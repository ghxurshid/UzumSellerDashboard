import { describe, expect, it } from 'vitest';

import { aggregateByProduct, aggregateOrders, type ProductRowLike } from './aggregation';

/**
 * The roll-up carries the whole profit chain, not only its last link.
 *
 * `sellerProfit` alone cannot say *why* a product earns what it earns: it is
 * already net of commission and logistics and still carries no cost of goods.
 * These tests pin the four sums that finish the sentence, because a per-product
 * net that does not agree with the window's net profit is the kind of wrong
 * that reads as right.
 */

const DAY = 24 * 60 * 60 * 1000;
const AT = Date.UTC(2026, 8, 1);

function row(over: Partial<ProductRowLike> = {}): ProductRowLike {
  return {
    timestamp: AT,
    revenue: 100_000,
    amount: 1,
    seller_profit: 70_000,
    commission: 20_000,
    logistic_fee: 10_000,
    purchase_price: 40_000,
    amount_returns: 0,
    cancelled: 0,
    order_id: 1,
    product_id: 500,
    product_title: 'Real Madrid kit',
    ...over,
  };
}

describe('aggregateByProduct', () => {
  it('sums the chain that turns revenue into what the seller kept', () => {
    const [total] = aggregateByProduct([
      row(),
      row({ order_id: 2, amount: 2, revenue: 200_000, seller_profit: 140_000, commission: 40_000, logistic_fee: 20_000, purchase_price: 80_000 }),
    ]);

    expect(total).toBeDefined();
    expect(total?.revenue).toBe(300_000);
    expect(total?.units).toBe(3);
    expect(total?.orders).toBe(2);

    expect(total?.commission).toBe(60_000);
    expect(total?.logistics).toBe(30_000);
    expect(total?.purchaseCost).toBe(120_000);

    /* revenue - commission - logistics = sellerProfit, and the archive's own
       sellerProfit column has to agree with that arithmetic. */
    expect(total!.revenue - total!.commission - total!.logistics).toBe(total?.profit);
    /* netActual, as the toolkit computes it. */
    expect(total!.profit - total!.purchaseCost).toBe(90_000);
  });

  it('counts returns and cancellations per product', () => {
    const [total] = aggregateByProduct([
      row({ amount_returns: 2 }),
      row({ order_id: 2, cancelled: 1, amount_returns: 1 }),
    ]);

    expect(total?.returns).toBe(3);
    expect(total?.cancelled).toBe(1);
  });

  it('keeps two products apart', () => {
    const ranked = aggregateByProduct([
      row({ product_id: 500, revenue: 100_000, purchase_price: 40_000 }),
      row({ product_id: 700, product_title: 'Barcelona kit', revenue: 300_000, purchase_price: 90_000, order_id: 2 }),
    ]);

    expect(ranked.map((entry) => entry.productId)).toEqual([700, 500]);
    expect(ranked[0]?.purchaseCost).toBe(90_000);
    expect(ranked[1]?.purchaseCost).toBe(40_000);
  });
});

describe('aggregateOrders, given only one product’s rows', () => {
  /**
   * The narrowing itself happens at the cursor in `analytics.runner`, so what
   * matters here is what the folder does with what survives it: a product that
   * sold on one day out of three must come back as a series with two zeros in
   * it, not as a series with one point. A chart cannot draw the gap otherwise,
   * and a model reading the result cannot tell "sold nothing" from "not stored".
   */
  it('returns gap-free buckets so a quiet day reads as zero', () => {
    const result = aggregateOrders(
      [row({ timestamp: AT + DAY, revenue: 250_000, amount: 2 })],
      { fromMs: AT, toMs: AT + 2 * DAY },
      'day',
    );

    expect(result.series.revenue).toEqual([0, 250_000, 0]);
    expect(result.series.units).toEqual([0, 2, 0]);
    expect(result.totals.revenue).toBe(250_000);
    expect(result.totals.products).toBe(1);
  });

  it('reports an empty window as zeros rather than no buckets', () => {
    const result = aggregateOrders([], { fromMs: AT, toMs: AT + 2 * DAY }, 'day');

    expect(result.series.at).toHaveLength(3);
    expect(result.series.revenue).toEqual([0, 0, 0]);
    expect(result.totals.rows).toBe(0);
  });
});
