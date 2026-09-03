import type {
  FbsInvoice,
  FbsOrder,
  FbsOrderItem,
  FinanceOrderItem,
  InvoiceProduct,
  ProductSku,
  ReturnItem,
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
  fallbackAt: number,
): { order: FbsOrderRecord; items: readonly FbsOrderItemRecord[] } {
  /* An order with no date still has to land inside the window this read
     covered: these two tables are windowed, coverage is about to claim that
     window, and a row outside it is a row no later read can reach — the one
     unrecoverable failure this archive is built to avoid. What the screen
     prints comes from `date_created`, which stays null, so filing the row
     somewhere findable invents nothing. */
  const at = order.dateCreated ?? fallbackAt;
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
      date_created: order.dateCreated ?? null,
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

/**
 * Rebuild an order and its lines from the two tables they were split across.
 *
 * The lines are a keyed read on `fbs_order_items.order_id`, so an order is
 * reassembled without walking anything. `shopId` comes back from `store_id` —
 * which is the shop the request was made for, and therefore more trustworthy
 * than the field the payload sometimes omits.
 *
 * `dropOffPoint` is always an object here, where the wire allows `null`. The
 * stored columns are `''` when the route said nothing, and a caller reading
 * `dropOffPoint?.title` gets the same empty answer either way.
 */
export function recordToFbsOrder(
  record: FbsOrderRecord,
  lines: readonly FbsOrderItemRecord[],
): FbsOrder {
  return {
    id: record.order_id,
    status: record.status,
    scheme: record.scheme,
    shopId: record.store_id,
    /* Rows written before `date_created` existed carry only `timestamp`, where
       `0` was the old "never said". Both shapes read back as null. */
    dateCreated: record.date_created ?? (record.timestamp === 0 ? null : record.timestamp),
    dateAcceptUntil: record.accept_until,
    dateDeliverUntil: record.deliver_until,
    price: record.price,
    orderItems: lines.map(recordToFbsOrderItem),
    dropOffPoint: { title: record.drop_off_title, address: record.drop_off_address },
  };
}

function recordToFbsOrderItem(record: FbsOrderItemRecord): FbsOrderItem {
  return {
    id: record.item_id,
    skuId: record.sku_id,
    skuTitle: record.sku_title,
    productTitle: record.product_title,
    amount: record.amount,
    price: record.price,
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

/**
 * Rebuild a product with its SKUs, from the two tables they were split across.
 *
 * Six wire fields are not stored and come back empty, because nothing in the
 * application reads them: `quantityCreated`, `quantityMissing` and
 * `quantityDefected` on a SKU, and `previewImg`, `rankInfo.rankValue` and
 * `isActive` on the product. They are listed here rather than left to be
 * discovered, so that adding a reader means adding a column instead of quietly
 * rendering a zero.
 *
 * `status.id`, `description` and `color` are dropped for the same reason. The
 * derivation layer narrows on `status.value`, which is stored verbatim —
 * `IN_STOCK`, not the `ACTIVE` the domain calls it.
 */
export function recordToProduct(
  record: ProductRecord,
  skus: readonly ProductSkuRecord[],
): ShopProduct {
  return {
    productId: record.product_id,
    title: record.title,
    category: record.category,
    /* Stored numeric, sent as text. `0` means the route sent nothing, which is
       not the same claim as a rating of zero. */
    rating: record.rating === 0 ? null : String(record.rating),
    feedbackQuantity: record.feedback_quantity,
    status:
      record.status === ''
        ? null
        : {
            id: 0,
            title: record.status_title,
            value: record.status,
            description: null,
            color: null,
          },
    skuList: skus.map(recordToSku),
    image: record.image,
    previewImg: null,
    quantityAvailable: record.quantity_available,
    quantityActive: record.quantity_active,
    quantityFbs: record.quantity_fbs,
    quantityCreated: record.quantity_created,
    quantitySold: record.quantity_sold,
    quantityReturned: record.quantity_returned,
    returnedPercentage: record.returned_percentage,
    price: record.price,
    roi: record.roi,
    conversion: record.conversion,
    clicks: record.clicks,
    viewers: record.viewers,
    rankInfo: rankOf(record.rank),
    isActive: null,
  };
}

export function recordToSku(record: ProductSkuRecord): ProductSku {
  return {
    skuId: record.sku_id,
    /* One stored title, two wire fields: the column was written from
       `skuFullTitle ?? skuTitle ?? product.title`, and `derive/products.ts`
       reads it back through the same fallback chain. */
    skuTitle: record.title,
    skuFullTitle: record.title,
    productTitle: null,
    barcode: record.barcode,
    characteristics: record.characteristics,
    price: record.price,
    purchasePrice: record.purchase_price,
    quantityCreated: 0,
    quantityAvailable: record.quantity_available,
    quantityActive: record.quantity_active,
    quantityFbs: record.quantity_fbs,
    quantitySold: record.quantity_sold,
    quantityReturned: record.quantity_returned,
    quantityMissing: 0,
    quantityDefected: 0,
    returnedPercentage: record.returned_percentage,
    rankInfo: rankOf(record.rank),
    commission: record.commission,
    turnover: record.turnover,
    sellerItemCode: record.seller_item_code,
    archived: record.archived === 1,
    blocked: record.blocked === 1,
  };
}

function rankOf(rank: string): ShopProduct['rankInfo'] {
  return rank === '' ? null : { rank, rankValue: null, dateUpdated: null };
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

export function recordToStock(record: FbsStockRecord): SkuAmount {
  return {
    skuId: record.sku_id,
    skuTitle: record.sku_title,
    productTitle: record.product_title,
    barcode: record.barcode,
    amount: record.amount,
    fbsAllowed: record.fbs_allowed === 1,
    dbsAllowed: record.dbs_allowed === 1,
    fbsLinked: record.fbs_linked === 1,
    dbsLinked: record.dbs_linked === 1,
    sellerSkuCode: record.seller_sku_code,
  };
}

/* ── FBO supply invoices ────────────────────────────────────────────────── */

/**
 * A supply invoice.
 *
 * `dateCreated` arrives as a string on this route while every other timestamp in
 * the API is epoch milliseconds — parsed here so the series axis stays one type.
 * A date the route did not give, or gave unparseably, is stored as `0`. That is
 * the value the whole codebase already reads as "unknown" (`stamp()` in
 * `derive/modules.ts`, and `fbsOrderToRecords` right above), and the reverse
 * mapper turns it back into `null` rather than into a day Uzum never named.
 * These three tables are read unbounded, so a `0` does not fall out of a window.
 */
export function supplyInvoiceToRecord(
  invoice: SupplyInvoice,
  account: string,
  storeId: number,
): SupplyInvoiceRecord {
  /* `0` rather than `capturedAt` when the route said nothing: the reverse
     mapper hands this straight to the screen, and a capture instant there
     renders as "raised today" — a date Uzum never gave. Zero is the value
     `stamp()` in `derive/modules.ts` already reads as unknown. */
  const at = parseDate(invoice.dateCreated, 0);
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
    shop_title: str(invoice.shopTitle),
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

/** `dd.MM.yyyy`, the only shape `/v1/invoice` sends for `dateCreated`. */
const DOTTED_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/**
 * Parse the one route that sends a date as text.
 *
 * `Date.parse` must not be used here, and the reason is worth stating: it reads
 * a dotted date as **month first**. `30.07.2026` is therefore `NaN` — month 30
 * does not exist — and `07.08.2026` parses cleanly as 8 July when the invoice
 * was raised on 7 August. The first case fell back to the capture instant and
 * filed the invoice under today; the second was silently a month out. Both
 * corrupt `timestamp`, which is half of the `store_date` index every period
 * query bounds on, so the row lands outside the window that should contain it.
 *
 * Parsed as UTC midnight, matching `dayOf` and every other timestamp in the
 * archive, so an invoice does not move a day when the viewer's clock does.
 */
function parseDate(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;

  const dotted = DOTTED_DATE.exec(value);
  if (dotted !== null) {
    const [, day, month, year] = dotted;
    const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  /* ISO-8601 and anything else the platform agrees on unambiguously. */
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The inverse of `parseDate`, so a stored invoice renders as it arrived. */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
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

/**
 * Rebuild a supply invoice with whatever lines were expanded for it.
 *
 * Line expansion costs one request per invoice, so the capture only expands the
 * most recent few. An invoice whose lines were never fetched comes back with an
 * empty list rather than `null`: "no lines held" and "no lines exist" would
 * otherwise be the same value, and the shortfall on the header says which.
 *
 * `stock.id` / `externalId` and `timeSlotReservation.id` / `status` are not
 * stored — nothing reads them — so the nested objects carry only the fields the
 * table keeps.
 */
export function recordToSupplyInvoice(
  record: SupplyInvoiceRecord,
  lines: readonly SupplyInvoiceItemRecord[],
): SupplyInvoice {
  return {
    id: record.invoice_id,
    shopId: record.store_id,
    /* Truthiness rather than `=== ''`: a row stored before this column existed
       carries no value at all, and `undefined` is not what the wire type
       promises. */
    shopTitle: record.shop_title ? record.shop_title : null,
    invoiceNumber: record.invoice_number,
    /* Back to the `dd.MM.yyyy` the route sent, because the invoice table
       renders this string as it stands. `0` is the column's "never said", and
       formatting it would print 01.01.1970 as though it had. */
    dateCreated: record.timestamp === 0 ? null : formatDate(record.timestamp),
    invoiceStatus:
      record.status === ''
        ? null
        : { value: record.status, text: record.status_title, color: null },
    fullPrice: record.full_price,
    totalAccepted: record.total_accepted,
    totalToStock: record.total_to_stock,
    dateAccepted: record.date_accepted,
    stock: { id: 0, externalId: null, title: record.stock_title, address: record.stock_address },
    timeSlotReservation: {
      id: null,
      status: null,
      timeFrom: record.slot_from,
      timeTo: record.slot_to,
    },
    productForInvoiceDto: lines.map(recordToSupplyInvoiceItem),
  };
}

function recordToSupplyInvoiceItem(record: SupplyInvoiceItemRecord): InvoiceProduct {
  return {
    id: record.line_id,
    skuTitle: record.sku_title,
    productTitle: record.product_title,
    quantityToStock: record.quantity_to_stock,
    quantityAccepted: record.quantity_accepted,
    purchasePrice: record.purchase_price,
    /* The per-SKU breakdown inside a line is not a table of its own — nothing
       reads it, and it would be a fourth level of nesting for one screen. */
    skuForInvoiceDtoList: null,
  };
}

/* ── warehouse returns ──────────────────────────────────────────────────── */

export function returnToRecords(
  entry: SellerReturn,
  account: string,
  storeId: number,
): { entry: SellerReturnRecord; items: readonly ReturnItemRecord[] } {
  /* Unknown stays unknown — see `supplyInvoiceToRecord`. */
  const at = entry.dateCreated ?? 0;
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
      shop_title: str(entry.shopTitle),
      external_number: str(entry.externalNumber),
      stock_title: str(entry.stock?.title),
      stock_address: str(entry.stock?.address),
      total_amount: num(entry.totalAmount),
      total_packed_amount: num(entry.totalPackedAmount),
    },
    items,
  };
}

/** Rebuild a warehouse return with its lines, read by `return_items.return_id`. */
export function recordToReturn(
  record: SellerReturnRecord,
  lines: readonly ReturnItemRecord[],
): SellerReturn {
  return {
    id: record.return_id,
    dateCreated: record.timestamp === 0 ? null : record.timestamp,
    status: record.status,
    type: record.kind,
    shopId: record.store_id,
    /* See `recordToSupplyInvoice`. */
    shopTitle: record.shop_title ? record.shop_title : null,
    externalNumber: record.external_number,
    stock: { id: 0, externalId: null, title: record.stock_title, address: record.stock_address },
    returnItems: lines.map(recordToReturnItem),
    totalAmount: record.total_amount,
    totalPackedAmount: record.total_packed_amount,
  };
}

function recordToReturnItem(record: ReturnItemRecord): ReturnItem {
  return {
    id: record.line_id,
    skuId: record.sku_id,
    amount: record.amount,
    packedAmount: record.packed_amount,
    skuTitle: record.sku_title,
    productTitle: record.product_title,
    purchasePrice: record.purchase_price,
  };
}

/* ── FBS shipment invoices ──────────────────────────────────────────────── */

export function fbsInvoiceToRecord(
  invoice: FbsInvoice,
  account: string,
  storeId: number,
): FbsInvoiceRecord {
  /* Unknown stays unknown — see `supplyInvoiceToRecord`. */
  const at = invoice.dateCreated ?? 0;

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

export function recordToFbsInvoice(record: FbsInvoiceRecord): FbsInvoice {
  return {
    id: record.invoice_id,
    number: record.invoice_number,
    status: record.status,
    dateCreated: record.timestamp === 0 ? null : record.timestamp,
    numberOrders: record.order_count,
    numberAcceptedOrders: record.accepted_order_count,
    fullPrice: record.full_price,
    acceptedPrice: record.accepted_price,
    dropOffPoint: { title: record.drop_off_title, address: record.drop_off_address },
    timeSlot: { timeFrom: record.slot_from ?? undefined, timeTo: record.slot_to ?? undefined },
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
