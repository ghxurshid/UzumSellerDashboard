import { z } from 'zod';

import { hourInZone, weekdayInZone } from '@core/lib/format';
import type { Scope } from '@/services/api/queryKeys';
import {
  readExpenses,
  readFinance,
  readInvoices,
  readOrders,
} from '@/services/data/collections';
import { readDataFreshness, type FreshnessTable } from '@/services/data/freshness';
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
import { readGeneralPreferences } from '@core/state/preferences.store';
import { useAlertsStore } from '@/store/alerts.store';
import type { Product } from '@/types/domain';

import { runLookup } from '@core/tools/createToolkit';
import type { BaseToolContext, ToolResult, ToolSpec } from '@core/tools/contract';
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
import { ledgerTable, moneyLines, tableStamp } from './digest';
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
} from '@core/tools/plaintext';

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
 * toolkit exists; the document `siteToolkit.ts` generates from this registry
 * writes the toolkit out when it asks for it; and each entry below is one thing
 * it can then do.
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

/**
 * What every site lookup is handed: the host-independent base (language, clock,
 * the question's abort signal) plus what only the site has.
 *
 * `ToolSpec` takes arguments as a bag because `schema` has already validated
 * them; a per-tool type parameter could not be called through a registry lookup.
 */
export interface ToolContext extends BaseToolContext {
  /** The scope the seller has selected — the default window for every read. */
  readonly scope: Scope;
  /** The catalogue already in the query cache. No request is made for it. */
  readonly products: readonly Product[];
  readonly shops: ReadonlyArray<{ readonly id: number; readonly name: string }>;
}

export type { ToolResult };

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

/* ── one forced refresh per collection, per question ────────────────────── */

/** A collection `fresh:true` can force past its freshness window — see `services/data/collections`. */
type ForceableCollection = 'finance' | 'expenses' | 'orders' | 'invoices';

/** The span a forced read covered — just enough to tell whether a later force is redundant. */
interface ForcedWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/** `supply.invoices` takes no window argument — every call names the same span, so the collection name is the whole key for it. */
const NO_WINDOW: ForcedWindow = { fromMs: 0, toMs: 0 };

/**
 * Windows a question has already forced, per collection, keyed on the
 * `ToolContext` the caller builds once per question (see
 * `useCopilotAnswers.launch`).
 *
 * `force` bypasses the freshness window and goes to Uzum whatever the
 * record's age. That is right the first time a question asks for a span and
 * wasteful the second *for a span already covered*: `window.totals
 * {fresh:true}` followed by `sales.timeline {fresh:true}` over the same days
 * both want the order ledger, and forcing it twice inside one question
 * re-reads what the first force just wrote. But a later call can name a
 * wider or a disjoint span — the seller's "get me the very latest" answered
 * for today by `orders.pipeline {fresh:true}`, then `data.rows
 * {dataset:"orders", fresh:true}` for the last seven days, which the first
 * force never touched — and downgrading that second call would leave a
 * settlement tail unread while the model believes it just asked for the
 * latest. So what is remembered is the window each force actually covered,
 * not just the collection's name, and a later `fresh:true` is downgraded
 * only when its window sits inside one already forced for that collection
 * this question; anything wider, earlier or disjoint forces again. A
 * `WeakMap` needs no lifecycle of its own — a new question gets a new
 * context object, and the entry for the old one goes with it.
 */
const forcedThisQuestion = new WeakMap<ToolContext, Map<ForceableCollection, ForcedWindow[]>>();

/** Whether every millisecond of `inner` already falls inside `outer`. */
function windowContains(outer: ForcedWindow, inner: ForcedWindow): boolean {
  return outer.fromMs <= inner.fromMs && outer.toMs >= inner.toMs;
}

/**
 * Whether this call should force `collection` past the freshness window.
 *
 * True the first time this question asks for a span via `fresh:true`, and
 * every later ask whose span already sits inside one this question already
 * forced for the same collection — the freshness window then serves from
 * what that force just wrote, still current, without a second request. A
 * wider, earlier or disjoint span forces again, because it names rows the
 * first force never re-read. Omit `window` for a collection with no window
 * argument (`supply.invoices`); it then behaves as before — forced once per
 * question, whatever is asked next.
 */
function forceOnce(
  context: ToolContext,
  collection: ForceableCollection,
  args: Record<string, unknown>,
  window: ForcedWindow = NO_WINDOW,
): boolean {
  if (!flag(args['fresh'])) return false;

  let byCollection = forcedThisQuestion.get(context);
  if (byCollection === undefined) {
    byCollection = new Map();
    forcedThisQuestion.set(context, byCollection);
  }

  const forced = byCollection.get(collection) ?? [];
  if (forced.some((span) => windowContains(span, window))) return false;

  byCollection.set(collection, [...forced, window]);
  return true;
}

/**
 * What a `fresh:true` request actually did to one collection, for the header.
 *
 * Silent unless the seller's `fresh:true` reached this call — the ordinary
 * case, and stating "from the store" on every ordinary read would tax the
 * token budget for a fact nobody asked about. Once asked, this says which is
 * true: the collection went to Uzum just now, or this question already
 * forced a window that covers it and this read was served from that refresh
 * rather than from this instant — never both, and never silent about it,
 * which is the bug this replaces.
 */
function freshNote(
  collection: ForceableCollection,
  requestedFresh: boolean,
  forced: boolean,
): string | null {
  if (!requestedFresh) return null;
  return forced
    ? `${collection} refetched from Uzum`
    : `${collection} already forced this question — served from that refresh`;
}

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

/** The snapshot tables `archive.coverage`'s per-shop rows do not cover — read from `readDataFreshness` instead. */
const SNAPSHOT_FRESHNESS_TABLES: readonly FreshnessTable[] = [
  'catalogue',
  'stock',
  'supplyInvoices',
  'returns',
  'fbsInvoices',
];

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
): Promise<Awaited<ReturnType<typeof readFinance>> & { readonly forced: boolean }> {
  const forced = forceOnce(context, 'finance', args, window);
  const source = await readFinance(scopeFor(context, window), {
    sync: true,
    force: forced,
    signal: context.signal,
  });
  return { ...source, forced };
}

/* ── the read registry ──────────────────────────────────────────────────── */

export const READ_TOOLS: Readonly<Record<string, ToolSpec<ToolContext>>> = {
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
      const askedFresh = flag(args['fresh']);
      const forceFinance = forceOnce(context, 'finance', args, window);
      const forceExpenses = forceOnce(context, 'expenses', args, window);

      const finance = await readFinance(scope, { sync: true, force: forceFinance, signal: context.signal });
      const expenses = await readExpenses(scope, { sync: true, force: forceExpenses, signal: context.signal });

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
            freshNote('finance', askedFresh, forceFinance),
            freshNote('expenses', askedFresh, forceExpenses),
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

      const read = async (window: Window, force: { readonly finance: boolean; readonly expenses: boolean }) => {
        const scope = scopeFor(context, window);
        const finance = await readFinance(scope, { sync: true, force: force.finance, signal: context.signal });
        const expenses = await readExpenses(scope, { sync: true, force: force.expenses, signal: context.signal });
        return summariseFinance(finance.items, expenses.payments, {
          cancelledTotal: finance.cancelledTotal,
          reportedTotal: finance.total,
        });
      };

      /* Only the current window is worth forcing: `previous` is settled history
         a refresh cannot change, and forcing it would spend a request on rows
         that are already final. Finance and expenses are still tracked as the
         separate collections they are — a later lookup this question may have
         already forced one of them for a window that covers this one. */
      const askedFresh = flag(args['fresh']);
      const forceFinance = forceOnce(context, 'finance', args, current);
      const forceExpenses = forceOnce(context, 'expenses', args, current);

      const now = await read(current, { finance: forceFinance, expenses: forceExpenses });
      const before = await read(previous, { finance: false, expenses: false });

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
            freshNote('finance', askedFresh, forceFinance),
            freshNote('expenses', askedFresh, forceExpenses),
            askedFresh ? 'previous is settled history — never forced' : null,
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
      const askedFresh = flag(args['fresh']);
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
              freshNote('finance', askedFresh, finance.forced),
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
            freshNote('finance', askedFresh, finance.forced),
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
            freshNote('finance', flag(args['fresh']), finance.forced),
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

      const finance = await financeFor(args, context, window);

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
            freshNote('finance', flag(args['fresh']), finance.forced),
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

      const finance = await financeFor(args, context, window);
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
            freshNote('finance', flag(args['fresh']), finance.forced),
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
      const forceExpenses = forceOnce(context, 'expenses', args, window);

      await readExpenses(scopeFor(context, window), {
        sync: true,
        force: forceExpenses,
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
            freshNote('expenses', flag(args['fresh']), forceExpenses),
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
      'marketplace. Deadlines come from the stored orders, which refresh themselves on their own —',
      'fresh:true is for when the seller explicitly asks for the very latest from Uzum, not by habit.',
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

      const forceOrders = forceOnce(context, 'orders', args, window);
      const source = await readOrders(scopeFor(context, window), {
        sync: true,
        force: forceOrders,
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
            freshNote('orders', flag(args['fresh']), forceOrders),
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

      const forceInvoices = forceOnce(context, 'invoices', args);
      const source = await readInvoices(context.scope, {
        sync: true,
        force: forceInvoices,
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
            freshNote('invoices', flag(args['fresh']), forceInvoices),
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
          const forceExpenses = forceOnce(context, 'expenses', args, window);
          const source = await readExpenses(scopeFor(context, window), {
            sync: true,
            force: forceExpenses,
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
              header('data.rows', [
                'expenses',
                windowLabel(window.fromMs, window.toMs),
                shopsLine(context),
                window.note,
                freshNote('expenses', flag(args['fresh']), forceExpenses),
              ]),
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
          const forceOrders = forceOnce(context, 'orders', args, window);
          const source = await readOrders(scopeFor(context, window), {
            sync: true,
            force: forceOrders,
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
              header('data.rows', [
                'orders',
                windowLabel(window.fromMs, window.toMs),
                shopsLine(context),
                window.note,
                freshNote('orders', flag(args['fresh']), forceOrders),
              ]),
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
                freshNote('finance', flag(args['fresh']), finance.forced),
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
      'last read, and whether the backwards walk has reached the start of the history — for sales,',
      'expenses and orders — plus a last-read stamp for the snapshot tables (catalogue, stock,',
      'supply invoices, returns, FBS invoices). Ask before answering about a period not looked at yet.',
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

      const freshness = await readDataFreshness(context.scope.shopIds, context.now);
      const snapshotStamps = freshness.tables
        .filter((entry) => SNAPSHOT_FRESHNESS_TABLES.includes(entry.table))
        .map((entry) => tableStamp(entry, context.now))
        .join(' · ');

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
          `snapshot tables (account-wide, current as of last capture) last read: ${snapshotStamps}`,
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

/**
 * Run one lookup of the site's registry, or explain why it did not run.
 *
 * The mechanism — own-property lookup, validation, failures as text for the
 * model, a cancelled question rethrown — is `runLookup` in core; this binds it
 * to the site's table. The toolkit document and the native declarations are
 * assembled in `siteToolkit.ts` from the same table.
 */
export function runReadTool(id: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  return runLookup(READ_TOOLS, id, args, context);
}
