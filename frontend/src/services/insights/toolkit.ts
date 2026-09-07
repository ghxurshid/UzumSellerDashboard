import { z } from 'zod';

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
import {
  loadExpenseTotals,
  loadProductTotals,
  loadSeries,
} from '@/services/storage/idb/analytics.client';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import { WINDOWED_ENTITIES } from '@/services/storage/idb/schema';
import { useAlertsStore } from '@/store/alerts.store';
import type { Language, Product } from '@/types/domain';

import { INSIGHT_ACTIONS, ACTION_IDS } from './actions';
import { moneyFacts, type Fact, type FactSeries } from './facts';
import {
  compose,
  header,
  isoDay,
  isoMinute,
  num,
  dec,
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
 * "compare July with August" wants two windows at once, and none of those can be
 * precomputed alongside every other thing a seller might ask.
 *
 * So the model starts with nothing and asks. The base prompt tells it that a
 * toolkit exists; `describeToolkit()` writes the toolkit out when it asks for
 * it; and each entry below is one thing it can then do. Progressive disclosure,
 * for a reason that is measurable rather than aesthetic — the fact table for a
 * busy account is several thousand tokens, and it used to be re-sent on every
 * turn of every thread whether the question needed a single figure of it or not.
 *
 * ## Three properties every tool holds to
 *
 *   **The archive answers first.** Every read goes through the collections door
 *   in `services/data`, which consults `sync_metadata`, fetches only the part of
 *   the window this machine does not already hold, writes it, and then answers
 *   from IndexedDB. A period read last week costs nothing; an unseen one costs
 *   one fetch. The tool does not decide this and cannot bypass it.
 *
 *   **Results are plain text.** See `plaintext.ts`. A model reads a table
 *   better than it reads a hundred repetitions of `"revenue":`, and the saving
 *   is roughly two thirds of the tokens.
 *
 *   **Every figure comes back with a ref.** A result names the refs it defined,
 *   and those refs are the only way a number reaches the screen — the model
 *   cites, the application resolves and formats. Retrieval widens what the model
 *   can *cite*; it never widens what it can *state*.
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
  /** What the model reads. Plain text, self-describing, ref-carrying. */
  readonly text: string;
  readonly facts?: readonly Fact[];
  readonly series?: readonly FactSeries[];
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

/** The ref namespace a result writes into. Lets two windows coexist. */
function namespaceOf(args: Record<string, unknown>, fallback: string): string {
  const id = str(args['id']);
  return id !== undefined && /^[a-z][a-z0-9]{0,7}$/.test(id) ? id : fallback;
}

const shopsLine = (context: ToolContext): string => `shops ${context.scope.shopIds.join(',')}`;

/**
 * One number as a percentage of another, or nothing.
 *
 * `format: 'percent'` values are 0–100 everywhere in this application, so a
 * share is a ratio multiplied out rather than a ratio.
 *
 * The null is the point. A window that sold nothing has a zero denominator and
 * a window that lost money has a negative one — neither has an honest
 * percentage behind it, and a share of a negative total reads backwards: the
 * worst product of a loss-making month would carry the largest positive share.
 * So the fact is left out, and a ref the model cites without one renders as a
 * dash — the failure this project prefers to a figure nobody can check.
 */
function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/* ── shared schema fragments ────────────────────────────────────────────── */

const dayString = z.string().trim().min(4).max(30);
const idString = z.string().trim().regex(/^[a-z][a-z0-9]{0,7}$/);
const windowArgs = {
  from: dayString.optional(),
  to: dayString.optional(),
  fresh: z.boolean().optional(),
};

/* ── downsampling ───────────────────────────────────────────────────────── */

/**
 * Buckets, at a length worth reading.
 *
 * A year by day is 365 rows, and the model does not need 365 rows to see a
 * shape — it needs the shape. Consecutive buckets are summed into at most
 * `target` groups, each labelled with the span it covers, so the trend survives
 * and the token cost does not scale with the window.
 *
 * The individual points are still drawn on screen: a `line` chart cites the
 * series by ref and the renderer reads the full array. This is what the *model*
 * reads, not what the seller sees.
 */
function downsample(
  at: readonly number[],
  columns: ReadonlyArray<readonly number[]>,
  target: number,
): ReadonlyArray<readonly (string | number)[]> {
  const size = at.length;
  if (size === 0) return [];

  const groups = Math.min(size, target);
  const width = Math.ceil(size / groups);
  const rows: (string | number)[][] = [];

  for (let start = 0; start < size; start += width) {
    const end = Math.min(size, start + width);
    const label =
      width === 1
        ? isoDay(at[start] ?? 0)
        : `${isoDay(at[start] ?? 0)}..${isoDay(at[end - 1] ?? 0)}`;

    const sums = columns.map((column) => {
      let total = 0;
      for (let index = start; index < end; index += 1) total += column[index] ?? 0;
      return total;
    });

    rows.push([label, ...sums]);
  }

  return rows;
}

/** The bucket that carried the most, and the one that carried the least. */
function extremes(
  at: readonly number[],
  values: readonly number[],
): { readonly peak: string; readonly trough: string } | null {
  if (at.length === 0) return null;

  let high = 0;
  let low = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] ?? 0) > (values[high] ?? 0)) high = index;
    if ((values[index] ?? 0) < (values[low] ?? 0)) low = index;
  }

  return {
    peak: `${isoDay(at[high] ?? 0)}=${num(values[high] ?? 0)}`,
    trough: `${isoDay(at[low] ?? 0)}=${num(values[low] ?? 0)}`,
  };
}

/* ── the read registry ──────────────────────────────────────────────────── */

export const READ_TOOLS: Readonly<Record<string, ToolSpec>> = {
  'window.totals': {
    route: 'archive → GET /v1/finance/orders + /v1/finance/expenses',
    args: '{from?, to?, id?, fresh?}',
    summary: [
      'The whole money model for one window: revenue, cost of goods, commission, logistics,',
      'sellerProfit, the expense ledger, net profit and margin, orders, units, cancellations,',
      'returns and average order value. Start here for anything about a period as a whole.',
    ],
    schema: z.object({ ...windowArgs, id: idString.optional() }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const scope = scopeFor(context, window);
      const id = namespaceOf(args, 'totals');
      const fresh = flag(args['fresh']);

      const finance = await readFinance(scope, {
        sync: true,
        force: fresh,
        signal: context.signal,
      });
      const expenses = await readExpenses(scope, {
        sync: true,
        force: fresh,
        signal: context.signal,
      });

      const totals = summariseFinance(finance.items, expenses.payments, {
        cancelledTotal: finance.cancelledTotal,
        reportedTotal: finance.total,
      });

      const facts = moneyFacts(totals, id);

      const ledger = [...totals.expenseBySource.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      return {
        facts,
        routes: ['/v1/finance/orders', '/v1/finance/expenses'],
        trace: `${windowLabel(window.fromMs, window.toMs)} · ${finance.items.length} rows`,
        text: compose([
          header('window.totals', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `${finance.items.length} order items`,
            finance.truncated ? 'TRUNCATED: the API returned fewer rows than it reports' : null,
            window.note,
            fresh ? 'refetched from Uzum' : null,
          ]),
          `refs under "${id}." — money in so'm, plain integers`,
          '',
          pairs([
            [`${id}.sellPrice`, totals.sellPrice],
            [`${id}.purchasePrice`, totals.purchasePrice],
            [`${id}.commission`, totals.commission],
            [`${id}.logistics`, totals.logisticDeliveryFee],
            [`${id}.sellerProfit`, totals.sellerProfit],
            [`${id}.sellerAdjustment`, facts.find((f) => f.ref === `${id}.sellerAdjustment`)?.value ?? 0],
            [`${id}.netProfit`, totals.netProfit],
          ]),
          pairs([
            [`${id}.netMargin`, dec(totals.netMargin)],
            [`${id}.takeRate`, dec(facts.find((f) => f.ref === `${id}.takeRate`)?.value ?? 0)],
            [`${id}.aov`, totals.averageOrderValue],
            [`${id}.orders`, totals.orders],
            [`${id}.units`, totals.units],
            [`${id}.liveItems`, totals.liveItems],
            [`${id}.cancelledItems`, totals.cancelledItems],
            [`${id}.cancellationRate`, dec(totals.cancellationRate)],
            [`${id}.returnedUnits`, totals.returnedUnits],
            [`${id}.withdrawnProfit`, totals.withdrawnProfit],
          ]),
          '',
          `expense ledger (logistics is reported apart because sellerProfit already carries it):`,
          pairs([
            [id === 'totals' ? 'expense.logistics' : `${id}.expense.logistics`, totals.expenseLogistics],
            [id === 'totals' ? 'expense.other' : `${id}.expense.other`, totals.expenseOther],
          ]),
          ledger.length === 0
            ? 'no expense rows in this window'
            : table(
                ['source', 'amount', 'ref suffix'],
                ledger.map(([source, value]) => [source, value, source]),
              ),
          '',
          'net profit = sellerProfit - purchasePrice - expenses other than logistics.',
          `sellerAdjustment closes a revenue→profit chain; include it if you draw one.`,
        ]),
      };
    },
  },

  'series.revenue': {
    route: 'archive:order_item (analytics worker)',
    args: '{from?, to?, granularity?:"hour|day|week|month", id?}',
    summary: [
      'Revenue, sellerProfit and units bucketed over time, plus the totals of the window.',
      'Use it for trends, seasonality, "which day/week was best", and to draw a line chart —',
      'a line cites the series by ref and never lists its own points.',
    ],
    schema: z.object({
      ...windowArgs,
      granularity: z.enum(['hour', 'day', 'week', 'month']).optional(),
      id: idString.optional(),
    }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const id = namespaceOf(args, 'series');
      const granularity = str(args['granularity']) as
        | 'hour'
        | 'day'
        | 'week'
        | 'month'
        | undefined;

      /* The archive is filled through the same door every screen uses, so the
         worker never walks a window this machine has not stored. */
      await readFinance(scopeFor(context, window), {
        sync: true,
        force: flag(args['fresh']),
        signal: context.signal,
      });

      const result = await loadSeries(context.scope.shopIds, window.fromMs, window.toMs, {
        ...(granularity !== undefined ? { granularity } : {}),
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });

      const { at, revenue, profit, units, orders, cancelled } = result.series;
      const spread = extremes(at, revenue);

      return {
        routes: ['archive:order_item'],
        trace: `${result.series.granularity} · ${at.length} buckets`,
        series: [
          { ref: `${id}.revenue`, label: 'Revenue per bucket', at, values: revenue, format: 'money' },
          { ref: `${id}.profit`, label: 'sellerProfit per bucket', at, values: profit, format: 'money' },
          { ref: `${id}.units`, label: 'Units per bucket', at, values: units, format: 'count' },
        ],
        facts: [
          { ref: `${id}.total.revenue`, label: 'Revenue over the window', value: result.totals.revenue, format: 'money' },
          { ref: `${id}.total.profit`, label: 'sellerProfit over the window', value: result.totals.profit, format: 'money' },
          { ref: `${id}.total.units`, label: 'Units over the window', value: result.totals.units, format: 'count' },
          { ref: `${id}.total.orders`, label: 'Distinct orders in the window', value: result.totals.orders, format: 'count' },
          { ref: `${id}.total.cancelled`, label: 'Cancelled items in the window', value: result.totals.cancelled, format: 'count' },
          { ref: `${id}.total.products`, label: 'Distinct products the window touched', value: result.totals.products, format: 'count' },
        ],
        text: compose([
          header('series.revenue', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `${result.series.granularity} buckets`,
            `${result.totals.rows} rows`,
            window.note,
          ]),
          `seriesRef: ${id}.revenue, ${id}.profit, ${id}.units — cite these on a line chart`,
          `totals: ${pairs([
            [`${id}.total.revenue`, result.totals.revenue],
            [`${id}.total.profit`, result.totals.profit],
            [`${id}.total.units`, result.totals.units],
            [`${id}.total.orders`, result.totals.orders],
            [`${id}.total.cancelled`, result.totals.cancelled],
          ])}`,
          spread === null ? null : `peak ${spread.peak} · trough ${spread.trough}`,
          '',
          at.length === 0
            ? 'no rows in this window'
            : table(
                ['bucket', 'revenue', 'profit', 'units', 'orders', 'cancelled'],
                downsample(at, [revenue, profit, units, orders, cancelled], 40),
              ),
          at.length > 40 ? `(${at.length} buckets summed into groups for reading)` : null,
        ]),
      };
    },
  },

  'products.rank': {
    route: 'archive:order_item + catalogue',
    args: '{from?, to?, limit?:1-30, by?:"revenue|profit|units"}',
    summary: [
      'Products ranked over the window, with units, revenue and sellerProfit from the archive',
      'joined to price, purchase price and stock from the catalogue. Carries netEst — profit',
      'less purchase price × units — which is the only figure that says whether a line earns.',
      'Also carries each product\'s share of the window and its margin, so a comparison can be',
      'cited rather than calculated.',
    ],
    schema: z.object({
      ...windowArgs,
      limit: z.number().int().min(1).max(30).optional(),
      by: z.enum(['revenue', 'profit', 'units']).optional(),
    }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const limit = int(args['limit'], 10);
      const by = (str(args['by']) ?? 'revenue') as 'revenue' | 'profit' | 'units';

      await readFinance(scopeFor(context, window), {
        sync: true,
        force: flag(args['fresh']),
        signal: context.signal,
      });

      /**
       * Every product in the window, ranked here rather than by the worker.
       *
       * Asking for the worker's top-N cost two things. A share is a fraction of
       * the window's total, and a total summed over a truncated list is not the
       * window's total — it is the total of whatever survived the cut. And
       * `aggregateByProduct` cuts by revenue whatever `by` says, so "top 10 by
       * profit" quietly meant "top 10 by profit among the top 60 by revenue".
       *
       * A catalogue is a few thousand products at most and the roll-up already
       * builds every one of them, so the whole list crosses the worker boundary
       * and the slice happens after the sort that was actually asked for.
       */
      const totals = await loadProductTotals(context.scope.shopIds, window.fromMs, window.toMs, {
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });

      const windowRevenue = totals.reduce((sum, entry) => sum + entry.revenue, 0);
      const windowProfit = totals.reduce((sum, entry) => sum + entry.profit, 0);
      const windowUnits = totals.reduce((sum, entry) => sum + entry.units, 0);

      const catalogue = new Map(context.products.map((product) => [product.productId, product]));
      const ranked = [...totals].sort((a, b) => b[by] - a[by]).slice(0, limit);

      /* The denominators, so a share the model cites can be read against the
         total it is a share of rather than taken on trust. */
      const facts: Fact[] = [
        { ref: 'rank.revenue', label: 'Sum revenue of every product in the window', value: windowRevenue, format: 'money' },
        { ref: 'rank.profit', label: 'Sum sellerProfit of every product in the window', value: windowProfit, format: 'money' },
        { ref: 'rank.units', label: 'Units sold across every product in the window', value: windowUnits, format: 'count' },
        { ref: 'rank.products', label: 'Products that sold at least once in the window', value: totals.length, format: 'count' },
      ];
      const rows: (string | number)[][] = [];

      for (const entry of ranked) {
        const product = catalogue.get(entry.productId);
        const cost = (product?.purchasePrice ?? 0) * entry.units;
        const netEst = entry.profit - cost;
        const ref = `p.${entry.productId}`;

        facts.push(
          { ref: `${ref}.revenue`, label: `Revenue of "${entry.title}"`, value: entry.revenue, format: 'money' },
          { ref: `${ref}.profit`, label: `sellerProfit of "${entry.title}"`, value: entry.profit, format: 'money' },
          { ref: `${ref}.units`, label: `Units sold of "${entry.title}"`, value: entry.units, format: 'count' },
          { ref: `${ref}.netEst`, label: `sellerProfit minus purchase cost for "${entry.title}"`, value: netEst, format: 'money' },
        );

        /**
         * The comparisons, computed here because prose cannot compute them.
         *
         * A ranking is answered in shares and margins — "this one alone is a
         * fifth of the profit", "it sells well and earns nothing". The model
         * may not type a figure, so without these refs its only way to say
         * either sentence was to work the percentage out and write it, which is
         * exactly what the number guard discards. Every ranking answer risked
         * losing a paragraph to a rule that had left it no other way to speak.
         */
        for (const [suffix, label, value] of [
          ['shareOfRevenue', `Share of window revenue for "${entry.title}"`, shareOf(entry.revenue, windowRevenue)],
          ['shareOfProfit', `Share of window sellerProfit for "${entry.title}"`, shareOf(entry.profit, windowProfit)],
          ['margin', `sellerProfit as a percent of revenue for "${entry.title}"`, shareOf(entry.profit, entry.revenue)],
          ['netMargin', `netEst as a percent of revenue for "${entry.title}"`, shareOf(netEst, entry.revenue)],
        ] as const) {
          if (value !== null) facts.push({ ref: `${ref}.${suffix}`, label, value, format: 'percent' });
        }

        if (product !== undefined) {
          facts.push(
            { ref: `${ref}.price`, label: `Listed price of "${entry.title}"`, value: product.price, format: 'money' },
            { ref: `${ref}.purchasePrice`, label: `Purchase price of "${entry.title}"`, value: product.purchasePrice, format: 'money' },
            { ref: `${ref}.available`, label: `Available stock of "${entry.title}"`, value: product.quantityAvailable, format: 'count' },
            { ref: `${ref}.returnedPct`, label: `Return rate of "${entry.title}"`, value: product.returnedPct, format: 'percent' },
          );
        }

        rows.push([
          ref,
          entry.title,
          entry.units,
          entry.revenue,
          entry.profit,
          netEst,
          product?.purchasePrice ?? 0,
          product?.quantityAvailable ?? 0,
        ]);
      }

      return {
        facts,
        routes: ['archive:order_item', '/v1/product/shop/{shopId}'],
        trace: `${rows.length} products by ${by}`,
        text: compose([
          header('products.rank', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `by ${by}`,
            `${totals.length} products touched the window`,
            window.note,
          ]),
          "money in so'm. purchasePrice and available come from the catalogue snapshot, so they",
          'are current values, not values as of the window.',
          rows.length === 0
            ? 'no sales in this window'
            : table(
                ['ref', 'name', 'units', 'revenue', 'sellerProfit', 'netEst', 'purchasePrice', 'available'],
                rows,
              ),
          `cite: <ref>.revenue .profit .units .netEst .price .purchasePrice .available .returnedPct`,
          'percentages, already worked out — cite these rather than doing the arithmetic:',
          '  <ref>.shareOfRevenue .shareOfProfit  this product as a share of the whole window',
          '  <ref>.margin .netMargin              sellerProfit and netEst as a percent of revenue',
          '  rank.revenue rank.profit rank.units rank.products   the window totals they divide by',
          'A share whose denominator is zero or negative is left out; citing it renders a dash.',
        ]),
      };
    },
  },

  'product.find': {
    route: 'catalogue + archive:order_item',
    args: '{query:"name fragment or productId", from?, to?}',
    summary: [
      'One product in full: price and purchase price per SKU, stock, lifetime counters, status,',
      'and what it sold over the window. Use it before proposing a price or stock write —',
      'those need skuId and barcode, and this is where they come from.',
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

      if (matches.length === 0) {
        return {
          trace: `no match for "${query}"`,
          text: compose([
            header('product.find', [`query "${query}"`, 'no match']),
            `the catalogue holds ${context.products.length} products for the shops in scope.`,
            'Try a shorter fragment, or products.rank to see what is actually selling.',
          ]),
        };
      }

      const product = matches[0];
      if (product === undefined) return { text: header('product.find', ['no match']) };

      const totals = await loadProductTotals(context.scope.shopIds, window.fromMs, window.toMs, {
        limit: 400,
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });
      const sold = totals.find((entry) => entry.productId === product.productId);

      const ref = `p.${product.productId}`;
      const unitMargin = product.price - product.purchasePrice;

      const facts: Fact[] = [
        { ref: `${ref}.price`, label: `Listed price of "${product.name}"`, value: product.price, format: 'money' },
        { ref: `${ref}.purchasePrice`, label: `Purchase price of "${product.name}"`, value: product.purchasePrice, format: 'money' },
        { ref: `${ref}.unitMargin`, label: `Price minus purchase price for "${product.name}"`, value: unitMargin, format: 'money' },
        { ref: `${ref}.available`, label: `Available stock of "${product.name}"`, value: product.quantityAvailable, format: 'count' },
        { ref: `${ref}.fbs`, label: `FBS stock of "${product.name}"`, value: product.quantityFbs, format: 'count' },
        { ref: `${ref}.soldLifetime`, label: `Units sold of "${product.name}" over its lifetime`, value: product.sold, format: 'count' },
        { ref: `${ref}.turnover`, label: `Lifetime turnover of "${product.name}"`, value: product.turnover, format: 'money' },
        { ref: `${ref}.returnedPct`, label: `Return rate of "${product.name}"`, value: product.returnedPct, format: 'percent' },
      ];

      if (sold !== undefined) {
        const netEst = sold.profit - product.purchasePrice * sold.units;
        facts.push(
          { ref: `${ref}.revenue`, label: `Revenue of "${product.name}" in the window`, value: sold.revenue, format: 'money' },
          { ref: `${ref}.profit`, label: `sellerProfit of "${product.name}" in the window`, value: sold.profit, format: 'money' },
          { ref: `${ref}.units`, label: `Units of "${product.name}" sold in the window`, value: sold.units, format: 'count' },
          { ref: `${ref}.netEst`, label: `sellerProfit minus purchase cost for "${product.name}"`, value: netEst, format: 'money' },
        );
      }

      for (const sku of product.skus) {
        facts.push({
          ref: `sku.${sku.skuId}.available`,
          label: `Available stock of SKU ${sku.skuId} "${sku.skuTitle}"`,
          value: sku.quantityAvailable,
          format: 'count',
        });
        facts.push({
          ref: `sku.${sku.skuId}.price`,
          label: `Price of SKU ${sku.skuId} "${sku.skuTitle}"`,
          value: sku.price,
          format: 'money',
        });
      }

      return {
        facts,
        routes: ['/v1/product/shop/{shopId}', 'archive:order_item'],
        trace: product.name,
        text: compose([
          header('product.find', [
            product.name,
            `productId ${product.productId}`,
            `shopId ${product.shopId}`,
            product.statusTitle === '' ? product.status : `${product.status} (${product.statusTitle})`,
            matches.length > 1 ? `${matches.length - 1} other names also matched` : null,
          ]),
          pairs([
            [`${ref}.price`, product.price],
            [`${ref}.purchasePrice`, product.purchasePrice],
            [`${ref}.unitMargin`, unitMargin],
            [`${ref}.available`, product.quantityAvailable],
            [`${ref}.fbs`, product.quantityFbs],
            [`${ref}.soldLifetime`, product.sold],
            [`${ref}.returnedPct`, dec(product.returnedPct)],
          ]),
          sold === undefined
            ? 'no sales in the window read'
            : pairs([
                [`${ref}.units`, sold.units],
                [`${ref}.revenue`, sold.revenue],
                [`${ref}.profit`, sold.profit],
                [`${ref}.netEst`, sold.profit - product.purchasePrice * sold.units],
              ]),
          '',
          'SKUs — skuId and barcode are what a price or stock write needs:',
          table(
            ['skuId', 'title', 'barcode', 'price', 'purchasePrice', 'available', 'fbs'],
            product.skus
              .slice(0, 12)
              .map((sku) => [
                sku.skuId,
                sku.skuTitle,
                sku.barcode === '' ? '—' : sku.barcode,
                sku.price,
                sku.purchasePrice,
                sku.quantityAvailable,
                sku.quantityFbs,
              ]),
          ),
          matches.length > 1
            ? `also matched: ${matches.slice(1, 6).map((entry) => entry.name).join(', ')}`
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
      'movement. Logistics appears here and inside sellerProfit — do not add it twice.',
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

      const facts: Fact[] = [
        { ref: 'ledger.net', label: 'Net cash movement in the ledger', value: totals.net, format: 'money' },
        { ref: 'ledger.income', label: 'Ledger income', value: totals.income, format: 'money' },
        { ref: 'ledger.outgoing', label: 'Ledger outgoings', value: totals.outgoing, format: 'money' },
      ];

      const rows = totals.byName.slice(0, 15).map((entry, index) => {
        const ref = `ledger.n${index}`;
        facts.push({
          ref,
          label: `Ledger outgoing, ${entry.name}`,
          value: entry.amount,
          format: 'money',
        });
        return [ref, entry.name, entry.amount] as const;
      });

      return {
        facts,
        routes: ['/v1/finance/expenses'],
        trace: `${totals.rows} ledger rows`,
        text: compose([
          header('expenses.breakdown', [
            windowLabel(window.fromMs, window.toMs),
            shopsLine(context),
            `${totals.rows} rows`,
            window.note,
          ]),
          pairs([
            ['ledger.net', totals.net],
            ['ledger.income', totals.income],
            ['ledger.outgoing', totals.outgoing],
          ]),
          rows.length === 0
            ? 'no ledger rows in this window'
            : table(['ref', 'name', 'amount'], rows.map((row) => [...row])),
        ]),
      };
    },
  },

  'stock.health': {
    route: 'catalogue snapshot',
    args: '{filter?:"empty|negative|low|runOut|all", limit?:1-40, below?:number}',
    summary: [
      'SKUs that need attention: empty, negative, below a threshold, or products the API marks',
      'RUN_OUT. Every row carries skuId and barcode, which is what a stock write needs.',
    ],
    schema: z.object({
      filter: z.enum(['empty', 'negative', 'low', 'runOut', 'all']).optional(),
      limit: z.number().int().min(1).max(40).optional(),
      below: z.number().int().min(1).max(1000).optional(),
    }),
    run: async (args, context) => {
      const filter = (str(args['filter']) ?? 'empty') as
        | 'empty'
        | 'negative'
        | 'low'
        | 'runOut'
        | 'all';
      const limit = int(args['limit'], 15);
      const below = int(args['below'], 5);

      const skus = flattenSkus(context.products);
      const runOut = context.products.filter((product) => product.status === 'RUN_OUT');

      const selected = skus.filter((sku) => {
        switch (filter) {
          case 'empty':
            return sku.quantityAvailable === 0;
          case 'negative':
            return sku.quantityAvailable < 0;
          case 'low':
            return sku.quantityAvailable > 0 && sku.quantityAvailable < below;
          case 'runOut':
            return runOut.some((product) => product.productId === sku.productId);
          case 'all':
            return true;
        }
      });

      const facts: Fact[] = [
        { ref: 'catalogue.products', label: 'Products in the catalogue', value: context.products.length, format: 'count' },
        { ref: 'catalogue.skus', label: 'SKUs across those products', value: skus.length, format: 'count' },
        { ref: 'catalogue.zeroStock', label: 'SKUs with quantityAvailable = 0', value: skus.filter((sku) => sku.quantityAvailable === 0).length, format: 'count' },
        { ref: 'catalogue.negativeStock', label: 'SKUs with quantityAvailable < 0', value: skus.filter((sku) => sku.quantityAvailable < 0).length, format: 'count' },
        { ref: 'catalogue.runOut', label: 'Products in status RUN_OUT', value: runOut.length, format: 'count' },
        { ref: 'stock.matched', label: 'SKUs matching this filter', value: selected.length, format: 'count' },
      ];

      const shown = selected.slice(0, limit);
      for (const sku of shown) {
        facts.push({
          ref: `sku.${sku.skuId}.available`,
          label: `Available stock of SKU ${sku.skuId} "${sku.productTitle}"`,
          value: sku.quantityAvailable,
          format: 'count',
        });
      }

      return {
        facts,
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
            ['catalogue.products', context.products.length],
            ['catalogue.skus', skus.length],
            ['catalogue.zeroStock', skus.filter((sku) => sku.quantityAvailable === 0).length],
            ['catalogue.negativeStock', skus.filter((sku) => sku.quantityAvailable < 0).length],
            ['catalogue.runOut', runOut.length],
          ]),
          shown.length === 0
            ? 'nothing matches this filter'
            : table(
                ['skuId', 'product', 'sku', 'barcode', 'available', 'fbs', 'price'],
                shown.map((sku) => [
                  sku.skuId,
                  sku.productTitle,
                  sku.skuTitle,
                  sku.barcode === '' ? '—' : sku.barcode,
                  sku.quantityAvailable,
                  sku.quantityFbs,
                  sku.price,
                ]),
              ),
          selected.length > shown.length ? `(${selected.length - shown.length} more not listed)` : null,
          'cite a row as sku.<skuId>.available',
        ]),
      };
    },
  },

  'orders.pipeline': {
    route: 'archive:fbs_order → GET /v2/fbs/orders',
    args: '{status?, limit?:1-30, fresh?}',
    summary: [
      'FBS and DBS orders in the window with their deadlines, counted by status. dateAcceptUntil',
      'is the one that costs money: an order not confirmed before it passes is cancelled by the',
      'marketplace. Use fresh:true when the seller is asking what to do right now.',
    ],
    schema: z.object({
      ...windowArgs,
      status: z
        .enum([
          'CREATED',
          'PACKING',
          'PENDING_DELIVERY',
          'DELIVERING',
          'DELIVERED',
          'COMPLETED',
          'CANCELED',
          'RETURNED',
        ])
        .optional(),
      limit: z.number().int().min(1).max(30).optional(),
    }),
    run: async (args, context) => {
      const window = windowOf(args, context);
      const status = str(args['status']);
      const limit = int(args['limit'], 15);

      const source = await readOrders(scopeFor(context, window), {
        sync: true,
        force: flag(args['fresh']),
        signal: context.signal,
      });

      const selected =
        status === undefined
          ? source.orders
          : source.orders.filter((order) => order.status === status);

      const counts = Object.entries(source.counts).filter(([, value]) => value > 0);
      const facts: Fact[] = [
        { ref: 'orders.total', label: 'Orders read for the window', value: source.total, format: 'count' },
        { ref: 'orders.matched', label: 'Orders matching this filter', value: selected.length, format: 'count' },
      ];
      for (const [key, value] of counts) {
        facts.push({
          ref: `orders.${key.toLowerCase()}`,
          label: `Orders in status ${key}`,
          value,
          format: 'count',
        });
      }

      const overdue = selected.filter(
        (order) =>
          order.status === 'CREATED' &&
          order.dateAcceptUntil !== null &&
          order.dateAcceptUntil < context.now,
      );
      facts.push({
        ref: 'orders.overdueAccept',
        label: 'Orders past their dateAcceptUntil and still unconfirmed',
        value: overdue.length,
        format: 'count',
      });

      const rows = selected.slice(0, limit).map((order) => [
        order.id,
        order.status,
        order.scheme ?? '—',
        order.dateCreated === null ? '—' : isoMinute(order.dateCreated),
        order.dateAcceptUntil === null ? '—' : isoMinute(order.dateAcceptUntil),
        order.price ?? 0,
        (order.orderItems ?? []).length,
      ]);

      return {
        facts,
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
          `now is ${isoMinute(context.now)} UTC — compare deadlines against it`,
          counts.length === 0
            ? 'no orders in this window'
            : pairs(counts.map(([key, value]) => [`orders.${key.toLowerCase()}`, value])),
          pairs([['orders.overdueAccept', overdue.length]]),
          rows.length === 0
            ? 'nothing matches this filter'
            : table(
                ['orderId', 'status', 'scheme', 'created', 'acceptUntil', 'price', 'items'],
                rows,
              ),
          selected.length > rows.length ? `(${selected.length - rows.length} more not listed)` : null,
        ]),
      };
    },
  },

  'supply.invoices': {
    route: 'GET /v1/invoice, /v1/return, /v1/fbs/invoice',
    args: '{limit?:1-25}',
    summary: [
      'Supply invoices with what the warehouse actually accepted against what was declared,',
      'warehouse returns, and FBS shipment invoices. The accepted-versus-declared gap is stock',
      'the seller paid for and never got on sale.',
    ],
    schema: z.object({ limit: z.number().int().min(1).max(25).optional(), fresh: z.boolean().optional() }),
    run: async (args, context) => {
      const limit = int(args['limit'], 10);

      const source = await readInvoices(context.scope, {
        sync: true,
        force: flag(args['fresh']),
        signal: context.signal,
      });

      const short = source.supply.filter(
        (invoice) =>
          invoice.totalAccepted < invoice.totalToStock &&
          invoice.invoiceStatus?.value === 'ACCEPTED',
      );
      const missingUnits = short.reduce(
        (sum, invoice) => sum + (invoice.totalToStock - invoice.totalAccepted),
        0,
      );

      const facts: Fact[] = [
        { ref: 'supply.invoices', label: 'Supply invoices held', value: source.supply.length, format: 'count' },
        { ref: 'supply.shortInvoices', label: 'Accepted supply invoices short of what was declared', value: short.length, format: 'count' },
        { ref: 'supply.missingUnits', label: 'Units declared but never accepted into the warehouse', value: missingUnits, format: 'count' },
        { ref: 'supply.returns', label: 'Warehouse returns held', value: source.returns.length, format: 'count' },
        { ref: 'supply.fbsInvoices', label: 'FBS shipment invoices held', value: source.fbs.length, format: 'count' },
      ];

      for (const invoice of short.slice(0, limit)) {
        facts.push({
          ref: `inv.${invoice.id}.missing`,
          label: `Units missing on invoice ${invoice.invoiceNumber ?? invoice.id}`,
          value: invoice.totalToStock - invoice.totalAccepted,
          format: 'count',
        });
      }

      return {
        facts,
        routes: ['/v1/invoice', '/v1/return', '/v1/fbs/invoice'],
        trace: `${source.supply.length} supply · ${short.length} short`,
        text: compose([
          header('supply.invoices', [
            shopsLine(context),
            `${source.supply.length} supply invoices`,
            `${source.returns.length} returns`,
            source.fbsUnavailable ? 'FBS shipment invoices unavailable for this account' : null,
          ]),
          pairs([
            ['supply.shortInvoices', short.length],
            ['supply.missingUnits', missingUnits],
            ['supply.returns', source.returns.length],
          ]),
          source.supply.length === 0
            ? 'no supply invoices held'
            : table(
                ['ref', 'number', 'status', 'declared', 'accepted', 'value'],
                source.supply
                  .slice(0, limit)
                  .map((invoice) => [
                    `inv.${invoice.id}`,
                    String(invoice.invoiceNumber ?? invoice.id),
                    invoice.invoiceStatus?.value ?? '—',
                    invoice.totalToStock,
                    invoice.totalAccepted,
                    invoice.fullPrice,
                  ]),
              ),
          'a short invoice cites inv.<id>.missing',
        ]),
      };
    },
  },

  'period.compare': {
    route: 'archive → GET /v1/finance/orders + /v1/finance/expenses',
    args: '{from?, to?, baseFrom?, baseTo?}',
    summary: [
      'Two windows and the change between them, under cur.*, prev.* and delta.*. Omit baseFrom',
      'and baseTo and the comparison is the window of the same length immediately before.',
      'This is the tool for "is it getting better", month against month, or before against after.',
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
          ? { fromMs: current.fromMs - span, toMs: current.fromMs, note: null }
          : {
              fromMs: baseFrom ?? current.fromMs - span,
              toMs: baseTo ?? current.fromMs,
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

      const facts: Fact[] = [...moneyFacts(now, 'cur'), ...moneyFacts(before, 'prev')];

      const measures: ReadonlyArray<readonly [string, number, number, 'money' | 'count' | 'percent']> = [
        ['sellPrice', now.sellPrice, before.sellPrice, 'money'],
        ['netProfit', now.netProfit, before.netProfit, 'money'],
        ['sellerProfit', now.sellerProfit, before.sellerProfit, 'money'],
        ['purchasePrice', now.purchasePrice, before.purchasePrice, 'money'],
        ['commission', now.commission, before.commission, 'money'],
        ['logistics', now.logisticDeliveryFee, before.logisticDeliveryFee, 'money'],
        ['units', now.units, before.units, 'count'],
        ['orders', now.orders, before.orders, 'count'],
        ['aov', now.averageOrderValue, before.averageOrderValue, 'money'],
        ['netMargin', now.netMargin, before.netMargin, 'percent'],
        ['cancellationRate', now.cancellationRate, before.cancellationRate, 'percent'],
      ];

      const rows: (string | number)[][] = [];
      for (const [name, currentValue, previousValue, format] of measures) {
        const change = currentValue - previousValue;
        const changePct =
          previousValue === 0 ? 0 : (change / Math.abs(previousValue)) * 100;

        facts.push({
          ref: `delta.${name}`,
          label: `Change in ${name} against the comparison window`,
          value: change,
          format,
        });
        facts.push({
          ref: `delta.${name}.pct`,
          label: `Change in ${name} against the comparison window, percent`,
          value: changePct,
          format: 'percent',
        });

        rows.push([name, currentValue, previousValue, change, dec(changePct)]);
      }

      return {
        facts,
        routes: ['/v1/finance/orders', '/v1/finance/expenses'],
        trace: `${windowLabel(current.fromMs, current.toMs)} vs ${windowLabel(previous.fromMs, previous.toMs)}`,
        text: compose([
          header('period.compare', [
            `current ${windowLabel(current.fromMs, current.toMs)}`,
            `previous ${windowLabel(previous.fromMs, previous.toMs)}`,
            shopsLine(context),
            current.note,
          ]),
          'refs: cur.<name>, prev.<name>, delta.<name>, delta.<name>.pct — full money model under',
          'each of cur. and prev., not only the rows below.',
          table(['measure', 'cur', 'prev', 'delta', 'delta%'], rows),
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

      if (shopId <= 0) {
        return { text: header('price.impact', ['no shop in scope']) };
      }

      const [journal, ledger, meta] = await Promise.all([
        readJournal(shopId),
        readLedger(shopId),
        readMeta(shopId, ENTITY_TYPES.orderItem),
      ]);

      const covered = bounds(toCoverage(meta.synced_ranges));
      const titles = new Map<number, string>();
      for (const row of ledger) {
        if (!titles.has(row.productId) && row.productTitle !== '') {
          titles.set(row.productId, row.productTitle);
        }
      }

      const moves = derivePriceImpact({
        journal,
        ledger,
        coveredFrom: covered?.fromMs ?? null,
        coveredTo: covered?.toMs ?? null,
        titleOf: (productId) => titles.get(productId) ?? `product ${productId}`,
      });

      const facts: Fact[] = [
        { ref: 'moves.count', label: 'Price moves the archive has watched', value: moves.length, format: 'count' },
      ];

      const shown = moves.slice(0, limit);
      const rows = shown.map((move, index) => {
        const ref = `move.${index}`;
        facts.push(
          { ref: `${ref}.from`, label: `Price of "${move.title}" before the move`, value: move.fromPrice, format: 'money' },
          { ref: `${ref}.to`, label: `Price of "${move.title}" after the move`, value: move.toPrice, format: 'money' },
          { ref: `${ref}.movePct`, label: `Price change for "${move.title}"`, value: move.movePct, format: 'percent' },
          { ref: `${ref}.demandPct`, label: `Change in units per day for "${move.title}"`, value: move.demandPct, format: 'percent' },
          { ref: `${ref}.revenuePct`, label: `Change in revenue per day for "${move.title}"`, value: move.revenuePct, format: 'percent' },
        );

        return [
          ref,
          move.title,
          isoDay(move.at),
          move.fromPrice,
          move.toPrice,
          dec(move.movePct),
          dec(move.demandPct),
          dec(move.revenuePct),
          move.confident ? 'yes' : 'thin',
        ];
      });

      return {
        facts,
        routes: ['archive:journal'],
        trace: `${moves.length} price moves`,
        text: compose([
          header('price.impact', [
            `shopId ${shopId}`,
            `${moves.length} moves`,
            covered === null
              ? 'no coverage recorded'
              : `archive covers ${windowLabel(covered.fromMs, covered.toMs)}`,
          ]),
          'before/after are per-day rates over equal spans either side of the move. "thin" means',
          'one side did not have enough days or units to be worth reading.',
          rows.length === 0
            ? 'the archive has not watched a price change yet — it only records what it saw'
            : table(
                ['ref', 'product', 'at', 'from', 'to', 'move%', 'demand%', 'revenue%', 'confident'],
                rows,
              ),
        ]),
      };
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
          header('alerts.list', [
            `${rules.length} standing rules`,
            `now ${isoMinute(context.now)} UTC`,
          ]),
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
                  rule.lastSignature === null ? '—' : rule.lastSignature.slice(0, 40),
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
            context.shops.map((shop) => [shop.id, shop.name, selected.has(shop.id) ? 'yes' : 'no']),
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
 * to bolt the two together loses it: declaring twenty-seven tools on the first
 * request means their schemas are in the prompt whether the question needed
 * them or not, which is exactly the cost the redesign removed.
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

  const actions = ACTION_IDS.map((id) => {
    const definition = INSIGHT_ACTIONS[id];
    const gate =
      definition.risk === 'none'
        ? 'Runs immediately; changes nothing at Uzum.'
        : `Places a button for the seller to press — it is NOT performed by you. ${definition.endpoint ?? ''} (risk ${definition.risk}).`;

    return {
      name: safeToolName(id),
      description: `${definition.summary} ${gate}`,
      parameters: toJsonSchema(definition.params),
    };
  });

  return [openToolkitSchema, ...reads, ...actions];
}

/* ── running one ────────────────────────────────────────────────────────── */

export interface ToolFailure {
  readonly text: string;
}

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
      `      ${route} · risk ${definition.risk}`,
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
    'CONVENTIONS',
    `  from/to   whole UTC days, "YYYY-MM-DD", both ends included. Omit them and I use the`,
    `            period the seller has selected: ${windowLabel(context.scope.fromMs, context.scope.toMs)}.`,
    '  id        namespaces the refs a result defines, so two windows can be cited at once —',
    '            {"id":"jul"} makes jul.netProfit. Default is the name in the header.',
    '  fresh     true re-reads the period from Uzum even if it is already stored. Slow and',
    '            rate-limited: use it when the seller asks for the very latest, not by habit.',
    "  money     so'm, plain integers. Percentages come with one decimal.",
    '  refs      every result names the refs it defined. Those are the only figures you can',
    '            show; the application resolves and formats them.',
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
    '  Actions with risk "none" change nothing and run immediately; I tell you what happened.',
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
