import type { DateWindow } from '@/services/uzum/endpoints';
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

import { accountFingerprint } from '../account';
import {
  changeToRecord,
  expenseToRecord,
  fbsInvoiceToRecord,
  fbsOrderToRecords,
  orderToRecord,
  productToRecords,
  recordToChange,
  recordToExpense,
  recordToOrder,
  returnToRecords,
  skuRecordToCatalog,
  stockToRecord,
  supplyInvoiceItemToRecord,
  supplyInvoiceToRecord,
} from '../idb/mappers';
import {
  commitBackfill,
  commitCoverage,
  commitEviction,
  deleteAccountMetadata,
  deleteShopMetadata,
  metadataStoreIds,
  patchMetadata,
  readMetadata,
  readShopMetadata,
  toCoverage,
} from '../idb/metadata.repo';
import {
  countEntity,
  deleteAccount as deleteAccountRecords,
  deleteEntity,
  deleteStore as deleteStoreRecords,
  entityBounds,
  putRecords,
  readBy,
  readPeriod,
  storeIdsFor,
  trimToNewest,
  type WriteOutcome,
} from '../idb/records.repo';
import {
  ALL_ENTITY_TYPES,
  ENTITY_TYPES,
  SNAPSHOT_ENTITIES,
  WINDOWED_ENTITIES,
  type ChangeEventRecord,
  type EntityType,
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
  type StoredRecord,
  type SupplyInvoiceItemRecord,
  type SupplyInvoiceRecord,
  type SyncMetadataRecord,
} from '../idb/schema';
import { needsPruning, retentionFor } from '../retention';
import { diffCatalog, projectCatalog, type CatalogSku, type ChangeEvent } from './codec';

/**
 * The archive: one shop's data, and the record of how much of it is held.
 *
 * Two write paths, because there are two kinds of entity and conflating them is
 * what produces either a stale catalogue or a re-fetched year of history.
 *
 *   **`mergeWindow`** — settled history. Rows are upserted by deterministic key
 *   and the window is recorded as covered *after* the write lands. Re-reading a
 *   period that is already held overwrites in place, which is how the settlement
 *   lag corrects a `PROCESSING` order item that has since become `CANCELED`.
 *   Only `order_item`, `expense`, `fbs_order` and `fbs_order_item` take this
 *   path — they are exactly the entities whose route accepts `dateFrom`/`dateTo`.
 *
 *   **`commitSnapshot`** — current state. The previous capture is deleted and
 *   the new one written whole, because a row that has left the catalogue has no
 *   incoming row to overwrite it and would otherwise show its last known price
 *   forever. Metadata records `captured_at` and never a range: there is no
 *   period to claim, and the route would not filter by one if there were.
 *
 * ## The invariant that must never break
 *
 * A range is recorded **only after the rows it covers have been written**. The
 * opposite order is the single unrecoverable bug available in this design: a
 * window marked covered but never stored is a hole no future sync will ever look
 * at again, because the planner trusts this record absolutely.
 */

/* ── metadata ───────────────────────────────────────────────────────────── */

/** Shops this account holds anything for. */
export async function archivedShops(): Promise<readonly number[]> {
  const [fromMeta, fromRows] = await Promise.all([
    metadataStoreIds(accountFingerprint()),
    storeIdsFor(accountFingerprint()),
  ]);

  /* Either source alone can be incomplete: metadata exists before the first row
     lands, and rows survive a metadata write that failed. The union is the
     honest answer to "which shops does this machine know about". */
  return [...new Set([...fromMeta, ...fromRows])].sort((a, b) => a - b);
}

export function readMeta(shopId: number, entity: EntityType): Promise<SyncMetadataRecord> {
  return readMetadata(accountFingerprint(), shopId, entity);
}

/** Every entity's metadata for one shop, in one read. */
export function readShopMeta(
  shopId: number,
  entities: readonly EntityType[] = ALL_ENTITY_TYPES,
): Promise<Readonly<Record<string, SyncMetadataRecord>>> {
  return readShopMetadata(accountFingerprint(), shopId, entities);
}

/** The ledger's coverage, which is what every planning decision is made from. */
export function ledgerCoverage(shopId: number): Promise<SyncMetadataRecord> {
  return readMeta(shopId, ENTITY_TYPES.orderItem);
}

export function recordBackfill(
  shopId: number,
  progress: { readonly from: number | null; readonly complete: boolean },
): Promise<SyncMetadataRecord> {
  return commitBackfill(accountFingerprint(), shopId, ENTITY_TYPES.orderItem, progress);
}

export function stampSynced(shopId: number, at: number): Promise<SyncMetadataRecord> {
  return patchMetadata(accountFingerprint(), shopId, ENTITY_TYPES.orderItem, (current) => ({
    ...current,
    last_synced_at: at,
  }));
}

/* ── the generic write paths ────────────────────────────────────────────── */

export interface MergeOutcome {
  readonly stored: boolean;
  /** Rows the archive did not previously hold. */
  readonly added: number;
  /** Rows it held whose values this read changed — settlement catching up. */
  readonly updated: number;
  /** Rows the shop now holds of this kind. */
  readonly rows: number;
  /** Oldest rows dropped by the retention policy. */
  readonly evicted: number;
}

export const EMPTY_MERGE: MergeOutcome = {
  stored: false,
  added: 0,
  updated: 0,
  rows: 0,
  evicted: 0,
};

/**
 * Write rows, prune if the policy says to, then record what is now held.
 *
 * The order is the one invariant that must never be relaxed — see this module's
 * header. Pruning happens between the two, and when it clips the record the
 * coverage is clipped with it, so "what is covered" and "what is stored" stay
 * the same statement rather than two claims that can drift apart.
 */
async function write(options: {
  readonly shopId: number;
  readonly entity: EntityType;
  readonly rows: readonly StoredRecord[];
  readonly window: DateWindow | null;
  readonly at: number;
  readonly capturedAt?: number | undefined;
}): Promise<MergeOutcome> {
  const account = accountFingerprint();

  let outcome: WriteOutcome;
  try {
    outcome = await putRecords(options.entity, options.rows);
  } catch {
    /* A failed write must leave the coverage record untouched, so the next run
       plans this window again. Reporting `stored: false` is what the sync log
       shows as a source that did not land. */
    return EMPTY_MERGE;
  }

  let rows = await countEntity(options.shopId, options.entity);
  let evicted = 0;

  const policy = retentionFor(options.entity);
  if (needsPruning(options.entity, rows)) {
    evicted = await trimToNewest(options.shopId, options.entity, policy.maxRows);
    rows = await countEntity(options.shopId, options.entity);
  }

  await commitCoverage(account, options.shopId, options.entity, {
    window: options.window,
    rows,
    at: options.at,
    capturedAt: options.capturedAt,
  });

  /* Only after the coverage has been extended is it clipped, so the two writes
     cannot leave the record claiming a period whose rows have just gone. */
  if (evicted > 0 && policy.clipsCoverage) {
    const bounds = await entityBounds(options.shopId, options.entity);
    if (bounds.oldest !== null) {
      await commitEviction(account, options.shopId, options.entity, bounds.oldest, rows);
    }
  }

  return { stored: true, added: outcome.added, updated: outcome.updated, rows, evicted };
}

/**
 * Store a window of settled history and record it as covered.
 *
 * Rows outside the window are never read, never rewritten and never even
 * deserialised — the cost of storing one week is the size of that week.
 */
export function mergeWindow(
  shopId: number,
  entity: EntityType,
  rows: readonly StoredRecord[],
  window: DateWindow | null,
): Promise<MergeOutcome> {
  return write({ shopId, entity, rows, window, at: Date.now() });
}

/**
 * Replace a snapshot entity's rows wholesale.
 *
 * The delete comes first and is not optional: a product that has left the
 * catalogue, or an invoice that has closed and dropped off the list, has no
 * incoming row to overwrite it. Without the delete it would sit in the table
 * showing its last known state indefinitely, and no read could tell it apart
 * from a live one.
 *
 * An empty incoming set is treated as a failed read rather than an emptied
 * catalogue, and leaves the previous capture alone. A route that answers with
 * nothing is far more often rate-limited or briefly broken than it is a seller
 * who deleted every product, and wiping a good capture on that evidence is not
 * a recoverable mistake.
 */
export async function commitSnapshot(
  shopId: number,
  entity: EntityType,
  rows: readonly StoredRecord[],
  at: number,
): Promise<MergeOutcome> {
  if (rows.length === 0) return EMPTY_MERGE;

  await deleteEntity(shopId, entity);
  return write({ shopId, entity, rows, window: null, at, capturedAt: at });
}

/* ── windowed entities ──────────────────────────────────────────────────── */

const UNBOUNDED = {
  fromMs: Number.NEGATIVE_INFINITY,
  toMs: Number.POSITIVE_INFINITY,
} as const;

/**
 * Settled order items for a shop, optionally confined to a window.
 *
 * The window is not a filter applied after reading — it is the key range the
 * cursor opens on. Asking for March touches March's rows and nothing else.
 */
export async function readLedger(
  shopId: number,
  window: DateWindow = UNBOUNDED,
): Promise<readonly FinanceOrderItem[]> {
  const rows = await readPeriod<OrderItemRecord>({
    storeId: shopId,
    entity: ENTITY_TYPES.orderItem,
    fromMs: window.fromMs,
    toMs: window.toMs,
  });

  return rows.map(recordToOrder);
}

export function mergeLedger(
  shopId: number,
  items: readonly FinanceOrderItem[],
  window: DateWindow | null,
): Promise<MergeOutcome> {
  const account = accountFingerprint();
  const rows = items.map((item) => orderToRecord(item, account, shopId));
  return mergeWindow(shopId, ENTITY_TYPES.orderItem, rows, window);
}

export async function readExpenses(
  shopId: number,
  window: DateWindow = UNBOUNDED,
): Promise<readonly SellerPayment[]> {
  const rows = await readPeriod<ExpenseRecord>({
    storeId: shopId,
    entity: ENTITY_TYPES.expense,
    fromMs: window.fromMs,
    toMs: window.toMs,
  });

  return rows.map(recordToExpense);
}

export function mergeExpenses(
  shopId: number,
  payments: readonly SellerPayment[],
  window: DateWindow | null,
): Promise<MergeOutcome> {
  const account = accountFingerprint();
  const rows = payments.map((payment) => expenseToRecord(payment, account, shopId));
  return mergeWindow(shopId, ENTITY_TYPES.expense, rows, window);
}

export function readFbsOrders(
  shopId: number,
  window: DateWindow = UNBOUNDED,
): Promise<readonly FbsOrderRecord[]> {
  return readPeriod<FbsOrderRecord>({
    storeId: shopId,
    entity: ENTITY_TYPES.fbsOrder,
    fromMs: window.fromMs,
    toMs: window.toMs,
  });
}

/** The lines of one FBS order — a keyed read, not a walk. */
export function readFbsOrderItems(orderId: number): Promise<readonly FbsOrderItemRecord[]> {
  return readBy<FbsOrderItemRecord>(ENTITY_TYPES.fbsOrderItem, 'order_id', orderId);
}

/**
 * Store a window of FBS orders and their lines together.
 *
 * Both are committed for the same window, and the order record is written
 * first. If the second write fails the order's coverage claims a window whose
 * lines are missing — so the line entity keeps its own coverage record, and the
 * planner takes the union of what either is missing.
 */
export async function mergeFbsOrders(
  shopId: number,
  orders: readonly FbsOrder[],
  window: DateWindow | null,
): Promise<{ orders: MergeOutcome; items: MergeOutcome }> {
  const account = accountFingerprint();
  const mapped = orders.map((order) => fbsOrderToRecords(order, account, shopId));

  const orderOutcome = await mergeWindow(
    shopId,
    ENTITY_TYPES.fbsOrder,
    mapped.map((entry) => entry.order),
    window,
  );

  const itemOutcome = await mergeWindow(
    shopId,
    ENTITY_TYPES.fbsOrderItem,
    mapped.flatMap((entry) => entry.items),
    window,
  );

  return { orders: orderOutcome, items: itemOutcome };
}

/* ── snapshot entities ──────────────────────────────────────────────────── */

export interface Capture<T> {
  /** When the capture was taken, or null if there has never been one. */
  readonly at: number | null;
  readonly rows: readonly T[];
}

async function readCapture<T extends StoredRecord>(
  shopId: number,
  entity: EntityType,
): Promise<Capture<T>> {
  const [rows, meta] = await Promise.all([
    readPeriod<T>({ storeId: shopId, entity, ...UNBOUNDED }),
    readMeta(shopId, entity),
  ]);

  return { at: meta.captured_at, rows };
}

export const readProducts = (shopId: number): Promise<Capture<ProductRecord>> =>
  readCapture<ProductRecord>(shopId, ENTITY_TYPES.product);

export const readProductSkus = (shopId: number): Promise<Capture<ProductSkuRecord>> =>
  readCapture<ProductSkuRecord>(shopId, ENTITY_TYPES.productSku);

export const readFbsStocks = (shopId: number): Promise<Capture<FbsStockRecord>> =>
  readCapture<FbsStockRecord>(shopId, ENTITY_TYPES.fbsStock);

export const readSupplyInvoices = (shopId: number): Promise<Capture<SupplyInvoiceRecord>> =>
  readCapture<SupplyInvoiceRecord>(shopId, ENTITY_TYPES.supplyInvoice);

export const readSellerReturns = (shopId: number): Promise<Capture<SellerReturnRecord>> =>
  readCapture<SellerReturnRecord>(shopId, ENTITY_TYPES.sellerReturn);

export const readFbsInvoices = (shopId: number): Promise<Capture<FbsInvoiceRecord>> =>
  readCapture<FbsInvoiceRecord>(shopId, ENTITY_TYPES.fbsInvoice);

/** The SKUs of one product — a keyed read on the `product_id` index. */
export const readSkusOf = (productId: number): Promise<readonly ProductSkuRecord[]> =>
  readBy<ProductSkuRecord>(ENTITY_TYPES.productSku, 'product_id', productId);

/** The lines of one supply invoice. */
export const readSupplyInvoiceItems = (
  invoiceId: number,
): Promise<readonly SupplyInvoiceItemRecord[]> =>
  readBy<SupplyInvoiceItemRecord>(ENTITY_TYPES.supplyInvoiceItem, 'invoice_id', invoiceId);

/** The lines of one warehouse return. */
export const readReturnItems = (returnId: number): Promise<readonly ReturnItemRecord[]> =>
  readBy<ReturnItemRecord>(ENTITY_TYPES.returnItem, 'return_id', returnId);

/**
 * Replace the shop's catalogue capture, and journal what moved.
 *
 * Products and SKUs are two entities from one payload, so both are replaced in
 * the same call — a capture that updated products but not SKUs would leave the
 * two tables describing different days.
 *
 * The journal is the reason the previous SKU capture is read first. The seller
 * API publishes no change history — no endpoint answers "what was this SKU's
 * price on 15 July" — so a price move can only be *observed*, by comparing this
 * capture against the last one. The first capture journals nothing: there is no
 * "before", and emitting the whole catalogue as changes would bury the real
 * moves on the one day the journal is created.
 */
export async function commitCatalog(
  shopId: number,
  products: readonly ShopProduct[],
  stocks: readonly SkuAmount[],
  at: number,
): Promise<{
  readonly stored: boolean;
  readonly products: number;
  readonly skus: number;
  readonly events: readonly ChangeEvent[];
}> {
  const account = accountFingerprint();

  /* The diff is taken against what is stored, joined with the stock amounts the
     stored rows no longer carry — `fbs_stock` is its own entity now. */
  const previousSkus = await readProductSkus(shopId);
  const previousStock = await readFbsStocks(shopId);
  const stockBySku = new Map(previousStock.rows.map((row) => [row.sku_id, row.amount]));

  const before: readonly CatalogSku[] = previousSkus.rows.map((row) =>
    skuRecordToCatalog(row, stockBySku.get(row.sku_id) ?? -1),
  );
  const after = projectCatalog(products, stocks);
  const events = previousSkus.at === null ? [] : diffCatalog(before, after, at);

  const mapped = products.map((product) => productToRecords(product, account, shopId, at));

  const productOutcome = await commitSnapshot(
    shopId,
    ENTITY_TYPES.product,
    mapped.map((entry) => entry.product),
    at,
  );
  const skuOutcome = await commitSnapshot(
    shopId,
    ENTITY_TYPES.productSku,
    mapped.flatMap((entry) => entry.skus),
    at,
  );

  if (!productOutcome.stored) return { stored: false, products: 0, skus: 0, events: [] };
  if (events.length > 0) await appendJournal(shopId, events);

  return {
    stored: true,
    products: productOutcome.rows,
    skus: skuOutcome.rows,
    events,
  };
}

/**
 * Replace the FBS stock capture for one shop.
 *
 * `/v3/fbs/sku/stocks` is account-wide and names no shop, so the caller decides
 * which rows belong here — normally by matching `skuId` against this shop's
 * catalogue. Splitting the account-wide read across shops is what keeps
 * `store_id` truthful on an entity the API never stamps.
 */
export function commitStocks(
  shopId: number,
  stocks: readonly SkuAmount[],
  at: number,
): Promise<MergeOutcome> {
  const account = accountFingerprint();
  const rows = stocks.map((stock) => stockToRecord(stock, account, shopId, at));
  return commitSnapshot(shopId, ENTITY_TYPES.fbsStock, rows, at);
}

export function commitSupplyInvoices(
  shopId: number,
  invoices: readonly SupplyInvoice[],
  at: number,
): Promise<MergeOutcome> {
  const account = accountFingerprint();
  const rows = invoices.map((invoice) => supplyInvoiceToRecord(invoice, account, shopId, at));
  return commitSnapshot(shopId, ENTITY_TYPES.supplyInvoice, rows, at);
}

/**
 * Replace the line rows of the supply invoices that were captured.
 *
 * Lines come from a different route than the invoices, one request per invoice,
 * so the caller fetches only the invoices worth expanding and hands the whole
 * result here to be written as one capture.
 */
export function commitSupplyInvoiceItems(
  shopId: number,
  lines: readonly { readonly invoiceId: number; readonly products: readonly InvoiceProduct[] }[],
  at: number,
): Promise<MergeOutcome> {
  const account = accountFingerprint();

  const rows = lines.flatMap((entry) =>
    entry.products.map((product) =>
      supplyInvoiceItemToRecord(product, entry.invoiceId, account, shopId, at),
    ),
  );

  return commitSnapshot(shopId, ENTITY_TYPES.supplyInvoiceItem, rows, at);
}

export async function commitReturns(
  shopId: number,
  returns: readonly SellerReturn[],
  at: number,
): Promise<{ entries: MergeOutcome; items: MergeOutcome }> {
  const account = accountFingerprint();
  const mapped = returns.map((entry) => returnToRecords(entry, account, shopId, at));

  const entries = await commitSnapshot(
    shopId,
    ENTITY_TYPES.sellerReturn,
    mapped.map((entry) => entry.entry),
    at,
  );
  const items = await commitSnapshot(
    shopId,
    ENTITY_TYPES.returnItem,
    mapped.flatMap((entry) => entry.items),
    at,
  );

  return { entries, items };
}

export function commitFbsInvoices(
  shopId: number,
  invoices: readonly FbsInvoice[],
  at: number,
): Promise<MergeOutcome> {
  const account = accountFingerprint();
  const rows = invoices.map((invoice) => fbsInvoiceToRecord(invoice, account, shopId, at));
  return commitSnapshot(shopId, ENTITY_TYPES.fbsInvoice, rows, at);
}

/* ── journal ────────────────────────────────────────────────────────────── */

export async function readJournal(
  shopId: number,
  window: DateWindow = UNBOUNDED,
): Promise<readonly ChangeEvent[]> {
  const rows = await readPeriod<ChangeEventRecord>({
    storeId: shopId,
    entity: ENTITY_TYPES.changeEvent,
    fromMs: window.fromMs,
    toMs: window.toMs,
  });

  return rows.flatMap((row) => {
    const event = recordToChange(row);
    return event === null ? [] : [event];
  });
}

/**
 * Append change events, oldest forgotten first.
 *
 * The journal is the only record of a price move — no endpoint replays it — so
 * it is capped by count rather than by age: a shop that changes nothing for a
 * year should still be able to see the change it made last spring.
 */
export async function appendJournal(
  shopId: number,
  events: readonly ChangeEvent[],
): Promise<boolean> {
  if (events.length === 0) return true;

  const account = accountFingerprint();
  const rows = events.map((event) => changeToRecord(event, account, shopId));
  const outcome = await write({
    shopId,
    entity: ENTITY_TYPES.changeEvent,
    rows,
    window: null,
    at: Date.now(),
  });

  return outcome.stored;
}

/* ── housekeeping ───────────────────────────────────────────────────────── */

export interface ShopUsage {
  readonly shopId: number;
  /** Rows held, per entity. */
  readonly rows: Readonly<Record<EntityType, number>>;
  readonly totalRows: number;
}

/**
 * What one shop holds.
 *
 * Counted through each store's index, so this is one keyed count per entity
 * rather than a deserialisation of anything.
 */
export async function usage(shopId: number): Promise<ShopUsage> {
  const counts = await Promise.all(
    ALL_ENTITY_TYPES.map((entity) => countEntity(shopId, entity)),
  );

  const rows = Object.fromEntries(
    ALL_ENTITY_TYPES.map((entity, index) => [entity, counts[index] ?? 0]),
  ) as Record<EntityType, number>;

  return {
    shopId,
    rows,
    totalRows: counts.reduce((sum, value) => sum + value, 0),
  };
}

/** Drop one shop's archive entirely — every entity, and its metadata. */
export async function clearShop(shopId: number): Promise<void> {
  await deleteStoreRecords(shopId);
  await deleteShopMetadata(accountFingerprint(), shopId);
}

/** Drop every shop's archive for the current account. */
export async function clearArchive(): Promise<void> {
  const account = accountFingerprint();
  await deleteAccountRecords(account);
  await deleteAccountMetadata(account);
}

/** A shop with nothing at all — what makes the next sync a backfill. */
export async function isEmpty(shopId: number): Promise<boolean> {
  const [ledger, products] = await Promise.all([
    readMeta(shopId, ENTITY_TYPES.orderItem),
    readMeta(shopId, ENTITY_TYPES.product),
  ]);

  return ledger.synced_ranges.length === 0 && products.captured_at === null;
}

/** The outer bounds of one shop's settled ledger. */
export async function ledgerBounds(shopId: number): Promise<DateWindow | null> {
  const meta = await readMeta(shopId, ENTITY_TYPES.orderItem);
  const covered = toCoverage(meta.synced_ranges);

  const first = covered[0];
  const last = covered[covered.length - 1];
  if (first === undefined || last === undefined) return null;

  return { fromMs: first.fromMs, toMs: last.toMs };
}

export { ENTITY_TYPES, SNAPSHOT_ENTITIES, WINDOWED_ENTITIES };
export type { EntityType, SyncMetadataRecord };
