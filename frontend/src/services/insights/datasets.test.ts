import { describe, expect, it } from 'vitest';

import type { FinanceOrderItem } from '@/services/uzum/types';

import {
  buildPattern,
  buildProductTimeline,
  buildTimeline,
  bucketStarts,
  lineRevenue,
  pageOf,
  pickGranularity,
  rowStamp,
} from './datasets';

/**
 * The arithmetic behind the computing lookups.
 *
 * These are the numbers the model is told it can trust more than its own
 * addition, so they are the ones worth pinning: a day that sold nothing is a
 * zero and not a gap, an order split across two lines is one order, a cancelled
 * line adds nothing but is counted, and revenue is the price of a unit times
 * the units — the fact the recorded API samples settle.
 */

const DAY = 86_400_000;
const SEP_7 = Date.UTC(2026, 8, 7);

function line(overrides: Partial<FinanceOrderItem>): FinanceOrderItem {
  return {
    id: 1,
    status: 'TO_WITHDRAW',
    date: SEP_7 + 10 * 3_600_000,
    orderId: 100,
    skuTitle: 'Qora, M',
    productId: 7,
    productTitle: 'Abaya',
    shopId: 1,
    dateIssued: null,
    sellPrice: 48_900,
    amount: 2,
    amountReturns: 0,
    commission: 24_450,
    sellerProfit: 62_350,
    purchasePrice: 25_000,
    logisticDeliveryFee: 11_000,
    cancelled: false,
    withdrawnProfit: 0,
    comment: null,
    returnCause: null,
    ...overrides,
  };
}

const WEEK = { fromMs: SEP_7, toMs: SEP_7 + 7 * DAY - 1 };

describe('lineRevenue', () => {
  it('is the price of one unit times the units', () => {
    /* From the recorded samples: commission 24 450 is a quarter of 97 800. */
    expect(lineRevenue(line({}))).toBe(97_800);
  });
});

describe('pickGranularity', () => {
  it('keeps a timeline near sixty rows', () => {
    expect(pickGranularity(0, DAY)).toBe('hour');
    expect(pickGranularity(0, 7 * DAY)).toBe('day');
    expect(pickGranularity(0, 60 * DAY)).toBe('day');
    expect(pickGranularity(0, 200 * DAY)).toBe('week');
    expect(pickGranularity(0, 400 * DAY)).toBe('week');
    expect(pickGranularity(0, 500 * DAY)).toBe('month');
  });
});

describe('bucketStarts', () => {
  it('covers the window without a gap', () => {
    const starts = bucketStarts(WEEK.fromMs, WEEK.toMs, 'day');
    expect(starts).toHaveLength(7);
    expect(starts[6]).toBe(SEP_7 + 6 * DAY);
  });
});

describe('buildTimeline', () => {
  it('puts a zero where nothing sold, not a missing day', () => {
    const timeline = buildTimeline([line({})], WEEK, 'day');

    expect(timeline.buckets).toHaveLength(7);
    expect(timeline.buckets[0]?.revenue).toBe(97_800);
    expect(timeline.buckets[3]).toMatchObject({ orders: 0, units: 0, revenue: 0 });
  });

  it('counts an order once however many lines it has', () => {
    const timeline = buildTimeline(
      [line({ id: 1, productId: 7 }), line({ id: 2, productId: 8 })],
      WEEK,
      'day',
    );

    expect(timeline.buckets[0]?.orders).toBe(1);
    expect(timeline.buckets[0]?.units).toBe(4);
    expect(timeline.total.orders).toBe(1);
  });

  it('counts a cancelled line and adds nothing of it', () => {
    const timeline = buildTimeline(
      [line({}), line({ id: 2, orderId: 101, status: 'CANCELED', amount: 0, sellerProfit: 0 })],
      WEEK,
      'day',
    );

    expect(timeline.total.cancelled).toBe(1);
    expect(timeline.total.orders).toBe(1);
    expect(timeline.total.revenue).toBe(97_800);
  });

  it('sums to the same total the buckets add up to', () => {
    const items = [
      line({ id: 1, orderId: 1, date: SEP_7 + 1_000 }),
      line({ id: 2, orderId: 2, date: SEP_7 + 2 * DAY }),
      line({ id: 3, orderId: 3, date: SEP_7 + 6 * DAY }),
    ];
    const timeline = buildTimeline(items, WEEK, 'day');

    const added = timeline.buckets.reduce((sum, bucket) => sum + bucket.sellerProfit, 0);
    expect(added).toBe(timeline.total.sellerProfit);
    expect(timeline.total.sellerProfit).toBe(3 * 62_350);
  });
});

describe('buildProductTimeline', () => {
  const items = [
    line({ id: 1, orderId: 1, productId: 7, amount: 2, date: SEP_7 + 1_000 }),
    line({ id: 2, orderId: 2, productId: 8, amount: 1, date: SEP_7 + 1_000 }),
    line({ id: 3, orderId: 3, productId: 7, amount: 3, date: SEP_7 + 2 * DAY }),
    line({ id: 4, orderId: 4, productId: 9, amount: 5, date: SEP_7 + 2 * DAY }),
  ];

  it('gives every product the same buckets, zeros where it did not sell', () => {
    const result = buildProductTimeline(items, WEEK, 'day', [7, 8], 'units');

    expect(result.values.get(7)).toEqual([2, 0, 3, 0, 0, 0, 0]);
    expect(result.values.get(8)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(result.totals.get(7)).toBe(5);
    /* A product nobody asked for is not smuggled in. */
    expect(result.values.has(9)).toBe(false);
  });

  it('counts distinct orders per product when asked for orders', () => {
    const result = buildProductTimeline(
      [...items, line({ id: 5, orderId: 1, productId: 7, amount: 1, date: SEP_7 + 2_000 })],
      WEEK,
      'day',
      [7],
      'orders',
    );

    expect(result.values.get(7)?.[0]).toBe(1);
    expect(result.totals.get(7)).toBe(2);
  });

  it('keeps the title the rows carried', () => {
    expect(buildProductTimeline(items, WEEK, 'day', [7], 'revenue').titles.get(7)).toBe('Abaya');
  });
});

describe('buildPattern', () => {
  it('folds sales onto the key the clock gives them', () => {
    const rows = buildPattern(
      [line({ orderId: 1 }), line({ id: 2, orderId: 2 }), line({ id: 3, orderId: 3, status: 'CANCELED' })],
      () => 3,
      7,
    );

    expect(rows).toHaveLength(7);
    expect(rows[3]).toEqual({ key: 3, orders: 2, units: 4, revenue: 195_600 });
    expect(rows[0]?.orders).toBe(0);
  });
});

describe('pageOf', () => {
  const rows = Array.from({ length: 25 }, (_, index) => index);

  it('says where the next page starts', () => {
    expect(pageOf(rows, 0, 10)).toMatchObject({ total: 25, offset: 0, next: 10 });
    expect(pageOf(rows, 20, 10)).toMatchObject({ rows: [20, 21, 22, 23, 24], next: null });
  });

  it('clamps an offset past the end rather than failing', () => {
    expect(pageOf(rows, 99, 10)).toMatchObject({ rows: [], offset: 25, next: null });
  });
});

describe('rowStamp', () => {
  it('drops the year when the header already states it', () => {
    expect(rowStamp(Date.UTC(2026, 8, 7, 10, 22), true)).toBe('09-07 10:22');
    expect(rowStamp(Date.UTC(2026, 8, 7, 10, 22), false)).toBe('2026-09-07 10:22');
  });
});
