import type { FinanceTotals } from '@/services/derive/finance';
import { LOGISTICS_SOURCE } from '@/services/derive/finance';
import { flattenSkus } from '@/services/derive/products';
import type { InvoicesSource } from '@/services/queries/sources';
import type { Product } from '@/types/domain';

import { clip, compose, dec, num, pairs, table } from './plaintext';

/**
 * A window of the account, written out as data.
 *
 * This replaces the fact table. That table was a set of `ref → value` pairs the
 * model could cite but not state, and it carried the whole weight of keeping
 * figures honest by keeping them out of the model's hands. The model now reads
 * the figures and writes them — so what it needs from here is not a catalogue
 * of citable names but the numbers themselves, labelled well enough that a
 * sum, a share or a difference taken over them is taken over the right thing.
 *
 * Two readers use it: `window.totals` in the chat toolkit, which writes the
 * money model for one window, and the insights rail, which hands the model the
 * whole digest in one prompt because its question never changes.
 */

/**
 * The money model for one window, as `key=value` lines.
 *
 * The derivations are stated beside the figures, because a model that knows
 * `netProfit = sellerProfit - purchasePrice - expenseOther` can explain a
 * change in it, and one that only has the three numbers has to guess how they
 * relate. `sellerAdjustment` is kept for the same reason it was introduced: it
 * is the residual that makes a revenue-to-profit chain arrive at its total, and
 * a waterfall that stops short of net profit is a chart the seller can see is
 * wrong.
 */
export function moneyLines(totals: FinanceTotals): readonly string[] {
  const take = totals.commission + totals.logisticDeliveryFee;
  const takeRate = totals.sellPrice === 0 ? 0 : (take / totals.sellPrice) * 100;
  const sellerAdjustment =
    totals.sellPrice - totals.commission - totals.logisticDeliveryFee - totals.sellerProfit;

  return [
    "money so'm, whole numbers · pct = percent, already multiplied by 100 · cancelled items are excluded",
    pairs([
      ['sellPrice', num(totals.sellPrice)],
      ['commission', num(totals.commission)],
      ['logistics', num(totals.logisticDeliveryFee)],
      ['sellerAdjustment', num(sellerAdjustment)],
      ['sellerProfit', num(totals.sellerProfit)],
      ['purchasePrice', num(totals.purchasePrice)],
      ['expenseOther', num(totals.expenseOther)],
      ['netProfit', num(totals.netProfit)],
    ]),
    pairs([
      ['netMarginPct', dec(totals.netMargin)],
      ['take', num(take)],
      ['takeRatePct', dec(takeRate)],
      ['aov', num(totals.averageOrderValue)],
      ['withdrawnProfit', num(totals.withdrawnProfit)],
    ]),
    pairs([
      ['orders', totals.orders],
      ['units', totals.units],
      ['liveItems', totals.liveItems],
      ['cancelledItems', totals.cancelledItems],
      ['cancellationRatePct', dec(totals.cancellationRate)],
      ['returnedUnits', totals.returnedUnits],
    ]),
    'sellerProfit = sellPrice - commission - logistics - sellerAdjustment',
    'netProfit = sellerProfit - purchasePrice - expenseOther',
    'take = commission + logistics; takeRatePct = take / sellPrice',
    'A revenue-to-net-profit waterfall is: sellPrice, then minus commission, logistics,',
    'sellerAdjustment, purchasePrice, expenseOther, ending at netProfit. Logistics is already',
    'inside sellerProfit, so the ledger\'s logistics line is never subtracted a second time.',
  ];
}

/** The expense ledger split by source, biggest first, with its share of sellPrice. */
export function ledgerTable(totals: FinanceTotals): string {
  const rows = [...totals.expenseBySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([source, amount]) => [
      source,
      num(amount),
      totals.sellPrice > 0 ? dec((amount / totals.sellPrice) * 100) : '',
      source === LOGISTICS_SOURCE ? 'inside sellerProfit' : 'in expenseOther',
    ]);

  return rows.length === 0
    ? 'expense ledger: no rows in this window'
    : compose(['expense ledger by source:', table(['source', 'amount', 'pctOfSellPrice', 'counted'], rows)]);
}

export interface DigestInput {
  readonly totals: FinanceTotals;
  readonly products: readonly Product[];
  readonly invoices: InvoicesSource | undefined;
}

/**
 * How many products the rail's digest lists.
 *
 * Every product in the catalogue would be the most useful table and the most
 * expensive prompt. The ranked head is where the findings are: a card about the
 * long tail is a card about rows the seller has no time to act on anyway.
 */
const DIGEST_PRODUCTS = 15;

/** The whole account for one window, for the insights rail's single prompt. */
export function buildDigest(input: DigestInput): string {
  const { totals, products } = input;
  const skus = flattenSkus(products);

  const zeroStock = skus.filter((sku) => sku.quantityAvailable === 0).length;
  const negativeStock = skus.filter((sku) => sku.quantityAvailable < 0).length;
  const runOut = products.filter((product) => product.status === 'RUN_OUT').length;

  const short = (input.invoices?.supply ?? []).filter(
    (invoice) =>
      invoice.totalAccepted < invoice.totalToStock && invoice.invoiceStatus?.value === 'ACCEPTED',
  );
  const missingUnits = short.reduce(
    (sum, invoice) => sum + (invoice.totalToStock - invoice.totalAccepted),
    0,
  );

  const ranked = [...products].sort((a, b) => b.turnover - a.turnover).slice(0, DIGEST_PRODUCTS);

  return compose([
    'MONEY — the selected window',
    ...moneyLines(totals),
    ledgerTable(totals),
    '',
    'CATALOGUE — current snapshot',
    pairs([
      ['products', products.length],
      ['skus', skus.length],
      ['skusAtZero', zeroStock],
      ['skusNegative', negativeStock],
      ['productsRunOut', runOut],
      ['zeroStockPct', skus.length === 0 ? '0' : dec((zeroStock / skus.length) * 100)],
    ]),
    input.invoices === undefined
      ? 'supply: not read yet'
      : pairs([
          ['supplyInvoices', input.invoices.supply.length],
          ['shortInvoices', short.length],
          ['unitsDeclaredNeverAccepted', missingUnits],
        ]),
    '',
    `TOP ${ranked.length} PRODUCTS by lifetime turnover (catalogue counters, not the window):`,
    ranked.length === 0
      ? 'no products'
      : table(
          ['productId', 'name', 'price', 'purchasePrice', 'unitMargin', 'soldLifetime', 'turnover', 'returnedPct', 'available'],
          ranked.map((product) => [
            product.productId,
            clip(product.name),
            product.price,
            product.purchasePrice,
            product.price - product.purchasePrice,
            product.sold,
            product.turnover,
            dec(product.returnedPct),
            product.quantityAvailable,
          ]),
        ),
  ]);
}

/**
 * A cheap fingerprint of the digest's numbers.
 *
 * Not a hash of the whole text: the point is to change when the account's
 * figures change and to stay put when they do not, and a handful of totals plus
 * the catalogue's size does that at a fraction of the cost. A collision costs
 * one stale set of AI cards until the next sync.
 */
export function digestKey(input: DigestInput): string {
  const skus = flattenSkus(input.products);
  return [
    input.totals.sellPrice,
    input.totals.netProfit,
    input.totals.cancelledItems,
    input.products.length,
    skus.length,
    skus.filter((sku) => sku.quantityAvailable <= 0).length,
    input.invoices?.supply.length ?? -1,
  ]
    .map((part) => Math.round(part))
    .join(':');
}
