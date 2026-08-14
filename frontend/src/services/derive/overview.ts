import { formatCompactMoney, formatDelta, formatNumber, formatPercent, trendOf } from '@/lib/format';
import type { DateWindow } from '@/services/uzum/endpoints';
import type { FinanceOrderItem, SellerPayment } from '@/services/uzum/types';
import type {
  EconomicsRow,
  HeatCell,
  Kpi,
  Language,
  Product,
  RankBucket,
  SeriesPoint,
  TickerItem,
  Tone,
} from '@/types/domain';

import { changeBetween, summariseFinance, type FinanceTotals } from './finance';
import { buildStatusBuckets } from './products';
import { buildHeatmap, buildSeries, itemsToday, sparkFrom } from './series';

/**
 * The overview screen, assembled from what the API returned.
 *
 * Every tile names the field it is summed from. Deltas appear only when a
 * previous period has actually been read — when it has not, the tile shows the
 * figure and no comparison, because a delta against nothing is a fabrication.
 */

export interface OverviewSummary {
  readonly kpis: readonly Kpi[];
  readonly ticker: readonly TickerItem[];
  readonly economics: readonly EconomicsRow[];
  readonly ranks: readonly RankBucket[];
  readonly heatmap: readonly HeatCell[];
  readonly series: readonly SeriesPoint[];
  readonly productTotal: number;
  readonly totals: FinanceTotals;
  /** True when the finance read stopped at the page ceiling. */
  readonly truncated: boolean;
  /** Order items the API reports for the window, whether or not all were read. */
  readonly reportedItems: number;
}

export interface OverviewInput {
  readonly items: readonly FinanceOrderItem[];
  readonly reportedTotal: number;
  readonly cancelledTotal: number;
  readonly truncated: boolean;
  readonly payments: readonly SellerPayment[];
  readonly products: readonly Product[];
  readonly window: DateWindow;
  readonly language: Language;
  /** The same window one period earlier, when it has been read. */
  readonly previous?: {
    readonly items: readonly FinanceOrderItem[];
    readonly payments: readonly SellerPayment[];
  } | undefined;
}

interface TileInput {
  readonly key: string;
  readonly labelKey: string;
  readonly value: string;
  readonly unit: string;
  readonly current: number;
  readonly previous: number | null;
  readonly spark: readonly number[];
  readonly source: string;
  /** A rise is a regression for this metric (returns, cancellations). */
  readonly invert?: boolean;
}

function tile(input: TileInput): Kpi {
  const change = input.previous === null ? null : changeBetween(input.current, input.previous);
  const trend = change === null ? 'flat' : trendOf(input.invert === true ? -change : change);

  return {
    key: input.key,
    labelKey: input.labelKey,
    value: input.value,
    unit: input.unit,
    delta: change === null ? '' : formatDelta(change),
    trend,
    spark: input.spark,
    source: input.source,
  };
}

export function buildOverview(input: OverviewInput): OverviewSummary {
  const totals = summariseFinance(input.items, input.payments, {
    cancelledTotal: input.cancelledTotal,
    reportedTotal: input.reportedTotal,
  });

  const previous =
    input.previous === undefined
      ? null
      : summariseFinance(input.previous.items, input.previous.payments);

  const series = buildSeries(input.items, input.window);
  const revenueSpark = sparkFrom(series, 'revenue');
  const profitSpark = sparkFrom(series, 'profit');

  const money = (value: number): string => formatCompactMoney(value, input.language);
  const unit = (value: number): string =>
    Math.abs(value) >= 1_000_000 ? (input.language === 'ru' ? 'млн' : 'mln') : input.language === 'ru' ? 'тыс' : 'ming';

  /* Stock turn is only meaningful where there is stock to turn over. */
  const availableUnits = input.products.reduce(
    (sum, product) => sum + Math.max(0, product.quantityAvailable),
    0,
  );
  const soldUnits = input.products.reduce((sum, product) => sum + product.sold, 0);
  const stockTurn = availableUnits === 0 ? 0 : soldUnits / availableUnits;

  const kpis: readonly Kpi[] = [
    tile({
      key: 'revenue',
      labelKey: 'kRev',
      value: money(totals.sellPrice).split(' ')[0] ?? '0',
      unit: unit(totals.sellPrice),
      current: totals.sellPrice,
      previous: previous?.sellPrice ?? null,
      spark: revenueSpark,
      source: 'Σ sellPrice · /v1/finance/orders',
    }),
    tile({
      key: 'profit',
      labelKey: 'kProf',
      value: money(totals.netProfit).split(' ')[0] ?? '0',
      unit: unit(totals.netProfit),
      current: totals.netProfit,
      previous: previous?.netProfit ?? null,
      spark: profitSpark,
      source: 'sellerProfit − purchasePrice − expenses',
    }),
    tile({
      key: 'margin',
      labelKey: 'kMarg',
      value: formatNumber(totals.netMargin, 1),
      unit: '%',
      current: totals.netMargin,
      previous: previous?.netMargin ?? null,
      spark: profitSpark,
      source: 'netProfit ÷ sellPrice',
    }),
    tile({
      key: 'orders',
      labelKey: 'kOrd',
      value: formatNumber(totals.orders),
      unit: '',
      current: totals.orders,
      previous: previous?.orders ?? null,
      spark: revenueSpark,
      source: 'distinct orderId · /v1/finance/orders',
    }),
    tile({
      key: 'aov',
      labelKey: 'kAov',
      value: formatNumber(totals.averageOrderValue),
      unit: input.language === 'ru' ? 'сум' : "so'm",
      current: totals.averageOrderValue,
      previous: previous?.averageOrderValue ?? null,
      spark: revenueSpark,
      source: 'Σ sellPrice ÷ orders',
    }),
    tile({
      key: 'turn',
      labelKey: 'kTurn',
      value: formatNumber(stockTurn, 1),
      unit: 'x',
      current: stockTurn,
      previous: null,
      spark: [stockTurn],
      source: 'Σ quantitySold ÷ Σ quantityAvailable',
    }),
    tile({
      key: 'cash',
      labelKey: 'kCash',
      value: money(totals.withdrawnProfit).split(' ')[0] ?? '0',
      unit: unit(totals.withdrawnProfit),
      current: totals.withdrawnProfit,
      previous: previous?.withdrawnProfit ?? null,
      spark: profitSpark,
      source: 'Σ withdrawnProfit',
    }),
  ];

  /* The ticker reports on today only — it is the "live" strip, and yesterday's
     numbers in it would be a lie by omission. */
  const today = summariseFinance(itemsToday(input.items), []);
  const buyout =
    today.units === 0 ? 0 : ((today.units - today.returnedUnits) / today.units) * 100;

  const ticker: readonly TickerItem[] = [
    {
      key: 'today',
      labelKey: 'tkToday',
      value: money(today.sellPrice),
      delta: '',
      trend: trendOf(today.sellPrice),
    },
    {
      key: 'orders',
      labelKey: 'tkOrders',
      value: formatNumber(today.orders),
      delta: '',
      trend: trendOf(today.orders),
    },
    {
      key: 'cancels',
      labelKey: 'tkCancels',
      value: formatNumber(today.cancelledItems),
      delta: '',
      trend: today.cancelledItems > 0 ? 'down' : 'flat',
    },
    {
      key: 'returns',
      labelKey: 'tkReturns',
      value: formatNumber(today.returnedUnits),
      delta: '',
      trend: today.returnedUnits > 0 ? 'down' : 'flat',
    },
    {
      key: 'buyout',
      labelKey: 'tkBuyout',
      value: formatPercent(buyout),
      delta: '',
      trend: trendOf(buyout - 90),
    },
  ];

  const share = (value: number): number =>
    totals.sellPrice === 0 ? 0 : Math.round((Math.abs(value) / totals.sellPrice) * 1000) / 10;

  const row = (
    key: string,
    labelKey: string,
    field: string,
    value: number,
    tone: Tone,
  ): EconomicsRow => ({
    key,
    labelKey,
    field,
    value: formatNumber(value),
    pct: key === 'revenue' ? 100 : share(value),
    tone,
  });

  const economics: readonly EconomicsRow[] = [
    row('revenue', 'kRev', 'Σ sellPrice', totals.sellPrice, 'accent'),
    row('cost', 'cPurchase', 'Σ purchasePrice', totals.purchasePrice, 'neutral'),
    row('commission', 'cFees', 'Σ commission', totals.commission, 'negative'),
    row('logistics', 'cCourier', 'Σ logisticDeliveryFee', totals.logisticDeliveryFee, 'warning'),
    row('profit', 'kProf', 'netProfit', totals.netProfit, totals.netProfit >= 0 ? 'positive' : 'negative'),
  ];

  return {
    kpis,
    ticker,
    economics,
    ranks: buildStatusBuckets(input.products),
    heatmap: buildHeatmap(input.items),
    series,
    productTotal: input.products.length,
    totals,
    truncated: input.truncated,
    reportedItems: input.reportedTotal,
  };
}
