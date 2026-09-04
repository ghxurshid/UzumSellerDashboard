import { formatMoney, formatNumber, formatPercent } from '@/lib/format';
import type { FinanceTotals } from '@/services/derive/finance';
import { LOGISTICS_SOURCE } from '@/services/derive/finance';
import { flattenSkus } from '@/services/derive/products';
import type { InvoicesSource } from '@/services/queries/sources';
import type { Language, Product } from '@/types/domain';

/**
 * Every number a card is allowed to cite.
 *
 * This is the single most consequential piece of the analysis layer, and it is
 * worth being explicit about why it exists. The model is asked to explain an
 * account's finances. If it writes figures into prose, three things follow: the
 * figure may be invented, it cannot be traced to a route, and it will drift out
 * of date the moment the period selector moves. None of those are detectable by
 * looking at the card.
 *
 * So the model is never given the job. It is handed this table — a flat set of
 * `ref → value` pairs summed from exactly the same sources the tables on screen
 * were drawn from — and its blocks cite refs. The application resolves them at
 * render time, in the user's locale and currency. A card therefore cannot state
 * a number this application did not compute, and re-rendering it after a period
 * change re-resolves every figure in it.
 *
 * The table is also the grounding context: `describeFacts()` writes it out for
 * the prompt. That symmetry is the point — the model can cite a fact if and only
 * if it was told about it, so "cite only what you were given" stops being an
 * instruction it may ignore and becomes a property of the schema.
 */

export type FactFormat = 'money' | 'percent' | 'count' | 'plain';

export interface Fact {
  readonly ref: string;
  /**
   * What the fact is, in English.
   *
   * Prompt-side only. On screen the label comes from whoever authored the block
   * — a dictionary key for a rule, the interface language for the model — so
   * this never needs translating.
   */
  readonly label: string;
  readonly value: number;
  readonly format: FactFormat;
}

export type FactTable = ReadonlyMap<string, Fact>;

/**
 * A series, for the charts that cannot cite their points one at a time.
 *
 * Ninety daily buckets are ninety numbers, and no author is going to name them
 * individually — so a `line` chart cites this by ref and the points stay on the
 * application's side of the line, exactly as a single figure does. The values
 * come from the analytics worker, off the main thread, over a bounded index
 * range; nothing here ever holds the period's rows.
 */
export interface FactSeries {
  readonly ref: string;
  readonly label: string;
  /** Bucket start instants, ascending and gap-free. */
  readonly at: readonly number[];
  readonly values: readonly number[];
  readonly format: FactFormat;
}

export type SeriesTable = ReadonlyMap<string, FactSeries>;

export const EMPTY_SERIES: SeriesTable = new Map();

export interface FactInput {
  readonly totals: FinanceTotals;
  readonly products: readonly Product[];
  readonly invoices: InvoicesSource | undefined;
}

/**
 * How many products get their own facts.
 *
 * Every product in the catalogue would be the most useful table and the most
 * expensive prompt. The ranked head is where the findings are: a card about the
 * long tail is a card about rows the seller has no time to act on anyway.
 */
const RANKED_PRODUCTS = 12;

/** `ref` is a path, and the segments are constrained so a product id is safe. */
function put(table: Map<string, Fact>, fact: Fact): void {
  table.set(fact.ref, fact);
}

/**
 * The money model of one window, as facts under a chosen prefix.
 *
 * Extracted from `buildFacts` because the chat can now hold more than one
 * window at a time: a question comparing July with August needs both sets of
 * figures citable at once, and a single `totals.netProfit` cannot be two
 * numbers. The tool that fetched the window names it — `jul`, `aug` — and its
 * figures arrive as `jul.netProfit`, `aug.netProfit`.
 *
 * The default id reproduces the original refs exactly, including the separate
 * `expense.*` namespace the rules in `derive/insights.ts` cite by name.
 */
export function moneyFacts(totals: FinanceTotals, id = 'totals'): readonly Fact[] {
  const facts: Fact[] = [];
  const m = id;
  const e = id === 'totals' ? 'expense' : `${id}.expense`;

  /* ── the window's money ───────────────────────────────────────────────── */

  facts.push({ ref: `${m}.sellPrice`, label: 'Sum sellPrice (revenue)', value: totals.sellPrice, format: 'money' });
  facts.push({ ref: `${m}.purchasePrice`, label: 'Sum purchasePrice (cost of goods)', value: totals.purchasePrice, format: 'money' });
  facts.push({ ref: `${m}.commission`, label: 'Sum commission', value: totals.commission, format: 'money' });
  facts.push({ ref: `${m}.logistics`, label: 'Sum logisticDeliveryFee', value: totals.logisticDeliveryFee, format: 'money' });
  facts.push({ ref: `${m}.sellerProfit`, label: 'Sum sellerProfit', value: totals.sellerProfit, format: 'money' });
  facts.push({ ref: `${m}.withdrawnProfit`, label: 'Sum withdrawnProfit', value: totals.withdrawnProfit, format: 'money' });
  facts.push({ ref: `${m}.netProfit`, label: 'Net profit (sellerProfit - purchasePrice - expenses)', value: totals.netProfit, format: 'money' });
  facts.push({ ref: `${m}.netMargin`, label: 'Net margin, percent of sellPrice', value: totals.netMargin, format: 'percent' });
  facts.push({ ref: `${m}.aov`, label: 'Average order value', value: totals.averageOrderValue, format: 'money' });

  /* ── the window's counts ──────────────────────────────────────────────── */

  facts.push({ ref: `${m}.orders`, label: 'Distinct orders', value: totals.orders, format: 'count' });
  facts.push({ ref: `${m}.units`, label: 'Units sold', value: totals.units, format: 'count' });
  facts.push({ ref: `${m}.liveItems`, label: 'Order items not cancelled', value: totals.liveItems, format: 'count' });
  facts.push({ ref: `${m}.cancelledItems`, label: 'Order items cancelled', value: totals.cancelledItems, format: 'count' });
  facts.push({ ref: `${m}.cancellationRate`, label: 'Cancellation rate, percent of order items', value: totals.cancellationRate, format: 'percent' });
  facts.push({ ref: `${m}.returnedUnits`, label: 'Units returned', value: totals.returnedUnits, format: 'count' });

  /* ── the expense ledger ───────────────────────────────────────────────── */

  facts.push({ ref: `${e}.logistics`, label: 'Expense ledger, logistics', value: totals.expenseLogistics, format: 'money' });
  facts.push({ ref: `${e}.other`, label: 'Expense ledger, everything except logistics', value: totals.expenseOther, format: 'money' });

  for (const [source, value] of totals.expenseBySource) {
    if (source === LOGISTICS_SOURCE) continue;
    facts.push({
      ref: `${e}.${slug(source)}`,
      label: `Expense ledger, ${source}`,
      value,
      format: 'money',
    });
    if (totals.sellPrice > 0) {
      facts.push({
        ref: `${e}.${slug(source)}.share`,
        label: `Expense ${source} as a share of revenue`,
        value: (value / totals.sellPrice) * 100,
        format: 'percent',
      });
    }
  }

  /**
   * The step that makes the chain add up.
   *
   * `netProfit` is built from Uzum's own `sellerProfit` rather than from revenue
   * less the commission and delivery lines — see `finance.ts`. The two are close
   * but not equal, so a deduction chain written as
   * `sellPrice − commission − logistics − purchasePrice − expenses` lands beside
   * `netProfit` instead of on it, by whatever `sellerProfit` accounts for and
   * those two lines do not.
   *
   * Without a name, that residual can only show up as a chart whose columns
   * quietly fail to reach its total — a figure the seller can see is missing and
   * cannot look up. Naming it makes the chain closeable and the gap citable, and
   * it is the honest label: this is the part of `sellerProfit` these deductions
   * do not explain, not a category anyone booked.
   *
   * Signed as a deduction, because that is what every other step in the chain
   * is: `commission` and the rest are stored as positive amounts that come off
   * the balance. So this is `base - sellerProfit`, and a marketplace that paid
   * out more than those two lines account for makes it negative — a deduction
   * of a negative amount, which is money going back on. Subtracting all six in
   * order lands on `totals.netProfit` exactly.
   */
  const sellerBase = totals.sellPrice - totals.commission - totals.logisticDeliveryFee;
  facts.push({
    ref: `${m}.sellerAdjustment`,
    label:
      '(sellPrice - commission - logisticDeliveryFee) - sellerProfit: the residual that closes a ' +
      'revenue-to-net-profit chain, signed as a deduction like the other steps. Negative means ' +
      'the payout exceeded those lines. Include it as a step whenever you draw that chain',
    value: sellerBase - totals.sellerProfit,
    format: 'money',
  });

  /* The marketplace's own cut, which is the one figure a seller cannot change
     by buying better — it is worth naming rather than leaving to be derived. */
  const take = totals.commission + totals.logisticDeliveryFee;
  facts.push({ ref: `${m}.take`, label: 'Marketplace take (commission + delivery)', value: take, format: 'money' });
  facts.push({
    ref: `${m}.takeRate`,
    label: 'Marketplace take as a share of revenue',
    value: totals.sellPrice === 0 ? 0 : (take / totals.sellPrice) * 100,
    format: 'percent',
  });

  return facts;
}

export function buildFacts(input: FactInput): FactTable {
  const { totals, products } = input;
  const table = new Map<string, Fact>();
  const skus = flattenSkus(products);

  for (const fact of moneyFacts(totals)) put(table, fact);

  /* ── the catalogue ────────────────────────────────────────────────────── */

  const zeroStock = skus.filter((sku) => sku.quantityAvailable === 0);
  const negativeStock = skus.filter((sku) => sku.quantityAvailable < 0);
  const runOut = products.filter((product) => product.status === 'RUN_OUT');

  put(table, { ref: 'catalogue.products', label: 'Products read', value: products.length, format: 'count' });
  put(table, { ref: 'catalogue.skus', label: 'SKUs across those products', value: skus.length, format: 'count' });
  put(table, { ref: 'catalogue.zeroStock', label: 'SKUs with quantityAvailable = 0', value: zeroStock.length, format: 'count' });
  put(table, { ref: 'catalogue.negativeStock', label: 'SKUs with quantityAvailable < 0', value: negativeStock.length, format: 'count' });
  put(table, { ref: 'catalogue.runOut', label: 'Products in status RUN_OUT', value: runOut.length, format: 'count' });
  put(table, {
    ref: 'catalogue.zeroStockShare',
    label: 'Share of SKUs at zero available',
    value: skus.length === 0 ? 0 : (zeroStock.length / skus.length) * 100,
    format: 'percent',
  });

  /* ── supply ───────────────────────────────────────────────────────────── */

  const short = (input.invoices?.supply ?? []).filter(
    (invoice) =>
      invoice.totalAccepted < invoice.totalToStock && invoice.invoiceStatus?.value === 'ACCEPTED',
  );
  const missingUnits = short.reduce(
    (sum, invoice) => sum + (invoice.totalToStock - invoice.totalAccepted),
    0,
  );

  put(table, { ref: 'supply.shortInvoices', label: 'Accepted supply invoices short of what was declared', value: short.length, format: 'count' });
  put(table, { ref: 'supply.missingUnits', label: 'Units declared but never accepted into the warehouse', value: missingUnits, format: 'count' });

  /* ── per product, for the ranked head ─────────────────────────────────── */

  const ranked = [...products].sort((a, b) => b.turnover - a.turnover).slice(0, RANKED_PRODUCTS);

  for (const product of ranked) {
    const base = `product.${product.productId}`;
    const unitMargin = product.price - product.purchasePrice;

    put(table, { ref: `${base}.price`, label: `Price of "${product.name}"`, value: product.price, format: 'money' });
    put(table, { ref: `${base}.purchasePrice`, label: `Purchase price of "${product.name}"`, value: product.purchasePrice, format: 'money' });
    put(table, { ref: `${base}.unitMargin`, label: `Price minus purchase price for "${product.name}"`, value: unitMargin, format: 'money' });
    put(table, { ref: `${base}.sold`, label: `Units sold of "${product.name}"`, value: product.sold, format: 'count' });
    put(table, { ref: `${base}.turnover`, label: `Turnover of "${product.name}"`, value: product.turnover, format: 'money' });
    put(table, { ref: `${base}.returnedPct`, label: `Return rate of "${product.name}"`, value: product.returnedPct, format: 'percent' });
    put(table, { ref: `${base}.available`, label: `Available stock of "${product.name}"`, value: product.quantityAvailable, format: 'count' });
  }

  return table;
}

/** `Ombor xarajati` and the like become path-safe without losing identity. */
function slug(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/* ── resolution ─────────────────────────────────────────────────────────── */

/**
 * A fact, written the way the rest of the interface writes numbers.
 *
 * Currency suffix, decimal separator and grouping all come from the user's
 * preferences through `lib/format`, so a figure inside a card and the same
 * figure in the table behind it are formatted by one code path.
 */
export function formatFact(fact: Fact, language: Language): string {
  switch (fact.format) {
    case 'money':
      return formatMoney(fact.value, language);
    case 'percent':
      return formatPercent(fact.value);
    case 'count':
      return formatNumber(fact.value);
    case 'plain':
      return String(fact.value);
  }
}

export function resolveFact(facts: FactTable, ref: string): Fact | null {
  return facts.get(ref) ?? null;
}

/**
 * The fact table, written out for the model.
 *
 * Values are included in their formatted form as well as raw, because the model
 * reasons better about "129 000 so'm" than about `129000` — and because a
 * comparison it makes in prose ("almost a fifth") should be against the number
 * the seller will actually see.
 */
export function describeFacts(facts: FactTable, language: Language): string {
  const lines: string[] = [];
  for (const fact of facts.values()) {
    lines.push(`${fact.ref} = ${formatFact(fact, language)}  — ${fact.label}`);
  }
  return lines.join('\n');
}

/**
 * The series, named but not enumerated.
 *
 * The model is told a series exists, what it measures and how long it is — not
 * what is in it. Ninety numbers would cost more prompt than the answer they
 * support, and the model does not need them: it decides *whether to draw the
 * series*, and the renderer draws it from the values the worker returned.
 */
export function describeSeries(series: SeriesTable): string {
  const lines: string[] = [];
  for (const entry of series.values()) {
    lines.push(`${entry.ref} — ${entry.label} (${entry.at.length} buckets)`);
  }
  return lines.join('\n');
}
