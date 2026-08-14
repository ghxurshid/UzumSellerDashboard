import type { DateWindow } from '@/services/uzum/endpoints';
import type { FinanceOrderItem, SellerPayment } from '@/services/uzum/types';

import { accountFingerprint } from '../account';
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
  readPeriod,
  storeIdsFor,
  trimToNewest,
  type WriteOutcome,
} from '../idb/records.repo';
import {
  ENTITY_TYPES,
  type CatalogSkuRecord,
  type ChangeEventRecord,
  type EntityType,
  type ExpenseRecord,
  type OrderItemRecord,
  type SyncMetadataRecord,
} from '../idb/schema';
import {
  changeToRecord,
  expenseToRecord,
  orderToRecord,
  recordToChange,
  recordToExpense,
  recordToOrder,
  recordToSku,
  skuToRecord,
} from '../idb/mappers';
import { needsPruning, retentionFor } from '../retention';
import { diffCatalog, type CatalogSku, type ChangeEvent } from './codec';

/**
 * The archive, over IndexedDB.
 *
 * Same responsibility as before — one shop's history, and the record of which
 * periods of it are held — but the mechanics are inverted by the storage engine
 * underneath.
 *
 * Under localStorage, a shop's history was one string per part. Storing a
 * newly-fetched window meant reading the whole part, parsing it, merging by row
 * id in memory, re-serialising the lot, and writing it back — with an eviction
 * loop around that in case the result no longer fit the origin's five megabytes.
 * The cost of storing one week grew with the size of the archive it was being
 * added to.
 *
 * Here, a window is a batch of keyed `put`s into the `records` store. Rows
 * outside the window are never read, never rewritten, and never even
 * deserialised. The cost of storing one week is the size of that week.
 *
 * ## What is a "shop" here
 *
 * Partitioning is by `(account, store_id)` as before, but it is now a *column*
 * rather than a key prefix, because IndexedDB can index a column and
 * localStorage could not search one. Two shops still never mix — the compound
 * index pins `store_id` as its leading component — but dropping one shop is now
 * a bounded delete rather than a walk over every key in the origin.
 *
 * ## Merging
 *
 * Rows are still merged, never appended blindly. The seller ledger hands back
 * the same order item as often as it is asked, and the settlement lag means an
 * already-covered window is deliberately re-read so provisional rows can be
 * corrected. The record id is deterministic in `(account, shop, entity, row id)`,
 * so a re-read is an overwrite in place — the merge that used to need a
 * read-modify-write cycle is now what `put` does by definition.
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
  entities: readonly EntityType[],
): Promise<Readonly<Record<string, SyncMetadataRecord>>> {
  return readShopMetadata(accountFingerprint(), shopId, entities);
}

/** The ledger's coverage, which is what every planning decision is made from. */
export async function ledgerCoverage(shopId: number): Promise<SyncMetadataRecord> {
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

/* ── reads ──────────────────────────────────────────────────────────────── */

const UNBOUNDED = {
  fromMs: Number.NEGATIVE_INFINITY,
  toMs: Number.POSITIVE_INFINITY,
} as const;

/**
 * Settled order items for a shop, optionally confined to a window.
 *
 * The window is not a filter applied after reading — it is the key range the
 * cursor opens on. Asking for March touches March's rows and nothing else,
 * which is the single behavioural difference that makes period queries cheap
 * enough to run on every range change.
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

export interface CatalogCapture {
  readonly at: number | null;
  readonly skus: readonly CatalogSku[];
}

export async function readCatalog(shopId: number): Promise<CatalogCapture> {
  const [rows, meta] = await Promise.all([
    readPeriod<CatalogSkuRecord>({
      storeId: shopId,
      entity: ENTITY_TYPES.catalogSku,
      ...UNBOUNDED,
    }),
    readMeta(shopId, ENTITY_TYPES.catalogSku),
  ]);

  return { at: meta.captured_at, skus: rows.map(recordToSku) };
}

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

/* ── writes ─────────────────────────────────────────────────────────────── */

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
 * Write rows, prune if the policy says to, then record the window as covered.
 *
 * The order is the one invariant that must never be relaxed. Coverage is
 * committed **after** the rows have landed, because a window marked covered but
 * never stored is a hole no future sync will look at again — the planner trusts
 * the coverage record absolutely, and it is right to.
 *
 * Pruning happens between the two, and when it clips the record the coverage is
 * clipped with it. That keeps "what is covered" and "what is stored" the same
 * statement rather than two claims that can drift apart.
 */
async function mergeEntity(options: {
  readonly shopId: number;
  readonly entity: EntityType;
  readonly rows: readonly (OrderItemRecord | ExpenseRecord | ChangeEventRecord | CatalogSkuRecord)[];
  readonly window: DateWindow | null;
  readonly at: number;
  readonly capturedAt?: number | undefined;
}): Promise<MergeOutcome> {
  const account = accountFingerprint();

  let outcome: WriteOutcome;
  try {
    outcome = await putRecords(options.rows);
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

  return {
    stored: true,
    added: outcome.added,
    updated: outcome.updated,
    rows,
    evicted,
  };
}

export async function mergeLedger(
  shopId: number,
  items: readonly FinanceOrderItem[],
  window: DateWindow | null,
): Promise<MergeOutcome> {
  const account = accountFingerprint();

  return mergeEntity({
    shopId,
    entity: ENTITY_TYPES.orderItem,
    rows: items.map((item) => orderToRecord(item, account, shopId)),
    window,
    at: Date.now(),
  });
}

export async function mergeExpenses(
  shopId: number,
  payments: readonly SellerPayment[],
  window: DateWindow | null,
): Promise<MergeOutcome> {
  const account = accountFingerprint();

  return mergeEntity({
    shopId,
    entity: ENTITY_TYPES.expense,
    rows: payments.map((payment) => expenseToRecord(payment, account, shopId)),
    window,
    at: Date.now(),
  });
}

/* ── catalogue and journal ──────────────────────────────────────────────── */

export interface CatalogOutcome {
  readonly stored: boolean;
  readonly skus: number;
  /** Changes this capture revealed against the previous one. */
  readonly events: readonly ChangeEvent[];
}

/**
 * Replace the shop's catalogue capture, and journal what moved.
 *
 * Deliberately *not* incremental. A price, a stock level and a status are
 * statements about right now: there is no window to fill in, and yesterday's
 * value is only interesting as the thing today's value differs from. So the
 * capture is replaced whole — and the difference, which is the only part worth
 * keeping, is appended to the journal.
 *
 * The first capture journals nothing. There is no "before" to compare against,
 * and emitting the entire catalogue as changes would make the journal useless
 * on the one day it is created.
 *
 * SKUs that have left the catalogue are deleted rather than left behind. The
 * old implementation got this for free by overwriting one blob; here it has to
 * be done deliberately, and not doing it would leave a discontinued SKU showing
 * its last known stock level forever.
 */
export async function commitCatalog(
  shopId: number,
  skus: readonly CatalogSku[],
  at: number,
): Promise<CatalogOutcome> {
  const account = accountFingerprint();

  const previous = await readCatalog(shopId);
  const events = previous.at === null ? [] : diffCatalog(previous.skus, skus, at);

  /* Drop the previous capture first: a SKU that is no longer in the catalogue
     has no row in the incoming set to overwrite it. */
  await deleteEntity(shopId, ENTITY_TYPES.catalogSku);

  const outcome = await mergeEntity({
    shopId,
    entity: ENTITY_TYPES.catalogSku,
    rows: skus.map((sku) => skuToRecord(sku, account, shopId, at)),
    window: null,
    at,
    capturedAt: at,
  });

  if (!outcome.stored) return { stored: false, skus: 0, events: [] };
  if (events.length > 0) await appendJournal(shopId, events);

  return { stored: true, skus: outcome.rows, events };
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

  const outcome = await mergeEntity({
    shopId,
    entity: ENTITY_TYPES.changeEvent,
    rows: events.map((event) => changeToRecord(event, account, shopId)),
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
 * Counted through the index, so this is four keyed counts rather than four
 * deserialisations — the old version had to read every stored string to measure
 * its length.
 */
export async function usage(shopId: number): Promise<ShopUsage> {
  const entities = Object.values(ENTITY_TYPES);
  const counts = await Promise.all(entities.map((entity) => countEntity(shopId, entity)));

  const rows = Object.fromEntries(
    entities.map((entity, index) => [entity, counts[index] ?? 0]),
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

/** A shop with no settled rows at all — what makes the next sync a backfill. */
export async function isEmpty(shopId: number): Promise<boolean> {
  const [ledger, catalog] = await Promise.all([
    readMeta(shopId, ENTITY_TYPES.orderItem),
    readMeta(shopId, ENTITY_TYPES.catalogSku),
  ]);

  return ledger.synced_ranges.length === 0 && catalog.captured_at === null;
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

export { ENTITY_TYPES };
export type { EntityType, SyncMetadataRecord };
