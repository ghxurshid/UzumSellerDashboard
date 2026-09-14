import { z } from 'zod';

import { hourInZone, weekdayInZone } from '@/lib/format';
import { toJsonSchema } from '@/services/ai/jsonSchema';
import { safeToolName, type ToolSchema } from '@/services/ai/messages';
import type { Scope } from '@/services/api/queryKeys';
import {
  readExpenses,
  readFinance,
  readInvoices,
  readOrders,
} from '@/services/data/collections';
import { summariseFinance } from '@/services/derive/finance';
import { derivePriceImpact } from '@/services/derive/priceImpact';
import { flattenSkus } from '@/services/derive/products';
import {
  ENTITY_TYPES,
  readJournal,
  readLedger,
  readMeta,
  readShopMeta,
} from '@/services/storage/archive/archive.service';
import { bounds } from '@/services/storage/archive/coverage';
import type { Granularity } from '@/services/storage/idb/aggregation';
import { loadExpenseTotals, loadProductTotals } from '@/services/storage/idb/analytics.client';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import { WINDOWED_ENTITIES } from '@/services/storage/idb/schema';
import { readGeneralPreferences } from '@/store/preferences.store';
import { useAlertsStore } from '@/store/alerts.store';
import type { Language, Product } from '@/types/domain';

import { INSIGHT_ACTIONS, ACTION_IDS } from './actions';
import {
  bucketLabel,
  bucketStarts,
  buildPattern,
  buildProductTimeline,
  buildTimeline,
  isCancelled,
  lineRevenue,
  pageOf,
  pickGranularity,
  rowStamp,
  spansOneYear,
  type TimelineMeasure,
} from './datasets';
import { ledgerTable, moneyLines } from './digest';
import {
  clip,
  compose,
  dec,
  header,
  isoDay,
  isoMinute,
  num,
  pairs,
  parseDay,
  table,
  windowLabel,
} from './plaintext';

/**
 * What the model may go and look up, and what a lookup hands back.
 *
 * The old arrangement put a fixed fact table in front of every prompt and asked
 * the model to work from it. That is the right shape for the insights rail,
 * whose question never changes, and the wrong one for a chat: "which SKUs are
 * empty" wants a list, "why is the abaya losing money" wants one product's rows,
 * "how did the last seven days go" wants a day-by-day series, and none of those
 * can be precomputed alongside every other thing a seller might ask.
 *
 * So the model starts with nothing and asks. The base prompt tells it that a
 * toolkit exists; `describeToolkit()` writes the toolkit out when it asks for
 * it; and each entry below is one thing it can then do.
 *
 * ## Three properties every tool holds to
 *
 *   **The archive answers first.** Every read goes through the collections door
 *   in `services/data`, which consults `sync_metadata`, fetches only the part of
 *   the window this machine does not already hold, writes it, and then answers
 *   from IndexedDB. A period read last week costs nothing; an unseen one costs
 *   one fetch. The tool does not decide this and cannot bypass it.
 *
 *   **Results are the data itself.** Plain text, a header saying what was read,
 *   and pipe-separated tables — see `plaintext.ts`. A result used to name refs
 *   the model could cite but never state; it now hands over the numbers, and the
 *   model computes from them and writes what it found into the answer.
 *
 *   **Two depths.** Most lookups *compute*: totals, rankings, a timeline per day,
 *   a comparison of two windows — the arithmetic a question usually needs, done
 *   here over every row rather than by a model adding up a column in its head.
 *   `data.rows` does not: it pages through the raw lines so a question no
 *   computing lookup anticipated can still be answered from the rows themselves.
 */

/* ── context and result ─────────────────────────────────────────────────── */

export interface ToolContext {
  /** The scope the seller has selected — the default window for every read. */
  readonly scope: Scope;
  /** The catalogue already in the query cache. No request is made for it. */
  readonly products: readonly Product[];
  readonly shops: ReadonlyArray<{ readonly id: number; readonly name: string }>;
  readonly language: Language;
  readonly now: number;
  readonly signal: AbortSignal | undefined;
}

export interface ToolResult {
  /** What the model reads. Plain text, self-describing. */
  readonly text: string;
  /** Routes or stores touched, for the answer's context chip. */
  readonly routes?: readonly string[];
  /** One short line for the tool chip in the transcript. */
  readonly trace?: string;
}

interface ToolSpec {
  /** Where the rows come from, shown in the result header. */
  readonly route: string;
  /** The argument shape, for the toolkit document. */
  readonly args: string;
  /** One to three lines telling the model when this is the right lookup. */
  readonly summary: readonly string[];
  readonly schema: z.ZodTypeAny;
  /**
   * Arguments arrive already validated by `schema`, which is why this takes a
   * bag rather than a generic: the alternative is a per-tool type parameter
   * that TypeScript then cannot call through a registry lookup, and the small
   * readers below cost less than that machinery.
   */
  readonly run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

/* ── argument readers ───────────────────────────────────────────────────── */

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;

const flag = (value: unknown): boolean => value === true;

const ids = (value: unknown): readonly number[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is number => typeof entry === 'number' && entry > 0))]
    : [];

/* ── windows ────────────────────────────────────────────────────────────── */

/** A read may not walk further back than this in one call. */
const MAX_SPAN_DAYS = 400;
const DAY_MS = 86_400_000;

interface Window {
  readonly fromMs: number;
  readonly toMs: number;
  /** Set when the request was clamped, so the header can say so. */
  readonly note: string | null;
}

/**
 * The window a lookup runs over.
 *
 * Omitting `from`/`to` means the period the seller has selected, which is the
 * common case and the one that keeps an answer consistent with the screen
 * behind it. A named window is taken as whole UTC days, both ends included.
 */
function windowOf(args: Record<string, unknown>, context: ToolContext): Window {
  const from = parseDay(args['from'], 'start');
  const to = parseDay(args['to'], 'end');

  if (from === null && to === null) {
    return { fromMs: context.scope.fromMs, toMs: context.scope.toMs, note: null };
  }

  let fromMs = from ?? context.scope.fromMs;
  let toMs = to ?? context.now;
  if (fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];

  if (toMs - fromMs > MAX_SPAN_DAYS * DAY_MS) {
    fromMs = toMs - MAX_SPAN_DAYS * DAY_MS;
    return { fromMs, toMs, note: `clamped to the last ${MAX_SPAN_DAYS} days` };
  }

  return { fromMs, toMs, note: null };
}

const scopeFor = (context: ToolContext, window: Window): Scope => ({
  ...context.scope,
  fromMs: window.fromMs,
  toMs: window.toMs,
});

const shopsLine = (context: ToolContext): string => `shops ${context.scope.shopIds.join(',')}`;

/**
 * One number as a percentage of another, or an empty cell.
 *
 * The empty cell is the point. A window that sold nothing has a zero denominator
 * and a window that lost money has a negative one — neither has an honest
 * percentage behind it, and a share of a negative total reads backwards: the
 * worst product of a loss-making month would carry the largest positive share.
 */
function pctOf(part: number, whole: number): string | null {
  return whole > 0 ? dec((part / whole) * 100) : null;
}

const MONEY_LINE = "money so'm, whole numbers · Pct columns are percent, already multiplied by 100";

/* ── shared schema fragments ────────────────────────────────────────────── */

const dayString = z.string().trim().min(4).max(30);
const windowArgs = {
  from: dayString.optional(),
  to: dayString.optional(),
  fresh: z.boolean().optional(),
};
const productIdsSchema = z.array(z.number().int().positive()).min(1).max(8);
const granularitySchema = z.enum(['hour', 'day', 'week', 'month']);

/** How many buckets a timeline may return before it is coarsened. */
const MAX_BUCKETS = 400;

/** The catalogue's name for a product, or what the rows called it. */
function nameOf(context: ToolContext, productId: number, fallback?: string): string {
  const product = context.products.find((entry) => entry.productId === productId);
  return clip(product?.name ?? fallback ?? `product ${productId}`);
}

/** Read the order lines for a window through the one door that syncs. */
async function financeFor(
  args: Record<string, unknown>,
  context: ToolContext,
  window: Window,
) {
  return readFinance(scopeFor(context, window), {
    sync: true,
    force: flag(args['fresh']),
    signal: context.signal,
  });
}

/* ── the read registry ──────────────────────────────────────────────────── */

export const READ_TOOLS: Readonly<Record<string, ToolSpec>> = {
  'window.totals': {
    route: 'archive → GET /v1/finance/orders + /v1/finance/expenses',
    args: '{from?, to?, fresh?}',
    summary: [
      'The whole money model for one window, computed over every order line: sellPrice,',
      'commission, logistics, sellerProfit, cost of goods, the expense ledger by source, net',
      'profit and margin, orders, units, cancellations and returns. Start here for a period as a whole.',
    ],
    schema: z.object(windowArgs),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const scope = scopeFor(context, window);
      const fresh = flag(args['fresh']);

      const finance = await readFinance(scope, { sync: true, force: fresh, signal: context.signal });
      const expenses = await readExpenses(scope, { sync: true, force: fresh, signal: context.signal });

      const totals = summariseFinance(finance.items, expenses.payments, {
        cancelledTotal: finance.cancelledTotal,
        reportedTotal: finance.total,
      });

      return {
        routes: ['/v1/finance/orders', '/v1/finance/expenses'],
        trace: `${windowLabel(window.fromMs, window.toMs)} · ${finance.items.length} rows`,
        text: compose([
          header('window.totals', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `${finance.items.length} order lines`,
            `${expenses.payments.length} ledger rows`,
            finance.truncated ? 'TRUNCATED: retention has cut into this window' : null,
            window.note,
            fresh ? 'refetched from Uzum' : null,
          ]),
          ...moneyLines(totals),
          ledgerTable(totals),
        ]),
      };
    },
  },

  'period.compare': {
    route: 'archive → GET /v1/finance/orders + /v1/finance/expenses',
    args: '{from?, to?, baseFrom?, baseTo?}',
    summary: [
      'Two windows side by side with the change between them, already computed. Omit baseFrom',
      'and baseTo and the comparison is the window of the same length immediately before.',
      'The tool for "is it getting better", month against month, before against after.',
    ],
    schema: z.object({
      ...windowArgs,
      baseFrom: dayString.optional(),
      baseTo: dayString.optional(),
    }),
    run: async (args, context) => {
      const current = windowOf(args, context);
      const baseFrom = parseDay(args['baseFrom'], 'start');
      const baseTo = parseDay(args['baseTo'], 'end');
      const span = current.toMs - current.fromMs;

      const previous: Window =
        baseFrom === null && baseTo === null
          ? { fromMs: current.fromMs - span - 1, toMs: current.fromMs - 1, note: null }
          : {
              fromMs: baseFrom ?? current.fromMs - span - 1,
              toMs: baseTo ?? current.fromMs - 1,
              note: null,
            };

      const read = async (window: Window) => {
        const scope = scopeFor(context, window);
        const finance = await readFinance(scope, { sync: true, signal: context.signal });
        const expenses = await readExpenses(scope, { sync: true, signal: context.signal });
        return summariseFinance(finance.items, expenses.payments, {
          cancelledTotal: finance.cancelledTotal,
          reportedTotal: finance.total,
        });
      };

      const now = await read(current);
      const before = await read(previous);

      const measures: ReadonlyArray<readonly [string, number, number, boolean]> = [
        ['sellPrice', now.sellPrice, before.sellPrice, false],
        ['commission', now.commission, before.commission, false],
        ['logistics', now.logisticDeliveryFee, before.logisticDeliveryFee, false],
        ['sellerProfit', now.sellerProfit, before.sellerProfit, false],
        ['purchasePrice', now.purchasePrice, before.purchasePrice, false],
        ['expenseOther', now.expenseOther, before.expenseOther, false],
        ['netProfit', now.netProfit, before.netProfit, false],
        ['orders', now.orders, before.orders, false],
        ['units', now.units, before.units, false],
        ['aov', now.averageOrderValue, before.averageOrderValue, false],
        ['cancelledItems', now.cancelledItems, before.cancelledItems, false],
        ['returnedUnits', now.returnedUnits, before.returnedUnits, false],
        ['netMarginPct', now.netMargin, before.netMargin, true],
        ['cancellationRatePct', now.cancellationRate, before.cancellationRate, true],
      ];

      const rows = measures.map(([name, currentValue, previousValue, isRate]) => {
        const change = currentValue - previousValue;
        return [
          name,
          isRate ? dec(currentValue) : num(currentValue),
          isRate ? dec(previousValue) : num(previousValue),
          isRate ? dec(change) : num(change),
          /* A rate's change is already in points; a percent change of a percent
             is a number nobody means. */
          isRate || previousValue === 0 ? null : dec((change / Math.abs(previousValue)) * 100),
        ];
      });

      return {
        routes: ['/v1/finance/orders', '/v1/finance/expenses'],
        trace: `${windowLabel(current.fromMs, current.toMs)} vs ${windowLabel(previous.fromMs, previous.toMs)}`,
        text: compose([
          header('period.compare', [
            `current ${windowLabel(current.fromMs, current.toMs)}`,
            `previous ${windowLabel(previous.fromMs, previous.toMs)}`,
            shopsLine(context),
            current.note,
          ]),
          MONEY_LINE,
          'change = current - previous; changePct = change / |previous| × 100, empty when previous is 0.',
          'For the two Pct measures the change is in percentage points.',
          table(['measure', 'current', 'previous', 'change', 'changePct'], rows),
        ]),
      };
    },
  },

  'sales.timeline': {
    route: 'archive:order_item → GET /v1/finance/orders',
    args: '{from?, to?, granularity?:"hour|day|week|month", productIds?:[number] ≤8, measure?:"units|revenue|sellerProfit|orders"}',
    summary: [
      'Sales bucketed over time — the tool for dynamics, trends, "which day was best", and the',
      'data behind a line chart. Without productIds: the whole shop per bucket (orders, units,',
      'revenue, sellerProfit, commission, logistics, returns, cancelled). With productIds: one',
      'column per product for the chosen measure, same buckets, zeros where nothing sold.',
    ],
    schema: z.object({
      ...windowArgs,
      granularity: granularitySchema.optional(),
      productIds: productIdsSchema.optional(),
      measure: z.enum(['units', 'revenue', 'sellerProfit', 'orders']).optional(),
    }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const asked = str(args['granularity']) as Granularity | undefined;

      /* A granularity that would produce thousands of rows is coarsened rather
         than refused: the model asked for a shape, and the nearest readable
         shape answers it better than an error does. */
      let granularity = asked ?? pickGranularity(window.fromMs, window.toMs);
      let coarsened: string | null = null;
      if (bucketStarts(window.fromMs, window.toMs, granularity).length > MAX_BUCKETS) {
        granularity = pickGranularity(window.fromMs, window.toMs);
        coarsened = `${asked ?? 'that'} buckets would exceed ${MAX_BUCKETS} rows — coarsened to ${granularity}`;
      }

      const finance = await financeFor(args, context, window);
      const productIds = ids(args['productIds']);
      const clock =
        granularity === 'hour'
          ? 'bucket = UTC hour'
          : granularity === 'day'
            ? 'bucket = UTC day'
            : granularity === 'week'
              ? 'bucket = week starting Monday (UTC)'
              : 'bucket = calendar month (UTC)';

      if (productIds.length > 0) {
        const measure = (str(args['measure']) ?? 'units') as TimelineMeasure;
        const result = buildProductTimeline(finance.items, window, granularity, productIds, measure);

        return {
          routes: ['archive:order_item'],
          trace: `${productIds.length} products · ${measure} · ${result.starts.length} ${granularity}s`,
          text: compose([
            header('sales.timeline', [
              windowLabel(window.fromMs, window.toMs),
              shopsLine(context),
              `${productIds.length} products`,
              `measure ${measure}`,
              `${result.starts.length} ${granularity} buckets`,
              window.note,
              coarsened,
            ]),
            measure === 'revenue' || measure === 'sellerProfit' ? MONEY_LINE : null,
            `${clock} · revenue = sellPrice × amount · cancelled lines add nothing`,
            'products (the columns below are these productIds):',
            table(
              ['productId', 'name', `total ${measure}`],
              productIds.map((id) => [
                id,
                nameOf(context, id, result.titles.get(id)),
                result.totals.get(id) ?? 0,
              ]),
            ),
            table(
              ['bucket', ...productIds.map(String)],
              result.starts.map((at, position) => [
                bucketLabel(at, granularity),
                ...productIds.map((id) => result.values.get(id)?.[position] ?? 0),
              ]),
            ),
          ]),
        };
      }

      const timeline = buildTimeline(finance.items, window, granularity);
      const busiest = timeline.buckets.reduce<(typeof timeline.buckets)[number] | undefined>(
        (best, bucket) => (best === undefined || bucket.revenue > best.revenue ? bucket : best),
        undefined,
      );

      return {
        routes: ['archive:order_item'],
        trace: `${timeline.buckets.length} ${granularity}s · ${finance.items.length} rows`,
        text: compose([
          header('sales.timeline', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            'all products',
            `${timeline.buckets.length} ${granularity} buckets`,
            `${finance.items.length} order lines`,
            finance.truncated ? 'TRUNCATED: retention has cut into this window' : null,
            window.note,
            coarsened,
          ]),
          MONEY_LINE,
          `${clock} · revenue = sellPrice × amount · orders are distinct order ids · cancelled lines are only counted in cancelled`,
          table(
            ['bucket', 'orders', 'units', 'revenue', 'sellerProfit', 'commission', 'logistics', 'returns', 'cancelled'],
            [
              ...timeline.buckets.map((bucket) => [
                bucketLabel(bucket.at, granularity),
                bucket.orders,
                bucket.units,
                bucket.revenue,
                bucket.sellerProfit,
                bucket.commission,
                bucket.logistics,
                bucket.returns,
                bucket.cancelled,
              ]),
              [
                'TOTAL',
                timeline.total.orders,
                timeline.total.units,
                timeline.total.revenue,
                timeline.total.sellerProfit,
                timeline.total.commission,
                timeline.total.logistics,
                timeline.total.returns,
                timeline.total.cancelled,
              ],
            ],
          ),
          busiest === undefined || busiest.revenue === 0
            ? 'no sales in this window'
            : `highest revenue bucket: ${bucketLabel(busiest.at, granularity)}`,
        ]),
      };
    },
  },

  'sales.pattern': {
    route: 'archive:order_item',
    args: '{from?, to?, by:"hour|weekday"}',
    summary: [
      'Orders, units and revenue folded onto the hour of the day or the day of the week, in the',
      "seller's own time zone. For \"when do my orders come in\" and \"which weekday sells best\".",
    ],
    schema: z.object({ ...windowArgs, by: z.enum(['hour', 'weekday']) }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const by = str(args['by']) === 'weekday' ? 'weekday' : 'hour';
      const finance = await financeFor(args, context, window);

      const rows =
        by === 'hour'
          ? buildPattern(finance.items, hourInZone, 24)
          : buildPattern(finance.items, weekdayInZone, 7);
      const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      return {
        routes: ['archive:order_item'],
        trace: `by ${by} · ${finance.items.length} rows`,
        text: compose([
          header('sales.pattern', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `by ${by}`,
            `zone ${readGeneralPreferences().timezone}`,
            window.note,
          ]),
          MONEY_LINE,
          'orders are distinct order ids · revenue = sellPrice × amount · cancelled lines excluded',
          by === 'weekday'
            ? 'A short window holds some weekdays once and others not at all — say so before ranking them.'
            : null,
          table(
            [by, 'orders', 'units', 'revenue', 'revenuePct'],
            rows.map((row) => [
              by === 'hour' ? row.key : (days[row.key] ?? String(row.key)),
              row.orders,
              row.units,
              row.revenue,
              pctOf(row.revenue, revenue),
            ]),
          ),
        ]),
      };
    },
  },

  'products.rank': {
    route: 'archive:order_item + catalogue',
    args: '{from?, to?, limit?:1-50, by?:"revenue|profit|units|netActual|returns", order?:"desc|asc"}',
    summary: [
      'Every product that sold in the window, ranked, with its whole profit chain computed from',
      'the archive — units, orders, revenue, commission, logistics, sellerProfit, cost, netActual —',
      'its share of the window, its margins, and current price and stock. order:"asc" finds the',
      'weakest. The tool for "best seller", "which products lose money", "top 10 by profit".',
    ],
    schema: z.object({
      ...windowArgs,
      limit: z.number().int().min(1).max(50).optional(),
      by: z.enum(['revenue', 'profit', 'units', 'netActual', 'returns']).optional(),
      order: z.enum(['desc', 'asc']).optional(),
    }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const limit = int(args['limit'], 10);
      const by = (str(args['by']) ?? 'revenue') as 'revenue' | 'profit' | 'units' | 'netActual' | 'returns';
      const ascending = str(args['order']) === 'asc';

      await financeFor(args, context, window);

      /**
       * Every product in the window, ranked here rather than by the worker.
       *
       * A share is a fraction of the window's total, and a total summed over a
       * truncated list is the total of whatever survived the cut. The roll-up
       * already builds every product, so the whole list crosses the worker
       * boundary and the slice happens after the sort that was actually asked for.
       */
      const totals = await loadProductTotals(context.scope.shopIds, window.fromMs, window.toMs, {
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });

      const sum = (pick: (entry: (typeof totals)[number]) => number): number =>
        totals.reduce((acc, entry) => acc + pick(entry), 0);
      const windowRevenue = sum((entry) => entry.revenue);
      const windowProfit = sum((entry) => entry.profit);
      const windowCost = sum((entry) => entry.purchaseCost);

      const catalogue = new Map(context.products.map((product) => [product.productId, product]));
      const keyOf = (entry: (typeof totals)[number]): number =>
        by === 'netActual' ? entry.profit - entry.purchaseCost : entry[by];
      const ranked = [...totals]
        .sort((a, b) => (ascending ? keyOf(a) - keyOf(b) : keyOf(b) - keyOf(a)))
        .slice(0, limit);

      const rows = ranked.map((entry) => {
        const product = catalogue.get(entry.productId);
        const netActual = entry.profit - entry.purchaseCost;
        /**
         * Two nets, because there are two honest questions.
         *
         * `netActual` uses the cost the archive recorded when the sale settled,
         * which is what the seller actually kept. `netEst` re-prices the same
         * units at today's catalogue cost — what the same sales would earn at
         * the price the seller buys at now. When they disagree, the gap is the
         * answer to "why is last month's margin not this month's".
         */
        const netEst =
          product === undefined ? null : entry.profit - product.purchasePrice * entry.units;

        return [
          entry.productId,
          clip(entry.title === '' ? (product?.name ?? '') : entry.title),
          entry.units,
          entry.orders,
          entry.revenue,
          entry.commission,
          entry.logistics,
          entry.profit,
          entry.purchaseCost,
          netActual,
          netEst,
          entry.returns,
          entry.cancelled,
          pctOf(entry.revenue, windowRevenue),
          pctOf(entry.profit, windowProfit),
          pctOf(entry.profit, entry.revenue),
          pctOf(netActual, entry.revenue),
          product?.price ?? null,
          product?.quantityAvailable ?? null,
        ];
      });

      return {
        routes: ['archive:order_item', '/v1/product/shop/{shopId}'],
        trace: `${rows.length} products by ${by}${ascending ? ' (asc)' : ''}`,
        text: compose([
          header('products.rank', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `by ${by} ${ascending ? 'asc' : 'desc'}`,
            `${totals.length} products sold in the window`,
            `showing ${rows.length}`,
            window.note,
          ]),
          MONEY_LINE,
          `window, every product: ${pairs([
            ['revenue', num(windowRevenue)],
            ['sellerProfit', num(windowProfit)],
            ['cost', num(windowCost)],
            ['netActual', num(windowProfit - windowCost)],
            ['units', sum((entry) => entry.units)],
          ])}`,
          'revenue = sellPrice × amount. revenue - commission - logistics = sellerProfit;',
          'sellerProfit - cost = netActual (cost recorded at sale); netEst uses today\'s purchasePrice.',
          'Share and margin Pct columns are empty where the denominator is zero or negative.',
          'price and available are the current catalogue, not values as of the window.',
          rows.length === 0
            ? 'no sales in this window'
            : table(
                [
                  'productId', 'name', 'units', 'orders', 'revenue', 'commission', 'logistics',
                  'sellerProfit', 'cost', 'netActual', 'netEst', 'returns', 'cancelled',
                  'revenueSharePct', 'profitSharePct', 'marginPct', 'netActualMarginPct', 'price', 'available',
                ],
                rows,
              ),
        ]),
      };
    },
  },

  'product.find': {
    route: 'catalogue + archive:order_item',
    args: '{query:"name fragment or productId", from?, to?}',
    summary: [
      'One product in full: price and purchase price per SKU, stock, lifetime counters, status,',
      'and what it earned over the window. Use it before proposing a price or stock write — those',
      'need skuId and barcode — and to get the productId a timeline needs.',
    ],
    schema: z.object({ ...windowArgs, query: z.string().trim().min(1).max(80) }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const query = str(args['query']) ?? '';
      const asId = Number(query);

      const needle = query.toLowerCase();
      const matches = context.products.filter((product) =>
        Number.isFinite(asId) && asId > 0
          ? product.productId === asId
          : product.name.toLowerCase().includes(needle),
      );

      const product = matches[0];
      if (product === undefined) {
        return {
          trace: `no match for "${query}"`,
          text: compose([
            header('product.find', [`query "${query}"`, 'no match']),
            `the catalogue holds ${context.products.length} products for the shops in scope.`,
            'Try a shorter fragment, or products.rank to see what is actually selling.',
          ]),
        };
      }

      await financeFor(args, context, window);
      const totals = await loadProductTotals(context.scope.shopIds, window.fromMs, window.toMs, {
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });
      const sold = totals.find((entry) => entry.productId === product.productId);

      return {
        routes: ['/v1/product/shop/{shopId}', 'archive:order_item'],
        trace: product.name,
        text: compose([
          header('product.find', [
            clip(product.name, 120),
            `productId ${product.productId}`,
            `shopId ${product.shopId}`,
            product.statusTitle === '' ? product.status : `${product.status} (${product.statusTitle})`,
            matches.length > 1 ? `${matches.length - 1} other products also matched` : null,
          ]),
          MONEY_LINE,
          `catalogue now: ${pairs([
            ['price', product.price],
            ['purchasePrice', product.purchasePrice],
            ['unitMargin', product.price - product.purchasePrice],
            ['available', product.quantityAvailable],
            ['fbs', product.quantityFbs],
            ['soldLifetime', product.sold],
            ['returnedPct', dec(product.returnedPct)],
            ['rank', product.rank],
          ])}`,
          sold === undefined
            ? `window ${windowLabel(window.fromMs, window.toMs)}: no sales`
            : compose([
                `window ${windowLabel(window.fromMs, window.toMs)}: ${pairs([
                  ['units', sold.units],
                  ['orders', sold.orders],
                  ['revenue', sold.revenue],
                  ['commission', sold.commission],
                  ['logistics', sold.logistics],
                  ['sellerProfit', sold.profit],
                  ['cost', sold.purchaseCost],
                  ['netActual', sold.profit - sold.purchaseCost],
                  ['netEst', sold.profit - product.purchasePrice * sold.units],
                  ['returns', sold.returns],
                  ['cancelled', sold.cancelled],
                ])}`,
                pairs([
                  ['marginPct', pctOf(sold.profit, sold.revenue) ?? ''],
                  ['netActualMarginPct', pctOf(sold.profit - sold.purchaseCost, sold.revenue) ?? ''],
                  ['commissionRatePct', pctOf(sold.commission, sold.revenue) ?? ''],
                ]),
              ]),
          'skus (skuId and barcode are what a price or stock write needs):',
          table(
            ['skuId', 'title', 'barcode', 'price', 'purchasePrice', 'available', 'fbs', 'sold', 'returned'],
            product.skus
              .slice(0, 20)
              .map((sku) => [
                sku.skuId,
                clip(sku.skuTitle, 50),
                sku.barcode === '' ? null : sku.barcode,
                sku.price,
                sku.purchasePrice,
                sku.quantityAvailable,
                sku.quantityFbs,
                sku.quantitySold,
                sku.quantityReturned,
              ]),
          ),
          matches.length > 1
            ? compose([
                'also matched:',
                table(
                  ['productId', 'name'],
                  matches.slice(1, 8).map((entry) => [entry.productId, clip(entry.name)]),
                ),
              ])
            : null,
        ]),
      };
    },
  },

  'expenses.breakdown': {
    route: 'archive:expense',
    args: '{from?, to?}',
    summary: [
      'The seller expense ledger split by name, biggest outgoing first, with income and net',
      'movement. Logistics appears here and inside sellerProfit — do not subtract it twice.',
    ],
    schema: z.object(windowArgs),
    run: async (args, context) => {
      const window = windowOf(args, context);

      await readExpenses(scopeFor(context, window), {
        sync: true,
        force: flag(args['fresh']),
        signal: context.signal,
      });

      const totals = await loadExpenseTotals(context.scope.shopIds, window.fromMs, window.toMs, {
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });

      return {
        routes: ['/v1/finance/expenses'],
        trace: `${totals.rows} ledger rows`,
        text: compose([
          header('expenses.breakdown', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `${totals.rows} rows`,
            window.note,
          ]),
          MONEY_LINE,
          pairs([
            ['net', num(totals.net)],
            ['income', num(totals.income)],
            ['outgoing', num(totals.outgoing)],
          ]),
          totals.byName.length === 0
            ? 'no outgoing ledger rows in this window'
            : table(
                ['name', 'amount', 'pctOfOutgoing'],
                totals.byName
                  .slice(0, 25)
                  .map((entry) => [clip(entry.name), num(entry.amount), pctOf(entry.amount, totals.outgoing)]),
              ),
        ]),
      };
    },
  },

  'stock.health': {
    route: 'catalogue snapshot',
    args: '{filter?:"empty|negative|low|runOut|all", limit?:1-60, below?:number}',
    summary: [
      'SKUs that need attention: empty, negative, below a threshold, or products the API marks',
      'RUN_OUT. Every row carries skuId and barcode, which is what a stock write needs.',
    ],
    schema: z.object({
      filter: z.enum(['empty', 'negative', 'low', 'runOut', 'all']).optional(),
      limit: z.number().int().min(1).max(60).optional(),
      below: z.number().int().min(1).max(1000).optional(),
    }),
    run: async (args, context) => {
      const filter = (str(args['filter']) ?? 'empty') as 'empty' | 'negative' | 'low' | 'runOut' | 'all';
      const limit = int(args['limit'], 20);
      const below = int(args['below'], 5);

      const skus = flattenSkus(context.products);
      const runOut = new Set(
        context.products.filter((product) => product.status === 'RUN_OUT').map((product) => product.productId),
      );

      const selected = skus.filter((sku) => {
        switch (filter) {
          case 'empty':
            return sku.quantityAvailable === 0;
          case 'negative':
            return sku.quantityAvailable < 0;
          case 'low':
            return sku.quantityAvailable > 0 && sku.quantityAvailable < below;
          case 'runOut':
            return runOut.has(sku.productId);
          case 'all':
            return true;
        }
      });

      const shown = selected.slice(0, limit);

      return {
        routes: ['/v1/product/shop/{shopId}'],
        trace: `${selected.length} SKUs match "${filter}"`,
        text: compose([
          header('stock.health', [
            `filter ${filter}`,
            filter === 'low' ? `below ${below}` : null,
            `${selected.length} matched of ${skus.length} SKUs`,
            'catalogue snapshot, current values',
          ]),
          pairs([
            ['products', context.products.length],
            ['skus', skus.length],
            ['skusAtZero', skus.filter((sku) => sku.quantityAvailable === 0).length],
            ['skusNegative', skus.filter((sku) => sku.quantityAvailable < 0).length],
            ['productsRunOut', runOut.size],
          ]),
          shown.length === 0
            ? 'nothing matches this filter'
            : table(
                ['skuId', 'productId', 'product', 'sku', 'barcode', 'available', 'fbs', 'price', 'sold'],
                shown.map((sku) => [
                  sku.skuId,
                  sku.productId,
                  clip(sku.productTitle, 50),
                  clip(sku.skuTitle, 40),
                  sku.barcode === '' ? null : sku.barcode,
                  sku.quantityAvailable,
                  sku.quantityFbs,
                  sku.price,
                  sku.quantitySold,
                ]),
              ),
          selected.length > shown.length
            ? `(${selected.length - shown.length} more not listed — raise limit, or data.rows dataset "catalogue")`
            : null,
        ]),
      };
    },
  },

  'orders.pipeline': {
    route: 'archive:fbs_order → GET /v2/fbs/orders',
    args: '{from?, to?, status?, limit?:1-50, fresh?}',
    summary: [
      'FBS and DBS orders in the window with their deadlines, counted by status. dateAcceptUntil',
      'is the one that costs money: an order not confirmed before it passes is cancelled by the',
      'marketplace. Use fresh:true when the seller is asking what to do right now.',
    ],
    schema: z.object({
      ...windowArgs,
      status: z
        .enum(['CREATED', 'PACKING', 'PENDING_DELIVERY', 'DELIVERING', 'DELIVERED', 'COMPLETED', 'CANCELED', 'RETURNED'])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const status = str(args['status']);
      const limit = int(args['limit'], 20);

      const source = await readOrders(scopeFor(context, window), {
        sync: true,
        force: flag(args['fresh']),
        signal: context.signal,
      });

      const selected =
        status === undefined ? source.orders : source.orders.filter((order) => order.status === status);
      const counts = Object.entries(source.counts).filter(([, value]) => value > 0);
      const overdue = selected.filter(
        (order) =>
          order.status === 'CREATED' && order.dateAcceptUntil !== null && order.dateAcceptUntil < context.now,
      );

      return {
        routes: ['/v2/fbs/orders'],
        trace: `${selected.length} orders${status === undefined ? '' : ` in ${status}`}`,
        text: compose([
          header('orders.pipeline', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            status === undefined ? 'all statuses' : `status ${status}`,
            `${source.total} orders read`,
            window.note,
          ]),
          `now is ${isoMinute(context.now)} UTC — compare deadlines against it · money so'm`,
          counts.length === 0 ? 'no orders in this window' : `by status: ${pairs(counts)}`,
          pairs([['createdPastAcceptDeadline', overdue.length]]),
          selected.length === 0
            ? 'nothing matches this filter'
            : table(
                ['orderId', 'status', 'scheme', 'created', 'acceptUntil', 'deliverUntil', 'price', 'lines'],
                selected
                  .slice(0, limit)
                  .map((order) => [
                    order.id,
                    order.status,
                    order.scheme,
                    order.dateCreated === null ? null : isoMinute(order.dateCreated),
                    order.dateAcceptUntil === null ? null : isoMinute(order.dateAcceptUntil),
                    order.dateDeliverUntil === null ? null : isoMinute(order.dateDeliverUntil),
                    order.price,
                    (order.orderItems ?? []).length,
                  ]),
              ),
          selected.length > limit ? `(${selected.length - limit} more not listed — data.rows dataset "orders" pages through all)` : null,
        ]),
      };
    },
  },

  'supply.invoices': {
    route: 'GET /v1/invoice, /v1/return, /v1/fbs/invoice',
    args: '{limit?:1-40}',
    summary: [
      'Supply invoices with what the warehouse actually accepted against what was declared,',
      'warehouse returns, and FBS shipment invoices. The accepted-versus-declared gap is stock',
      'the seller paid for and never got on sale.',
    ],
    schema: z.object({ limit: z.number().int().min(1).max(40).optional(), fresh: z.boolean().optional() }),
    run: async (args, context) => {
      const limit = int(args['limit'], 15);

      const source = await readInvoices(context.scope, {
        sync: true,
        force: flag(args['fresh']),
        signal: context.signal,
      });

      const short = source.supply.filter(
        (invoice) => invoice.totalAccepted < invoice.totalToStock && invoice.invoiceStatus?.value === 'ACCEPTED',
      );

      return {
        routes: ['/v1/invoice', '/v1/return', '/v1/fbs/invoice'],
        trace: `${source.supply.length} supply · ${short.length} short`,
        text: compose([
          header('supply.invoices', [
            shopsLine(context),
            `${source.supply.length} supply invoices`,
            `${source.returns.length} returns`,
            `${source.fbs.length} FBS shipment invoices`,
            source.fbsUnavailable ? 'FBS shipment invoices unavailable for this account' : null,
          ]),
          pairs([
            ['shortInvoices', short.length],
            ['unitsDeclaredNeverAccepted', short.reduce((sum, invoice) => sum + invoice.totalToStock - invoice.totalAccepted, 0)],
          ]),
          source.supply.length === 0
            ? 'no supply invoices held'
            : table(
                ['invoiceId', 'number', 'status', 'declared', 'accepted', 'missing', 'value'],
                source.supply
                  .slice(0, limit)
                  .map((invoice) => [
                    invoice.id,
                    String(invoice.invoiceNumber ?? invoice.id),
                    invoice.invoiceStatus?.value ?? null,
                    invoice.totalToStock,
                    invoice.totalAccepted,
                    Math.max(0, invoice.totalToStock - invoice.totalAccepted),
                    invoice.fullPrice,
                  ]),
              ),
        ]),
      };
    },
  },

  'price.impact': {
    route: 'archive:change journal + ledger',
    args: '{shopId?, limit?:1-15}',
    summary: [
      'Price changes this machine has watched, each with demand and revenue per day before and',
      'after. The only evidence-backed answer to "what happened last time I moved this price" —',
      'and it exists only for moves the archive was running for. Never extrapolate from it.',
    ],
    schema: z.object({
      shopId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(15).optional(),
    }),
    run: async (args, context) => {
      const shopId = int(args['shopId'], context.scope.shopIds[0] ?? 0);
      const limit = int(args['limit'], 8);

      if (shopId <= 0) return { text: header('price.impact', ['no shop in scope']) };

      const [journal, ledger, meta] = await Promise.all([
        readJournal(shopId),
        readLedger(shopId),
        readMeta(shopId, ENTITY_TYPES.orderItem),
      ]);

      const covered = bounds(toCoverage(meta.synced_ranges));
      const titles = new Map<number, string>();
      for (const row of ledger) {
        if (!titles.has(row.productId) && row.productTitle !== '') titles.set(row.productId, row.productTitle);
      }

      const moves = derivePriceImpact({
        journal,
        ledger,
        coveredFrom: covered?.fromMs ?? null,
        coveredTo: covered?.toMs ?? null,
        titleOf: (productId) => titles.get(productId) ?? `product ${productId}`,
      });

      return {
        routes: ['archive:journal'],
        trace: `${moves.length} price moves`,
        text: compose([
          header('price.impact', [
            `shopId ${shopId}`,
            `${moves.length} moves`,
            covered === null ? 'no coverage recorded' : `archive covers ${windowLabel(covered.fromMs, covered.toMs)}`,
          ]),
          "money so'm · before/after are per-day rates over equal spans either side of the move ·",
          '"thin" means one side did not have enough days or units to be worth reading.',
          moves.length === 0
            ? 'the archive has not watched a price change yet — it only records what it saw'
            : table(
                ['product', 'at', 'fromPrice', 'toPrice', 'movePct', 'demandPct', 'revenuePct', 'confident'],
                moves
                  .slice(0, limit)
                  .map((move) => [
                    clip(move.title),
                    isoDay(move.at),
                    move.fromPrice,
                    move.toPrice,
                    dec(move.movePct),
                    dec(move.demandPct),
                    dec(move.revenuePct),
                    move.confident ? 'yes' : 'thin',
                  ]),
              ),
        ]),
      };
    },
  },

  'data.rows': {
    route: 'archive (IndexedDB) → Uzum seller API for what is missing',
    args: '{dataset:"sales|expenses|orders|catalogue", from?, to?, productIds?:[number], status?, limit?:1-1000, offset?}',
    summary: [
      'The raw rows, paged — for deep analysis no computing lookup covers: baskets per order, a',
      'SKU-level breakdown, return causes, anything that needs individual lines. sales = order',
      'lines, expenses = ledger rows, orders = FBS/DBS orders, catalogue = every SKU now.',
      'Prefer a computing lookup when one answers the question; add up rows yourself only when not.',
    ],
    schema: z.object({
      ...windowArgs,
      dataset: z.enum(['sales', 'expenses', 'orders', 'catalogue']),
      productIds: z.array(z.number().int().positive()).min(1).max(50).optional(),
      status: z.string().trim().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const dataset = str(args['dataset']) ?? 'sales';
      const limit = int(args['limit'], 200);
      const offset = int(args['offset'], 0);
      const status = str(args['status'])?.toUpperCase();
      const wanted = new Set(ids(args['productIds']));
      const sameYear = spansOneYear(window.fromMs, window.toMs);

      const paging = (total: number, shown: number, next: number | null): string =>
        next === null
          ? `rows ${offset + (shown === 0 ? 0 : 1)}-${offset + shown} of ${total} · end`
          : `rows ${offset + 1}-${offset + shown} of ${total} · next page: offset ${next}`;

      switch (dataset) {
        case 'expenses': {
          const source = await readExpenses(scopeFor(context, window), {
            sync: true,
            force: flag(args['fresh']),
            signal: context.signal,
          });
          const rows = source.payments.filter(
            (payment) => status === undefined || payment.status.toUpperCase() === status,
          );
          const page = pageOf(rows, offset, limit);

          return {
            routes: ['/v1/finance/expenses'],
            trace: `expenses · ${page.rows.length} of ${page.total}`,
            text: compose([
              header('data.rows', ['expenses', windowLabel(window.fromMs, window.toMs), shopsLine(context), window.note]),
              paging(page.total, page.rows.length, page.next),
              `money so'm · date is UTC${sameYear ? `, year ${new Date(window.fromMs).getUTCFullYear()}` : ''} · type INCOME is money back, OUTCOME is a charge`,
              table(
                ['date', 'shopId', 'source', 'name', 'type', 'paymentPrice', 'amount', 'status'],
                page.rows.map((payment) => [
                  rowStamp(payment.dateCreated, sameYear),
                  payment.shopId,
                  clip(payment.source, 30),
                  clip(payment.name, 50),
                  payment.type,
                  payment.paymentPrice,
                  payment.amount,
                  payment.status,
                ]),
              ),
            ]),
          };
        }

        case 'orders': {
          const source = await readOrders(scopeFor(context, window), {
            sync: true,
            force: flag(args['fresh']),
            signal: context.signal,
          });
          const rows = source.orders
            .filter((order) => status === undefined || order.status === status)
            .sort((a, b) => (a.dateCreated ?? 0) - (b.dateCreated ?? 0));
          const page = pageOf(rows, offset, limit);

          return {
            routes: ['/v2/fbs/orders'],
            trace: `orders · ${page.rows.length} of ${page.total}`,
            text: compose([
              header('data.rows', ['orders', windowLabel(window.fromMs, window.toMs), shopsLine(context), window.note]),
              paging(page.total, page.rows.length, page.next),
              `money so'm · times UTC${sameYear ? `, year ${new Date(window.fromMs).getUTCFullYear()}` : ''} · lines = skuId×amount@price;…`,
              table(
                ['orderId', 'created', 'status', 'scheme', 'acceptUntil', 'deliverUntil', 'price', 'lines', 'dropOff'],
                page.rows.map((order) => [
                  order.id,
                  order.dateCreated === null ? null : rowStamp(order.dateCreated, sameYear),
                  order.status,
                  order.scheme,
                  order.dateAcceptUntil === null ? null : rowStamp(order.dateAcceptUntil, sameYear),
                  order.dateDeliverUntil === null ? null : rowStamp(order.dateDeliverUntil, sameYear),
                  order.price,
                  (order.orderItems ?? [])
                    .map((line) => `${line.skuId ?? '?'}×${line.amount ?? 0}@${line.price ?? 0}`)
                    .join(';'),
                  clip(order.dropOffPoint?.title ?? '', 30),
                ]),
              ),
            ]),
          };
        }

        case 'catalogue': {
          const skus = flattenSkus(context.products).filter(
            (sku) =>
              (wanted.size === 0 || wanted.has(sku.productId)) &&
              (status === undefined || sku.status === status),
          );
          const page = pageOf(skus, offset, limit);
          const products = [...new Set(page.rows.map((sku) => sku.productId))];

          return {
            routes: ['/v1/product/shop/{shopId}'],
            trace: `catalogue · ${page.rows.length} of ${page.total} SKUs`,
            text: compose([
              header('data.rows', ['catalogue', shopsLine(context), 'snapshot as of the last sync — from/to do not apply']),
              paging(page.total, page.rows.length, page.next),
              "money so'm · sold and returned are lifetime counters",
              'products:',
              table(
                ['productId', 'name', 'status', 'rank', 'returnedPct'],
                products.map((id) => {
                  const product = context.products.find((entry) => entry.productId === id);
                  return [id, clip(product?.name ?? ''), product?.status ?? null, product?.rank ?? null, product === undefined ? null : dec(product.returnedPct)];
                }),
              ),
              'skus:',
              table(
                ['productId', 'skuId', 'sku', 'barcode', 'price', 'purchasePrice', 'available', 'fbs', 'sold', 'returned'],
                page.rows.map((sku) => [
                  sku.productId,
                  sku.skuId,
                  clip(sku.skuTitle, 40),
                  sku.barcode === '' ? null : sku.barcode,
                  sku.price,
                  sku.purchasePrice,
                  sku.quantityAvailable,
                  sku.quantityFbs,
                  sku.quantitySold,
                  sku.quantityReturned,
                ]),
              ),
            ]),
          };
        }

        default: {
          const finance = await financeFor(args, context, window);
          const rows = finance.items.filter(
            (item) =>
              (wanted.size === 0 || wanted.has(item.productId)) &&
              (status === undefined || item.status === status),
          );
          const page = pageOf(rows, offset, limit);

          /* Titles once per product rather than once per line: a name is ten or
             twenty tokens, and a busy product repeats on every row of the page. */
          const titles = new Map<number, string>();
          for (const item of page.rows) {
            if (!titles.has(item.productId)) titles.set(item.productId, nameOf(context, item.productId, item.productTitle));
          }

          return {
            routes: ['/v1/finance/orders'],
            trace: `sales · ${page.rows.length} of ${page.total}`,
            text: compose([
              header('data.rows', [
                'sales',
                windowLabel(window.fromMs, window.toMs),
                shopsLine(context),
                finance.truncated ? 'TRUNCATED: retention has cut into this window' : null,
                window.note,
              ]),
              paging(page.total, page.rows.length, page.next),
              `money so'm · date is UTC${sameYear ? `, year ${new Date(window.fromMs).getUTCFullYear()}` : ''} · one row per order line, oldest first`,
              'sellPrice is per unit; commission, logistics and sellerProfit are for the whole line',
              '(sellerProfit = sellPrice × amount - commission - logistics). A CANCELED line has amount 0.',
              'products:',
              table(['productId', 'name'], [...titles.entries()]),
              'lines:',
              table(
                ['date', 'orderId', 'productId', 'sku', 'status', 'amount', 'sellPrice', 'commission', 'logistics', 'sellerProfit', 'purchasePrice', 'returns', 'returnCause'],
                page.rows.map((item) => [
                  rowStamp(item.date, sameYear),
                  item.orderId,
                  item.productId,
                  clip(item.skuTitle, 30),
                  item.status,
                  item.amount,
                  item.sellPrice,
                  item.commission,
                  item.logisticDeliveryFee,
                  item.sellerProfit,
                  item.purchasePrice,
                  item.amountReturns,
                  item.returnCause === null ? null : clip(item.returnCause, 40),
                ]),
              ),
              page.total === 0
                ? `no lines — ${rows.length === finance.items.length ? 'the window holds none' : `${finance.items.length} lines exist but none match the filter`}`
                : `window sums over the matching lines: ${pairs([
                    ['lines', rows.length],
                    ['cancelled', rows.filter(isCancelled).length],
                    ['units', rows.reduce((sum, item) => sum + (isCancelled(item) ? 0 : item.amount), 0)],
                    ['revenue', rows.reduce((sum, item) => sum + (isCancelled(item) ? 0 : lineRevenue(item)), 0)],
                  ])}`,
            ]),
          };
        }
      }
    },
  },

  'archive.coverage': {
    route: 'sync_metadata',
    args: '{}',
    summary: [
      'What this machine actually holds: the period covered per shop, how many rows, when it was',
      'last read, and whether the backwards walk has reached the start of the history. Ask before',
      'answering anything about a period the seller has not looked at, and say so if it is thin.',
    ],
    schema: z.object({}),
    run: async (_args, context) => {
      const rows: (string | number)[][] = [];

      for (const shopId of context.scope.shopIds) {
        const meta = await readShopMeta(shopId, WINDOWED_ENTITIES);
        for (const entity of WINDOWED_ENTITIES) {
          const record = meta[entity];
          if (record === undefined) continue;

          const covered = bounds(toCoverage(record.synced_ranges));
          rows.push([
            shopId,
            entity,
            record.rows,
            covered === null ? '—' : windowLabel(covered.fromMs, covered.toMs),
            record.last_synced_at === null ? 'never' : isoMinute(record.last_synced_at),
            record.backfill_complete ? 'complete' : 'partial',
          ]);
        }
      }

      return {
        routes: ['sync_metadata'],
        trace: `${rows.length} records`,
        text: compose([
          header('archive.coverage', [
            shopsLine(context),
            `selected period ${windowLabel(context.scope.fromMs, context.scope.toMs)}`,
            `now ${isoMinute(context.now)} UTC`,
          ]),
          'A lookup fills whatever it is missing before answering, so a gap here is not a refusal —',
          'it is one fetch. "partial" backfill means older history exists at Uzum but has not been',
          'walked back to yet, and a question about it will read further than the rows below.',
          rows.length === 0
            ? 'this machine holds nothing for the shops in scope'
            : table(['shopId', 'entity', 'rows', 'covered', 'lastRead', 'backfill'], rows),
        ]),
      };
    },
  },

  'alerts.list': {
    route: 'local rules',
    args: '{}',
    summary: [
      'The standing rules this dashboard is already checking after every sync, and what each one',
      'last reported. Read it before setting a rule, so you replace the right one and do not',
      'promise the seller something they already have.',
    ],
    schema: z.object({}),
    run: async (_args, context) => {
      const rules = useAlertsStore.getState().rules;

      return {
        routes: ['local rules'],
        trace: `${rules.length} rules`,
        text: compose([
          header('alerts.list', [`${rules.length} standing rules`, `now ${isoMinute(context.now)} UTC`]),
          'threshold means: units for stock.below, hours before dateAcceptUntil for',
          'order.deadline, percent for margin.below and cancel.above. stock.empty ignores it.',
          rules.length === 0
            ? 'no rules set — alert.create adds one'
            : table(
                ['kind', 'threshold', 'lastFired', 'lastFound'],
                rules.map((rule) => [
                  rule.kind,
                  rule.threshold,
                  rule.lastFiredAt === null ? 'never' : isoMinute(rule.lastFiredAt),
                  rule.lastSignature === null ? null : rule.lastSignature.slice(0, 40),
                ]),
              ),
        ]),
      };
    },
  },

  'shops.list': {
    route: 'GET /v1/shops',
    args: '{}',
    summary: [
      'The shops this token can see and which of them the seller currently has selected. Needed',
      'before a price write, which is addressed per shop.',
    ],
    schema: z.object({}),
    run: async (_args, context) => {
      const selected = new Set(context.scope.shopIds);

      return {
        routes: ['/v1/shops'],
        trace: `${context.shops.length} shops`,
        text: compose([
          header('shops.list', [
            `${context.shops.length} shops`,
            `${selected.size} in scope`,
            context.scope.storeKey === 'all' ? 'consolidated view' : 'one shop selected',
          ]),
          table(
            ['shopId', 'name', 'inScope'],
            context.shops.map((shop) => [shop.id, clip(shop.name), selected.has(shop.id) ? 'yes' : 'no']),
          ),
        ]),
      };
    },
  },
};

export const READ_TOOL_IDS = Object.keys(READ_TOOLS);

/* ── the same registries, as native tools ───────────────────────────────── */

/**
 * The one tool a thread starts with.
 *
 * Progressive disclosure has to survive native tool calling, and the naive way
 * to bolt the two together loses it: declaring every tool on the first request
 * means their schemas are in the prompt whether the question needed them or
 * not, which is exactly the cost the redesign removed.
 *
 * So the first request declares one tool — this one. The model calls it, gets
 * the toolkit document, and *from that round on* the real tools are declared
 * alongside it. Same conversation as the text protocol, same "ask for what you
 * need", with the provider doing the parsing.
 */
export const OPEN_TOOLKIT = 'open_toolkit';

const openToolkitSchema: ToolSchema = {
  name: OPEN_TOOLKIT,
  description:
    'Ask for a capability document before using it. "tools" returns every lookup and action ' +
    'available over this shop, with arguments and what each returns — and makes those ' +
    'tools callable. "widgets" returns how to draw an answer on screen. Ask once per thread.',
  parameters: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        enum: ['tools', 'widgets'],
        description: 'Which document to open.',
      },
    },
    required: ['capability'],
    additionalProperties: false,
  },
};

/**
 * Safe name → registry id.
 *
 * Built from the registries rather than by undoing the substitution, because
 * `open_toolkit` would reverse into `open.toolkit` and name nothing. A lookup
 * cannot drift the way a rule can.
 */
const ID_BY_SAFE_NAME: ReadonlyMap<string, string> = new Map([
  ...READ_TOOL_IDS.map((id) => [safeToolName(id), id] as const),
  ...ACTION_IDS.map((id) => [safeToolName(id), id] as const),
]);

/** The registry id a provider's tool call refers to, or the name unchanged. */
export function toolIdOfName(name: string): string {
  return ID_BY_SAFE_NAME.get(name) ?? name;
}

/** What calling an action does, in the words the model is told. */
function actionGate(id: (typeof ACTION_IDS)[number]): string {
  const definition = INSIGHT_ACTIONS[id];
  /* A follow-up question is the one `none` action that does not run: asking it
     outright would start a second question underneath the answer to the first. */
  if (id === 'copilot.ask') return 'Places a follow-up question chip under your answer.';
  if (definition.risk === 'none') return 'Runs immediately; changes nothing at Uzum.';
  return `Places a button for the seller to press — it is NOT performed by you. ${definition.endpoint ?? ''} (risk ${definition.risk}).`;
}

/**
 * What the provider is told it may call, given what the thread has been handed.
 *
 * Before the toolkit is opened this is one tool. After, it is everything —
 * described from the same `summary` lines the text document is generated from,
 * so the two disclosures cannot disagree about what a lookup does.
 */
export function nativeToolSchemas(granted: ReadonlySet<string>): readonly ToolSchema[] {
  if (!granted.has('tools')) return [openToolkitSchema];

  const reads = READ_TOOL_IDS.flatMap((id) => {
    const spec = READ_TOOLS[id];
    if (spec === undefined) return [];
    return [
      {
        name: safeToolName(id),
        description: spec.summary.join(' '),
        parameters: toJsonSchema(spec.schema),
      },
    ];
  });

  const actions = ACTION_IDS.map((id) => ({
    name: safeToolName(id),
    description: `${INSIGHT_ACTIONS[id].summary} ${actionGate(id)}`,
    parameters: toJsonSchema(INSIGHT_ACTIONS[id].params),
  }));

  return [openToolkitSchema, ...reads, ...actions];
}

/* ── running one ────────────────────────────────────────────────────────── */

/**
 * Run one lookup, or explain why it did not run.
 *
 * A failure is returned rather than thrown, and it is returned *to the model* —
 * a bad argument is something it can correct on the next round, and a tool that
 * failed silently is one it will call again the same way. The text is the same
 * plain-text envelope as a success, so nothing downstream has to tell them
 * apart.
 */
export async function runReadTool(
  id: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const spec = READ_TOOLS[id];
  if (spec === undefined) {
    return {
      trace: `unknown lookup ${id}`,
      text: `[${id}] no such lookup. Available: ${READ_TOOL_IDS.join(', ')}`,
    };
  }

  const parsed = spec.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const why = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
      .join('; ');
    return { trace: `${id} rejected`, text: `[${id}] arguments rejected — ${why}. Expected ${spec.args}` };
  }

  try {
    return await spec.run(parsed.data as Record<string, unknown>, context);
  } catch (error) {
    /* A cancelled question is not a failed lookup. Reporting it as one would
       hand the model an error to narrate about a conversation the seller has
       already walked away from, so it goes back up and ends the run. */
    if (context.signal?.aborted === true) throw error;

    const reason = error instanceof Error ? error.message : 'the lookup failed';
    return {
      trace: `${id} failed`,
      text: `[${id}] failed — ${reason}. Say what you could not read rather than estimating it.`,
    };
  }
}

/* ── the document ───────────────────────────────────────────────────────── */

/**
 * The toolkit, written out when the model asks for it.
 *
 * Generated from the registries rather than maintained beside them, so a tool
 * or an action that exists is a tool or an action the model is told about — the
 * failure mode where a prompt describes a capability that was renamed six
 * months ago cannot happen here.
 */
export function describeToolkit(context: ToolContext): string {
  const reads = READ_TOOL_IDS.map((id) => {
    const spec = READ_TOOLS[id];
    if (spec === undefined) return '';
    return [`  ${id} ${spec.args}`, ...spec.summary.map((line) => `      ${line}`)].join('\n');
  }).filter((entry) => entry !== '');

  const actions = ACTION_IDS.map((id) => {
    const definition = INSIGHT_ACTIONS[id];
    const route = definition.endpoint ?? 'no request — the app does it locally';
    return [
      `  ${id} ${definition.argsDoc}`,
      `      ${definition.summary}`,
      `      ${route} · risk ${definition.risk} · ${actionGate(id)}`,
    ].join('\n');
  });

  return [
    'TOOLKIT — what you may read and what you may offer.',
    '',
    'CALLING',
    '  One object per line, nothing else in that turn:',
    '    {"call":"window.totals","args":{}}',
    '  Several lines are allowed and run in order; I answer with every result in one message',
    '  and you carry on with the same question. Do not guess at a result before it arrives.',
    '',
    'WHAT A RESULT IS',
    '  The data itself: a header saying what was read, then tables whose first line names the',
    '  columns and whose cells are separated by "|". An empty cell is a value the row does not',
    '  have. Read the header before the rows — it states the window, the shops, the units, and',
    '  whether the rows are TRUNCATED or only one page of more.',
    '',
    'CONVENTIONS',
    `  from/to   whole UTC days, "YYYY-MM-DD", both ends included. Omit them and I use the`,
    `            period the seller has selected: ${windowLabel(context.scope.fromMs, context.scope.toMs)}.`,
    `            "the last 7 days" ending today is from ${isoDay(context.now - 6 * DAY_MS)} to ${isoDay(context.now)}.`,
    '  fresh     true re-reads the period from Uzum even if it is already stored. Slow and',
    '            rate-limited: use it when the seller asks for the very latest, not by habit.',
    "  money     so'm, whole numbers, no grouping. Pct columns are percentages (23.5 means 23.5%).",
    '  paging    data.rows returns one page; its header says "next page: offset N" when there is more.',
    '',
    'CHOOSING A LOOKUP',
    '  Computing lookups did the arithmetic over every row: window.totals, period.compare,',
    '  sales.timeline, sales.pattern, products.rank, product.find, expenses.breakdown. Use them',
    '  whenever they answer the question — their totals are exact, and a column you add up',
    '  yourself from three hundred rows is not. data.rows is for what they do not cover; when you',
    '  compute from it, keep the arithmetic small and say what you counted.',
    '',
    'WHERE THE DATA COMES FROM',
    '  A lookup answers from this machine\'s archive. If the period is not held, I fetch exactly',
    '  the missing part from the Uzum seller API, store it, and then answer — so a period read',
    '  before costs nothing and an unseen one costs one fetch. Recent days are re-read on their',
    '  own because an order settles days after it is placed. You do not manage any of this.',
    '',
    'LOOKUPS',
    ...reads,
    '',
    'ACTIONS',
    '  You never send a write to Uzum. Naming one places a button in your answer, filled in with',
    '  the parameters you gave; the seller sees the route and the risk and presses it, or does',
    '  not. Say what the button would do — never that it has been done.',
    ...actions,
    '',
    'NOT AVAILABLE',
    '  The Uzum seller API has no route for renaming a product or editing its description, and',
    '  none for reading or replying to customer reviews — the catalogue reports rating and',
    '  feedbackQuantity and nothing further. It publishes no forecast, no score and no',
    '  competitor data. If the seller asks for one of these, say plainly that the API does not',
    '  offer it and what you can do instead.',
  ].join('\n');
}
