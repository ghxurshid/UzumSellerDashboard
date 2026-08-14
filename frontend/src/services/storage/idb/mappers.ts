import type { FinanceOrderItem, SellerPayment } from '@/services/uzum/types';

import type { CatalogSku, ChangeEvent, ChangeField } from '../archive/codec';
import { CHANGE_FIELDS } from '../archive/codec';
import {
  ENTITY_TYPES,
  dayOf,
  recordId,
  type CatalogSkuRecord,
  type ChangeEventRecord,
  type ExpenseRecord,
  type OrderItemRecord,
} from './schema';

/**
 * Wire rows in, flat records out — and back again.
 *
 * The archive used to store positional tuples against a shared string table,
 * because localStorage charged for every character and a raw order item is
 * about 1 900 of them. That trade is off the table now: IndexedDB stores
 * structured clones, so a number is a number rather than eight characters of
 * decimal, and an index can only be built over a named field. Packing would now
 * cost the very thing the schema exists to provide.
 *
 * So a record is flat, named and denormalised, and it carries three kinds of
 * column:
 *
 *   1. **Identity and axis** — `id`, `store_id`, `entity_type`, `timestamp`.
 *      The index is built on these.
 *   2. **The facts themselves**, one per field, no nesting.
 *   3. **Pre-computed derivations** — `revenue`, `day`, `cancelled`,
 *      `signed_amount`. Each is something a chart or an AI summary would
 *      otherwise recompute per row on every read. They cost a few bytes in a
 *      store with gigabytes of headroom and they remove all arithmetic from the
 *      aggregation loop, which is the difference between a series that redraws
 *      in a frame and one that stutters.
 *
 * The contract every mapper keeps: `fromRecord(toRecord(x))` is the same object
 * the derivation layer was already passing around. Nothing above this module
 * knows records exist, which is what let the storage engine change underneath
 * the application at all.
 */

/* ── order items ────────────────────────────────────────────────────────── */

const CANCELLED = 'CANCELED';

export function orderToRecord(
  item: FinanceOrderItem,
  account: string,
  storeId: number,
): OrderItemRecord {
  const sellPrice = item.sellPrice ?? 0;
  const amount = item.amount ?? 0;

  return {
    id: recordId(account, storeId, ENTITY_TYPES.orderItem, item.id),
    store_id: storeId,
    entity_type: ENTITY_TYPES.orderItem,
    timestamp: item.date,
    day: dayOf(item.date),
    account,

    item_id: item.id,
    order_id: item.orderId,
    product_id: item.productId,
    sku_title: item.skuTitle ?? '',
    product_title: item.productTitle ?? '',
    status: item.status ?? '',
    sell_price: sellPrice,
    amount,
    amount_returns: item.amountReturns ?? 0,
    commission: item.commission ?? 0,
    seller_profit: item.sellerProfit ?? 0,
    purchase_price: item.purchasePrice ?? 0,
    logistic_fee: item.logisticDeliveryFee ?? 0,
    withdrawn_profit: item.withdrawnProfit ?? 0,
    return_cause: item.returnCause ?? null,

    /* Derived once, here, rather than in every consumer. */
    revenue: sellPrice * amount,
    cancelled: item.status === CANCELLED ? 1 : 0,
  };
}

/**
 * Rebuild the wire shape.
 *
 * `dateIssued` and `comment` come back as `null` because they are not stored:
 * nothing in the application reads them, and they were the two heaviest fields
 * on the row. `cancelled` is reconstructed from `status` rather than stored
 * twice — it is that field restated.
 */
export function recordToOrder(record: OrderItemRecord): FinanceOrderItem {
  return {
    id: record.item_id,
    date: record.timestamp,
    status: record.status,
    orderId: record.order_id,
    productId: record.product_id,
    skuTitle: record.sku_title,
    productTitle: record.product_title,
    shopId: record.store_id,
    sellPrice: record.sell_price,
    amount: record.amount,
    amountReturns: record.amount_returns,
    commission: record.commission,
    sellerProfit: record.seller_profit,
    purchasePrice: record.purchase_price,
    logisticDeliveryFee: record.logistic_fee,
    withdrawnProfit: record.withdrawn_profit,
    returnCause: record.return_cause,
    cancelled: record.cancelled === 1 ? true : null,
    dateIssued: null,
    comment: null,
  };
}

/* ── expenses ───────────────────────────────────────────────────────────── */

const INCOME = 'INCOME';

export function expenseToRecord(
  payment: SellerPayment,
  account: string,
  storeId: number,
): ExpenseRecord {
  const price = payment.paymentPrice ?? 0;
  const kind = payment.type ?? '';

  return {
    id: recordId(account, storeId, ENTITY_TYPES.expense, payment.id),
    store_id: storeId,
    entity_type: ENTITY_TYPES.expense,
    timestamp: payment.dateCreated,
    day: dayOf(payment.dateCreated),
    account,

    payment_id: payment.id,
    name: payment.name ?? '',
    source: payment.source ?? '',
    code: payment.code ?? '',
    payment_price: price,
    amount: payment.amount ?? 0,
    kind,

    /* Signed at write time so a period's net cash movement is one summation of
       one column, rather than a branch on `type` per row. */
    signed_amount: kind === INCOME ? price : -price,
  };
}

export function recordToExpense(record: ExpenseRecord): SellerPayment {
  return {
    id: record.payment_id,
    dateCreated: record.timestamp,
    dateUpdated: null,
    name: record.name,
    source: record.source,
    shopId: record.store_id,
    sellerId: 0,
    paymentPrice: record.payment_price,
    amount: record.amount,
    type: record.kind,
    status: '',
    externalId: null,
    code: record.code,
    dateService: null,
  };
}

/* ── catalogue captures ─────────────────────────────────────────────────── */

/**
 * A SKU as it stood at `capturedAt`.
 *
 * The timestamp is the capture, not the SKU: a catalogue row states what is
 * true *now*, and the whole capture is replaced on every sync. Keying by
 * `sku_id` alone — rather than by sku and time — is deliberate, and it is what
 * makes the replacement a set of overwrites instead of an ever-growing series
 * of snapshots nobody reads.
 */
export function skuToRecord(
  sku: CatalogSku,
  account: string,
  storeId: number,
  capturedAt: number,
): CatalogSkuRecord {
  return {
    id: recordId(account, storeId, ENTITY_TYPES.catalogSku, sku.skuId),
    store_id: storeId,
    entity_type: ENTITY_TYPES.catalogSku,
    timestamp: capturedAt,
    day: dayOf(capturedAt),
    account,

    sku_id: sku.skuId,
    product_id: sku.productId,
    title: sku.title,
    price: sku.price,
    purchase_price: sku.purchasePrice,
    quantity_available: sku.quantityAvailable,
    quantity_active: sku.quantityActive,
    quantity_fbs: sku.quantityFbs,
    quantity_sold: sku.quantitySold,
    quantity_returned: sku.quantityReturned,
    rank: sku.rank,
    discount: sku.discount ? 1 : 0,
    fbs_stock: sku.fbsStock,
    barcode: sku.barcode,
  };
}

export function recordToSku(record: CatalogSkuRecord): CatalogSku {
  return {
    skuId: record.sku_id,
    productId: record.product_id,
    title: record.title,
    price: record.price,
    purchasePrice: record.purchase_price,
    quantityAvailable: record.quantity_available,
    quantityActive: record.quantity_active,
    quantityFbs: record.quantity_fbs,
    quantitySold: record.quantity_sold,
    quantityReturned: record.quantity_returned,
    rank: record.rank,
    discount: record.discount === 1,
    fbsStock: record.fbs_stock,
    barcode: record.barcode,
  };
}

/* ── change events ──────────────────────────────────────────────────────── */

/**
 * A change this machine observed.
 *
 * The key includes the instant, the SKU and the field, because unlike the other
 * three entities a change event is not a row that gets corrected later — it is
 * an append-only observation, and two changes to the same SKU on different days
 * are two facts rather than one fact restated. Making the key deterministic
 * still matters: replaying the same sync twice must not journal it twice.
 */
export function changeToRecord(
  event: ChangeEvent,
  account: string,
  storeId: number,
): ChangeEventRecord {
  return {
    id: recordId(
      account,
      storeId,
      ENTITY_TYPES.changeEvent,
      `${event.at}-${event.skuId}-${event.field}`,
    ),
    store_id: storeId,
    entity_type: ENTITY_TYPES.changeEvent,
    timestamp: event.at,
    day: dayOf(event.at),
    account,

    sku_id: event.skuId,
    product_id: event.productId,
    field: event.field,
    from_value: event.from,
    to_value: event.to,
  };
}

/**
 * Rebuild a change event, or `null` if the field is one this build no longer
 * knows.
 *
 * A record written by a future build could name a field that was added after
 * this one shipped. Dropping it is right: a change to something this build
 * cannot describe is not something it can draw.
 */
export function recordToChange(record: ChangeEventRecord): ChangeEvent | null {
  if (!(CHANGE_FIELDS as readonly string[]).includes(record.field)) return null;

  return {
    at: record.timestamp,
    skuId: record.sku_id,
    productId: record.product_id,
    field: record.field as ChangeField,
    from: record.from_value,
    to: record.to_value,
  };
}
