/**
 * The IndexedDB schema — every store, index and record shape in one place.
 *
 * The application used to keep its history in localStorage, which forced two
 * compromises that shaped the whole storage layer: a ~5 MB origin ceiling, and
 * a key/value interface with no way to ask a question about a *range*. Rows were
 * therefore packed into positional tuples to fit, and every read deserialised a
 * shop's entire history to answer "what happened in March".
 *
 * IndexedDB removes both constraints, and this schema is built around what it
 * offers instead:
 *
 *   • **Structured clone, not JSON.** Values are stored as real objects with
 *     real numbers. Packing rows into tuples bought nothing here and cost the
 *     ability to index them, so records are stored **flat and denormalised** —
 *     one row per fact, every column a top-level field.
 *
 *   • **Indexes.** A period query is answered by the index rather than by
 *     scanning, which is the difference between a chart that redraws in a frame
 *     and one that unpacks 40 000 rows first.
 *
 * ## Why flat, and why these extra columns
 *
 * The two consumers are AI analysis over time intervals and performance-critical
 * charts. Both want the same thing: *give me every row between two instants,
 * already in a form I can sum*. So each record carries pre-computed columns that
 * would otherwise be derived per row on every read — `revenue`, `day` (the UTC
 * midnight the row belongs to), `cancelled` as 0/1. They cost a few bytes each
 * in a store with gigabytes of headroom, and they turn a daily revenue series
 * into one pass of additions with no date arithmetic in the loop.
 *
 * ## The compound index
 *
 * `store_entity_date` = `['store_id', 'entity_type', 'timestamp']` is the index
 * every read goes through. Because IndexedDB orders compound keys
 * lexicographically by component, an `IDBKeyRange.bound()` over
 * `[shop, kind, from]` → `[shop, kind, to]` selects exactly one shop's rows, of
 * exactly one kind, inside exactly one period — contiguously, in timestamp
 * order, with no filtering afterwards. That is the single design decision the
 * rest of this layer's performance rests on.
 */

/* ── database ───────────────────────────────────────────────────────────── */

export const DB_NAME = 'savdo';

/**
 * Bump this and add an upgrade step in `db.ts` when a store or index changes.
 *
 * v1 is the first IndexedDB schema; the localStorage payloads that preceded it
 * are imported by the one-shot migration in `storage/migration/`, not by an
 * upgrade step, because they live in a different storage engine entirely.
 */
export const DB_VERSION = 1;

export const STORES = {
  /** Flat, time-series rows — the archive. */
  records: 'records',
  /** What has been pulled from the server, per store and entity. */
  syncMetadata: 'sync_metadata',
  /** Read-through payload slots, keyed by source and scope. */
  buffer: 'buffer',
  /** Everything that is one value rather than a series: settings, logs. */
  kv: 'kv',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export const INDEXES = {
  /** `['store_id', 'entity_type', 'timestamp']` — the period query. */
  storeEntityDate: 'store_entity_date',
  timestamp: 'timestamp',
  storeId: 'store_id',
  /**
   * Not part of the requested set; used only for housekeeping.
   *
   * Everything is partitioned by the account fingerprint so that pasting a
   * different seller's token cannot show the previous one's numbers. Dropping
   * an account's rows needs a way to find them without scanning the store.
   */
  account: 'account',
} as const;

/* ── entities ───────────────────────────────────────────────────────────── */

/**
 * What kind of fact a record states.
 *
 * The three groups the sync engine already distinguishes map onto these:
 * settled history (`order_item`, `expense`) accumulates by period; current
 * state (`catalog_sku`) is captured whole and superseded; derived history
 * (`change_event`) is observed locally by diffing consecutive captures.
 */
export const ENTITY_TYPES = {
  orderItem: 'order_item',
  expense: 'expense',
  catalogSku: 'catalog_sku',
  changeEvent: 'change_event',
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

export const ALL_ENTITY_TYPES: readonly EntityType[] = Object.values(ENTITY_TYPES);

/**
 * Entities whose completeness is a question about *periods*.
 *
 * Only these have `synced_ranges` worth consulting: a sale belongs to a moment,
 * so "have I read March" is answerable. A catalogue capture belongs to no
 * period — it is a claim about right now — so its metadata records `captured_at`
 * instead and lazy sync never plans a window for it.
 */
export const PERIODIC_ENTITIES: readonly EntityType[] = [
  ENTITY_TYPES.orderItem,
  ENTITY_TYPES.expense,
];

/* ── record shapes ──────────────────────────────────────────────────────── */

/**
 * Columns every record carries, whatever it describes.
 *
 * `id` is deterministic rather than auto-incremented, and that is load-bearing:
 * the settlement lag means the same order item is deliberately re-read days
 * after it was first stored, and a deterministic key makes that a `put()` that
 * overwrites in place. An auto-increment key would need a read-modify-write per
 * row to achieve the same thing, and would store the row twice if it missed.
 */
export interface BaseRecord {
  /** `<account>:<store_id>:<entity_type>:<native id>` — see `recordId`. */
  readonly id: string;
  readonly store_id: number;
  readonly entity_type: EntityType;
  /** When the fact happened, in epoch milliseconds. The series axis. */
  readonly timestamp: number;
  /** UTC midnight of `timestamp` — the bucket key daily charts group on. */
  readonly day: number;
  readonly account: string;
}

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

/** One SKU as it stood when the catalogue was last captured. */
export interface CatalogSkuRecord extends BaseRecord {
  readonly entity_type: 'catalog_sku';
  readonly sku_id: number;
  readonly product_id: number;
  readonly title: string;
  readonly price: number;
  readonly purchase_price: number;
  readonly quantity_available: number;
  readonly quantity_active: number;
  readonly quantity_fbs: number;
  readonly quantity_sold: number;
  readonly quantity_returned: number;
  readonly rank: string;
  readonly discount: 0 | 1;
  /** FBS warehouse amount, `−1` when the SKU is not carried on FBS. */
  readonly fbs_stock: number;
  readonly barcode: number;
}

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
  | CatalogSkuRecord
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
  /** Normalised, non-overlapping, ascending. The coverage record. */
  readonly synced_ranges: readonly SyncedRange[];
  /** Rows currently held for this pair. */
  readonly rows: number;
  /**
   * Where retention has cut the record, if it has.
   *
   * When old rows are pruned, `synced_ranges` is clipped to match so the record
   * never claims a period whose rows were discarded. This remembers that the
   * edge is pruned rather than merely unfetched — a distinction the coverage bar
   * draws, because one of them a sync can fill and the other it cannot.
   */
  readonly evicted_before: number | null;
  /** When this pair was last written to. */
  readonly last_synced_at: number | null;
  /** Non-periodic entities only: when the current capture was taken. */
  readonly captured_at: number | null;
  /** Whether the backwards walk has found the start of this shop's history. */
  readonly backfill_complete: boolean;
  /** How far back the backwards walk has reached. */
  readonly backfill_from: number | null;
  readonly version: number;
}

export const METADATA_VERSION = 1;

/* ── buffer ─────────────────────────────────────────────────────────────── */

/**
 * One read-through slot: a whole API payload for one source and one scope.
 *
 * Kept apart from `records` on purpose. These are *payloads*, not facts — they
 * answer "what did this endpoint say when I last asked", they are replaced
 * wholesale, and they are evicted by age. Mixing them into the time-series store
 * would put rows that expire next to rows that are permanent.
 */
export interface BufferRecord {
  /** `<account>:<source>:<scope>`. */
  readonly key: string;
  readonly account: string;
  readonly source: string;
  readonly scope: string;
  /** When the payload was read from the server. Indexed, for LRU eviction. */
  readonly at: number;
  /** Rough serialised size, used for the usage read-out. */
  readonly bytes: number;
  readonly meta: Record<string, unknown>;
  readonly tables: Readonly<Record<string, unknown>>;
  readonly version: number;
}

export const BUFFER_VERSION = 1;

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
  /** Records that the one-shot localStorage import has already run. */
  migration: 'migration',
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

export function bufferKey(account: string, source: string, scope: string): string {
  return `${account}:${source}:${scope}`;
}
