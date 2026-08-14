import { deleteWhere, request, walk, withStore } from './db';
import {
  ENTITY_TYPES,
  INDEXES,
  STORES,
  type EntityType,
  type StoredRecord,
} from './schema';

/**
 * Every read and write of the time-series store.
 *
 * The one rule this module exists to enforce: **a period query never scans.**
 * Each read below is bounded on `store_entity_date` — the compound index
 * `['store_id', 'entity_type', 'timestamp']` — so the cursor opens directly on
 * the first row of the requested window and stops at the last. A shop holding
 * two years of history answers a question about last Tuesday by touching the
 * rows of last Tuesday, and the cost of the query is the size of the answer
 * rather than the size of the archive.
 *
 * That is what `IDBKeyRange.bound()` buys, and why the index is ordered
 * `(store, entity, time)` rather than any other permutation: the components a
 * query fixes exactly come first, and the one it asks a range over comes last.
 * Reversing the last two would make every period query a filtered scan of the
 * shop's entire history.
 */

/* ── ranges ─────────────────────────────────────────────────────────────── */

/**
 * The key range for one shop's rows, of one kind, inside one period.
 *
 * Inclusive at both ends, which matches how the rest of the application talks
 * about windows (`fromMs`/`toMs` are both "in the period"). The trailing
 * component of a compound key is what the bound actually varies; the first two
 * are pinned to the same value in both keys, which is what confines the cursor
 * to a single contiguous run.
 */
export function periodRange(
  storeId: number,
  entity: EntityType,
  fromMs: number,
  toMs: number,
): IDBKeyRange {
  return IDBKeyRange.bound([storeId, entity, fromMs], [storeId, entity, toMs]);
}

/**
 * Everything of one kind a shop holds, at any time.
 *
 * `-Infinity`/`Infinity` are legal IndexedDB number keys, so this stays on the
 * same index as a period query instead of needing a second one.
 */
export function entityRange(storeId: number, entity: EntityType): IDBKeyRange {
  return periodRange(storeId, entity, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export interface PeriodQuery {
  readonly storeId: number;
  readonly entity: EntityType;
  readonly fromMs: number;
  readonly toMs: number;
  /** Stop after this many rows. Applied at the cursor, not afterwards. */
  readonly limit?: number | undefined;
  /** `next` is oldest-first (the default); `prev` reads newest-first. */
  readonly direction?: IDBCursorDirection | undefined;
}

/**
 * Rows for one shop, one kind, one period — in timestamp order.
 *
 * Returned as an array because the callers that need every row (a chart series,
 * an AI window) are going to hold them all anyway. Callers that only need a
 * summary should use `reduceRecords` or the aggregation worker instead, and
 * never materialise the array at all.
 */
export async function readPeriod<T extends StoredRecord>(query: PeriodQuery): Promise<T[]> {
  const rows: T[] = [];
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  await withStore(STORES.records, 'readonly', (store) =>
    walk<T>(
      store.index(INDEXES.storeEntityDate),
      periodRange(query.storeId, query.entity, query.fromMs, query.toMs),
      query.direction ?? 'next',
      (row) => {
        rows.push(row);
        return rows.length < limit;
      },
    ),
  );

  return rows;
}

/**
 * The same window across several shops, merged into one ascending series.
 *
 * Each shop is a separate bounded read — the index cannot span shops in one
 * range, since `store_id` is its leading component — and the results are merged
 * afterwards. That is still far cheaper than the alternative of ranging on the
 * `timestamp` index and discarding every row belonging to a shop out of scope.
 */
export async function readPeriodAcross<T extends StoredRecord>(
  storeIds: readonly number[],
  entity: EntityType,
  fromMs: number,
  toMs: number,
): Promise<T[]> {
  if (storeIds.length === 0) return [];

  if (storeIds.length === 1) {
    const only = storeIds[0];
    if (only === undefined) return [];
    return readPeriod<T>({ storeId: only, entity, fromMs, toMs });
  }

  const rows: T[] = [];

  /* One transaction for all of them: opening a transaction per shop would pay
     the setup cost six times over for a consolidated view. */
  await withStore(STORES.records, 'readonly', async (store) => {
    const index = store.index(INDEXES.storeEntityDate);
    for (const storeId of storeIds) {
      await walk<T>(index, periodRange(storeId, entity, fromMs, toMs), 'next', (row) => {
        rows.push(row);
      });
    }
  });

  return rows.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fold a period without materialising it.
 *
 * This is the read every chart and every AI summary should use. The rows never
 * exist as an array — each is handed to `step` as the cursor passes it and is
 * then free to be collected — so summarising a year of history costs a fixed
 * amount of memory rather than one object per row.
 */
export async function reduceRecords<T extends StoredRecord, A>(
  query: PeriodQuery,
  seed: A,
  step: (accumulator: A, row: T) => A,
): Promise<A> {
  let accumulator = seed;

  await withStore(STORES.records, 'readonly', (store) =>
    walk<T>(
      store.index(INDEXES.storeEntityDate),
      periodRange(query.storeId, query.entity, query.fromMs, query.toMs),
      query.direction ?? 'next',
      (row) => {
        accumulator = step(accumulator, row);
      },
    ),
  );

  return accumulator;
}

/** How many rows a shop holds of one kind, without reading any of them. */
export function countEntity(storeId: number, entity: EntityType): Promise<number> {
  return withStore(STORES.records, 'readonly', (store) =>
    request(store.index(INDEXES.storeEntityDate).count(entityRange(storeId, entity))),
  );
}

/** Rows inside a window, counted by the index rather than read. */
export function countPeriod(
  storeId: number,
  entity: EntityType,
  fromMs: number,
  toMs: number,
): Promise<number> {
  return withStore(STORES.records, 'readonly', (store) =>
    request(store.index(INDEXES.storeEntityDate).count(periodRange(storeId, entity, fromMs, toMs))),
  );
}

export interface EntityBounds {
  readonly oldest: number | null;
  readonly newest: number | null;
  readonly rows: number;
}

/**
 * The oldest and newest timestamps a shop holds of one kind.
 *
 * Two single-step cursor reads — one from each end of the range — rather than a
 * scan. This is what tells the retention policy where to start pruning and what
 * the coverage read-out draws as the outer bounds of the record.
 */
export async function entityBounds(storeId: number, entity: EntityType): Promise<EntityBounds> {
  return withStore(STORES.records, 'readonly', async (store) => {
    const index = store.index(INDEXES.storeEntityDate);
    const range = entityRange(storeId, entity);

    let oldest: number | null = null;
    let newest: number | null = null;

    await walk<StoredRecord>(index, range, 'next', (row) => {
      oldest = row.timestamp;
      return false;
    });
    await walk<StoredRecord>(index, range, 'prev', (row) => {
      newest = row.timestamp;
      return false;
    });

    const rows = await request(index.count(range));
    return { oldest, newest, rows };
  });
}

/** Every shop id that holds at least one record for this account. */
export async function storeIdsFor(account: string): Promise<readonly number[]> {
  const ids = new Set<number>();

  await withStore(STORES.records, 'readonly', (store) =>
    walk<StoredRecord>(store.index(INDEXES.account), IDBKeyRange.only(account), 'next', (row) => {
      ids.add(row.store_id);
    }),
  );

  return [...ids].sort((a, b) => a - b);
}

/* ── writes ─────────────────────────────────────────────────────────────── */

export interface WriteOutcome {
  /** Rows the store did not previously hold. */
  readonly added: number;
  /** Rows it held whose values this write changed — settlement catching up. */
  readonly updated: number;
  /** Rows it held that were already identical, and were left alone. */
  readonly unchanged: number;
}

const EMPTY_OUTCOME: WriteOutcome = { added: 0, updated: 0, unchanged: 0 };

/**
 * How many reads are issued before their results are collected.
 *
 * The batch exists to keep IndexedDB's request queue busy without building a
 * hundred thousand pending promises for a large backfill window.
 */
const PROBE_BATCH = 500;

/**
 * Upsert a batch of records, reporting what actually changed.
 *
 * All of it in one transaction, which is the whole reason this migration is
 * worth doing: the localStorage archive had to read a shop's entire history,
 * merge in memory, re-serialise and write it back on every window fetched.
 * Here a window is a batch of `put`s against a keyed store, and rows outside it
 * are never touched.
 *
 * The added/updated/unchanged split is not bookkeeping for its own sake — the
 * sync log reports it, and "updated" is the visible evidence that the settlement
 * lag is doing its job, since it counts rows whose status or profit moved after
 * they were first stored.
 *
 * ## Why the reads are batched rather than sequential
 *
 * Knowing whether a row is new requires reading what is there. Awaiting each
 * read before issuing the next would serialise a five-thousand-row window into
 * five thousand round trips through the request queue — correct, and needlessly
 * slow. Issuing a batch of reads and then collecting them lets IndexedDB service
 * them together, and every request in the batch is created in the same turn, so
 * the transaction stays open across the collection.
 */
export async function putRecords(rows: readonly StoredRecord[]): Promise<WriteOutcome> {
  if (rows.length === 0) return EMPTY_OUTCOME;

  return withStore(STORES.records, 'readwrite', async (store) => {
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    for (let offset = 0; offset < rows.length; offset += PROBE_BATCH) {
      const batch = rows.slice(offset, offset + PROBE_BATCH);

      /* Every `get` is issued before the first is awaited — that is what makes
         this a batch rather than a queue. */
      const probes = batch.map((row) =>
        request<StoredRecord | undefined>(
          store.get(row.id) as IDBRequest<StoredRecord | undefined>,
        ),
      );
      const existing = await Promise.all(probes);

      for (const [index, row] of batch.entries()) {
        const previous = existing[index];

        if (previous === undefined) {
          added += 1;
        } else if (sameRecord(previous, row)) {
          /* Identical rows are still written: skipping the `put` would save a
             little work, but the re-read exists precisely because a row *might*
             have changed, and a comparison that is wrong in either direction is
             more expensive than the write it avoided. */
          unchanged += 1;
        } else {
          updated += 1;
        }

        store.put(row);
      }
    }

    return { added, updated, unchanged };
  });
}

/**
 * Whether two records state the same thing.
 *
 * A shallow compare over the union of both key sets. Every column is a
 * primitive — that is what "flat" means here — so shallow *is* deep, and this
 * avoids the trap the packed archive had to work around, where two identical
 * rows compared unequal because their keys were in a different order.
 */
function sameRecord(a: StoredRecord, b: StoredRecord): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

/* ── deletion ───────────────────────────────────────────────────────────── */

/** Drop every record of one kind for one shop — how a capture is replaced. */
export function deleteEntity(storeId: number, entity: EntityType): Promise<number> {
  return withStore(STORES.records, 'readwrite', (store) =>
    deleteWhere(store.index(INDEXES.storeEntityDate), entityRange(storeId, entity)),
  );
}

/** Drop one kind's rows older than an instant — what retention enforces. */
export function deleteBefore(
  storeId: number,
  entity: EntityType,
  earliest: number,
): Promise<number> {
  return withStore(STORES.records, 'readwrite', (store) =>
    deleteWhere(
      store.index(INDEXES.storeEntityDate),
      periodRange(storeId, entity, Number.NEGATIVE_INFINITY, earliest - 1),
    ),
  );
}

/**
 * Prune a kind down to its newest `keep` rows.
 *
 * Reads the timestamp of the `keep`-th newest row by walking backwards, then
 * deletes everything below it in one bounded range. Two index operations rather
 * than a scan, whatever the archive holds.
 */
export async function trimToNewest(
  storeId: number,
  entity: EntityType,
  keep: number,
): Promise<number> {
  const total = await countEntity(storeId, entity);
  if (total <= keep) return 0;

  let boundary: number | null = null;
  let seen = 0;

  await withStore(STORES.records, 'readonly', (store) =>
    walk<StoredRecord>(
      store.index(INDEXES.storeEntityDate),
      entityRange(storeId, entity),
      'prev',
      (row) => {
        seen += 1;
        if (seen < keep) return true;
        boundary = row.timestamp;
        return false;
      },
    ),
  );

  if (boundary === null) return 0;
  return deleteBefore(storeId, entity, boundary);
}

/** Drop everything one shop holds, of every kind. */
export function deleteStore(storeId: number): Promise<number> {
  return withStore(STORES.records, 'readwrite', (store) =>
    deleteWhere(store.index(INDEXES.storeId), IDBKeyRange.only(storeId)),
  );
}

/** Drop everything one account holds — what a token change costs. */
export function deleteAccount(account: string): Promise<number> {
  return withStore(STORES.records, 'readwrite', (store) =>
    deleteWhere(store.index(INDEXES.account), IDBKeyRange.only(account)),
  );
}

/** Empty the store completely. */
export function clearRecords(): Promise<void> {
  return withStore(STORES.records, 'readwrite', (store) => {
    store.clear();
  });
}

export { ENTITY_TYPES };
