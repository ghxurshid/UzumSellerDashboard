import type { Granularity } from '@/services/storage/idb/aggregation';
import { bucketStart } from '@/services/storage/idb/aggregation';
import type { FinanceOrderItem } from '@/services/uzum/types';

import { isoDay, isoMinute } from './plaintext';

/**
 * The arithmetic behind the chat's computing lookups, kept pure.
 *
 * The toolkit reads rows through the collections door and hands them here; what
 * comes back is the table the model reads. Nothing in this file touches storage,
 * the network or the clock, which is what lets every lookup's numbers be pinned
 * by a test built from a dozen hand-written rows.
 *
 * ## What a sale is worth here
 *
 * The recorded API samples settle the question the rest of the code base is
 * split on: `sellPrice` is the price of **one** unit, while `commission`,
 * `logisticDeliveryFee` and `sellerProfit` are totals for the whole line — a row
 * with `sellPrice 48 900 × amount 2` carries `commission 24 450`, a quarter of
 * 97 800. So revenue here is `sellPrice × amount`, the same as the archive's
 * `revenue` column, and a cancelled line (amount 0, every money field 0) adds
 * nothing to it and is counted on its own.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const isCancelled = (item: FinanceOrderItem): boolean =>
  item.status === 'CANCELED' || item.cancelled === true;

/** What one line earned, from the fields as the API gives them. */
export function lineRevenue(item: FinanceOrderItem): number {
  return (item.sellPrice ?? 0) * (item.amount ?? 0);
}

/* ── buckets ────────────────────────────────────────────────────────────── */

/**
 * The granularity that keeps a timeline readable.
 *
 * About sixty rows is where a table stops being read and starts being skimmed:
 * two days by the hour, two months by the day, a year by the week. Past that,
 * months. A model that wants finer buckets asks for them by name.
 */
export function pickGranularity(fromMs: number, toMs: number): Granularity {
  const span = Math.max(0, toMs - fromMs);
  if (span <= 2 * DAY_MS) return 'hour';
  if (span <= 62 * DAY_MS) return 'day';
  if (span <= 60 * 7 * DAY_MS) return 'week';
  return 'month';
}

/** Every bucket start in the window, ascending and gap-free. */
export function bucketStarts(fromMs: number, toMs: number, granularity: Granularity): number[] {
  const starts: number[] = [];
  let cursor = bucketStart(fromMs, granularity);

  /* A bound on the walk, so a nonsensical window cannot spin forever. */
  while (cursor <= toMs && starts.length < 10_000) {
    starts.push(cursor);
    if (granularity === 'month') {
      const date = new Date(cursor);
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    } else if (granularity === 'week') {
      cursor += 7 * DAY_MS;
    } else {
      cursor += granularity === 'day' ? DAY_MS : HOUR_MS;
    }
  }

  return starts;
}

/** A bucket's label, as short as the granularity allows. */
export function bucketLabel(at: number, granularity: Granularity): string {
  switch (granularity) {
    case 'hour':
      return isoMinute(at);
    case 'month':
      return isoDay(at).slice(0, 7);
    case 'day':
    case 'week':
      return isoDay(at);
  }
}

/* ── timeline ───────────────────────────────────────────────────────────── */

export interface TimelineBucket {
  readonly at: number;
  readonly orders: number;
  readonly units: number;
  readonly revenue: number;
  readonly sellerProfit: number;
  readonly commission: number;
  readonly logistics: number;
  readonly returns: number;
  readonly cancelled: number;
}

/** A bucket while it is being filled; the readonly one is what leaves. */
type OpenBucket = { -readonly [K in keyof TimelineBucket]: TimelineBucket[K] };

function emptyBucket(at: number): OpenBucket {
  return {
    at,
    orders: 0,
    units: 0,
    revenue: 0,
    sellerProfit: 0,
    commission: 0,
    logistics: 0,
    returns: 0,
    cancelled: 0,
  };
}

export interface Timeline {
  readonly granularity: Granularity;
  readonly buckets: readonly TimelineBucket[];
  readonly total: TimelineBucket;
}

/**
 * One series of buckets over a set of lines.
 *
 * `orders` counts distinct order ids per bucket, because order items arrive
 * several per order and counting rows would report a busy day as busier than it
 * was. The total's `orders` is distinct over the whole window for the same
 * reason — an order does not become two by spanning midnight in UTC.
 */
export function buildTimeline(
  items: readonly FinanceOrderItem[],
  window: { readonly fromMs: number; readonly toMs: number },
  granularity: Granularity,
): Timeline {
  const starts = bucketStarts(window.fromMs, window.toMs, granularity);
  const index = new Map(starts.map((at, position) => [at, position]));

  const buckets = starts.map(emptyBucket);
  const ordersPerBucket = starts.map(() => new Set<number>());
  const allOrders = new Set<number>();
  const total = emptyBucket(starts[0] ?? window.fromMs);

  for (const item of items) {
    const position = index.get(bucketStart(item.date, granularity));
    if (position === undefined) continue;
    const bucket = buckets[position];
    if (bucket === undefined) continue;

    if (isCancelled(item)) {
      bucket.cancelled += 1;
      total.cancelled += 1;
      continue;
    }

    const revenue = lineRevenue(item);
    bucket.units += item.amount ?? 0;
    bucket.revenue += revenue;
    bucket.sellerProfit += item.sellerProfit ?? 0;
    bucket.commission += item.commission ?? 0;
    bucket.logistics += item.logisticDeliveryFee ?? 0;
    bucket.returns += item.amountReturns ?? 0;
    ordersPerBucket[position]?.add(item.orderId);
    allOrders.add(item.orderId);

    total.units += item.amount ?? 0;
    total.revenue += revenue;
    total.sellerProfit += item.sellerProfit ?? 0;
    total.commission += item.commission ?? 0;
    total.logistics += item.logisticDeliveryFee ?? 0;
    total.returns += item.amountReturns ?? 0;
  }

  buckets.forEach((bucket, position) => {
    bucket.orders = ordersPerBucket[position]?.size ?? 0;
  });
  total.orders = allOrders.size;

  return { granularity, buckets, total };
}

/**
 * Several products over the same buckets, one measure each.
 *
 * The question this answers is "how did these sell, day by day, side by side" —
 * so the products share one set of bucket labels, and a product that sold
 * nothing on a day has a zero there rather than a missing row.
 */
export type TimelineMeasure = 'units' | 'revenue' | 'sellerProfit' | 'orders';

export interface ProductTimeline {
  readonly granularity: Granularity;
  readonly starts: readonly number[];
  /** productId → one value per bucket. */
  readonly values: ReadonlyMap<number, readonly number[]>;
  readonly totals: ReadonlyMap<number, number>;
  /** The first title each product's rows carried. */
  readonly titles: ReadonlyMap<number, string>;
}

export function buildProductTimeline(
  items: readonly FinanceOrderItem[],
  window: { readonly fromMs: number; readonly toMs: number },
  granularity: Granularity,
  productIds: readonly number[],
  measure: TimelineMeasure,
): ProductTimeline {
  const starts = bucketStarts(window.fromMs, window.toMs, granularity);
  const index = new Map(starts.map((at, position) => [at, position]));
  const wanted = new Set(productIds);

  const values = new Map<number, number[]>(productIds.map((id) => [id, starts.map(() => 0)]));
  const orderSets = new Map<number, Set<number>[]>(
    productIds.map((id) => [id, starts.map(() => new Set<number>())]),
  );
  const distinct = new Map<number, Set<number>>(productIds.map((id) => [id, new Set<number>()]));
  const titles = new Map<number, string>();

  for (const item of items) {
    if (!wanted.has(item.productId) || isCancelled(item)) continue;
    const position = index.get(bucketStart(item.date, granularity));
    if (position === undefined) continue;

    if (!titles.has(item.productId) && item.productTitle !== '') {
      titles.set(item.productId, item.productTitle);
    }

    const column = values.get(item.productId);
    if (column === undefined) continue;

    if (measure === 'orders') {
      orderSets.get(item.productId)?.[position]?.add(item.orderId);
      distinct.get(item.productId)?.add(item.orderId);
      continue;
    }

    const add =
      measure === 'units'
        ? (item.amount ?? 0)
        : measure === 'revenue'
          ? lineRevenue(item)
          : (item.sellerProfit ?? 0);
    column[position] = (column[position] ?? 0) + add;
  }

  if (measure === 'orders') {
    for (const [id, sets] of orderSets) values.set(id, sets.map((set) => set.size));
  }

  const totals = new Map<number, number>();
  for (const [id, column] of values) {
    totals.set(
      id,
      measure === 'orders'
        ? (distinct.get(id)?.size ?? 0)
        : column.reduce((sum, value) => sum + value, 0),
    );
  }

  return { granularity, starts, values, totals, titles };
}

/* ── patterns ───────────────────────────────────────────────────────────── */

export interface PatternRow {
  readonly key: number;
  readonly orders: number;
  readonly units: number;
  readonly revenue: number;
}

/**
 * Sales folded onto the hour of the day or the day of the week.
 *
 * The clock is the seller's, injected rather than read: a seller in Tashkent
 * asking when orders come in means Tashkent's hours, and a function that reached
 * for the configured zone itself could not be tested with a fixed one.
 */
export function buildPattern(
  items: readonly FinanceOrderItem[],
  keyOf: (at: number) => number,
  size: number,
): readonly PatternRow[] {
  const orders = Array.from({ length: size }, () => new Set<number>());
  const units = new Array<number>(size).fill(0);
  const revenue = new Array<number>(size).fill(0);

  for (const item of items) {
    if (isCancelled(item)) continue;
    const key = keyOf(item.date);
    if (key < 0 || key >= size) continue;

    orders[key]?.add(item.orderId);
    units[key] = (units[key] ?? 0) + (item.amount ?? 0);
    revenue[key] = (revenue[key] ?? 0) + lineRevenue(item);
  }

  return Array.from({ length: size }, (_, key) => ({
    key,
    orders: orders[key]?.size ?? 0,
    units: units[key] ?? 0,
    revenue: revenue[key] ?? 0,
  }));
}

/* ── pages ──────────────────────────────────────────────────────────────── */

export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly offset: number;
  /** The offset of the next page, or null when this one reached the end. */
  readonly next: number | null;
}

/** A slice of an ordered list, and where the one after it starts. */
export function pageOf<T>(rows: readonly T[], offset: number, limit: number): Page<T> {
  const start = Math.max(0, Math.min(offset, rows.length));
  const end = Math.min(rows.length, start + Math.max(1, limit));

  return {
    rows: rows.slice(start, end),
    total: rows.length,
    offset: start,
    next: end < rows.length ? end : null,
  };
}

/**
 * A timestamp for a raw row, without the year when the whole window shares one.
 *
 * Two tokens a row is nothing on one row and a thousand on five hundred, and a
 * header that states the year once says it better than every row repeating it.
 */
export function rowStamp(at: number, sameYear: boolean): string {
  const full = isoMinute(at);
  return sameYear ? full.slice(5) : full;
}

export function spansOneYear(fromMs: number, toMs: number): boolean {
  return new Date(fromMs).getUTCFullYear() === new Date(toMs).getUTCFullYear();
}
