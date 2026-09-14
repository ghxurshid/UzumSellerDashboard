import { formatNumber, formatPercent } from '@/lib/format';
import type { Block, InsightCard } from '@/services/insights/blocks';
import { SEVERITY_ORDER } from '@/services/insights/blocks';
import type { InvoicesSource, StocksSource } from '@/services/queries/sources';
import type { Product } from '@/types/domain';

import type { FinanceTotals } from './finance';
import { LOGISTICS_SOURCE } from './finance';
import { flattenSkus } from './products';

/**
 * Insights, derived — not written.
 *
 * Each rule below fires only when the account's own numbers cross a threshold,
 * and every card carries the figures that triggered it. An account with nothing
 * wrong produces an empty list, and the rail says so; that is the honest
 * outcome, and it is why none of these are seeded.
 *
 * The seller API has no scoring or forecasting endpoint, so nothing here is
 * predicted. Every claim is a statement about rows that already exist.
 *
 * ## Why these look like the model's cards
 *
 * A rule and the model emit the same thing: an `InsightCard` whose body is a
 * list of blocks. That is deliberate. The rail renders one card type, the
 * dismiss/filter/open behaviour is written once, and a finding that starts as a
 * rule can gain a model-written explanation without changing shape. The
 * difference between the two authors is where the words come from — a rule
 * ships dictionary keys, because its wording is the same three sentences in
 * three languages, and the model ships strings it wrote in the seller's
 * language.
 *
 * The figures are written into the blocks here, from the same totals the screens
 * are drawn from, with a `format` so the renderer prints them the way every
 * other number in the interface is printed.
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
/** An expense line below this share of revenue is not worth a card. */
const EXPENSE_SHARE = 2;

export function buildInsights(input: InsightInput): readonly InsightCard[] {
  const cards: InsightCard[] = [];
  const { totals, products } = input;
  const skus = flattenSkus(products);

  /* ── stock ────────────────────────────────────────────────────────────── */

  const zeroStock = skus.filter((sku) => sku.quantityAvailable === 0);
  if (skus.length > 0 && zeroStock.length / skus.length >= ZERO_STOCK_SHARE) {
    const share = (zeroStock.length / skus.length) * 100;
    const runOut = products.filter((product) => product.status === 'RUN_OUT').length;

    cards.push({
      id: 'stock-zero',
      origin: 'rule',
      target: 'inventory',
      severity: 'high',
      categoryKey: 'catInventory',
      group: 'stockOps',
      source: 'GET /v1/product/shop/{shopId} · skuList.quantityAvailable',
      signal: { value: share, format: 'percent' },
      title: {
        key: 'insZeroT',
        vars: { n: formatNumber(zeroStock.length), total: formatNumber(skus.length) },
      },
      blocks: [
        { kind: 'text', text: { key: 'insZeroB' } },
        {
          kind: 'kv',
          rows: [
            { label: { key: 'evZeroSku' }, value: zeroStock.length, format: 'count' },
            { label: { key: 'evShare' }, value: share, format: 'percent' },
            { label: { key: 'evRunOut' }, value: runOut, format: 'count' },
          ],
        },
      ],
    });
  }

  const negative = skus.filter((sku) => sku.quantityAvailable < 0);
  if (negative.length > 0) {
    cards.push({
      id: 'stock-negative',
      origin: 'rule',
      target: 'inventory',
      severity: 'critical',
      categoryKey: 'catAnomaly',
      group: 'anomaly',
      source: 'skuList.quantityAvailable < 0',
      signal: { value: negative.length, format: 'count' },
      title: { key: 'insNegT', vars: { n: formatNumber(negative.length) } },
      blocks: [
        { kind: 'text', text: { key: 'insNegB' }, tone: 'negative' },
        {
          kind: 'table',
          columns: [{ key: 'colSku' }, { key: 'colAvailable' }],
          rows: negative.slice(0, 5).map((sku) => [String(sku.skuId), sku.quantityAvailable]),
          formats: ['text', 'count'],
        },
      ],
    });
  }

  /* ── orders ───────────────────────────────────────────────────────────── */

  if (totals.cancellationRate >= CANCELLATION_RATE) {
    cards.push({
      id: 'orders-cancelled',
      origin: 'rule',
      target: 'ops',
      severity: totals.cancellationRate >= 35 ? 'critical' : 'high',
      categoryKey: 'catOperations',
      group: 'stockOps',
      source: 'GET /v1/finance/orders · statuses=CANCELED',
      signal: { value: totals.cancellationRate, format: 'percent' },
      title: { key: 'insCancelT', vars: { pct: formatPercent(totals.cancellationRate) } },
      blocks: [
        { kind: 'text', text: { key: 'insCancelB' } },
        {
          kind: 'kv',
          rows: [
            { label: { key: 'evCancelled' }, value: totals.cancelledItems, format: 'count' },
            { label: { key: 'evLive' }, value: totals.liveItems, format: 'count' },
            { label: { key: 'evLogistics' }, value: totals.expenseLogistics, format: 'money' },
          ],
        },
      ],
    });
  }

  /* ── margin ───────────────────────────────────────────────────────────── */

  const take = totals.commission + totals.logisticDeliveryFee;
  const takeRate = totals.sellPrice === 0 ? 0 : (take / totals.sellPrice) * 100;

  if (takeRate >= TAKE_RATE) {
    cards.push({
      id: 'margin-take',
      origin: 'rule',
      target: 'finance',
      severity: 'high',
      categoryKey: 'catMargin',
      group: 'profit',
      source: '(commission + logisticDeliveryFee) ÷ sellPrice',
      signal: { value: takeRate, format: 'percent' },
      title: { key: 'insTakeT', vars: { pct: formatPercent(takeRate) } },
      blocks: [
        { kind: 'text', text: { key: 'insTakeB' } },
        {
          kind: 'steps',
          items: [
            { text: { key: 'evCommission' }, value: totals.commission, format: 'money' },
            { text: { key: 'evLogistics' }, value: totals.logisticDeliveryFee, format: 'money' },
            { text: { key: 'evRevenue' }, value: totals.sellPrice, format: 'money' },
          ],
        },
      ],
    });
  }

  if (totals.sellPrice > 0 && totals.netMargin < THIN_MARGIN) {
    const atLoss = totals.netProfit < 0;
    cards.push({
      id: 'margin-net',
      origin: 'rule',
      target: 'finance',
      severity: atLoss ? 'critical' : 'watch',
      categoryKey: 'catMargin',
      group: 'profit',
      source: 'sellerProfit − purchasePrice − expenses',
      signal: { value: totals.netProfit, format: 'money' },
      title: atLoss
        ? { key: 'insLossT' }
        : { key: 'insThinT', vars: { pct: formatPercent(totals.netMargin) } },
      blocks: [
        { kind: 'text', text: { key: 'insMarginB' }, ...(atLoss ? { tone: 'negative' as const } : {}) },
        {
          kind: 'steps',
          items: [
            { text: { key: 'evSellerProfit' }, value: totals.sellerProfit, format: 'money' },
            { text: { key: 'evCost' }, value: totals.purchasePrice, format: 'money' },
            { text: { key: 'evExpenseOther' }, value: totals.expenseOther, format: 'money' },
            { text: { key: 'evNetProfit' }, value: totals.netProfit, format: 'money' },
          ],
        },
      ],
    });
  }

  /* ── expense ledger ───────────────────────────────────────────────────── */

  for (const [source, value] of totals.expenseBySource) {
    if (source === LOGISTICS_SOURCE || value <= 0) continue;
    const share = totals.sellPrice === 0 ? 0 : (value / totals.sellPrice) * 100;
    if (share < EXPENSE_SHARE) continue;

    cards.push({
      id: `expense-${source}`,
      origin: 'rule',
      target: 'finance',
      severity: share >= 5 ? 'high' : 'watch',
      categoryKey: 'catOpportunity',
      group: 'profit',
      source: 'GET /v1/finance/expenses · paymentPrice',
      signal: { value: share, format: 'percent' },
      title: { key: 'insExpenseT', vars: { source, pct: formatPercent(share) } },
      blocks: [
        { kind: 'text', text: { key: 'insExpenseB' } },
        {
          kind: 'kv',
          rows: [
            { label: source, value, format: 'money' },
            { label: { key: 'evRevenue' }, value: totals.sellPrice, format: 'money' },
          ],
        },
      ],
    });
  }

  /* ── returns ──────────────────────────────────────────────────────────── */

  const returnHeavy = products
    .filter((product) => product.sold >= 10 && product.returnedPct >= RETURN_RATE)
    .sort((a, b) => b.returnedPct - a.returnedPct);

  if (returnHeavy.length > 0) {
    cards.push({
      id: 'returns-rate',
      origin: 'rule',
      target: 'products',
      severity: 'high',
      categoryKey: 'catOperations',
      group: 'stockOps',
      source: 'productList.returnedPercentage',
      title: {
        key: 'insReturnT',
        vars: { n: formatNumber(returnHeavy.length), pct: formatPercent(RETURN_RATE, 0) },
      },
      blocks: [
        { kind: 'text', text: { key: 'insReturnB' } },
        {
          kind: 'table',
          columns: [{ key: 'colProduct' }, { key: 'evReturnRate' }],
          rows: returnHeavy.slice(0, 5).map((product) => [product.name, product.returnedPct]),
          formats: ['text', 'percent'],
        },
      ],
    });
  }

  /* ── supply ───────────────────────────────────────────────────────────── */

  const short = (input.invoices?.supply ?? []).filter(
    (invoice) =>
      invoice.totalAccepted < invoice.totalToStock && invoice.invoiceStatus?.value === 'ACCEPTED',
  );

  if (short.length > 0) {
    const missing = short.reduce(
      (sum, invoice) => sum + (invoice.totalToStock - invoice.totalAccepted),
      0,
    );

    cards.push({
      id: 'supply-shortfall',
      origin: 'rule',
      target: 'invoices',
      severity: 'watch',
      categoryKey: 'catInventory',
      group: 'stockOps',
      source: 'GET /v1/invoice · totalToStock vs totalAccepted',
      signal: { value: missing, format: 'count' },
      title: { key: 'insSupplyT', vars: { n: formatNumber(missing) } },
      blocks: [
        { kind: 'text', text: { key: 'insSupplyB' } },
        {
          kind: 'kv',
          rows: [
            { label: { key: 'evMissingUnits' }, value: missing, format: 'count' },
            { label: { key: 'evShortInvoices' }, value: short.length, format: 'count' },
          ],
        },
        {
          kind: 'table',
          columns: [{ key: 'colInvoice' }, { key: 'colAccepted' }],
          rows: short
            .slice(0, 5)
            .map((invoice) => [
              String(invoice.id),
              `${formatNumber(invoice.totalAccepted)} / ${formatNumber(invoice.totalToStock)}`,
            ]),
        },
      ],
    });
  }

  return cards.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Blocks are exported as a type-only convenience for the rail's tests. */
export type { Block };
