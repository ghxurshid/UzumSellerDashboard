import type { EntityType } from './schema';

/**
 * Aggregation over the time-series store, expressed as pure functions.
 *
 * Two callers run this code: the analytics worker, off the main thread, and the
 * main thread itself when workers are unavailable. Keeping the arithmetic here —
 * separate from both the worker plumbing and the IndexedDB reads — is what makes
 * that possible without either copy drifting from the other.
 *
 * The shape of the output is chosen for what consumes it:
 *
 *   • **Charts** get parallel arrays of numbers rather than an array of point
 *     objects. A thousand-point series is then four typed-array-shaped columns
 *     instead of a thousand small objects, which is both cheaper to build and
 *     cheaper to hand across a worker boundary — structured clone copies it as
 *     buffers rather than walking an object graph.
 *
 *   • **AI analysis** gets the same buckets plus the totals it would otherwise
 *     ask for separately, because the pass that computes one has already read
 *     every row the other needs.
 *
 * Nothing here touches storage, the clock, or the DOM.
 */

/* ── buckets ────────────────────────────────────────────────────────────── */

export type Granularity = 'hour' | 'day' | 'week' | 'month';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The instant a row's bucket starts.
 *
 * Days and weeks are computed arithmetically in UTC, which keeps bucketing a
 * division rather than a `Date` construction per row — the single hottest line
 * in any of these passes. Months are the exception and genuinely need the
 * calendar, since they are not a fixed number of milliseconds.
 *
 * Weeks are anchored to Monday: the epoch fell on a Thursday, so the offset
 * shifts the division's origin by four days.
 */
export function bucketStart(timestamp: number, granularity: Granularity): number {
  switch (granularity) {
    case 'hour':
      return Math.floor(timestamp / HOUR_MS) * HOUR_MS;
    case 'day':
      return Math.floor(timestamp / DAY_MS) * DAY_MS;
    case 'week': {
      const shifted = timestamp + 3 * DAY_MS;
      return Math.floor(shifted / WEEK_MS) * WEEK_MS - 3 * DAY_MS;
    }
    case 'month': {
      const date = new Date(timestamp);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    }
  }
}

/**
 * How many buckets a window will produce.
 *
 * Used to pick a granularity that keeps a chart legible: a year at hourly
 * resolution is 8 760 points, which is more marks than a chart has pixels.
 */
export function bucketCount(fromMs: number, toMs: number, granularity: Granularity): number {
  const span = Math.max(0, toMs - fromMs);
  switch (granularity) {
    case 'hour':
      return Math.ceil(span / HOUR_MS);
    case 'day':
      return Math.ceil(span / DAY_MS);
    case 'week':
      return Math.ceil(span / WEEK_MS);
    case 'month':
      return Math.max(1, Math.round(span / (30 * DAY_MS)));
  }
}

/**
 * The coarsest granularity that still gives a useful number of marks.
 *
 * Chosen from the window rather than asked for by the caller, so a screen that
 * switches from "7 days" to "this year" does not have to know that hourly
 * points stop being drawable somewhere in between.
 */
export function chooseGranularity(fromMs: number, toMs: number, maxPoints = 400): Granularity {
  const order: readonly Granularity[] = ['hour', 'day', 'week', 'month'];
  for (const granularity of order) {
    if (bucketCount(fromMs, toMs, granularity) <= maxPoints) return granularity;
  }
  return 'month';
}

/* ── series ─────────────────────────────────────────────────────────────── */

/**
 * A bucketed series, held as parallel columns.
 *
 * `at[i]`, `revenue[i]` and `units[i]` describe the same bucket. Columns rather
 * than rows because every consumer reads one measure at a time — a chart draws
 * revenue, then draws units — and because this crosses a worker boundary, where
 * copying five arrays of numbers is markedly cheaper than copying one array of
 * five-field objects.
 */
export interface Series {
  readonly granularity: Granularity;
  /** Bucket start instants, ascending and gap-free across the window. */
  readonly at: readonly number[];
  readonly revenue: readonly number[];
  readonly units: readonly number[];
  readonly profit: readonly number[];
  readonly orders: readonly number[];
  readonly cancelled: readonly number[];
}

export interface SeriesTotals {
  readonly rows: number;
  readonly revenue: number;
  readonly units: number;
  readonly profit: number;
  readonly commission: number;
  readonly cancelled: number;
  readonly orders: number;
  /** Distinct products the window touched. */
  readonly products: number;
  readonly firstAt: number | null;
  readonly lastAt: number | null;
}

export interface SeriesResult {
  readonly series: Series;
  readonly totals: SeriesTotals;
}

/** The minimal row shape the order-item aggregations read. */
export interface OrderRowLike {
  readonly timestamp: number;
  readonly revenue: number;
  readonly amount: number;
  readonly seller_profit: number;
  readonly commission: number;
  readonly cancelled: 0 | 1;
  readonly order_id: number;
  readonly product_id: number;
}

/**
 * Fold order-item rows into a bucketed series and its totals in one pass.
 *
 * Buckets are pre-allocated for the whole window and indexed arithmetically,
 * so a row lands in its bucket without a map lookup or a search. That also
 * means the series is **gap-free**: a day with no sales is a zero rather than a
 * missing point, which is what a chart needs in order to draw a flat stretch
 * instead of interpolating across it.
 *
 * `orders` counts distinct order ids per bucket. Order items arrive several per
 * order, and counting rows would report a busy day as busier than it was.
 */
export function aggregateOrders(
  rows: Iterable<OrderRowLike>,
  window: { readonly fromMs: number; readonly toMs: number },
  granularity: Granularity,
): SeriesResult {
  const start = bucketStart(window.fromMs, granularity);
  const size = Math.max(1, bucketCount(start, window.toMs, granularity) + 1);

  const at = new Array<number>(size);
  const revenue = new Array<number>(size).fill(0);
  const units = new Array<number>(size).fill(0);
  const profit = new Array<number>(size).fill(0);
  const orders = new Array<number>(size).fill(0);
  const cancelled = new Array<number>(size).fill(0);

  /* Month buckets are irregular, so their starts are walked rather than
     computed from an index. Every other granularity is a fixed stride. */
  if (granularity === 'month') {
    let cursor = start;
    for (let index = 0; index < size; index += 1) {
      at[index] = cursor;
      const date = new Date(cursor);
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    }
  } else {
    const stride = granularity === 'hour' ? HOUR_MS : granularity === 'day' ? DAY_MS : WEEK_MS;
    for (let index = 0; index < size; index += 1) at[index] = start + index * stride;
  }

  const bucketOf = (timestamp: number): number => {
    if (granularity === 'month') {
      /* At most a few hundred buckets, and monthly series are the rarest, so a
         linear probe from the end is cheaper than maintaining an index. */
      for (let index = size - 1; index >= 0; index -= 1) {
        if (timestamp >= (at[index] ?? 0)) return index;
      }
      return 0;
    }
    const stride = granularity === 'hour' ? HOUR_MS : granularity === 'day' ? DAY_MS : WEEK_MS;
    return Math.min(size - 1, Math.max(0, Math.floor((timestamp - start) / stride)));
  };

  const seenOrders = new Set<number>();
  const seenPerBucket = new Set<string>();
  const seenProducts = new Set<number>();

  let totalRevenue = 0;
  let totalUnits = 0;
  let totalProfit = 0;
  let totalCommission = 0;
  let totalCancelled = 0;
  let rowCount = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const row of rows) {
    const index = bucketOf(row.timestamp);

    revenue[index] = (revenue[index] ?? 0) + row.revenue;
    units[index] = (units[index] ?? 0) + row.amount;
    profit[index] = (profit[index] ?? 0) + row.seller_profit;
    cancelled[index] = (cancelled[index] ?? 0) + row.cancelled;

    const bucketOrderKey = `${index}:${row.order_id}`;
    if (!seenPerBucket.has(bucketOrderKey)) {
      seenPerBucket.add(bucketOrderKey);
      orders[index] = (orders[index] ?? 0) + 1;
    }

    seenOrders.add(row.order_id);
    seenProducts.add(row.product_id);

    totalRevenue += row.revenue;
    totalUnits += row.amount;
    totalProfit += row.seller_profit;
    totalCommission += row.commission;
    totalCancelled += row.cancelled;
    rowCount += 1;

    if (firstAt === null) firstAt = row.timestamp;
    lastAt = row.timestamp;
  }

  return {
    series: { granularity, at, revenue, units, profit, orders, cancelled },
    totals: {
      rows: rowCount,
      revenue: totalRevenue,
      units: totalUnits,
      profit: totalProfit,
      commission: totalCommission,
      cancelled: totalCancelled,
      orders: seenOrders.size,
      products: seenProducts.size,
      firstAt,
      lastAt,
    },
  };
}

/* ── top-N ──────────────────────────────────────────────────────────────── */

export interface ProductTotal {
  readonly productId: number;
  readonly title: string;
  readonly revenue: number;
  readonly units: number;
  readonly profit: number;
  readonly orders: number;
}

/** The minimal row shape the product roll-up reads. */
export interface ProductRowLike extends OrderRowLike {
  readonly product_title: string;
}

/**
 * Revenue per product over a window, biggest first.
 *
 * Accumulated in a map and sorted once at the end rather than kept sorted as it
 * goes: a catalogue has a few thousand products at most, so one sort of the
 * finished totals costs less than maintaining an order across a hundred
 * thousand row updates.
 */
export function aggregateByProduct(
  rows: Iterable<ProductRowLike>,
  limit = 0,
): readonly ProductTotal[] {
  interface Bucket {
    title: string;
    revenue: number;
    units: number;
    profit: number;
    orders: Set<number>;
  }

  const totals = new Map<number, Bucket>();

  for (const row of rows) {
    let bucket = totals.get(row.product_id);
    if (bucket === undefined) {
      bucket = { title: row.product_title, revenue: 0, units: 0, profit: 0, orders: new Set() };
      totals.set(row.product_id, bucket);
    }

    bucket.revenue += row.revenue;
    bucket.units += row.amount;
    bucket.profit += row.seller_profit;
    bucket.orders.add(row.order_id);
    /* Titles can be blank on some rows; the first non-blank one wins. */
    if (bucket.title === '' && row.product_title !== '') bucket.title = row.product_title;
  }

  const ranked = [...totals.entries()]
    .map(([productId, bucket]): ProductTotal => ({
      productId,
      title: bucket.title,
      revenue: bucket.revenue,
      units: bucket.units,
      profit: bucket.profit,
      orders: bucket.orders.size,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return limit > 0 ? ranked.slice(0, limit) : ranked;
}

/* ── expenses ───────────────────────────────────────────────────────────── */

export interface ExpenseRowLike {
  readonly timestamp: number;
  readonly signed_amount: number;
  readonly payment_price: number;
  readonly kind: string;
  readonly name: string;
}

export interface ExpenseTotals {
  readonly rows: number;
  /** Net movement — income minus outgoings. */
  readonly net: number;
  readonly income: number;
  readonly outgoing: number;
  /** Outgoings by expense name, biggest first. */
  readonly byName: readonly { readonly name: string; readonly amount: number }[];
}

export function aggregateExpenses(rows: Iterable<ExpenseRowLike>): ExpenseTotals {
  const byName = new Map<string, number>();
  let net = 0;
  let income = 0;
  let outgoing = 0;
  let count = 0;

  for (const row of rows) {
    net += row.signed_amount;
    if (row.signed_amount >= 0) income += row.signed_amount;
    else outgoing += -row.signed_amount;

    if (row.signed_amount < 0) {
      byName.set(row.name, (byName.get(row.name) ?? 0) + -row.signed_amount);
    }
    count += 1;
  }

  return {
    rows: count,
    net,
    income,
    outgoing,
    byName: [...byName.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/* ── the request/response protocol ──────────────────────────────────────── */

/**
 * What the main thread can ask the analytics worker for.
 *
 * Deliberately coarse. Each job is one complete answer a screen needs, so the
 * boundary is crossed once per question rather than once per row — the mistake
 * that makes a worker slower than the main thread it was meant to unblock.
 */
export type AnalyticsJob =
  | {
      readonly kind: 'series';
      readonly storeIds: readonly number[];
      readonly fromMs: number;
      readonly toMs: number;
      readonly granularity?: Granularity | undefined;
    }
  | {
      readonly kind: 'products';
      readonly storeIds: readonly number[];
      readonly fromMs: number;
      readonly toMs: number;
      readonly limit?: number | undefined;
    }
  | {
      readonly kind: 'expenses';
      readonly storeIds: readonly number[];
      readonly fromMs: number;
      readonly toMs: number;
    }
  | {
      readonly kind: 'count';
      readonly storeIds: readonly number[];
      readonly entity: EntityType;
      readonly fromMs: number;
      readonly toMs: number;
    };

export type AnalyticsResult =
  | { readonly kind: 'series'; readonly value: SeriesResult }
  | { readonly kind: 'products'; readonly value: readonly ProductTotal[] }
  | { readonly kind: 'expenses'; readonly value: ExpenseTotals }
  | { readonly kind: 'count'; readonly value: number };

export interface WorkerRequest {
  readonly id: number;
  readonly job: AnalyticsJob;
}

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly result: AnalyticsResult }
  | { readonly id: number; readonly ok: false; readonly error: string };
