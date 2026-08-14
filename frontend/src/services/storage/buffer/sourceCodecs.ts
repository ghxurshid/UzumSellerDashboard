import type {
  ExpensesSource,
  InvoicesSource,
  OrdersSource,
  ProductsSource,
  StocksSource,
} from '@/services/queries/sources';
import type { FbsCountedStatus } from '@/services/uzum/endpoints';
import type { FbsInvoice, FbsOrder, SellerReturn, SkuAmount, SupplyInvoice } from '@/services/uzum/types';

import { pack, unpack, type PackedTable } from './columnar';

/**
 * How each source is laid out in the buffer.
 *
 * A codec is two functions that must compose to the identity: `fromStorage`
 * of `toStorage` returns a payload the derivation layer cannot tell from a
 * fresh one. That is the whole contract the read-through layer relies on —
 * screens must not be able to detect whether their rows came from the network
 * or from disk.
 *
 * Two decisions are made here rather than in the generic packer:
 *
 * **Projection.** Rows are reduced to the fields the application's own wire
 * types declare. The seller API sends about fifty fields per SKU; `ProductSku`
 * declares twenty-three, and the rest — nine thumbnail variants, blocking
 * histories, packaging dimensions — are read by nothing. Measured on a real
 * catalogue this is a 3.0× reduction before packing, and 7.1× with it. It is
 * not lossy in any sense the app can observe: a field no type declares cannot
 * be read by any code above this layer.
 *
 * **Normalisation.** Products arrive with their SKUs nested, which defeats
 * columnar packing — a nested array is one opaque value per row. Splitting them
 * into two tables joined on `productId` takes the catalogue from 0.9× (worse
 * than raw) to 2.5×, and is why the tables are shaped this way.
 */

export interface StoredPayload {
  /** Scalars that are not rows: totals, flags, status counts. */
  readonly meta: Record<string, unknown>;
  readonly tables: Readonly<Record<string, PackedTable>>;
}

export interface SourceCodec<T> {
  toStorage: (payload: T) => StoredPayload;
  fromStorage: (stored: StoredPayload) => T;
}

/* ── projection helpers ─────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

/**
 * Keep exactly these keys, present or not.
 *
 * Missing fields are written as `null` rather than dropped, so every row in a
 * table has the same shape and the packer's column set stays narrow.
 */
function project(row: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const key of keys) out[key] = row[key] ?? null;
  return out;
}

const projectAll = (rows: readonly unknown[], keys: readonly string[]): Row[] =>
  rows.filter((row): row is Row => typeof row === 'object' && row !== null).map((row) => project(row, keys));

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(value: unknown): boolean {
  return value === true;
}

/* ── field sets ─────────────────────────────────────────────────────────── */

/** `ShopProduct`, minus `skuList` which becomes its own table. */
const PRODUCT_FIELDS = [
  'productId',
  'title',
  'category',
  'rating',
  'feedbackQuantity',
  'status',
  'image',
  'previewImg',
  'quantityAvailable',
  'quantityActive',
  'quantityFbs',
  'quantityCreated',
  'quantitySold',
  'quantityReturned',
  'returnedPercentage',
  'price',
  'roi',
  'conversion',
  'clicks',
  'viewers',
  'rankInfo',
  'isActive',
  /* Not on the wire — added by `productsQuery`, and the only way a restored row
     knows which shop it came from. */
  'shopId',
] as const;

/** `ProductSku`, plus the join column. */
const SKU_FIELDS = [
  'skuId',
  'skuTitle',
  'skuFullTitle',
  'barcode',
  'characteristics',
  'price',
  'purchasePrice',
  'quantityCreated',
  'quantityAvailable',
  'quantityActive',
  'quantityFbs',
  'quantitySold',
  'quantityReturned',
  'quantityMissing',
  'quantityDefected',
  'returnedPercentage',
  'rankInfo',
  'commission',
  'turnover',
  'sellerItemCode',
  'archived',
  'blocked',
] as const;

const STOCK_FIELDS = [
  'skuId',
  'skuTitle',
  'productTitle',
  'barcode',
  'amount',
  'fbsAllowed',
  'dbsAllowed',
  'fbsLinked',
  'dbsLinked',
  'sellerSkuCode',
] as const;

const ORDER_FIELDS = [
  'id',
  'status',
  'scheme',
  'shopId',
  'dateCreated',
  'dateAcceptUntil',
  'dateDeliverUntil',
  'price',
  'orderItems',
  'dropOffPoint',
] as const;

const SUPPLY_FIELDS = [
  'id',
  'shopId',
  'shopTitle',
  'invoiceNumber',
  'dateCreated',
  'invoiceStatus',
  'fullPrice',
  'totalAccepted',
  'totalToStock',
  'dateAccepted',
  'stock',
  'timeSlotReservation',
  'productForInvoiceDto',
] as const;

const RETURN_FIELDS = [
  'id',
  'dateCreated',
  'status',
  'type',
  'shopId',
  'shopTitle',
  'externalNumber',
  'stock',
  'returnItems',
  'totalAmount',
  'totalPackedAmount',
] as const;

const FBS_INVOICE_FIELDS = [
  'id',
  'number',
  'status',
  'dateCreated',
  'numberOrders',
  'numberAcceptedOrders',
  'fullPrice',
  'acceptedPrice',
  'dropOffPoint',
  'timeSlot',
] as const;

/* ── products ───────────────────────────────────────────────────────────── */

/**
 * A SKU's `productTitle` is the parent product's `title` repeated on every row
 * — 55 characters per SKU, and a catalogue has fifteen SKUs per product. It is
 * dropped on the way in and restored from the join on the way out, which is
 * lossless and takes about a fifth off the SKU table.
 */
export const productsCodec: SourceCodec<ProductsSource> = {
  toStorage: (payload) => ({
    meta: { total: payload.total, truncated: payload.truncated },
    tables: {
      products: pack(projectAll(payload.products, PRODUCT_FIELDS)),
      skus: pack(
        payload.products.flatMap((product) =>
          projectAll(product.skuList ?? [], SKU_FIELDS).map((sku) => ({
            ...sku,
            productId: product.productId,
          })),
        ),
      ),
    },
  }),

  fromStorage: (stored) => {
    const products = unpack<Row>(stored.tables['products'] ?? pack([]));
    const skus = unpack<Row>(stored.tables['skus'] ?? pack([]));

    const byProduct = new Map<number, Row[]>();
    for (const sku of skus) {
      const productId = number(sku['productId']);
      const bucket = byProduct.get(productId);
      if (bucket === undefined) byProduct.set(productId, [sku]);
      else bucket.push(sku);
    }

    return {
      total: number(stored.meta['total']),
      truncated: boolean(stored.meta['truncated']),
      products: products.map((product) => {
        const productId = number(product['productId']);
        const title = product['title'];

        return {
          ...product,
          skuList: (byProduct.get(productId) ?? []).map((sku) => {
            /* The join column is storage's business, not the payload's, and
               `productTitle` comes back from the parent rather than from a
               copy repeated on every SKU row. */
            const rest: Row = { ...sku, productTitle: title };
            delete rest['productId'];
            return rest;
          }),
        };
      }),
    } as unknown as ProductsSource;
  },
};

/* ── stocks ─────────────────────────────────────────────────────────────── */

export const stocksCodec: SourceCodec<StocksSource> = {
  toStorage: (payload) => ({
    meta: { total: payload.total, truncated: payload.truncated },
    tables: { stocks: pack(projectAll(payload.stocks, STOCK_FIELDS)) },
  }),

  fromStorage: (stored) => ({
    stocks: unpack<SkuAmount>(stored.tables['stocks'] ?? pack([])),
    total: number(stored.meta['total']),
    truncated: boolean(stored.meta['truncated']),
  }),
};

/* ── orders ─────────────────────────────────────────────────────────────── */

export const ordersCodec: SourceCodec<OrdersSource> = {
  toStorage: (payload) => ({
    /* Counts are per status and come from a dedicated endpoint rather than from
       the rows, so they are meta and not derivable on the way back. */
    meta: { counts: payload.counts, total: payload.total },
    tables: { orders: pack(projectAll(payload.orders, ORDER_FIELDS)) },
  }),

  fromStorage: (stored) => ({
    orders: unpack<FbsOrder>(stored.tables['orders'] ?? pack([])),
    counts: (stored.meta['counts'] ?? {}) as Readonly<Record<FbsCountedStatus, number>>,
    total: number(stored.meta['total']),
  }),
};

/* ── invoices ───────────────────────────────────────────────────────────── */

export const invoicesCodec: SourceCodec<InvoicesSource> = {
  toStorage: (payload) => ({
    meta: { fbsUnavailable: payload.fbsUnavailable },
    tables: {
      supply: pack(projectAll(payload.supply, SUPPLY_FIELDS)),
      returns: pack(projectAll(payload.returns, RETURN_FIELDS)),
      fbs: pack(projectAll(payload.fbs, FBS_INVOICE_FIELDS)),
    },
  }),

  fromStorage: (stored) => ({
    supply: unpack<SupplyInvoice>(stored.tables['supply'] ?? pack([])),
    returns: unpack<SellerReturn>(stored.tables['returns'] ?? pack([])),
    fbs: unpack<FbsInvoice>(stored.tables['fbs'] ?? pack([])),
    fbsUnavailable: boolean(stored.meta['fbsUnavailable']),
  }),
};

/* ── expenses ───────────────────────────────────────────────────────────── */

const EXPENSE_FIELDS = [
  'id',
  'dateCreated',
  'dateUpdated',
  'name',
  'source',
  'shopId',
  'sellerId',
  'paymentPrice',
  'amount',
  'status',
  'externalId',
  'code',
  'dateService',
  'type',
] as const;

export const expensesCodec: SourceCodec<ExpensesSource> = {
  toStorage: (payload) => ({
    meta: { total: payload.total, truncated: payload.truncated },
    tables: { payments: pack(projectAll(payload.payments, EXPENSE_FIELDS)) },
  }),

  fromStorage: (stored) => ({
    payments: unpack<ExpensesSource['payments'][number]>(stored.tables['payments'] ?? pack([])),
    total: number(stored.meta['total']),
    truncated: boolean(stored.meta['truncated']),
  }),
};
