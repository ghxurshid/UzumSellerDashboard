import type { DateWindow } from '@/services/uzum/endpoints';

import { add, clip, missing, normalize, type Coverage } from '../archive/coverage';
import { deleteWhere, request, walk, withStore } from './db';
import {
  ALL_ENTITY_TYPES,
  INDEXES,
  METADATA_VERSION,
  STORES,
  WINDOWED_ENTITIES,
  metadataKey,
  type EntityType,
  type SyncMetadataRecord,
  type SyncedRange,
} from './schema';

/**
 * The `sync_metadata` store: what this machine has already pulled.
 *
 * This is the small record that makes the archive cheap. It answers one
 * question — *which stretches of time do I hold in full, for this shop and this
 * kind of row?* — and every decision about whether to make a request is taken
 * from it alone. Nothing scans the rows to work that out, so planning costs one
 * keyed read whether the shop holds a thousand rows or a million.
 *
 * It is the same idea a schema-migration runner uses: you do not inspect the
 * database to decide what to run, you read the table of what has already been
 * applied and run the complement. `synced_ranges` is that table.
 *
 * ## Two vocabularies, one boundary
 *
 * Persisted ranges are `{ start, end }`; the request layer talks in
 * `{ fromMs, toMs }`. The conversion happens here and only here, so the stored
 * shape does not have to change when the request layer's naming does — and so
 * the pure interval algebra in `archive/coverage.ts` can be reused unchanged.
 *
 * ## The invariant that must never break
 *
 * A range is recorded **only after the rows it covers have been written**. The
 * opposite order is the single unrecoverable bug available in this design: a
 * window marked covered but never stored is a hole no future sync will ever
 * look at again, because the planner trusts this record absolutely.
 */

/* ── conversion ─────────────────────────────────────────────────────────── */

export const toWindow = (range: SyncedRange): DateWindow => ({
  fromMs: range.start,
  toMs: range.end,
});

export const toRange = (window: DateWindow): SyncedRange => ({
  start: window.fromMs,
  end: window.toMs,
});

export const toCoverage = (ranges: readonly SyncedRange[]): Coverage => ranges.map(toWindow);

export const fromCoverage = (coverage: Coverage): readonly SyncedRange[] =>
  coverage.map(toRange);

/* ── defaults ───────────────────────────────────────────────────────────── */

export function emptyMetadata(
  account: string,
  storeId: number,
  entity: EntityType,
): SyncMetadataRecord {
  return {
    key: metadataKey(account, storeId, entity),
    account,
    store_id: storeId,
    entity_type: entity,
    synced_ranges: [],
    rows: 0,
    evicted_before: null,
    last_synced_at: null,
    captured_at: null,
    backfill_complete: false,
    backfill_from: null,
    version: METADATA_VERSION,
  };
}

/**
 * Repair whatever came back off disk.
 *
 * A record written by an older build, or half-written by an interrupted commit,
 * must not be trusted field by field. Anything unreadable resolves to "nothing
 * covered", which makes the next sync a full backfill — expensive, but the safe
 * direction. The opposite mistake, trusting a partial record, leaves permanent
 * holes.
 */
function sanitize(
  value: unknown,
  account: string,
  storeId: number,
  entity: EntityType,
): SyncMetadataRecord {
  const fallback = emptyMetadata(account, storeId, entity);
  if (typeof value !== 'object' || value === null) return fallback;

  const raw = value as Record<string, unknown>;
  if (raw['version'] !== METADATA_VERSION) return fallback;

  const ranges = Array.isArray(raw['synced_ranges'])
    ? (raw['synced_ranges'] as unknown[]).flatMap((entry): SyncedRange[] => {
        if (typeof entry !== 'object' || entry === null) return [];
        const range = entry as Record<string, unknown>;
        const start = range['start'];
        const end = range['end'];
        if (typeof start !== 'number' || !Number.isFinite(start)) return [];
        if (typeof end !== 'number' || !Number.isFinite(end)) return [];
        return [{ start, end }];
      })
    : [];

  const stamp = (key: string): number | null => {
    const candidate = raw[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
  };

  return {
    ...fallback,
    /* Normalising on read means every consumer can rely on the ranges being
       sorted, merged and hole-free without checking. */
    synced_ranges: fromCoverage(normalize(toCoverage(ranges))),
    rows: typeof raw['rows'] === 'number' ? raw['rows'] : 0,
    evicted_before: stamp('evicted_before'),
    last_synced_at: stamp('last_synced_at'),
    captured_at: stamp('captured_at'),
    backfill_complete: raw['backfill_complete'] === true,
    backfill_from: stamp('backfill_from'),
  };
}

/* ── reads ──────────────────────────────────────────────────────────────── */

/** One pair's record, or an empty one when nothing has been stored yet. */
export async function readMetadata(
  account: string,
  storeId: number,
  entity: EntityType,
): Promise<SyncMetadataRecord> {
  const stored = await withStore(STORES.syncMetadata, 'readonly', (store) =>
    request<unknown>(store.get(metadataKey(account, storeId, entity)) as IDBRequest<unknown>),
  );

  return sanitize(stored, account, storeId, entity);
}

/** Every pair recorded for one shop. */
export async function readShopMetadata(
  account: string,
  storeId: number,
  entities: readonly EntityType[],
): Promise<Readonly<Record<string, SyncMetadataRecord>>> {
  const entries = await withStore(STORES.syncMetadata, 'readonly', async (store) => {
    const collected: [string, unknown][] = [];
    for (const entity of entities) {
      const value = await request<unknown>(
        store.get(metadataKey(account, storeId, entity)) as IDBRequest<unknown>,
      );
      collected.push([entity, value]);
    }
    return collected;
  });

  return Object.fromEntries(
    entries.map(([entity, value]) => [
      entity,
      sanitize(value, account, storeId, entity as EntityType),
    ]),
  );
}

/** Shops this account has any metadata for — the partition index. */
export async function metadataStoreIds(account: string): Promise<readonly number[]> {
  const ids = new Set<number>();

  await withStore(STORES.syncMetadata, 'readonly', (store) =>
    walk<SyncMetadataRecord>(
      store.index(INDEXES.account),
      IDBKeyRange.only(account),
      'next',
      (row) => {
        ids.add(row.store_id);
      },
    ),
  );

  return [...ids].sort((a, b) => a - b);
}

/* ── the lazy-sync question ─────────────────────────────────────────────── */

export interface CoverageGap {
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * What of `window` is **not** held locally.
 *
 * The single function lazy sync is built on. An empty result means the request
 * can be served entirely from IndexedDB and no network call is made at all; a
 * non-empty one is exactly the list of periods to fetch, with everything already
 * held subtracted out. A period read last week therefore costs nothing forever,
 * and a period half held costs half a read.
 *
 * `unsealMs` re-opens the trailing edge of the record before the comparison.
 * Rows near the present are provisional — an order item is written `PROCESSING`
 * and becomes `TO_WITHDRAW` or `CANCELED` days later — so coverage younger than
 * the settlement lag is deliberately forgotten and re-read. Everything older is
 * settled history that no future request will ever ask about again.
 */
export function missingRanges(
  metadata: SyncMetadataRecord,
  window: DateWindow,
  options: { readonly now?: number; readonly unsealMs?: number } = {},
): readonly CoverageGap[] {
  const covered = toCoverage(metadata.synced_ranges);
  const unsealMs = options.unsealMs ?? 0;

  if (unsealMs <= 0) {
    return missing(window, covered).map((gap) => ({ fromMs: gap.fromMs, toMs: gap.toMs }));
  }

  const boundary = (options.now ?? Date.now()) - unsealMs;
  const sealed = covered.flatMap((range) => {
    if (range.toMs <= boundary) return [range];
    if (range.fromMs >= boundary) return [];
    return [{ fromMs: range.fromMs, toMs: boundary }];
  });

  return missing(window, normalize(sealed)).map((gap) => ({
    fromMs: gap.fromMs,
    toMs: gap.toMs,
  }));
}

/** Whether a window is held in full — the "serve locally" test. */
export function isCovered(
  metadata: SyncMetadataRecord,
  window: DateWindow,
  options: { readonly now?: number; readonly unsealMs?: number } = {},
): boolean {
  return missingRanges(metadata, window, options).length === 0;
}

/* ── writes ─────────────────────────────────────────────────────────────── */

/**
 * Apply a change to one pair's record, atomically.
 *
 * Read-modify-write inside a single transaction rather than around one: two
 * windows landing at the same moment would otherwise each read the record
 * before the other wrote it, and the second would erase the first's range. That
 * is precisely the race a lazy sync creates — several screens asking for
 * overlapping periods at once — so it has to be closed here rather than
 * avoided by convention.
 */
export async function patchMetadata(
  account: string,
  storeId: number,
  entity: EntityType,
  patch: (current: SyncMetadataRecord) => SyncMetadataRecord,
): Promise<SyncMetadataRecord> {
  return withStore(STORES.syncMetadata, 'readwrite', async (store) => {
    const key = metadataKey(account, storeId, entity);
    const stored = await request<unknown>(store.get(key) as IDBRequest<unknown>);
    const current = sanitize(stored, account, storeId, entity);

    const next: SyncMetadataRecord = {
      ...patch(current),
      /* Identity and version are this module's to set, never the caller's. */
      key,
      account,
      store_id: storeId,
      entity_type: entity,
      version: METADATA_VERSION,
    };

    store.put(next);
    return next;
  });
}

export interface CoverageCommit {
  /** The window whose rows have just been written. Null for a non-periodic write. */
  readonly window: DateWindow | null;
  /** Rows the pair now holds, counted from the store. */
  readonly rows: number;
  readonly at: number;
  /** Set when the write was a whole-capture replacement, not a period fill. */
  readonly capturedAt?: number | undefined;
}

/**
 * Record that a window is now held.
 *
 * Called **after** the rows have landed, never before — see the invariant in
 * this module's header. The range is merged into the existing record rather
 * than appended, so overlapping fetches collapse into one contiguous claim and
 * the planner never re-requests a seam.
 */
export function commitCoverage(
  account: string,
  storeId: number,
  entity: EntityType,
  commit: CoverageCommit,
): Promise<SyncMetadataRecord> {
  return patchMetadata(account, storeId, entity, (current) => {
    const covered =
      commit.window === null
        ? normalize(toCoverage(current.synced_ranges))
        : add(toCoverage(current.synced_ranges), commit.window);

    return {
      ...current,
      synced_ranges: fromCoverage(covered),
      rows: commit.rows,
      last_synced_at: commit.at,
      captured_at: commit.capturedAt ?? current.captured_at,
    };
  });
}

/**
 * Record that retention has pruned everything before an instant.
 *
 * Clipping the coverage to match is what keeps "what is covered" and "what is
 * stored" the same statement. Without it the record would keep claiming a
 * period whose rows were deleted, and no sync would ever refetch them.
 */
export function commitEviction(
  account: string,
  storeId: number,
  entity: EntityType,
  earliest: number,
  rows: number,
): Promise<SyncMetadataRecord> {
  return patchMetadata(account, storeId, entity, (current) => ({
    ...current,
    synced_ranges: fromCoverage(clip(toCoverage(current.synced_ranges), earliest)),
    evicted_before: earliest,
    rows,
  }));
}

/** Record how far the backwards walk has reached. */
export function commitBackfill(
  account: string,
  storeId: number,
  entity: EntityType,
  progress: { readonly from: number | null; readonly complete: boolean },
): Promise<SyncMetadataRecord> {
  return patchMetadata(account, storeId, entity, (current) => ({
    ...current,
    /* The frontier only ever moves backwards. It marks how far the walk has
       reached, so a later run reporting a newer instant — because its steps
       were all recent ones, or because the backfill emitted nothing this time —
       must not drag it forward and re-walk ground already covered. */
    backfill_from:
      progress.from === null
        ? current.backfill_from
        : Math.min(progress.from, current.backfill_from ?? progress.from),
    backfill_complete: progress.complete,
  }));
}

/* ── deletion ───────────────────────────────────────────────────────────── */

export function deleteShopMetadata(account: string, storeId: number): Promise<number> {
  return withStore(STORES.syncMetadata, 'readwrite', (store) => {
    for (const entity of ALL_ENTITY_TYPES) {
      store.delete(metadataKey(account, storeId, entity));
    }
    return ALL_ENTITY_TYPES.length;
  });
}

export function deleteAccountMetadata(account: string): Promise<number> {
  return withStore(STORES.syncMetadata, 'readwrite', (store) =>
    deleteWhere(store.index(INDEXES.account), IDBKeyRange.only(account)),
  );
}

export function clearMetadata(): Promise<void> {
  return withStore(STORES.syncMetadata, 'readwrite', (store) => {
    store.clear();
  });
}

export { WINDOWED_ENTITIES };
