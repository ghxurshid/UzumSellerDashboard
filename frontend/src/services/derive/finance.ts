import type { FinanceOrderItem, SellerPayment } from '@/services/uzum/types';

/**
 * The money model.
 *
 * The seller OpenAPI has no aggregate, score or forecast endpoint, so every
 * figure in the application is a sum over rows it returned. This module owns
 * those sums, once, so that two screens can never disagree about what net
 * profit means.
 *
 * Two facts about the data drive the arithmetic:
 *
 *  1. `sellerProfit = sellPrice − commission − logisticDeliveryFee`. Your own
 *     `purchasePrice` is *not* in it, so net profit has to be finished here.
 *  2. Logistics appears twice — inside `sellerProfit` and again as a
 *     `Logistika` row in the expense ledger. Counting the ledger row would
 *     charge the same fee to the same order a second time, so it is excluded
 *     from the expense total and reported separately.
 */

/** Expense ledger buckets, matched on the `source` field the API returns. */
export const LOGISTICS_SOURCE = 'Logistika';

export interface FinanceTotals {
  /** Items that were not cancelled — everything below is summed over these. */
  readonly liveItems: number;
  readonly cancelledItems: number;
  readonly orders: number;
  readonly units: number;

  readonly sellPrice: number;
  readonly purchasePrice: number;
  readonly commission: number;
  readonly logisticDeliveryFee: number;
  readonly sellerProfit: number;
  readonly withdrawnProfit: number;
  readonly returnedUnits: number;

  /** Ledger totals, split so logistics is never double-counted. */
  readonly expenseLogistics: number;
  readonly expenseOther: number;
  readonly expenseBySource: ReadonlyMap<string, number>;

  /** `sellerProfit − purchasePrice − expenseOther`. The number that matters. */
  readonly netProfit: number;
  /** Net profit as a share of `sellPrice`, in percent. */
  readonly netMargin: number;
  readonly averageOrderValue: number;
  /** Share of order items that were cancelled, in percent. */
  readonly cancellationRate: number;
}

const isCancelled = (item: FinanceOrderItem): boolean =>
  item.status === 'CANCELED' || item.cancelled === true;

export function summariseFinance(
  items: readonly FinanceOrderItem[],
  payments: readonly SellerPayment[],
  options: { readonly cancelledTotal?: number; readonly reportedTotal?: number } = {},
): FinanceTotals {
  const orderIds = new Set<number>();

  let liveItems = 0;
  let cancelledItems = 0;
  let units = 0;
  let sellPrice = 0;
  let purchasePrice = 0;
  let commission = 0;
  let logisticDeliveryFee = 0;
  let sellerProfit = 0;
  let withdrawnProfit = 0;
  let returnedUnits = 0;

  for (const item of items) {
    if (isCancelled(item)) {
      cancelledItems += 1;
      continue;
    }

    liveItems += 1;
    orderIds.add(item.orderId);
    units += item.amount ?? 0;
    returnedUnits += item.amountReturns ?? 0;
    sellPrice += item.sellPrice ?? 0;
    purchasePrice += item.purchasePrice ?? 0;
    commission += item.commission ?? 0;
    logisticDeliveryFee += item.logisticDeliveryFee ?? 0;
    sellerProfit += item.sellerProfit ?? 0;
    withdrawnProfit += item.withdrawnProfit ?? 0;
  }

  const expenseBySource = new Map<string, number>();
  let expenseLogistics = 0;
  let expenseOther = 0;

  for (const payment of payments) {
    /* INCOME rows are refunds (a cancelled order's logistics coming back), so
       they net against the outgoing charge rather than adding to it. */
    const signed = payment.type === 'INCOME' ? -payment.paymentPrice : payment.paymentPrice;
    expenseBySource.set(payment.source, (expenseBySource.get(payment.source) ?? 0) + signed);

    if (payment.source === LOGISTICS_SOURCE) expenseLogistics += signed;
    else expenseOther += signed;
  }

  const netProfit = sellerProfit - purchasePrice - expenseOther;
  const totalItems = options.reportedTotal ?? liveItems + cancelledItems;
  const cancelled = options.cancelledTotal ?? cancelledItems;

  return {
    liveItems,
    cancelledItems: cancelled,
    orders: orderIds.size,
    units,
    sellPrice,
    purchasePrice,
    commission,
    logisticDeliveryFee,
    sellerProfit,
    withdrawnProfit,
    returnedUnits,
    expenseLogistics,
    expenseOther,
    expenseBySource,
    netProfit,
    netMargin: sellPrice === 0 ? 0 : (netProfit / sellPrice) * 100,
    averageOrderValue: orderIds.size === 0 ? 0 : sellPrice / orderIds.size,
    cancellationRate: totalItems === 0 ? 0 : (cancelled / totalItems) * 100,
  };
}

/** Percentage change between two periods; `null` when there is nothing to compare to. */
export function changeBetween(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
