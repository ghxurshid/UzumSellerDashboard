import { describe, expect, it } from 'vitest';

import type { FinanceTotals } from '@/services/derive/finance';
import type { FbsOrder } from '@/services/uzum/types';
import type { Product, Sku } from '@/types/domain';

import { COOLDOWN_MS, defaultThreshold, evaluateAlerts, type AlertRule } from './alerts';

/**
 * The rules that speak without being asked.
 *
 * Two properties carry the feature and neither is about the arithmetic. A rule
 * that repeats itself on every sync turns the bell into noise and the seller
 * stops reading it — which is indistinguishable from not having the feature. A
 * rule that goes quiet when the finding *changes* is worse: it is a rule that
 * failed to mention the second SKU going empty.
 *
 * So the tests below are mostly about the signature and the cooldown.
 */

function sku(skuId: number, available: number): Sku {
  return {
    skuId,
    skuTitle: `sku-${skuId}`,
    barcode: `bc-${skuId}`,
    characteristics: '',
    price: 100_000,
    purchasePrice: 60_000,
    quantityAvailable: available,
    quantityActive: available,
    quantityFbs: 0,
    quantitySold: 0,
    quantityReturned: 0,
  };
}

function product(productId: number, skus: readonly Sku[]): Product {
  return {
    productId,
    shopId: 1,
    sku: String(productId),
    name: `product-${productId}`,
    price: 100_000,
    purchasePrice: 60_000,
    turnover: 0,
    sold: 0,
    returnedPct: 0,
    quantityAvailable: skus.reduce((sum, entry) => sum + entry.quantityAvailable, 0),
    quantityActive: 0,
    quantityFbs: 0,
    rank: '—',
    status: 'ACTIVE',
    statusTitle: '',
    skus,
  };
}

function order(id: number, acceptUntil: number | null): FbsOrder {
  return {
    id,
    status: 'CREATED',
    scheme: 'FBS',
    shopId: 1,
    dateCreated: 0,
    dateAcceptUntil: acceptUntil,
    dateDeliverUntil: null,
    price: 100_000,
    orderItems: [],
    dropOffPoint: null,
  };
}

const totals = (over: Partial<FinanceTotals> = {}): FinanceTotals => ({
  liveItems: 100,
  cancelledItems: 0,
  orders: 90,
  units: 120,
  sellPrice: 10_000_000,
  purchasePrice: 6_000_000,
  commission: 800_000,
  logisticDeliveryFee: 300_000,
  sellerProfit: 2_900_000,
  withdrawnProfit: 0,
  returnedUnits: 0,
  expenseLogistics: 300_000,
  expenseOther: 200_000,
  expenseBySource: new Map(),
  netProfit: 1_200_000,
  netMargin: 12,
  averageOrderValue: 111_111,
  cancellationRate: 0,
  ...over,
});

const rule = (over: Partial<AlertRule> & Pick<AlertRule, 'kind'>): AlertRule => ({
  id: `al-${over.kind}`,
  threshold: defaultThreshold(over.kind),
  createdAt: 0,
  lastFiredAt: null,
  lastSignature: null,
  ...over,
});

const now = Date.UTC(2026, 7, 20, 12);
const base = { products: [], orders: [], totals: null, now } as const;

describe('stock rules', () => {
  const empty = [product(1, [sku(11, 0), sku(12, 4)])];

  it('reports SKUs at or below zero', () => {
    const firings = evaluateAlerts([rule({ kind: 'stock.empty' })], { ...base, products: empty });

    expect(firings).toHaveLength(1);
    expect(firings[0]?.vars).toEqual({ n: 1 });
    expect(firings[0]?.screen).toBe('inventory');
  });

  it('says nothing when every shelf has stock', () => {
    const stocked = [product(1, [sku(11, 3)])];
    expect(evaluateAlerts([rule({ kind: 'stock.empty' })], { ...base, products: stocked })).toEqual(
      [],
    );
  });

  it('counts only what is below the threshold and still on the shelf', () => {
    const firings = evaluateAlerts([rule({ kind: 'stock.below', threshold: 5 })], {
      ...base,
      products: empty,
    });

    /* The zero one belongs to `stock.empty`; this rule is about running low. */
    expect(firings[0]?.vars).toEqual({ n: 1, t: 5 });
  });
});

describe('order.deadline', () => {
  const hour = 3_600_000;

  it('reports orders due inside the window', () => {
    const orders = [order(1, now + 2 * hour), order(2, now + 40 * hour)];
    const firings = evaluateAlerts([rule({ kind: 'order.deadline', threshold: 6 })], {
      ...base,
      orders,
    });

    expect(firings[0]?.vars).toEqual({ n: 1, h: 6 });
  });

  it('includes an order whose deadline has already passed', () => {
    /* Past due is the most urgent case there is: Uzum cancels it. */
    const firings = evaluateAlerts([rule({ kind: 'order.deadline', threshold: 6 })], {
      ...base,
      orders: [order(1, now - hour)],
    });

    expect(firings).toHaveLength(1);
  });

  it('ignores orders that are no longer waiting to be accepted', () => {
    const packing = { ...order(1, now + hour), status: 'PACKING' };
    expect(
      evaluateAlerts([rule({ kind: 'order.deadline' })], { ...base, orders: [packing] }),
    ).toEqual([]);
  });
});

describe('rate rules', () => {
  it('fires when margin falls below the threshold', () => {
    const firings = evaluateAlerts([rule({ kind: 'margin.below', threshold: 15 })], {
      ...base,
      totals: totals({ netMargin: 9 }),
    });

    expect(firings[0]?.key).toBe('alMarginBelow');
  });

  it('stays quiet at exactly the threshold', () => {
    expect(
      evaluateAlerts([rule({ kind: 'margin.below', threshold: 15 })], {
        ...base,
        totals: totals({ netMargin: 15 }),
      }),
    ).toEqual([]);
  });

  it('says nothing about a window with no sales', () => {
    /* Zero revenue is not a margin collapse, it is an empty period. */
    expect(
      evaluateAlerts([rule({ kind: 'margin.below' })], {
        ...base,
        totals: totals({ sellPrice: 0, netMargin: 0 }),
      }),
    ).toEqual([]);
  });

  it('fires when cancellations climb above the threshold', () => {
    const firings = evaluateAlerts([rule({ kind: 'cancel.above', threshold: 10 })], {
      ...base,
      totals: totals({ cancellationRate: 22 }),
    });

    expect(firings[0]?.key).toBe('alCancelAbove');
  });
});

describe('repetition', () => {
  const empty = [product(1, [sku(11, 0)])];
  const input = { ...base, products: empty };

  it('stays quiet when it already said this and the cooldown holds', () => {
    const fired = rule({
      kind: 'stock.empty',
      lastFiredAt: now - 60_000,
      lastSignature: '11',
    });

    expect(evaluateAlerts([fired], input)).toEqual([]);
  });

  it('speaks again once the cooldown has passed', () => {
    const stale = rule({
      kind: 'stock.empty',
      lastFiredAt: now - COOLDOWN_MS - 1,
      lastSignature: '11',
    });

    expect(evaluateAlerts([stale], input)).toHaveLength(1);
  });

  it('speaks immediately when the finding itself changed', () => {
    /* A second SKU emptying is news even one minute after the first. */
    const fired = rule({
      kind: 'stock.empty',
      lastFiredAt: now - 60_000,
      lastSignature: '11',
    });
    const worse = [product(1, [sku(11, 0), sku(12, 0)])];

    const firings = evaluateAlerts([fired], { ...input, products: worse });
    expect(firings).toHaveLength(1);
    expect(firings[0]?.signature).toBe('11,12');
  });

  it('signs on the rows rather than on the count', () => {
    /* One SKU refilled and another emptied is a different finding with the
       same total, and reporting it as unchanged would hide it. */
    const one = evaluateAlerts([rule({ kind: 'stock.empty' })], {
      ...input,
      products: [product(1, [sku(11, 0), sku(12, 3)])],
    });
    const other = evaluateAlerts([rule({ kind: 'stock.empty' })], {
      ...input,
      products: [product(1, [sku(11, 3), sku(12, 0)])],
    });

    expect(one[0]?.signature).not.toBe(other[0]?.signature);
  });
});
