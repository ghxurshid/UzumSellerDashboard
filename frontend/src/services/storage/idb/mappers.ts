import type {
  FbsInvoice,
  FbsOrder,
  FinanceOrderItem,
  InvoiceProduct,
  SellerPayment,
  SellerReturn,
  ShopProduct,
  SkuAmount,
  SupplyInvoice,
} from '@/services/uzum/types';

import type { CatalogSku, ChangeEvent, ChangeField } from '../archive/codec';
import { CHANGE_FIELDS } from '../archive/codec';
import {
  ENTITY_TYPES,
  dayOf,
  recordId,
  type ChangeEventRecord,
  type ExpenseRecord,
  type FbsInvoiceRecord,
  type FbsOrderItemRecord,
  type FbsOrderRecord,
  type FbsStockRecord,
  type OrderItemRecord,
  type ProductRecord,
  type ProductSkuRecord,
  type ReturnItemRecord,
  type SellerReturnRecord,
  type SupplyInvoiceItemRecord,
  type SupplyInvoiceRecord,
} from './schema';

/**
 * Wire rows in, flat records out — and back again.
 *
 * A record is flat, named and denormalised, and it carries four kinds of column:
 *
 *   1. **Identity and axis** — `id`, `store_id`, `entity_type`, `timestamp`,
 *      `day`, `account`. The indexes are built on these, and `store_id` is on
 *      every entity without exception. The API is inconsistent about naming the
 *      shop — a finance row states `shopId`, a stock row never mentions one — so
 *      it is stamped here from the shop the request was made for rather than
 *      trusted from the payload.
 *   2. **A parent key**, on nested entities: `order_id`, `invoice_id`,
 *      `return_id`, `product_id`. Each is indexed, so the lines of one order are
 *      a keyed read rather than a walk of the parent.
 *   3. **The facts themselves**, one per field, no nesting.
 *   4. **Pre-computed derivations** — `revenue`, `signed_amount`, `line_total`,
 *      `shortfall`, `cancelled`. Each is something a chart or an AI summary
 *      would otherwise recompute per row on every read.
 *
 * ## Nulls and defaults
 *
 * Numbers default to `0` and strings to `''`, because IndexedDB will happily
 * index either but a `null` in a compound key silently excludes the row from
 * every range query over that index. The exceptions are the four deadline
 * timestamps — `accept_until`, `deliver_until`, `slot_from`, `slot_to` — where
 * `null` means "no deadline set" and `0` would mean 1970, which a countdown
 * would render as catastrophically overdue.
 */

const num = (value: number | null | undefined): number => value ?? 0;
const str = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);
const flag = (value: boolean | null | undefined): 0 | 1 => (value === true ? 1 : 0);

/* ── order items ────────────────────────────────────────────────────────── */

const CANCELLED = 'CANCELED';

export function orderToRecord(
  item: FinanceOrderItem,
  account: string,
  storeId: number,
): OrderItemRecord {
  const sellPrice = num(item.sellPrice);
  const amount = num(item.amount);

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
    sku_title: str(item.skuTitle),
    product_title: str(item.productTitle),
    status: str(item.status),
    sell_price: sellPrice,
    amount,
    amount_returns: num(item.amountReturns),
    commission: num(item.commission),
    seller_profit: num(item.sellerProfit),
    purchase_price: num(item.purchasePrice),
    logistic_fee: num(item.logisticDeliveryFee),
    withdrawn_profit: num(item.withdrawnProfit),
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
  const price = num(payment.paymentPrice);
  const kind = str(payment.type);

  return {
    id: recordId(account, storeId, ENTITY_TYPES.expense, payment.id),
    store_id: storeId,
    entity_type: ENTITY_TYPES.expense,
    timestamp: payment.dateCreated,
    day: dayOf(payment.dateCreated),
    account,

    payment_id: payment.id,
    name: str(payment.name),
    source: str(payment.source),
    code: str(payment.code),
    payment_price: price,
    amount: num(payment.amount),
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

/* ── FBS / DBS orders ───────────────────────────────────────────────────── */

/**
 * An order and its lines, from one wire object.
 *
 * Two records come out of one payload because the lines are their own entity:
 * asking "how many of this SKU shipped last week" should be a keyed read of
 * `fbs_order_items` on `sku_id`, not a walk of every order unpacking arrays.
 *
 * `timestamp` is `dateCreated` on both. A line has no date of its own, and
 * dating it by its parent is what lets the same period query answer for either.
 */
export function fbsOrderToRecords(
  order: FbsOrder,
  account: string,
  storeId: number,
): { order: FbsOrderRecord; items: readonly FbsOrderItemRecord[] } {
  const at = order.dateCreated ?? 0;
  const status = str(order.status);
  const lines = order.orderItems ?? [];

  const items = lines.map((line): FbsOrderItemRecord => {
    const amount = num(line.amount);
    const price = num(line.price);

    return {
      id: recordId(account, storeId, ENTITY_TYPES.fbsOrderItem, `${order.id}-${line.id}`),
      store_id: storeId,
      entity_type: ENTITY_TYPES.fbsOrderItem,
      timestamp: at,
      day: dayOf(at),
      account,

      item_id: line.id,
      order_id: order.id,
      sku_id: num(line.skuId),
      sku_title: str(line.skuTitle),
      product_title: str(line.productTitle),
      amount,
      price,
      line_total: price * amount,
      order_status: status,
    };
  });

  return {
    order: {
      id: recordId(account, storeId, ENTITY_TYPES.fbsOrder, order.id),
      store_id: storeId,
      entity_type: ENTITY_TYPES.fbsOrder,
      timestamp: at,
      day: dayOf(at),
      account,

      order_id: order.id,
      status,
      scheme: str(order.scheme),
      price: num(order.price),
      /* Kept nullable: `0` here would render as an infinitely overdue deadline. */
      accept_until: order.dateAcceptUntil ?? null,
      deliver_until: order.dateDeliverUntil ?? null,
      drop_off_title: str(order.dropOffPoint?.title),
      drop_off_address: str(order.dropOffPoint?.address),
      item_count: lines.length,
    },
    items,
  };
}

/* ── catalogue: products and SKUs ───────────────────────────────────────── */

/**
 * A product and its SKUs, from one wire object.
 *
 * The timestamp is the capture, not the product: a catalogue row states what is
 * true *now*, and the whole capture is replaced on every sync. Keying by
 * `product_id` alone — rather than by product and time — is what makes the
 * replacement a set of overwrites instead of an ever-growing series of
 * snapshots nobody reads.
 */
export function productToRecords(
  product: ShopProduct,
  account: string,
  storeId: number,
  capturedAt: number,
): { product: ProductRecord; skus: readonly ProductSkuRecord[] } {
  const skuList = product.skuList ?? [];

  const skus = skuList.map((sku): ProductSkuRecord => {
    const loose = sku as unknown as Record<string, unknown>;

    return {
      id: recordId(account, storeId, ENTITY_TYPES.productSku, sku.skuId),
      store_id: storeId,
      entity_type: ENTITY_TYPES.productSku,
      timestamp: capturedAt,
      day: dayOf(capturedAt),
      account,

      sku_id: sku.skuId,
      product_id: product.productId,
      title: str(sku.skuFullTitle ?? sku.skuTitle ?? product.title),
      characteristics: str(sku.characteristics),
      barcode: str(sku.barcode),
      seller_item_code: str(sku.sellerItemCode),
      price: num(sku.price),
      purchase_price: num(sku.purchasePrice),
      quantity_available: num(sku.quantityAvailable),
      quantity_active: num(sku.quantityActive),
      quantity_fbs: num(sku.quantityFbs),
      quantity_sold: num(sku.quantitySold),
      quantity_returned: num(sku.quantityReturned),
      returned_percentage: num(sku.returnedPercentage),
      commission: num(sku.commission),
      turnover: num(sku.turnover),
      rank: str(sku.rankInfo?.rank),
      discount: flag(hasDiscount(loose)),
      archived: flag(sku.archived),
      blocked: flag(sku.blocked),
    };
  });

  return {
    product: {
      id: recordId(account, storeId, ENTITY_TYPES.product, product.productId),
      store_id: storeId,
      entity_type: ENTITY_TYPES.product,
      timestamp: capturedAt,
      day: dayOf(capturedAt),
      account,

      product_id: product.productId,
      title: str(product.title),
      category: str(product.category),
      /* Stored as the API spells it — `IN_STOCK`, not our `ACTIVE`. The
         translation into domain vocabulary belongs in the derivation layer, so
         a change in Uzum's wording is one edit there rather than a rewrite of
         every stored row. */
      status: str(product.status?.value),
      status_title: str(product.status?.title),
      rating: Number(product.rating ?? 0) || 0,
      feedback_quantity: num(product.feedbackQuantity),
      price: num(product.price),
      quantity_available: num(product.quantityAvailable),
      quantity_active: num(product.quantityActive),
      quantity_fbs: num(product.quantityFbs),
      quantity_created: num(product.quantityCreated),
      quantity_sold: num(product.quantitySold),
      quantity_returned: num(product.quantityReturned),
      returned_percentage: num(product.returnedPercentage),
      roi: num(product.roi),
      conversion: num(product.conversion),
      clicks: num(product.clicks),
      viewers: num(product.viewers),
      rank: str(product.rankInfo?.rank),
      image: str(product.previewImg ?? product.image),
      sku_count: skuList.length,
    },
    skus,
  };
}

/**
 * The live payload carries several overlapping discount signals that the
 * published schema does not document. Any of them being set means the SKU was
 * not selling at its own price when this snapshot was taken.
 */
function hasDiscount(sku: Record<string, unknown>): boolean {
  if (sku['hasActiveDiscount'] === true) return true;
  if (sku['activeSale'] !== null && sku['activeSale'] !== undefined) return true;

  const offer = sku['specialOffer'];
  if (offer !== null && typeof offer === 'object') {
    const endDate = (offer as { endDate?: unknown }).endDate;
    if (typeof endDate === 'number' && endDate > Date.now()) return true;
  }

  return false;
}

/* ── FBS stock ──────────────────────────────────────────────────────────── */

/**
 * An FBS warehouse amount.
 *
 * `/v3/fbs/sku/stocks` is account-wide and names no shop, so the caller decides
 * which shop a row belongs to by matching `skuId` against that shop's catalogue.
 * A SKU that matches none is stored under shop `0` rather than dropped — the
 * amount is real, and losing it would make the stock table disagree with the
 * warehouse.
 */
export function stockToRecord(
  stock: SkuAmount,
  account: string,
  storeId: number,
  capturedAt: number,
): FbsStockRecord {
  return {
    id: recordId(account, storeId, ENTITY_TYPES.fbsStock, stock.skuId),
    store_id: storeId,
    entity_type: ENTITY_TYPES.fbsStock,
    timestamp: capturedAt,
    day: dayOf(capturedAt),
    account,

    sku_id: stock.skuId,
    sku_title: str(stock.skuTitle),
    product_title: str(stock.productTitle),
    barcode: str(stock.barcode),
    seller_sku_code: str(stock.sellerSkuCode),
    amount: num(stock.amount),
    fbs_allowed: flag(stock.fbsAllowed),
    dbs_allowed: flag(stock.dbsAllowed),
    fbs_linked: flag(stock.fbsLinked),
    dbs_linked: flag(stock.dbsLinked),
  };
}

/* ── FBO supply invoices ────────────────────────────────────────────────── */

/**
 * A supply invoice.
 *
 * `dateCreated` arrives as a string on this route while every other timestamp in
 * the API is epoch milliseconds — parsed here so the series axis stays one type.
 * An unparseable date falls back to the capture instant rather than to 0, which
 * would sort the row before every other and drag chart bounds back to 1970.
 */
export function supplyInvoiceToRecord(
  invoice: SupplyInvoice,
  account: string,
  storeId: number,
  capturedAt: number,
): SupplyInvoiceRecord {
  const at = parseDate(invoice.dateCreated, capturedAt);
  const toStock = num(invoice.totalToStock);
  const accepted = num(invoice.totalAccepted);

  return {
    id: recordId(account, storeId, ENTITY_TYPES.supplyInvoice, invoice.id),
    store_id: storeId,
    entity_type: ENTITY_TYPES.supplyInvoice,
    timestamp: at,
    day: dayOf(at),
    account,

    invoice_id: invoice.id,
    invoice_number: num(invoice.invoiceNumber),
    status: str(invoice.invoiceStatus?.value),
    status_title: str(invoice.invoiceStatus?.text),
    full_price: num(invoice.fullPrice),
    total_to_stock: toStock,
    total_accepted: accepted,
    /* The shortfall is the number this table exists to surface — goods handed
       over that the warehouse did not accept. */
    shortfall: toStock - accepted,
    date_accepted: invoice.dateAccepted ?? null,
    stock_title: str(invoice.stock?.title),
    stock_address: str(invoice.stock?.address),
    slot_from: invoice.timeSlotReservation?.timeFrom ?? null,
    slot_to: invoice.timeSlotReservation?.timeTo ?? null,
  };
}

function parseDate(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function supplyInvoiceItemToRecord(
  line: InvoiceProduct,
  invoiceId: number,
  account: string,
  storeId: number,
  at: number,
): SupplyInvoiceItemRecord {
  const toStock = num(line.quantityToStock);
  const accepted = num(line.quantityAccepted);

  return {
    id: recordId(
      account,
      storeId,
      ENTITY_TYPES.supplyInvoiceItem,
      `${invoiceId}-${line.id}`,
    ),
    store_id: storeId,
    entity_type: ENTITY_TYPES.supplyInvoiceItem,
    timestamp: at,
    day: dayOf(at),
    account,

    line_id: line.id,
    invoice_id: invoiceId,
    sku_title: str(line.skuTitle),
    product_title: str(line.productTitle),
    quantity_to_stock: toStock,
    quantity_accepted: accepted,
    shortfall: toStock - accepted,
    purchase_price: num(line.purchasePrice),
  };
}

/* ── warehouse returns ──────────────────────────────────────────────────── */

export function returnToRecords(
  entry: SellerReturn,
  account: string,
  storeId: number,
  capturedAt: number,
): { entry: SellerReturnRecord; items: readonly ReturnItemRecord[] } {
  const at = entry.dateCreated ?? capturedAt;
  const lines = entry.returnItems ?? [];

  const items = lines.map((line): ReturnItemRecord => ({
    id: recordId(account, storeId, ENTITY_TYPES.returnItem, `${entry.id}-${line.id}`),
    store_id: storeId,
    entity_type: ENTITY_TYPES.returnItem,
    timestamp: at,
    day: dayOf(at),
    account,

    line_id: line.id,
    return_id: entry.id,
    sku_id: num(line.skuId),
    sku_title: str(line.skuTitle),
    product_title: str(line.productTitle),
    amount: num(line.amount),
    packed_amount: num(line.packedAmount),
    purchase_price: num(line.purchasePrice),
  }));

  return {
    entry: {
      id: recordId(account, storeId, ENTITY_TYPES.sellerReturn, entry.id),
      store_id: storeId,
      entity_type: ENTITY_TYPES.sellerReturn,
      timestamp: at,
      day: dayOf(at),
      account,

      return_id: entry.id,
      status: str(entry.status),
      kind: str(entry.type),
      external_number: str(entry.externalNumber),
      stock_title: str(entry.stock?.title),
      stock_address: str(entry.stock?.address),
      total_amount: num(entry.totalAmount),
      total_packed_amount: num(entry.totalPackedAmount),
    },
    items,
  };
}

/* ── FBS shipment invoices ──────────────────────────────────────────────── */

export function fbsInvoiceToRecord(
  invoice: FbsInvoice,
  account: string,
  storeId: number,
  capturedAt: number,
): FbsInvoiceRecord {
  const at = invoice.dateCreated ?? capturedAt;

  return {
    id: recordId(account, storeId, ENTITY_TYPES.fbsInvoice, invoice.id),
    store_id: storeId,
    entity_type: ENTITY_TYPES.fbsInvoice,
    timestamp: at,
    day: dayOf(at),
    account,

    invoice_id: invoice.id,
    invoice_number: str(invoice.number),
    status: str(invoice.status),
    order_count: num(invoice.numberOrders),
    accepted_order_count: num(invoice.numberAcceptedOrders),
    full_price: num(invoice.fullPrice),
    accepted_price: num(invoice.acceptedPrice),
    drop_off_title: str(invoice.dropOffPoint?.title),
    drop_off_address: str(invoice.dropOffPoint?.address),
    slot_from: invoice.timeSlot?.timeFrom ?? null,
    slot_to: invoice.timeSlot?.timeTo ?? null,
  };
}

/* ── catalogue projection, for the change journal ───────────────────────── */

/**
 * The SKU facts the journal watches, read back out of a stored snapshot.
 *
 * The journal diffs two captures, and both sides have to be the same shape. The
 * stored side is a `product_sku` row and the incoming side is projected from the
 * wire by `codec.projectCatalog`, so this is the adapter that makes the older
 * capture comparable with the newer one.
 *
 * `fbsStock` is not on the SKU row any more — it is its own entity — so the
 * caller joins it in. A SKU the stock table does not mention keeps −1: "not
 * carried on FBS" and "carried, none left" are different facts, and only the
 * second one is a stockout.
 */
export function skuRecordToCatalog(record: ProductSkuRecord, fbsStock: number): CatalogSku {
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
    fbsStock,
    barcode: Number(record.barcode) || 0,
  };
}

/* ── change events ──────────────────────────────────────────────────────── */

/**
 * A change this machine observed.
 *
 * The key includes the instant, the SKU and the field, because unlike the other
 * entities a change event is not a row that gets corrected later — it is an
 * append-only observation, and two changes to the same SKU on different days are
 * two facts rather than one fact restated. Making the key deterministic still
 * matters: replaying the same sync twice must not journal it twice.
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
