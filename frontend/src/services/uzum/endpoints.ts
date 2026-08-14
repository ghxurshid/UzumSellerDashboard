import { getPayload, getRaw, paginate, postPayload, toApiSeconds, type PageResult, type RequestContext } from './http';
import type {
  BarcodeType,
  ExpensesPayload,
  FbsInvoice,
  FbsOrder,
  FbsOrdersPayload,
  FinanceOrderItem,
  FinanceOrdersResponse,
  InvoiceProduct,
  PriceUpdateEntry,
  ReturnReason,
  SellerPayment,
  SellerReturn,
  ShopProduct,
  ShopProductsResponse,
  SkuAmount,
  SkuAmountPayload,
  StockUpdateEntry,
  SupplyInvoice,
  UzumShop,
} from './types';

/**
 * Every seller-OpenAPI call the application makes.
 *
 * One exported function per endpoint, named after what it returns rather than
 * the screen that uses it. Collections that support paging are walked to
 * completion here (bounded by `paginate`'s ceiling) so callers get a whole
 * dataset and a `truncated` flag, not a page cursor to manage.
 */

/** Uzum's own per-request page ceilings, from the OpenAPI document. */
const PAGE_SIZE = {
  finance: 50,
  expenses: 50,
  products: 100,
  fbsOrders: 50,
  stocks: 100,
  supplyInvoices: 50,
  returns: 50,
  fbsInvoices: 20,
} as const;

export interface DateWindow {
  /** Epoch milliseconds, inclusive. */
  readonly fromMs: number;
  /** Epoch milliseconds, inclusive. */
  readonly toMs: number;
}

function windowParams(window: DateWindow): Record<string, number> {
  return { dateFrom: toApiSeconds(window.fromMs), dateTo: toApiSeconds(window.toMs) };
}

/* ── account ────────────────────────────────────────────────────────────── */

/**
 * The shops this token can see.
 *
 * Also the connection check: it is the cheapest authenticated call in the API,
 * so a successful response proves base URL, token and reachability in one go.
 */
export function fetchShops(context: RequestContext = {}): Promise<readonly UzumShop[]> {
  return getRaw<readonly UzumShop[]>('/v1/shops', {}, context);
}

/* ── finance ────────────────────────────────────────────────────────────── */

export function fetchFinanceOrderItems(
  shopIds: readonly number[],
  window: DateWindow,
  context: RequestContext = {},
): Promise<PageResult<FinanceOrderItem>> {
  return paginate<FinanceOrderItem>({
    pageSize: PAGE_SIZE.finance,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      const body = await getRaw<FinanceOrdersResponse>(
        '/v1/finance/orders',
        { shopIds, ...windowParams(window), group: false, page, size },
        context,
      );
      return { items: body.orderItems ?? [], total: body.totalElements };
    },
  });
}

/**
 * Cancelled items in the same window.
 *
 * Read separately rather than filtered client-side: the flat list is capped by
 * the page ceiling, so a cancellation rate computed from it would be a rate of
 * whatever happened to fit. `totalElements` here is the real denominator.
 */
export async function fetchCancelledCount(
  shopIds: readonly number[],
  window: DateWindow,
  context: RequestContext = {},
): Promise<number> {
  const body = await getRaw<FinanceOrdersResponse>(
    '/v1/finance/orders',
    { shopIds, ...windowParams(window), group: false, page: 0, size: 1, statuses: ['CANCELED'] },
    context,
  );
  return body.totalElements ?? 0;
}

export function fetchExpenses(
  shopIds: readonly number[],
  window: DateWindow,
  context: RequestContext = {},
): Promise<PageResult<SellerPayment>> {
  return paginate<SellerPayment>({
    pageSize: PAGE_SIZE.expenses,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      const payload = await getPayload<ExpensesPayload>(
        '/v1/finance/expenses',
        { shopIds, ...windowParams(window), page, size },
        context,
      );
      return { items: payload.payments ?? [], total: payload.totalElements };
    },
  });
}

/* ── catalogue ──────────────────────────────────────────────────────────── */

export async function fetchShopProducts(
  shopId: number,
  context: RequestContext = {},
): Promise<PageResult<ShopProduct>> {
  return paginate<ShopProduct>({
    pageSize: PAGE_SIZE.products,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      const body = await getRaw<ShopProductsResponse>(
        `/v1/product/shop/${shopId}`,
        { shopId, page, size, sortBy: 'ORDERS', order: 'DESC', filter: 'ALL' },
        context,
      );
      return { items: body.productList ?? [], total: body.totalElements };
    },
  });
}

/* ── FBS stocks ─────────────────────────────────────────────────────────── */

export function fetchSkuStocks(context: RequestContext = {}): Promise<PageResult<SkuAmount>> {
  return paginate<SkuAmount>({
    pageSize: PAGE_SIZE.stocks,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      const payload = await getPayload<SkuAmountPayload>(
        '/v3/fbs/sku/stocks',
        { page, size },
        context,
      );
      return { items: payload.skuAmountList ?? [], total: payload.totalElements };
    },
  });
}

export function updateSkuStocks(
  entries: readonly StockUpdateEntry[],
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload('/v2/fbs/sku/stocks', { skuAmountList: entries }, context);
}

/* ── FBS / DBS orders ───────────────────────────────────────────────────── */

/** Order statuses `/v2/fbs/orders/count` is polled for, in workflow order. */
export const FBS_ORDER_STATUSES = [
  'CREATED',
  'PACKING',
  'PENDING_DELIVERY',
  'DELIVERING',
  'DELIVERED',
  'COMPLETED',
  'CANCELED',
  'RETURNED',
] as const;

export type FbsCountedStatus = (typeof FBS_ORDER_STATUSES)[number];

export function fetchFbsOrders(
  shopIds: readonly number[],
  window: DateWindow,
  status: FbsCountedStatus,
  context: RequestContext = {},
): Promise<PageResult<FbsOrder>> {
  return paginate<FbsOrder>({
    pageSize: PAGE_SIZE.fbsOrders,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      const payload = await getPayload<FbsOrdersPayload>(
        '/v2/fbs/orders',
        { shopIds, ...windowParams(window), status, page, size },
        context,
      );
      return { items: payload.orders ?? [], total: payload.totalElements };
    },
  });
}

export function fetchFbsOrderCount(
  shopIds: readonly number[],
  window: DateWindow,
  status: FbsCountedStatus,
  context: RequestContext = {},
): Promise<number> {
  return getPayload<number>(
    '/v2/fbs/orders/count',
    { shopIds, ...windowParams(window), status },
    context,
  );
}

export function confirmFbsOrder(orderId: number, context: RequestContext = {}): Promise<unknown> {
  return postPayload(`/v1/fbs/order/${orderId}/confirm`, {}, context);
}

export function cancelFbsOrder(
  orderId: number,
  body: { readonly reason: string; readonly comment?: string },
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload(`/v1/fbs/order/${orderId}/cancel`, body, context);
}

export function bindOrderIdentifiers(
  orderId: number,
  body: {
    readonly orderItemId: number;
    readonly type: string;
    readonly values: readonly string[];
  },
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload(`/v1/fbs/order/${orderId}/identifier`, body, context);
}

export function fetchReturnReasons(
  context: RequestContext = {},
): Promise<readonly ReturnReason[]> {
  return getPayload<{ readonly reasons: readonly ReturnReason[] }>(
    '/v1/fbs/order/return-reasons',
    {},
    context,
  ).then((payload) => payload.reasons ?? []);
}

/* ── DBS handover ───────────────────────────────────────────────────────── */

export function deliverDbsOrder(orderId: number, context: RequestContext = {}): Promise<unknown> {
  return postPayload(`/v1/dbs/order/${orderId}/delivering`, {}, context);
}

export function completeDbsOrder(
  orderId: number,
  body: { readonly issueCode: string },
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload(`/v1/dbs/order/${orderId}/completed`, body, context);
}

export function refundDbsOrder(orderId: number, context: RequestContext = {}): Promise<unknown> {
  return postPayload(`/v1/dbs/order/${orderId}/refund`, {}, context);
}

/* ── supply invoices and returns (FBO) ──────────────────────────────────── */

export function fetchSupplyInvoices(
  context: RequestContext = {},
): Promise<PageResult<SupplyInvoice>> {
  return paginate<SupplyInvoice>({
    pageSize: PAGE_SIZE.supplyInvoices,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      const items = await getRaw<readonly SupplyInvoice[]>('/v1/invoice', { page, size }, context);
      return { items: items ?? [] };
    },
  });
}

export function fetchSupplyInvoiceProducts(
  shopId: number,
  invoiceId: number,
  context: RequestContext = {},
): Promise<readonly InvoiceProduct[]> {
  return getRaw<readonly InvoiceProduct[]>(
    `/v1/shop/${shopId}/invoice/products`,
    { invoiceId, page: 0, size: 50 },
    context,
  );
}

export function fetchReturns(context: RequestContext = {}): Promise<PageResult<SellerReturn>> {
  return paginate<SellerReturn>({
    pageSize: PAGE_SIZE.returns,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      const items = await getRaw<readonly SellerReturn[]>('/v1/return', { page, size }, context);
      return { items: items ?? [] };
    },
  });
}

/* ── FBS shipment invoices ──────────────────────────────────────────────── */

export const FBS_INVOICE_STATUSES = [
  'CREATED',
  'ACCEPTANCE_IN_PROGRESS',
  'ACCEPTED',
  'CANCELLED',
] as const;

export function fetchFbsInvoices(context: RequestContext = {}): Promise<PageResult<FbsInvoice>> {
  return paginate<FbsInvoice>({
    pageSize: PAGE_SIZE.fbsInvoices,
    onProgress: context.onProgress,
    fetchPage: async (page, size) => {
      /* The route answers with a bare list on some deployments and a wrapped
         one on others; both shapes are accepted rather than guessed at. */
      const payload = await getPayload<unknown>(
        '/v1/fbs/invoice',
        { statuses: FBS_INVOICE_STATUSES, page, size },
        context,
      );

      if (Array.isArray(payload)) return { items: payload as readonly FbsInvoice[] };

      const wrapped = (payload as { invoices?: readonly FbsInvoice[] } | null)?.invoices;
      return { items: wrapped ?? [] };
    },
  });
}

export function createFbsInvoice(
  body: {
    readonly orderIds: readonly number[];
    readonly dropOffPointUuid: string;
    readonly timeSlotUuid: string;
    readonly idempotencyKey: string;
  },
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload('/v1/fbs/invoice', body, context);
}

export function cancelFbsInvoice(
  invoiceId: number,
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload(`/v1/fbs/invoice/${invoiceId}/cancel`, {}, context);
}

export function updateFbsInvoiceContent(
  invoiceId: number,
  body: { readonly customerOrderId: number; readonly idempotencyKey: string },
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload(`/v1/fbs/invoice/${invoiceId}/update-content`, body, context);
}

export function updateFbsInvoiceTimeSlot(
  body: {
    readonly invoiceId: number;
    readonly dropOffPointUuid: string;
    readonly timeSlotUuid: string;
    readonly idempotencyKey: string;
  },
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload('/v1/fbs/invoice/dop/time-slot', body, context);
}

/* ── printables ─────────────────────────────────────────────────────────── */

/**
 * Every print route answers with a Base64-encoded PDF rather than a binary
 * stream, so each returns a string here and the caller turns it into a Blob.
 */

export function fetchOrderLabel(
  orderId: number,
  size: string,
  context: RequestContext = {},
): Promise<string> {
  return getPayload<string>(`/v1/fbs/order/${orderId}/labels/print`, { size }, context);
}

export function fetchBarcodeTypes(context: RequestContext = {}): Promise<readonly BarcodeType[]> {
  return getPayload<readonly BarcodeType[]>('/v1/product/barcodes/types', {}, context);
}

export function printSkuBarcodes(
  shopId: number,
  body: {
    readonly barcodeTypeId: string;
    readonly skus: ReadonlyArray<{ readonly skuId: number; readonly labelCount: number }>;
  },
  context: RequestContext = {},
): Promise<string> {
  return postPayload<string, typeof body>(
    `/v1/product/shop/${shopId}/barcodes/print`,
    body,
    context,
  );
}

export function fetchSupplyAct(invoiceId: number, context: RequestContext = {}): Promise<string> {
  return getPayload<string>(`/v1/fbs/invoice/${invoiceId}/print`, {}, context);
}

export function fetchAcceptanceAct(
  invoiceId: number,
  context: RequestContext = {},
): Promise<string> {
  return getPayload<string>(`/v1/fbs/invoice/${invoiceId}/closing-documents`, {}, context);
}

/* ── prices ─────────────────────────────────────────────────────────────── */

export function sendPriceData(
  shopId: number,
  entries: readonly PriceUpdateEntry[],
  context: RequestContext = {},
): Promise<unknown> {
  return postPayload(`/v1/product/${shopId}/sendPriceData`, { skuList: entries }, context);
}
