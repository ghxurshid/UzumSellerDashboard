import type { ChangeEvent } from '@/services/storage/archive/codec';
import type { FinanceOrderItem } from '@/services/uzum/types';

/**
 * What a price change did to demand.
 *
 * This is the question the change journal was built to answer: *the price of
 * this product fell 15% on 15 July — did it sell any better?* Neither half of
 * that comes from one place. The move itself is only knowable from the journal,
 * because the seller API publishes no price history; the sales either side of
 * it come from the archived ledger, where every settled order item carries its
 * own date and amount.
 *
 * Two honesties are built into the result rather than left to the reader:
 *
 *   • **Observation windows are earned, not assumed.** The window either side
 *     of a move is clipped to the archive's own coverage and to the neighbouring
 *     moves on the same product, so a "before" period never includes days under
 *     a different price and never includes days the archive does not hold.
 *
 *   • **Correlation is not cause.** A move with too few days or too few units
 *     on either side is returned with `confident: false` rather than dropped or
 *     dressed up. Seasonality, stockouts and campaigns all move demand too, and
 *     nothing here can separate them.
 */

const DAY_MS = 86_400_000;

/** Days either side of a move that the comparison would like to have. */
const OBSERVE_DAYS = 14;

/** Below this many days on a side, the rate is noise rather than a rate. */
const MIN_DAYS = 4;

/** Below this many units on a side, one order swings the whole figure. */
const MIN_UNITS = 5;

/** Moves smaller than this are rounding, not repricing. */
const MIN_MOVE_PCT = 2;

export interface DemandWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly days: number;
  readonly units: number;
  readonly revenue: number;
  /** Units per day — the only figure comparable across unequal windows. */
  readonly perDay: number;
  /** Mean realised price per unit, which is what buyers actually paid. */
  readonly realisedPrice: number;
}

export interface PriceMove {
  readonly id: string;
  /** When the sync noticed the change — not necessarily when Uzum applied it. */
  readonly at: number;
  readonly productId: number;
  readonly title: string;
  /** SKUs that moved together in this capture. */
  readonly skuIds: readonly number[];
  readonly fromPrice: number;
  readonly toPrice: number;
  /** Signed change in listed price, per cent. */
  readonly movePct: number;
  readonly before: DemandWindow;
  readonly after: DemandWindow;
  /** Signed change in units per day, per cent. */
  readonly demandPct: number;
  /** Signed change in revenue per day, per cent. */
  readonly revenuePct: number;
  /** Whether both sides met the day and unit minimums. */
  readonly confident: boolean;
}

/* ── grouping ───────────────────────────────────────────────────────────── */

interface Move {
  readonly at: number;
  readonly productId: number;
  readonly skuIds: readonly number[];
  readonly fromPrice: number;
  readonly toPrice: number;
}

/**
 * Fold SKU-level price events into one move per product per capture.
 *
 * A seller repricing a product changes every size and colour under it, which
 * arrives as a dozen journal rows sharing one timestamp. Reporting them
 * separately would be a dozen findings about one decision, so they are averaged
 * into a single move — weighted by nothing, because the SKUs of one product
 * are alternatives to each other rather than quantities to be summed.
 */
function groupMoves(events: readonly ChangeEvent[]): readonly Move[] {
  const buckets = new Map<string, { at: number; productId: number; skus: ChangeEvent[] }>();

  for (const event of events) {
    if (event.field !== 'price') continue;
    if (event.from <= 0 || event.to <= 0) continue;

    const key = `${event.productId}:${event.at}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { at: event.at, productId: event.productId, skus: [event] });
    } else {
      bucket.skus.push(event);
    }
  }

  return [...buckets.values()]
    .map(({ at, productId, skus }): Move => {
      const from = skus.reduce((sum, event) => sum + event.from, 0) / skus.length;
      const to = skus.reduce((sum, event) => sum + event.to, 0) / skus.length;
      return { at, productId, skuIds: skus.map((event) => event.skuId), fromPrice: from, toPrice: to };
    })
    .sort((a, b) => a.at - b.at);
}

/* ── measurement ────────────────────────────────────────────────────────── */

/**
 * Sum a product's settled sales over a window.
 *
 * Cancelled items are excluded: a cancelled order returns commission and
 * `sellerProfit` as zero and never reaches the buyer, so counting it as demand
 * would credit a price cut with sales that did not happen. Returns are netted
 * off the unit count for the same reason.
 */
function measure(
  rows: readonly FinanceOrderItem[],
  fromMs: number,
  toMs: number,
): DemandWindow {
  const days = Math.max(0, (toMs - fromMs) / DAY_MS);
  let units = 0;
  let revenue = 0;

  for (const row of rows) {
    if (row.date < fromMs || row.date >= toMs) continue;
    if (row.status === 'CANCELED') continue;

    const net = Math.max(0, (row.amount ?? 0) - (row.amountReturns ?? 0));
    units += net;
    revenue += row.sellPrice * net;
  }

  return {
    fromMs,
    toMs,
    days,
    units,
    revenue,
    perDay: days === 0 ? 0 : units / days,
    realisedPrice: units === 0 ? 0 : revenue / units,
  };
}

function ratio(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : 100;
  return ((after - before) / before) * 100;
}

export interface PriceImpactInput {
  readonly journal: readonly ChangeEvent[];
  readonly ledger: readonly FinanceOrderItem[];
  /** Earliest instant the ledger actually covers — windows are clipped to it. */
  readonly coveredFrom: number | null;
  readonly coveredTo: number | null;
  readonly titleOf?: (productId: number) => string;
  readonly now?: number;
}

/**
 * Every price move the journal holds, with what happened either side.
 *
 * Returned newest first, since a move from last week is the one still worth
 * acting on. Moves whose windows fall entirely outside the archive's coverage
 * are dropped — there is nothing to measure them against and a zero would read
 * as "sold nothing" rather than "cannot say".
 */
export function derivePriceImpact(input: PriceImpactInput): readonly PriceMove[] {
  const now = input.now ?? Date.now();
  const moves = groupMoves(input.journal);
  if (moves.length === 0) return [];

  /* One pass to bucket the ledger by product; the alternative is a full scan of
     every archived row per move, which on a two-year archive is minutes. */
  const byProduct = new Map<number, FinanceOrderItem[]>();
  for (const row of input.ledger) {
    const bucket = byProduct.get(row.productId);
    if (bucket === undefined) byProduct.set(row.productId, [row]);
    else bucket.push(row);
  }

  const floor = input.coveredFrom ?? Number.NEGATIVE_INFINITY;
  const ceiling = Math.min(input.coveredTo ?? now, now);

  const results: PriceMove[] = [];

  moves.forEach((move, index) => {
    const movePct = ratio(move.fromPrice, move.toPrice);
    if (Math.abs(movePct) < MIN_MOVE_PCT) return;

    const rows = byProduct.get(move.productId) ?? [];

    /* Neighbouring moves on the same product bound the windows: days under a
       third price belong to neither comparison. */
    const previous = moves
      .slice(0, index)
      .filter((other) => other.productId === move.productId)
      .at(-1);
    const next = moves
      .slice(index + 1)
      .find((other) => other.productId === move.productId);

    const beforeFrom = Math.max(
      floor,
      previous?.at ?? Number.NEGATIVE_INFINITY,
      move.at - OBSERVE_DAYS * DAY_MS,
    );
    const afterTo = Math.min(
      ceiling,
      next?.at ?? Number.POSITIVE_INFINITY,
      move.at + OBSERVE_DAYS * DAY_MS,
    );

    if (beforeFrom >= move.at || afterTo <= move.at) return;

    const before = measure(rows, beforeFrom, move.at);
    const after = measure(rows, move.at, afterTo);

    const confident =
      before.days >= MIN_DAYS &&
      after.days >= MIN_DAYS &&
      before.units >= MIN_UNITS &&
      after.units >= MIN_UNITS;

    results.push({
      id: `${move.productId}-${move.at}`,
      at: move.at,
      productId: move.productId,
      title: input.titleOf?.(move.productId) ?? `product ${move.productId}`,
      skuIds: move.skuIds,
      fromPrice: move.fromPrice,
      toPrice: move.toPrice,
      movePct,
      before,
      after,
      demandPct: ratio(before.perDay, after.perDay),
      revenuePct: ratio(
        before.days === 0 ? 0 : before.revenue / before.days,
        after.days === 0 ? 0 : after.revenue / after.days,
      ),
      confident,
    });
  });

  return results.sort((a, b) => b.at - a.at);
}

/**
 * The moves worth showing first: confident ones, largest demand response first.
 *
 * A cut that did nothing is as informative as one that worked, so the sort is
 * on the magnitude of the response rather than its sign.
 */
export function rankPriceMoves(moves: readonly PriceMove[], limit = 5): readonly PriceMove[] {
  return [...moves]
    .filter((move) => move.confident)
    .sort((a, b) => Math.abs(b.demandPct) - Math.abs(a.demandPct))
    .slice(0, limit);
}
