/**
 * The IndexedDB schema — every store, index and record shape in one place.
 *
 * ## One store per entity
 *
 * Every list the seller API returns gets its own object store. The alternative —
 * one `records` store with an `entity_type` discriminator, which is what v1 did —
 * works, but it makes every store pay for every other one: a single shared index
 * whose leading component has to be the discriminator, one retention policy
 * shape stretched over rows that have nothing in common, and no way to give an
 * entity an index only it needs. A per-entity store lets `product_sku` carry an
 * index on `sku_id` and `fbs_order_item` one on `order_id` without either
 * appearing in the other's key space.
 *
 * Two columns are on **every** record whatever it describes:
 *
 *   • `store_id` — which shop the row belongs to. Uzum's payloads are
 *     inconsistent about this: `/v1/finance/orders` states `shopId` per row,
 *     `/v3/fbs/sku/stocks` never mentions a shop at all. So it is stamped here,
 *     from the shop the request was made for, and every store indexes it.
 *   • `account` — the token fingerprint, so pasting a different seller's token
 *     cannot show the previous one's numbers.
 *
 * ## Two kinds of entity, and why the difference is not a preference
 *
 * **Windowed** entities are settled history: a sale happened at an instant, for
 * an amount, with a commission taken, and none of that changes afterwards. They
 * are also — not by coincidence — the only ones the API will filter by date.
 * `/v1/finance/orders`, `/v1/finance/expenses` and `/v2/fbs/orders` accept
 * `dateFrom`/`dateTo`; every other route accepts nothing but `page` and `size`.
 * So these are the entities `sync_metadata.synced_ranges` is kept for, and the
 * ones lazy sync can answer from disk by subtracting what it already holds.
 *
 * **Snapshot** entities are claims about right now. A price changes, stock sells
 * down, a description is edited, an invoice moves from `CREATED` to `ACCEPTED`.
 * There is no window to fill because last week's value is not part of this
 * week's answer, and the API would not let us ask for it anyway. These are
 * captured whole and replaced whole, and their metadata records `captured_at`
 * instead of ranges. Asking lazy sync to plan a window for one would be asking a
 * question the route cannot answer.
 *
 * ## The compound index
 *
 * `store_date` = `['store_id', 'timestamp']` on every entity store. Compound
 * keys sort component by component, so `IDBKeyRange.bound([shop, from],
 * [shop, to])` selects exactly one shop's rows inside exactly one period —
 * contiguously, in timestamp order, with nothing to filter afterwards. In v1
 * this index needed a third leading component for the entity; giving each entity
 * its own store removes it, which makes every period query one component
 * narrower.
 */

/* ── database ───────────────────────────────────────────────────────────── */

export const DB_NAME = 'savdo';

/**
 * v2 split the single `records` store into one store per entity; v3 removes the
 * `buffer` store.
 *
 * The buffer held packed payloads keyed by source and selection, and it was a
 * second copy of what the entity stores already hold in normalised form. Two
 * copies of the catalogue meant two answers to "what is this SKU's price", and
 * which one a screen saw depended on which path it happened to take. v3 keeps
 * the normalised tables and deletes the copy.
 *
 * The upgrade discards rather than reshapes. The archive is derived data —
 * every row in it can be fetched again — and the coverage record makes the
 * refetch incremental, so the cost of starting clean is bounded and the cost of
 * a migration that subtly mis-maps a row is not.
 */
export const DB_VERSION = 3;

/* ── entities ───────────────────────────────────────────────────────────── */

/**
 * What kind of fact a record states.
 *
 * The name is the vocabulary the whole application uses for an entity; the
 * object store it lives in is an implementation detail resolved through
 * `ENTITIES` below.
 */
export const ENTITY_TYPES = {
  /* Windowed — settled history, date-filterable at the source. */
  orderItem: 'order_item',
  expense: 'expense',
  fbsOrder: 'fbs_order',
  fbsOrderItem: 'fbs_order_item',

  /* Snapshot — current state, captured whole. */
  product: 'product',
  productSku: 'product_sku',
  fbsStock: 'fbs_stock',
  supplyInvoice: 'supply_invoice',
  supplyInvoiceItem: 'supply_invoice_item',
  sellerReturn: 'seller_return',
  returnItem: 'return_item',
  fbsInvoice: 'fbs_invoice',

  /* Derived locally — no endpoint publishes it. */
  changeEvent: 'change_event',
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

/**
 * How an entity is kept up to date.
 *
 *   `windowed`  — periods are fetched and recorded in `synced_ranges`; lazy sync
 *                 subtracts what is held and requests only the complement.
 *   `snapshot`  — the whole set is re-read and replaces what was there; metadata
 *                 records `captured_at` and no ranges.
 *   `journal`   — append-only observations this machine made; never fetched.
 */
export type SyncMode = 'windowed' | 'snapshot' | 'journal';

export interface EntityDefinition {
  readonly entity: EntityType;
  /** The object store's name. */
  readonly store: string;
  readonly mode: SyncMode;
  /**
   * Indexes beyond the four every store gets.
   *
   * Declared here rather than in `db.ts` so that adding a lookup to an entity is
   * one edit next to the record shape it belongs to.
   */
  readonly indexes?: readonly { readonly name: string; readonly keyPath: string }[];
  /** Where the row came from, for the storage read-out and the docs. */
  readonly source: string;
}

/**
 * The registry. Everything else in this layer is derived from it.
 *
 * Adding an entity means adding one entry here, one record interface below, one
 * mapper in `mappers.ts` and one retention policy — and `db.ts` creates the
 * store without being touched.
 */
export const ENTITIES: Readonly<Record<EntityType, EntityDefinition>> = {
  [ENTITY_TYPES.orderItem]: {
    entity: ENTITY_TYPES.orderItem,
    store: 'order_items',
    mode: 'windowed',
    indexes: [
      { name: 'order_id', keyPath: 'order_id' },
      { name: 'product_id', keyPath: 'product_id' },
    ],
    source: 'GET /v1/finance/orders',
  },
  [ENTITY_TYPES.expense]: {
    entity: ENTITY_TYPES.expense,
    store: 'expenses',
    mode: 'windowed',
    indexes: [{ name: 'source_bucket', keyPath: 'source' }],
    source: 'GET /v1/finance/expenses',
  },
  [ENTITY_TYPES.fbsOrder]: {
    entity: ENTITY_TYPES.fbsOrder,
    store: 'fbs_orders',
    mode: 'windowed',
    indexes: [{ name: 'status', keyPath: 'status' }],
    source: 'GET /v2/fbs/orders',
  },
  [ENTITY_TYPES.fbsOrderItem]: {
    entity: ENTITY_TYPES.fbsOrderItem,
    store: 'fbs_order_items',
    mode: 'windowed',
    indexes: [
      { name: 'order_id', keyPath: 'order_id' },
      { name: 'sku_id', keyPath: 'sku_id' },
    ],
    source: 'GET /v2/fbs/orders → orderItems[]',
  },

  [ENTITY_TYPES.product]: {
    entity: ENTITY_TYPES.product,
    store: 'products',
    mode: 'snapshot',
    indexes: [{ name: 'product_id', keyPath: 'product_id' }],
    source: 'GET /v1/product/shop/{shopId}',
  },
  [ENTITY_TYPES.productSku]: {
    entity: ENTITY_TYPES.productSku,
    store: 'product_skus',
    mode: 'snapshot',
    indexes: [
      { name: 'sku_id', keyPath: 'sku_id' },
      { name: 'product_id', keyPath: 'product_id' },
    ],
    source: 'GET /v1/product/shop/{shopId} → skuList[]',
  },
  [ENTITY_TYPES.fbsStock]: {
    entity: ENTITY_TYPES.fbsStock,
    store: 'fbs_stocks',
    mode: 'snapshot',
    indexes: [{ name: 'sku_id', keyPath: 'sku_id' }],
    source: 'GET /v3/fbs/sku/stocks',
  },
  [ENTITY_TYPES.supplyInvoice]: {
    entity: ENTITY_TYPES.supplyInvoice,
    store: 'supply_invoices',
    mode: 'snapshot',
    indexes: [{ name: 'invoice_id', keyPath: 'invoice_id' }],
    source: 'GET /v1/invoice',
  },
  [ENTITY_TYPES.supplyInvoiceItem]: {
    entity: ENTITY_TYPES.supplyInvoiceItem,
    store: 'supply_invoice_items',
    mode: 'snapshot',
    indexes: [{ name: 'invoice_id', keyPath: 'invoice_id' }],
    source: 'GET /v1/shop/{shopId}/invoice/products',
  },
  [ENTITY_TYPES.sellerReturn]: {
    entity: ENTITY_TYPES.sellerReturn,
    store: 'seller_returns',
    mode: 'snapshot',
    indexes: [{ name: 'return_id', keyPath: 'return_id' }],
    source: 'GET /v1/return',
  },
  [ENTITY_TYPES.returnItem]: {
    entity: ENTITY_TYPES.returnItem,
    store: 'return_items',
    mode: 'snapshot',
    indexes: [
      { name: 'return_id', keyPath: 'return_id' },
      { name: 'sku_id', keyPath: 'sku_id' },
    ],
    source: 'GET /v1/return → returnItems[]',
  },
  [ENTITY_TYPES.fbsInvoice]: {
    entity: ENTITY_TYPES.fbsInvoice,
    store: 'fbs_invoices',
    mode: 'snapshot',
    indexes: [{ name: 'invoice_id', keyPath: 'invoice_id' }],
    source: 'GET /v1/fbs/invoice',
  },

  [ENTITY_TYPES.changeEvent]: {
    entity: ENTITY_TYPES.changeEvent,
    store: 'change_events',
    mode: 'journal',
    indexes: [{ name: 'sku_id', keyPath: 'sku_id' }],
    source: 'derived — product_sku snapshot diff',
  },
};

export const ALL_ENTITY_TYPES: readonly EntityType[] = Object.values(ENTITY_TYPES);

const byMode = (mode: SyncMode): readonly EntityType[] =>
  ALL_ENTITY_TYPES.filter((entity) => ENTITIES[entity].mode === mode);

/**
 * Entities whose completeness is a question about *periods*.
 *
 * Only these have `synced_ranges` worth consulting, and only these are ones the
 * API will filter by date. A snapshot entity belongs to no period — it is a
 * claim about right now — so its metadata records `captured_at` instead and lazy
 * sync never plans a window for it.
 */
export const WINDOWED_ENTITIES: readonly EntityType[] = byMode('windowed');

/** Entities captured whole and replaced whole. */
export const SNAPSHOT_ENTITIES: readonly EntityType[] = byMode('snapshot');

export const JOURNAL_ENTITIES: readonly EntityType[] = byMode('journal');

/** The object store one entity's rows live in. */
export function storeNameFor(entity: EntityType): string {
  return ENTITIES[entity].store;
}

export function isWindowed(entity: EntityType): boolean {
  return ENTITIES[entity].mode === 'windowed';
}

/* ── stores ─────────────────────────────────────────────────────────────── */

/** The stores that are not one entity's rows. */
export const STORES = {
  /** What has been pulled from the server, per shop and entity. */
  syncMetadata: 'sync_metadata',
  /** Everything that is one value rather than a series: settings, logs. */
  kv: 'kv',
} as const;

/** Every object store the database holds, entity stores included. */
export const ALL_STORE_NAMES: readonly string[] = [
  ...ALL_ENTITY_TYPES.map(storeNameFor),
  ...Object.values(STORES),
];

export const INDEXES = {
  /** `['store_id', 'timestamp']` — the period query, on every entity store. */
  storeDate: 'store_date',
  timestamp: 'timestamp',
  storeId: 'store_id',
  /**
   * Not part of the requested set; used only for housekeeping.
   *
   * Everything is partitioned by the account fingerprint, and dropping an
   * account's rows needs a way to find them without scanning.
   */
  account: 'account',
} as const;

/* ── record shapes ──────────────────────────────────────────────────────── */

/**
 * Columns every record carries, whatever it describes.
 *
 * `id` is deterministic rather than auto-incremented, and that is load-bearing:
 * the settlement lag means the same order item is deliberately re-read days
 * after it was first stored, and a deterministic key makes that a `put()` that
 * overwrites in place.
 */
export interface BaseRecord {
  /** `<account>:<store_id>:<entity>:<native id>` — see `recordId`. */
  readonly id: string;
  /** The shop this row belongs to. On every entity, without exception. */
  readonly store_id: number;
  readonly entity_type: EntityType;
  /** When the fact happened, in epoch milliseconds. The series axis. */
  readonly timestamp: number;
  /** UTC midnight of `timestamp` — the bucket key daily charts group on. */
  readonly day: number;
  readonly account: string;
}

/* ── windowed: settled history ──────────────────────────────────────────── */

/** A settled order item: one SKU sold on one order. */
export interface OrderItemRecord extends BaseRecord {
  readonly entity_type: 'order_item';
  readonly item_id: number;
  readonly order_id: number;
  readonly product_id: number;
  readonly sku_title: string;
  readonly product_title: string;
  readonly status: string;
  readonly sell_price: number;
  readonly amount: number;
  readonly amount_returns: number;
  readonly commission: number;
  readonly seller_profit: number;
  readonly purchase_price: number;
  readonly logistic_fee: number;
  readonly withdrawn_profit: number;
  readonly return_cause: string | null;
  /** `sell_price × amount`, pre-computed — the column every chart sums. */
  readonly revenue: number;
  /** `1` when the item was cancelled. Numeric so it sums into a count. */
  readonly cancelled: 0 | 1;
}

/** A settled expense or income row from the seller's payment ledger. */
export interface ExpenseRecord extends BaseRecord {
  readonly entity_type: 'expense';
  readonly payment_id: number;
  readonly name: string;
  readonly source: string;
  readonly code: string;
  readonly payment_price: number;
  readonly amount: number;
  readonly kind: string;
  /** Signed: outgoings negative, income positive, so a period sums directly. */
  readonly signed_amount: number;
}

/**
 * An FBS or DBS order.
 *
 * Windowed, but with a caveat the others do not have: an order's `status` moves
 * through the fulfilment workflow after the row is first written. The settlement
 * lag that re-opens the recent tail is what keeps those transitions caught —
 * the same mechanism that corrects a `PROCESSING` order item, applied to a
 * `CREATED` order that becomes `COMPLETED`.
 */
export interface FbsOrderRecord extends BaseRecord {
  readonly entity_type: 'fbs_order';
  readonly order_id: number;
  readonly status: string;
  /** `FBS` or `DBS` — which fulfilment scheme the order runs under. */
  readonly scheme: string;
  readonly price: number;
  /** Deadline to accept the order; missing it cancels it. */
  readonly accept_until: number | null;
  readonly deliver_until: number | null;
  readonly drop_off_title: string;
  readonly drop_off_address: string;
  /** How many `fbs_order_item` rows this order produced. */
  readonly item_count: number;
}

/** One line of an FBS order. */
export interface FbsOrderItemRecord extends BaseRecord {
  readonly entity_type: 'fbs_order_item';
  readonly item_id: number;
  readonly order_id: number;
  readonly sku_id: number;
  readonly sku_title: string;
  readonly product_title: string;
  readonly amount: number;
  readonly price: number;
  /** `price × amount`, pre-computed for the same reason `revenue` is. */
  readonly line_total: number;
  /** The parent order's status, denormalised so a line can be filtered alone. */
  readonly order_status: string;
}

/* ── snapshot: current state ────────────────────────────────────────────── */

/**
 * A product as it stood when the catalogue was last captured.
 *
 * Product-level figures are lifetime counters and marketing measures; the
 * per-variant prices and stock live on `product_sku`.
 */
export interface ProductRecord extends BaseRecord {
  readonly entity_type: 'product';
  readonly product_id: number;
  readonly title: string;
  readonly category: string;
  /** Wire vocabulary as-is: `IN_STOCK`, `RUN_OUT`, `ARCHIVED`, `BLOCKED`. */
  readonly status: string;
  readonly status_title: string;
  readonly rating: number;
  readonly feedback_quantity: number;
  readonly price: number;
  readonly quantity_available: number;
  readonly quantity_active: number;
  readonly quantity_fbs: number;
  readonly quantity_created: number;
  readonly quantity_sold: number;
  readonly quantity_returned: number;
  readonly returned_percentage: number;
  readonly roi: number;
  readonly conversion: number;
  readonly clicks: number;
  readonly viewers: number;
  readonly rank: string;
  readonly image: string;
  readonly sku_count: number;
}

/** One SKU as it stood when the catalogue was last captured. */
export interface ProductSkuRecord extends BaseRecord {
  readonly entity_type: 'product_sku';
  readonly sku_id: number;
  readonly product_id: number;
  readonly title: string;
  readonly characteristics: string;
  readonly barcode: string;
  readonly seller_item_code: string;
  readonly price: number;
  readonly purchase_price: number;
  readonly quantity_available: number;
  readonly quantity_active: number;
  readonly quantity_fbs: number;
  readonly quantity_sold: number;
  readonly quantity_returned: number;
  readonly returned_percentage: number;
  readonly commission: number;
  readonly turnover: number;
  readonly rank: string;
  readonly discount: 0 | 1;
  readonly archived: 0 | 1;
  readonly blocked: 0 | 1;
}

/**
 * An FBS warehouse amount.
 *
 * Its own entity rather than a column on `product_sku`, because it comes from a
 * different route with a different cadence: stock moves on every sale while a
 * catalogue capture is a heavier read. Keeping them apart means refreshing
 * stock does not mean re-reading the catalogue.
 *
 * `/v3/fbs/sku/stocks` is account-wide and names no shop, so `store_id` is
 * stamped from the shop whose SKU it matched — and `0` when it matched none.
 */
export interface FbsStockRecord extends BaseRecord {
  readonly entity_type: 'fbs_stock';
  readonly sku_id: number;
  readonly sku_title: string;
  readonly product_title: string;
  readonly barcode: string;
  readonly seller_sku_code: string;
  readonly amount: number;
  readonly fbs_allowed: 0 | 1;
  readonly dbs_allowed: 0 | 1;
  readonly fbs_linked: 0 | 1;
  readonly dbs_linked: 0 | 1;
}

/** An FBO supply invoice — goods handed to an Uzum warehouse. */
export interface SupplyInvoiceRecord extends BaseRecord {
  readonly entity_type: 'supply_invoice';
  readonly invoice_id: number;
  readonly invoice_number: number;
  readonly status: string;
  readonly status_title: string;
  /**
   * The shop's display name as the route stated it.
   *
   * Denormalised on purpose: the invoice table is read on its own, and joining
   * `store_id` against the shop list to render a name would make every read of
   * this table depend on a second source being loaded first.
   */
  readonly shop_title: string;
  readonly full_price: number;
  /** What was handed over, and what the warehouse actually accepted. */
  readonly total_to_stock: number;
  readonly total_accepted: number;
  /** `total_to_stock − total_accepted` — the shortfall, pre-computed. */
  readonly shortfall: number;
  readonly date_accepted: number | null;
  readonly stock_title: string;
  readonly stock_address: string;
  readonly slot_from: number | null;
  readonly slot_to: number | null;
}

/** One product line of a supply invoice. */
export interface SupplyInvoiceItemRecord extends BaseRecord {
  readonly entity_type: 'supply_invoice_item';
  readonly line_id: number;
  readonly invoice_id: number;
  readonly sku_title: string;
  readonly product_title: string;
  readonly quantity_to_stock: number;
  readonly quantity_accepted: number;
  readonly shortfall: number;
  readonly purchase_price: number;
}

/** A warehouse return — goods coming back from Uzum to the seller. */
export interface SellerReturnRecord extends BaseRecord {
  readonly entity_type: 'seller_return';
  readonly return_id: number;
  readonly status: string;
  /** `RETURN` or `DEFECTED`. */
  readonly kind: string;
  /** Denormalised for the same reason as on `supply_invoice`. */
  readonly shop_title: string;
  readonly external_number: string;
  readonly stock_title: string;
  readonly stock_address: string;
  readonly total_amount: number;
  readonly total_packed_amount: number;
}

/** One line of a warehouse return. */
export interface ReturnItemRecord extends BaseRecord {
  readonly entity_type: 'return_item';
  readonly line_id: number;
  readonly return_id: number;
  readonly sku_id: number;
  readonly sku_title: string;
  readonly product_title: string;
  readonly amount: number;
  readonly packed_amount: number;
  readonly purchase_price: number;
}

/** An FBS shipment invoice — orders bundled for one drop-off. */
export interface FbsInvoiceRecord extends BaseRecord {
  readonly entity_type: 'fbs_invoice';
  readonly invoice_id: number;
  readonly invoice_number: string;
  readonly status: string;
  readonly order_count: number;
  readonly accepted_order_count: number;
  readonly full_price: number;
  readonly accepted_price: number;
  readonly drop_off_title: string;
  readonly drop_off_address: string;
  readonly slot_from: number | null;
  readonly slot_to: number | null;
}

/* ── journal ────────────────────────────────────────────────────────────── */

/** A change this machine observed between two catalogue captures. */
export interface ChangeEventRecord extends BaseRecord {
  readonly entity_type: 'change_event';
  readonly sku_id: number;
  readonly product_id: number;
  readonly field: string;
  readonly from_value: number;
  readonly to_value: number;
}

export type StoredRecord =
  | OrderItemRecord
  | ExpenseRecord
  | FbsOrderRecord
  | FbsOrderItemRecord
  | ProductRecord
  | ProductSkuRecord
  | FbsStockRecord
  | SupplyInvoiceRecord
  | SupplyInvoiceItemRecord
  | SellerReturnRecord
  | ReturnItemRecord
  | FbsInvoiceRecord
  | ChangeEventRecord;

/* ── sync metadata ──────────────────────────────────────────────────────── */

/**
 * A period this machine has pulled from the server and holds in full.
 *
 * Named `start`/`end` rather than the `fromMs`/`toMs` the request layer uses,
 * because this is the persisted shape and it should not have to change when the
 * request layer's vocabulary does. `metadata.repo.ts` converts at the boundary.
 */
export interface SyncedRange {
  readonly start: number;
  readonly end: number;
}

/**
 * What is known about one `(store_id, entity_type)` pair.
 *
 * This record — not the rows — is what every planning decision is made from.
 * Asking "must I fetch 1 January to 1 February?" costs one keyed read here,
 * whether the store holds a thousand rows or a million.
 */
export interface SyncMetadataRecord {
  /** `<account>:<store_id>:<entity_type>` — see `metadataKey`. */
  readonly key: string;
  readonly account: string;
  readonly store_id: number;
  readonly entity_type: EntityType;
  /**
   * Normalised, non-overlapping, ascending. The coverage record.
   *
   * Always empty for snapshot entities: their route takes no date filter, so
   * there is no period that could be claimed.
   */
  readonly synced_ranges: readonly SyncedRange[];
  /** Rows currently held for this pair. */
  readonly rows: number;
  /**
   * Where retention has cut the record, if it has.
   *
   * When old rows are pruned, `synced_ranges` is clipped to match so the record
   * never claims a period whose rows were discarded.
   */
  readonly evicted_before: number | null;
  /** When this pair was last written to. */
  readonly last_synced_at: number | null;
  /** Snapshot entities only: when the current capture was taken. */
  readonly captured_at: number | null;
  /** Whether the backwards walk has found the start of this shop's history. */
  readonly backfill_complete: boolean;
  /** How far back the backwards walk has reached. */
  readonly backfill_from: number | null;
  readonly version: number;
}

export const METADATA_VERSION = 2;

/* ── key/value ──────────────────────────────────────────────────────────── */

export interface KvRecord {
  readonly key: string;
  readonly value: unknown;
  readonly at: number;
}

/** The fixed set of key/value slots, so no module invents its own spelling. */
export const KV_KEYS = {
  settings: 'settings',
  notifications: 'notifications',
  syncLog: 'sync_log',
} as const;

export type KvKey = (typeof KV_KEYS)[keyof typeof KV_KEYS];

/* ── key builders ───────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/** UTC midnight of an instant — the daily bucket every chart groups on. */
export function dayOf(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

/**
 * The primary key of a record.
 *
 * Deterministic in all four components, so re-reading a period that is already
 * held overwrites the rows it holds rather than duplicating them.
 */
export function recordId(
  account: string,
  storeId: number,
  entity: EntityType,
  nativeId: string | number,
): string {
  return `${account}:${storeId}:${entity}:${nativeId}`;
}

export function metadataKey(account: string, storeId: number, entity: EntityType): string {
  return `${account}:${storeId}:${entity}`;
}
