import { ApiError } from '@/services/api/client';
import {
  commitCatalog,
  commitFbsInvoices,
  commitReturns,
  commitStocks,
  commitSupplyInvoiceItems,
  commitSupplyInvoices,
  readMeta,
  readProductSkus,
} from '@/services/storage/archive/archive.service';
import type { ChangeEvent } from '@/services/storage/archive/codec';
import { ENTITY_TYPES, SNAPSHOT_ENTITIES, type EntityType } from '@/services/storage/idb/schema';
import {
  fetchFbsInvoices,
  fetchReturns,
  fetchShopProducts,
  fetchSkuStocks,
  fetchSupplyInvoiceProducts,
  fetchSupplyInvoices,
} from '@/services/uzum/endpoints';
import type { InvoiceProduct, SkuAmount, SupplyInvoice } from '@/services/uzum/types';

/**
 * Capturing the entities that have no window.
 *
 * Six routes answer here — the catalogue, FBS stock, supply invoices and their
 * lines, warehouse returns and their lines, and FBS shipment invoices — and not
 * one of them accepts a date filter. `page` and `size` are the whole of their
 * query vocabulary. So there is no period to plan, nothing to subtract, and no
 * coverage record to consult: the only correct read is the whole set, and the
 * only correct write is a replacement.
 *
 * That is the difference from `lazySync.ts`, and it is a difference in the API
 * rather than a choice made here. A sale is a fact with a date on it and Uzum
 * will filter by that date; a price, a stock level and an invoice status are
 * claims about right now, and Uzum will only ever tell you what they are at the
 * moment you ask.
 *
 * ## Freshness instead of coverage
 *
 * A snapshot is skipped when the last capture is younger than the caller's
 * freshness window. That is the only economy available: without a date filter
 * the alternative to re-reading everything is re-reading nothing. `force`
 * bypasses it, because that is what pressing sync means.
 */

export interface SnapshotOptions {
  readonly shopId: number;
  readonly now?: number;
  readonly signal?: AbortSignal | undefined;
  /** Re-capture whatever the age of what is held. */
  readonly force?: boolean | undefined;
  /** Skip a capture younger than this. Zero always re-captures. */
  readonly maxAgeMs?: number | undefined;
  /**
   * Account-wide FBS amounts, read once per run and shared across shops.
   *
   * `/v3/fbs/sku/stocks` names no shop, so reading it per shop would fetch the
   * same rows once for each.
   */
  readonly stocks?: readonly SkuAmount[] | undefined;
  /** Whether the shared `stocks` read above was clipped by its page limit. */
  readonly stocksTruncated?: boolean | undefined;
  /**
   * Capture only these entities, instead of all six routes.
   *
   * A screen asking for one collection with `sync: true` should not pay for the
   * other five. Omitted means everything, which is what the sync button wants.
   *
   * Dependencies are still honoured — see `requested()` for which imply which.
   */
  readonly only?: readonly EntityType[] | undefined;
  /**
   * Called once, before the first entity that actually goes to the network.
   *
   * The sync log's contract: a source appears there when it turns out to need
   * requests, not when a screen re-reads what it already holds. Announcing
   * before the freshness check is how a run that fetched nothing comes to look
   * like a run that fetched everything.
   */
  readonly onBegin?: (() => void) | undefined;
  readonly onEntity?: (entity: EntityType, rows: number) => void;
}

export interface SnapshotReport {
  readonly shopId: number;
  /** Rows captured, per entity. Absent entities were skipped or failed. */
  readonly captured: Readonly<Partial<Record<EntityType, number>>>;
  /**
   * Entities whose page walk stopped at the limit before the route ran out.
   *
   * A snapshot is written by replacement, so a clipped read replaces a whole
   * catalogue with part of one. Absent means the entity was not captured this
   * run — which is not the same claim as "captured, and complete".
   */
  readonly truncated: Readonly<Partial<Record<EntityType, boolean>>>;
  /** Changes the catalogue capture revealed against the previous one. */
  readonly changes: readonly ChangeEvent[];
  readonly skipped: readonly EntityType[];
  readonly failures: readonly string[];
}

/**
 * How many supply invoices get their lines expanded.
 *
 * The line route takes one invoice at a time, so expanding a hundred invoices
 * is a hundred requests against an hourly budget. The recent ones are the ones
 * a shortfall would still be worth acting on, so the walk stops after this many.
 */
const INVOICE_DETAIL_LIMIT = 20;

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  /* A plain `Error` raised in here says something specific about why a capture
     could not run; collapsing it to "Unexpected failure" throws that away. */
  return error instanceof Error ? error.message : 'Unexpected failure';
}

/**
 * Which entities a run will attempt, with the ones that share a step pulled in.
 *
 * Three pairs are written by a single call and cannot be asked for separately:
 * products and their SKUs come out of one payload, returns and their lines out
 * of another, and invoice lines are expanded from the invoice list that was
 * just captured. Asking for the child alone would otherwise silently capture
 * nothing, because the step that writes it is keyed on the parent.
 *
 * Stock pulls the catalogue in too, but only when there is none stored. The
 * split of the account-wide amounts is made from the shop's SKU ids, and
 * `ownedSkus` reads those from the table when the capture did not run — so a
 * catalogue that already exists is enough, and re-walking it on every stock
 * sync would cost a full page walk per shop for an answer already held. Nothing
 * stored is the case that has no fallback, and only that case pays.
 */
async function requested(
  shopId: number,
  only: readonly EntityType[] | undefined,
): Promise<ReadonlySet<EntityType>> {
  if (only === undefined) return new Set(SNAPSHOT_ENTITIES);

  const wanted = new Set<EntityType>(only);
  const implies: readonly (readonly [EntityType, EntityType])[] = [
    [ENTITY_TYPES.productSku, ENTITY_TYPES.product],
    [ENTITY_TYPES.returnItem, ENTITY_TYPES.sellerReturn],
    [ENTITY_TYPES.supplyInvoiceItem, ENTITY_TYPES.supplyInvoice],
  ];

  for (const [child, parent] of implies) {
    if (wanted.has(child)) wanted.add(parent);
  }

  if (wanted.has(ENTITY_TYPES.fbsStock) && !wanted.has(ENTITY_TYPES.product)) {
    const stored = await readProductSkus(shopId);
    if (stored.rows.length === 0) wanted.add(ENTITY_TYPES.product);
  }

  return wanted;
}

/**
 * The SKUs this shop owns, for splitting the account-wide stock read.
 *
 * The catalogue capture hands these back when it runs. When it was skipped as
 * fresh they are read from the stored catalogue instead of giving up. `null`
 * means neither answered — the catalogue has never been captured and this run's
 * attempt at it failed — and the caller must then decline to store anything,
 * because storing every account's amounts under this shop would make `store_id`
 * a lie on the one entity the API never stamps.
 */
async function ownedSkus(
  shopId: number,
  fromCapture: ReadonlySet<number> | null,
): Promise<ReadonlySet<number> | null> {
  if (fromCapture !== null) return fromCapture;

  const stored = await readProductSkus(shopId);
  if (stored.rows.length === 0) return null;

  return new Set(stored.rows.map((row) => row.sku_id));
}

/** Whether a capture is recent enough to leave alone. */
async function isFresh(
  shopId: number,
  entity: EntityType,
  now: number,
  maxAgeMs: number,
): Promise<boolean> {
  if (maxAgeMs <= 0) return false;

  const meta = await readMeta(shopId, entity);
  if (meta.captured_at === null) return false;

  return now - meta.captured_at < maxAgeMs;
}

/**
 * Capture every snapshot entity for one shop.
 *
 * Each entity is independent: a failure captures nothing for that one and
 * leaves the previous capture in place, while the others carry on. Nothing here
 * is transactional across entities on purpose — a stale invoice table next to a
 * fresh catalogue is a far better outcome than neither being written because one
 * route was rate-limited.
 */
export async function captureSnapshots(options: SnapshotOptions): Promise<SnapshotReport> {
  const { shopId, signal } = options;
  const now = options.now ?? Date.now();
  const force = options.force === true;
  const maxAge = force ? 0 : (options.maxAgeMs ?? 0);

  const captured: Partial<Record<EntityType, number>> = {};
  const truncated: Partial<Record<EntityType, boolean>> = {};
  const skipped: EntityType[] = [];
  const failures: string[] = [];
  let changes: readonly ChangeEvent[] = [];
  let announced = false;

  const wanted = await requested(shopId, options.only);

  /** Run one capture, unless it was not asked for or is fresh enough to skip. */
  const step = async (
    entity: EntityType,
    run: () => Promise<number>,
  ): Promise<void> => {
    if (aborted(signal)) return;

    if (!wanted.has(entity)) return;

    if (await isFresh(shopId, entity, now, maxAge)) {
      skipped.push(entity);
      return;
    }

    /* Past the freshness gate is the first moment this run is known to need the
       network, which is the moment the sync log is entitled to hear about it. */
    if (!announced) {
      announced = true;
      options.onBegin?.();
    }

    try {
      const rows = await run();
      captured[entity] = rows;
      options.onEntity?.(entity, rows);
    } catch (error) {
      /* A run the caller cancelled is not a run that failed. React Query aborts
         the signal when a screen unmounts mid-read, and recording that would
         leave a red row in the sync log for work the user simply walked away
         from. */
      if (aborted(signal)) return;
      failures.push(`${entity}: ${describe(error)}`);
    }
  };

  /** Record that a route's page walk hit its limit before the collection ended. */
  const clipped = (entity: EntityType, wasTruncated: boolean): void => {
    truncated[entity] = wasTruncated;
  };

  /* The catalogue first: the stock capture below is partitioned by which of
     this shop's SKUs each amount belongs to, which needs the catalogue read. */
  const products = await captureCatalogue(
    options,
    now,
    step,
    (events) => {
      changes = events;
    },
    clipped,
  );

  await step(ENTITY_TYPES.fbsStock, async () => {
    let stocks = options.stocks;
    if (stocks === undefined) {
      const page = await fetchSkuStocks({ signal });
      clipped(ENTITY_TYPES.fbsStock, page.truncated);
      stocks = page.items;
    } else if (options.stocksTruncated !== undefined) {
      /* Only when the sharer said. An absent flag means the caller did not
         measure it, which is not the same claim as "the walk was complete". */
      clipped(ENTITY_TYPES.fbsStock, options.stocksTruncated);
    }

    /* `/v3/fbs/sku/stocks` is account-wide and names no shop. Only the amounts
       whose SKU is in this shop's catalogue are stored under it, so the same
       account-wide read can serve several shops without any of them claiming
       another's rows. */
    const skus = await ownedSkus(shopId, products);
    if (skus === null) {
      /* Nothing says which of these amounts are this shop's. Filing them all
         here would double every SKU on a two-shop account and put another
         seller's warehouse in this one's inventory. Better to store none and
         leave no stamp, so the next read — with a catalogue behind it — tries
         again. */
      throw new Error('catalogue unknown, cannot attribute account-wide amounts');
    }

    const owned = stocks.filter((stock) => skus.has(stock.skuId));
    const outcome = await commitStocks(shopId, owned, now);
    return outcome.rows;
  });

  const invoices = await captureSupplyInvoices(options, now, step);

  /* Only when the invoice list was actually captured just now. Expanding lines
     is keyed on that list, so with a skipped parent this step would announce
     the source, issue no request and settle — a fetch that never happened. */
  if (invoices.length > 0) {
    await step(ENTITY_TYPES.supplyInvoiceItem, async () => {
      /* Newest first, and only the first few: one request per invoice against
         an hourly budget is the constraint that decides this. */
      const recent = [...invoices]
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
        .slice(0, INVOICE_DETAIL_LIMIT);

      const lines: { invoiceId: number; products: readonly InvoiceProduct[] }[] = [];
      for (const invoice of recent) {
        if (aborted(signal)) break;
        const products_ = await fetchSupplyInvoiceProducts(shopId, invoice.id, { signal });
        lines.push({ invoiceId: invoice.id, products: products_ });
      }

      const outcome = await commitSupplyInvoiceItems(shopId, lines, now);
      return outcome.rows;
    });
  }

  await step(ENTITY_TYPES.sellerReturn, async () => {
    const page = await fetchReturns({ signal });
    const outcome = await commitReturns(shopId, page.items, now);
    captured[ENTITY_TYPES.returnItem] = outcome.items.rows;
    return outcome.entries.rows;
  });

  await step(ENTITY_TYPES.fbsInvoice, async () => {
    const page = await fetchFbsInvoices({ signal });
    const outcome = await commitFbsInvoices(shopId, page.items, now);
    return outcome.rows;
  });

  return { shopId, captured, truncated, changes, skipped, failures };
}

/**
 * Capture products and SKUs, and return the SKU ids the shop owns.
 *
 * The id set is what lets the account-wide stock read be split across shops. A
 * `null` return means the catalogue was not read this run — skipped as fresh,
 * not asked for, or failed — and the caller decides what that permits.
 */
async function captureCatalogue(
  options: SnapshotOptions,
  now: number,
  step: (entity: EntityType, run: () => Promise<number>) => Promise<void>,
  onChanges: (events: readonly ChangeEvent[]) => void,
  clipped: (entity: EntityType, wasTruncated: boolean) => void,
): Promise<ReadonlySet<number> | null> {
  let owned: ReadonlySet<number> | null = null;

  await step(ENTITY_TYPES.product, async () => {
    const page = await fetchShopProducts(options.shopId, { signal: options.signal });
    const stocks = options.stocks ?? [];

    /* The write is a replacement, so a clipped page walk swaps a whole
       catalogue for part of one. Say so rather than let the shorter table pass
       as the complete answer. */
    clipped(ENTITY_TYPES.product, page.truncated);

    const outcome = await commitCatalog(options.shopId, page.items, stocks, now);
    onChanges(outcome.events);

    owned = new Set(
      page.items.flatMap((product) => (product.skuList ?? []).map((sku) => sku.skuId)),
    );

    return outcome.products;
  });

  return owned;
}

/** Capture supply invoices, and hand back what was captured for line expansion. */
async function captureSupplyInvoices(
  options: SnapshotOptions,
  now: number,
  step: (entity: EntityType, run: () => Promise<number>) => Promise<void>,
): Promise<readonly SupplyInvoice[]> {
  let captured: readonly SupplyInvoice[] = [];

  await step(ENTITY_TYPES.supplyInvoice, async () => {
    const page = await fetchSupplyInvoices({ signal: options.signal });

    /* `/v1/invoice` is account-wide too, and unlike the stock route it does
       state a shop per row — so the split is a filter rather than a join. */
    captured = page.items.filter((invoice) => invoice.shopId === options.shopId);

    const outcome = await commitSupplyInvoices(options.shopId, captured, now);
    return outcome.rows;
  });

  return captured;
}

/**
 * Capture the same entities for several shops, reading account-wide once.
 *
 * `/v3/fbs/sku/stocks` names no shop and answers the same rows whichever one is
 * asked about, so a loop that let every shop's run fetch it would spend N
 * requests on one answer. It is read here instead and handed down.
 *
 * A failure to read it is deliberately not fatal and not recorded here: the
 * option is simply left off, each shop's own step tries again, and the failure
 * lands in that shop's report where the sync log can show it.
 */
export async function captureSnapshotsAcross(
  shopIds: readonly number[],
  options: Omit<SnapshotOptions, 'shopId' | 'stocks' | 'stocksTruncated'>,
): Promise<readonly SnapshotReport[]> {
  let shared: { items: readonly SkuAmount[]; truncated: boolean } | null = null;

  const needsStocks =
    options.only === undefined || options.only.includes(ENTITY_TYPES.fbsStock);

  if (shopIds.length > 1 && needsStocks) {
    try {
      const page = await fetchSkuStocks({ signal: options.signal });
      shared = { items: page.items, truncated: page.truncated };
    } catch {
      shared = null;
    }
  }

  const reports: SnapshotReport[] = [];

  for (const shopId of shopIds) {
    if (aborted(options.signal)) break;

    reports.push(
      await captureSnapshots({
        ...options,
        shopId,
        ...(shared === null ? {} : { stocks: shared.items, stocksTruncated: shared.truncated }),
      }),
    );
  }

  return reports;
}
