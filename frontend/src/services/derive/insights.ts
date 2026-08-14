import { formatNumber, formatPercent } from '@/lib/format';
import type { InvoicesSource, StocksSource } from '@/services/queries/sources';
import type { Insight, Product } from '@/types/domain';

import type { FinanceTotals } from './finance';
import { LOGISTICS_SOURCE } from './finance';
import { flattenSkus } from './products';

/**
 * Insights, derived — not written.
 *
 * Each rule below fires only when the account's own numbers cross a threshold,
 * and every insight carries the figures that triggered it. An account with
 * nothing wrong produces an empty list, and the rail says so; that is the
 * honest outcome, and it is why none of these are seeded.
 *
 * The seller API has no scoring or forecasting endpoint, so nothing here is
 * predicted. Every claim is a statement about rows that already exist.
 */

export interface InsightInput {
  readonly totals: FinanceTotals;
  readonly products: readonly Product[];
  readonly stocks: StocksSource | undefined;
  readonly invoices: InvoicesSource | undefined;
}

/** Above this share of SKUs at zero, the catalogue is effectively unsellable. */
const ZERO_STOCK_SHARE = 0.5;
/** Cancellations above this share of order items stop being noise. */
const CANCELLATION_RATE = 20;
/** Marketplace take (commission + logistics) above this share of revenue. */
const TAKE_RATE = 30;
/** Per-product return rate that warrants a look at the card. */
const RETURN_RATE = 25;
/** Net margin below this is a margin problem, not a rounding one. */
const THIN_MARGIN = 5;

export function buildInsights(input: InsightInput): readonly Insight[] {
  const insights: Insight[] = [];
  const { totals, products } = input;
  const skus = flattenSkus(products);

  /* ── stock ────────────────────────────────────────────────────────────── */

  const zeroStock = skus.filter((sku) => sku.quantityAvailable === 0);
  if (skus.length > 0 && zeroStock.length / skus.length >= ZERO_STOCK_SHARE) {
    const runOut = products.filter((product) => product.status === 'RUN_OUT').length;
    insights.push({
      id: 'stock-zero',
      target: 'inventory',
      severity: 'high',
      categoryKey: 'catInventory',
      title: `${formatNumber(zeroStock.length)} of ${formatNumber(skus.length)} SKU have quantityAvailable = 0`,
      body: 'Most of the catalogue cannot be bought right now. The loss here is unsold demand rather than storage cost — a card that is live but empty still spends its ranking.',
      signal: 'GET /v1/product/shop/{shopId} · skuList.quantityAvailable',
      evidence: [
        { text: 'SKU at zero available', value: formatNumber(zeroStock.length) },
        {
          text: 'Share of the catalogue',
          value: formatPercent((zeroStock.length / skus.length) * 100),
        },
        { text: 'Products in RUN_OUT', value: `${formatNumber(runOut)} / ${formatNumber(products.length)}` },
      ],
    });
  }

  const negative = skus.filter((sku) => sku.quantityAvailable < 0);
  if (negative.length > 0) {
    insights.push({
      id: 'stock-negative',
      target: 'inventory',
      severity: 'critical',
      categoryKey: 'catAnomaly',
      title: `${formatNumber(negative.length)} SKU report negative stock`,
      body: 'Reserved units exceed what the warehouse has registered. Nothing on these SKUs can be sold and the open reservations will cancel on their own.',
      signal: 'skuList.quantityAvailable < 0',
      evidence: negative.slice(0, 3).map((sku) => ({
        text: `skuId ${sku.skuId}`,
        value: formatNumber(sku.quantityAvailable),
      })),
    });
  }

  /* ── orders ───────────────────────────────────────────────────────────── */

  if (totals.cancellationRate >= CANCELLATION_RATE) {
    insights.push({
      id: 'orders-cancelled',
      target: 'ops',
      severity: totals.cancellationRate >= 35 ? 'critical' : 'high',
      categoryKey: 'catOperations',
      title: `${formatPercent(totals.cancellationRate)} of order items were cancelled`,
      body: 'Cancelled items return commission and sellerProfit as zero, but the delivery fee is still charged and only partly refunded. The gap between what sold and what shipped is where the money goes.',
      signal: 'GET /v1/finance/orders · statuses=CANCELED',
      evidence: [
        { text: 'Cancelled order items', value: formatNumber(totals.cancelledItems) },
        { text: 'Live order items', value: formatNumber(totals.liveItems) },
        { text: 'Logistics charged in the ledger', value: formatNumber(totals.expenseLogistics) },
      ],
    });
  }

  /* ── margin ───────────────────────────────────────────────────────────── */

  const take = totals.commission + totals.logisticDeliveryFee;
  const takeRate = totals.sellPrice === 0 ? 0 : (take / totals.sellPrice) * 100;

  if (takeRate >= TAKE_RATE) {
    insights.push({
      id: 'margin-take',
      target: 'finance',
      severity: 'high',
      categoryKey: 'catMargin',
      title: `Marketplace fees take ${formatPercent(takeRate)} of revenue`,
      body: 'Commission and delivery are deducted before sellerProfit, so this share is gone before your own purchase price is counted. Price and discount depth are the only levers on it.',
      signal: '(commission + logisticDeliveryFee) ÷ sellPrice',
      evidence: [
        { text: 'Σ commission', value: formatNumber(totals.commission) },
        { text: 'Σ logisticDeliveryFee', value: formatNumber(totals.logisticDeliveryFee) },
        { text: 'Σ sellPrice', value: formatNumber(totals.sellPrice) },
      ],
    });
  }

  if (totals.sellPrice > 0 && totals.netMargin < THIN_MARGIN) {
    insights.push({
      id: 'margin-net',
      target: 'finance',
      severity: totals.netProfit < 0 ? 'critical' : 'watch',
      categoryKey: 'catMargin',
      title:
        totals.netProfit < 0
          ? 'The period is running at a loss after expenses'
          : `Net margin is ${formatPercent(totals.netMargin)} after expenses`,
      body: 'sellerProfit looks healthier than the account is: your purchase price and the marketing and storage rows of the expense ledger still have to come out of it.',
      signal: 'sellerProfit − purchasePrice − expenses',
      evidence: [
        { text: 'Σ sellerProfit', value: formatNumber(totals.sellerProfit) },
        { text: 'Σ purchasePrice', value: formatNumber(totals.purchasePrice) },
        { text: 'Expenses excluding logistics', value: formatNumber(totals.expenseOther) },
      ],
    });
  }

  /* ── expense ledger ───────────────────────────────────────────────────── */

  for (const [source, value] of totals.expenseBySource) {
    if (source === LOGISTICS_SOURCE || value <= 0) continue;
    const share = totals.sellPrice === 0 ? 0 : (value / totals.sellPrice) * 100;
    if (share < 2) continue;

    insights.push({
      id: `expense-${source}`,
      target: 'finance',
      severity: share >= 5 ? 'high' : 'watch',
      categoryKey: 'catOpportunity',
      title: `${source} costs ${formatPercent(share)} of revenue`,
      body: 'This is charged on top of the marketplace fee and is not inside sellerProfit, so it lands directly on net profit.',
      signal: 'GET /v1/finance/expenses · paymentPrice',
      evidence: [
        { text: `Σ paymentPrice · ${source}`, value: formatNumber(value) },
        { text: 'Σ sellPrice', value: formatNumber(totals.sellPrice) },
      ],
    });
  }

  /* ── returns ──────────────────────────────────────────────────────────── */

  const returnHeavy = products
    .filter((product) => product.sold >= 10 && product.returnedPct >= RETURN_RATE)
    .sort((a, b) => b.returnedPct - a.returnedPct);

  if (returnHeavy.length > 0) {
    insights.push({
      id: 'returns-rate',
      target: 'products',
      severity: 'high',
      categoryKey: 'catOperations',
      title: `${formatNumber(returnHeavy.length)} product${returnHeavy.length === 1 ? '' : 's'} return above ${formatPercent(RETURN_RATE, 0)}`,
      body: 'A returned unit costs the delivery both ways and comes back to the warehouse as stock you have already paid to store. The card, not the price, is usually the cause.',
      signal: 'productList.returnedPercentage',
      evidence: returnHeavy.slice(0, 3).map((product) => ({
        text: product.name,
        value: formatPercent(product.returnedPct),
      })),
    });
  }

  /* ── supply ───────────────────────────────────────────────────────────── */

  const short = (input.invoices?.supply ?? []).filter(
    (invoice) => invoice.totalAccepted < invoice.totalToStock && invoice.invoiceStatus?.value === 'ACCEPTED',
  );

  if (short.length > 0) {
    const missing = short.reduce(
      (sum, invoice) => sum + (invoice.totalToStock - invoice.totalAccepted),
      0,
    );
    insights.push({
      id: 'supply-shortfall',
      target: 'invoices',
      severity: 'watch',
      categoryKey: 'catInventory',
      title: `${formatNumber(missing)} units never reached the warehouse`,
      body: 'These supply invoices were accepted for fewer units than were declared. The difference is stock you have paid for and cannot sell.',
      signal: 'GET /v1/invoice · totalToStock vs totalAccepted',
      evidence: short.slice(0, 3).map((invoice) => ({
        text: `invoice ${invoice.id}`,
        value: `${formatNumber(invoice.totalAccepted)} / ${formatNumber(invoice.totalToStock)}`,
      })),
    });
  }

  const SEVERITY_ORDER = { critical: 0, high: 1, watch: 2, idea: 3 } as const;
  return insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
