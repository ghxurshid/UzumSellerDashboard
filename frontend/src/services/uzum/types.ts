/**
 * Uzum seller OpenAPI — wire types.
 *
 * These mirror `api-seller.uzum.uz/api/seller-openapi` exactly: same field
 * names, same nullability, same envelope shapes. Nothing is renamed or
 * flattened here — the derivation layer does that — so a response that stops
 * matching the contract fails at the boundary rather than three screens later.
 *
 * Three envelope shapes exist in the wild and all three are handled in
 * `http.ts`:
 *   • bare array            — /v1/shops, /v1/invoice, /v1/return
 *   • `{ payload, … }`      — /v3/fbs/sku/stocks, /v2/fbs/orders, /v1/finance/expenses
 *   • bespoke object        — /v1/finance/orders, /v1/product/shop/{shopId}
 *
 * Timestamps: query parameters `dateFrom`/`dateTo` are **seconds**; every
 * timestamp *inside* a response body is **milliseconds**.
 */

/* ── envelopes ──────────────────────────────────────────────────────────── */

export interface UzumEnvelope<T> {
  readonly payload: T;
  readonly timestamp?: string;
  readonly errors?: readonly UzumError[];
  readonly error?: string;
  readonly trace?: string;
}

export interface UzumError {
  readonly code: string;
  readonly message: string;
}

export interface UzumPage<T> {
  readonly items: readonly T[];
  /** Total the API reports, where it reports one; otherwise the items read. */
  readonly total: number;
}

/* ── shops ──────────────────────────────────────────────────────────────── */

export interface UzumShop {
  readonly id: number;
  readonly name: string;
}

/* ── finance ────────────────────────────────────────────────────────────── */

export type FinanceOrderStatus =
  | 'TO_WITHDRAW'
  | 'PROCESSING'
  | 'CANCELED'
  | 'PARTIALLY_CANCELLED';

export interface FinanceOrderItem {
  readonly id: number;
  readonly status: FinanceOrderStatus | string;
  /** Unix epoch, milliseconds. */
  readonly date: number;
  readonly orderId: number;
  readonly skuTitle: string;
  readonly productId: number;
  readonly productTitle: string;
  readonly shopId: number;
  readonly dateIssued: number | null;
  readonly sellPrice: number;
  readonly amount: number;
  readonly amountReturns: number;
  readonly commission: number;
  readonly sellerProfit: number;
  readonly purchasePrice: number | null;
  readonly logisticDeliveryFee: number;
  readonly cancelled: boolean | null;
  readonly withdrawnProfit: number;
  readonly comment: string | null;
  readonly returnCause: string | null;
}

export interface FinanceOrdersResponse {
  readonly orderItems: readonly FinanceOrderItem[];
  readonly totalElements: number;
}

export type ExpenseType = 'INCOME' | 'OUTCOME';

export interface SellerPayment {
  readonly id: number;
  /** Unix epoch, milliseconds. */
  readonly dateCreated: number;
  readonly dateUpdated: number | null;
  readonly name: string;
  /** Free-text ledger bucket the account uses, e.g. `Logistika`, `Marketing`. */
  readonly source: string;
  readonly shopId: number;
  readonly sellerId: number;
  readonly paymentPrice: number;
  readonly amount: number;
  readonly status: string;
  readonly externalId: string | null;
  readonly code: string;
  readonly dateService: number | null;
  readonly type: ExpenseType | string;
}

export interface ExpensesPayload {
  readonly payments: readonly SellerPayment[];
  readonly totalElements: number;
}

/* ── catalogue ──────────────────────────────────────────────────────────── */

export interface ProductStatusDto {
  readonly id: number;
  readonly title: string;
  /** `ACTIVE`, `RUN_OUT`, `ARCHIVED`, … — the value the UI narrows on. */
  readonly value: string;
  readonly description: string | null;
  readonly color: string | null;
}

export interface RankInfo {
  readonly rank: string | null;
  readonly rankValue: string | null;
  readonly dateUpdated: number | null;
}

export interface ProductSku {
  readonly skuId: number;
  readonly skuTitle: string | null;
  readonly skuFullTitle: string | null;
  readonly productTitle: string | null;
  readonly barcode: number | string | null;
  readonly characteristics: string | null;
  readonly price: number | null;
  readonly purchasePrice: number | null;
  readonly quantityCreated: number;
  readonly quantityAvailable: number;
  readonly quantityActive: number;
  readonly quantityFbs: number;
  readonly quantitySold: number;
  readonly quantityReturned: number;
  readonly quantityMissing: number;
  readonly quantityDefected: number;
  readonly returnedPercentage: number | null;
  readonly rankInfo: RankInfo | null;
  readonly commission: number | null;
  readonly turnover: number | null;
  readonly sellerItemCode: string | null;
  readonly archived: boolean | null;
  readonly blocked: boolean | null;
}

export interface ShopProduct {
  readonly productId: number;
  readonly title: string;
  readonly category: string | null;
  readonly rating: string | null;
  readonly feedbackQuantity: number | null;
  readonly status: ProductStatusDto | null;
  readonly skuList: readonly ProductSku[];
  readonly image: string | null;
  readonly previewImg: string | null;
  readonly quantityAvailable: number;
  readonly quantityActive: number;
  readonly quantityFbs: number;
  readonly quantityCreated: number;
  readonly quantitySold: number;
  readonly quantityReturned: number;
  readonly returnedPercentage: number | null;
  readonly price: number | null;
  readonly roi: number | null;
  readonly conversion: number | null;
  readonly clicks: number | null;
  readonly viewers: number | null;
  readonly rankInfo: RankInfo | null;
  readonly isActive: boolean | null;
}

export interface ShopProductsResponse {
  readonly productList: readonly ShopProduct[];
  /**
   * The catalogue total. Named unlike every other collection in the API, which
   * publishes `totalElements`; this route has neither that nor `totalPages`.
   */
  readonly totalProductsAmount?: number;
  readonly totalProductsAmountWithoutWeightDimensional?: number;
}

/* ── FBS stocks ─────────────────────────────────────────────────────────── */

export interface SkuAmount {
  readonly skuId: number;
  readonly skuTitle: string | null;
  readonly productTitle: string | null;
  readonly barcode: string | null;
  readonly amount: number;
  readonly fbsAllowed: boolean;
  readonly dbsAllowed: boolean;
  readonly fbsLinked: boolean;
  readonly dbsLinked: boolean;
  readonly sellerSkuCode: string | null;
}

export interface SkuAmountPayload {
  readonly skuAmountList: readonly SkuAmount[];
  readonly totalElements?: number;
}

/* ── FBS / DBS orders ───────────────────────────────────────────────────── */

export type FbsOrderStatus =
  | 'CREATED'
  | 'PACKING'
  | 'PENDING_DELIVERY'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'RETURNED';

export interface FbsOrderItem {
  readonly id: number;
  readonly skuId: number | null;
  readonly skuTitle: string | null;
  readonly productTitle: string | null;
  readonly amount: number | null;
  readonly price: number | null;
}

export interface FbsOrder {
  readonly id: number;
  readonly status: string;
  readonly scheme: string | null;
  readonly shopId: number | null;
  readonly dateCreated: number | null;
  readonly dateAcceptUntil: number | null;
  readonly dateDeliverUntil: number | null;
  readonly price: number | null;
  readonly orderItems: readonly FbsOrderItem[] | null;
  readonly dropOffPoint: { readonly title?: string; readonly address?: string } | null;
}

export interface FbsOrdersPayload {
  readonly orders: readonly FbsOrder[];
  readonly totalElements?: number;
}

/* ── invoices, supply and returns ───────────────────────────────────────── */

export interface UzumStock {
  readonly id: number;
  readonly externalId: string | null;
  readonly title: string | null;
  readonly address: string | null;
}

export interface InvoiceStatusDto {
  readonly text: string | null;
  readonly color: string | null;
  readonly value: string;
}

export interface TimeSlotReservation {
  readonly id: number | null;
  readonly status: string | null;
  readonly timeFrom: number | null;
  readonly timeTo: number | null;
}

export interface InvoiceProductSku {
  readonly id: number;
  readonly skuTitle: string | null;
  readonly quantityToStock: number;
  readonly quantityAccepted: number;
  readonly purchasePrice: number | null;
  readonly issue: string | null;
}

export interface InvoiceProduct {
  readonly id: number;
  readonly skuTitle: string | null;
  readonly productTitle: string | null;
  readonly quantityToStock: number;
  readonly quantityAccepted: number;
  readonly purchasePrice: number | null;
  readonly skuForInvoiceDtoList: readonly InvoiceProductSku[] | null;
}

/** FBO supply invoice — `GET /v1/invoice`. */
export interface SupplyInvoice {
  readonly id: number;
  readonly shopId: number;
  readonly shopTitle: string | null;
  readonly invoiceNumber: number | null;
  readonly dateCreated: string | null;
  readonly invoiceStatus: InvoiceStatusDto | null;
  readonly fullPrice: number;
  readonly totalAccepted: number;
  readonly totalToStock: number;
  readonly dateAccepted: number | null;
  readonly stock: UzumStock | null;
  readonly timeSlotReservation: TimeSlotReservation | null;
  readonly productForInvoiceDto: readonly InvoiceProduct[] | null;
}

export interface ReturnItem {
  readonly id: number;
  readonly skuId: number;
  readonly amount: number;
  readonly packedAmount: number;
  readonly skuTitle: string | null;
  readonly productTitle: string | null;
  readonly purchasePrice: number | null;
}

/** Warehouse return — `GET /v1/return`. */
export interface SellerReturn {
  readonly id: number;
  readonly dateCreated: number | null;
  readonly status: string;
  readonly type: string;
  readonly shopId: number | null;
  readonly shopTitle: string | null;
  readonly externalNumber: string | null;
  readonly stock: UzumStock | null;
  readonly returnItems: readonly ReturnItem[] | null;
  readonly totalAmount: number;
  readonly totalPackedAmount: number;
}

export type FbsInvoiceStatus =
  | 'CREATED'
  | 'ACCEPTANCE_IN_PROGRESS'
  | 'ACCEPTED'
  | 'CANCELLED';

/** FBS shipment invoice — `GET /v1/fbs/invoice`. */
export interface FbsInvoice {
  readonly id: number;
  readonly number: number | string | null;
  readonly status: string;
  readonly dateCreated: number | null;
  readonly numberOrders: number | null;
  readonly numberAcceptedOrders: number | null;
  readonly fullPrice: number | null;
  readonly acceptedPrice: number | null;
  readonly dropOffPoint: { readonly title?: string; readonly address?: string } | null;
  readonly timeSlot: { readonly timeFrom?: number; readonly timeTo?: number } | null;
}

/* ── reference data ─────────────────────────────────────────────────────── */

export interface ReturnReason {
  readonly reason: string;
  readonly title: string;
}

export interface BarcodeType {
  readonly id: string;
  readonly title?: string;
  readonly name?: string;
}

/* ── write payloads ─────────────────────────────────────────────────────── */

export interface StockUpdateEntry {
  readonly skuId: number;
  readonly barcode: string;
  readonly amount: number;
}

export interface PriceUpdateEntry {
  readonly skuId: number;
  readonly fullPrice: number;
  readonly sellPrice: number;
}
