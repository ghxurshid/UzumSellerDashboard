import {
  ALL_ENTITY_TYPES,
  DB_NAME,
  DB_VERSION,
  ENTITIES,
  INDEXES,
  STORES,
} from './schema';

/** Any object store in the database — entity stores included. */
export type StoreName = string;

/**
 * The connection, and the promise wrappers everything above it uses.
 *
 * IndexedDB's own API is event-based, older than promises, and unforgiving
 * about transaction lifetimes — a transaction closes the moment its microtask
 * queue drains, so a single stray `await` between two operations aborts it. The
 * rest of this layer never touches `IDBRequest` directly; it asks for a store
 * and gets a promise, and the rules about staying inside a transaction are
 * enforced here rather than remembered at forty call sites.
 *
 * Two properties matter to callers:
 *
 *   • **Opening is idempotent and shared.** One connection per tab, opened
 *     lazily on first use and reused; concurrent openers await the same promise
 *     rather than racing two `open()` calls through the same upgrade.
 *
 *   • **Failure degrades, it does not throw upward.** A browser in private mode,
 *     with storage disabled, or mid-`versionchange` can refuse to open the
 *     database at all. `withStore` answers such callers with a rejected promise
 *     they can handle, and `isAvailable()` lets the UI say so plainly — the same
 *     contract the old localStorage module offered, for the same reason: a
 *     storage-less browser should degrade to an in-memory session, not a blank
 *     screen.
 */

type Mode = 'readonly' | 'readwrite';

let connection: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;

/** Set once the environment has proved it cannot provide IndexedDB. */
let unavailable = false;

export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('IndexedDB is not available in this browser session');
    this.name = 'StorageUnavailableError';
    this.cause = cause;
  }
}

function indexedDbFactory(): IDBFactory | null {
  try {
    if (typeof indexedDB === 'undefined') return null;
    return indexedDB;
  } catch {
    /* Property access itself throws in some locked-down profiles. */
    return null;
  }
}

/* ── schema creation ────────────────────────────────────────────────────── */

/**
 * Build the schema for a fresh database, or bring an old one forward.
 *
 * Each version's changes go in its own block, guarded by the version the
 * database is coming *from*, so a browser two versions behind arrives at the
 * current shape by running both steps in order.
 */
function upgrade(db: IDBDatabase, fromVersion: number): void {
  /**
   * v2 replaced the single `records` store with one store per entity.
   *
   * Everything from before is dropped rather than reshaped. Every row the
   * archive holds can be fetched again, and the coverage record makes the
   * refetch incremental — so starting clean costs a backfill that the sync
   * engine already knows how to pace, while a migration that mis-maps a column
   * would leave wrong numbers on screen with nothing to detect it.
   */
  if (fromVersion < 2) {
    for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);

    /**
     * One store per entity, each with the same four indexes.
     *
     * `store_date` is the one the design rests on: compound keys sort component
     * by component, so bounding it between `[shop, from]` and `[shop, to]`
     * yields exactly one shop's rows inside one period — already in timestamp
     * order, with nothing to filter afterwards.
     */
    for (const entity of ALL_ENTITY_TYPES) {
      const definition = ENTITIES[entity];
      const store = db.createObjectStore(definition.store, { keyPath: 'id' });

      store.createIndex(INDEXES.storeDate, ['store_id', 'timestamp'], { unique: false });

      /* Cross-shop reads over a period — the consolidated "all stores" view. */
      store.createIndex(INDEXES.timestamp, 'timestamp', { unique: false });

      /* Everything one shop holds, for per-shop counts and deletion. */
      store.createIndex(INDEXES.storeId, 'store_id', { unique: false });

      /* Housekeeping only: dropping one account's rows when the token changes. */
      store.createIndex(INDEXES.account, 'account', { unique: false });

      /* Lookups only this entity needs — `sku_id`, `order_id` and the like. */
      for (const index of definition.indexes ?? []) {
        store.createIndex(index.name, index.keyPath, { unique: false });
      }
    }

    const metadata = db.createObjectStore(STORES.syncMetadata, { keyPath: 'key' });
    metadata.createIndex(INDEXES.account, 'account', { unique: false });
    metadata.createIndex(INDEXES.storeId, 'store_id', { unique: false });

    db.createObjectStore(STORES.kv, { keyPath: 'key' });
  }

  /**
   * v3 removes the `buffer` store.
   *
   * It held packed payloads keyed by source and selection — a second copy of
   * what the entity stores already keep in normalised form. Screens now read
   * the tables, so the copy is not stale data waiting to be refreshed; it is
   * data with no reader. Dropping the store is the whole migration: nothing
   * referenced it that is not being deleted in the same change.
   *
   * Guarded on presence as well as version, because a v2 database created
   * before this release has the store and one created after it does not.
   */
  if (fromVersion >= 2 && db.objectStoreNames.contains('buffer')) {
    db.deleteObjectStore('buffer');
  }
}

/* ── opening ────────────────────────────────────────────────────────────── */

function open(): Promise<IDBDatabase> {
  const factory = indexedDbFactory();
  if (factory === null) {
    unavailable = true;
    return Promise.reject(new StorageUnavailableError());
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      unavailable = true;
      reject(new StorageUnavailableError(error));
      return;
    }

    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion);
    };

    request.onsuccess = () => {
      const db = request.result;

      /**
       * Another tab wants a newer schema than this one can speak.
       *
       * Holding the connection open would block that tab's upgrade forever, so
       * this one steps aside: close, forget the handle, and let the next call
       * re-open against whatever version won. Anything in flight fails, which
       * is correct — it was written against a schema that no longer exists.
       */
      db.onversionchange = () => {
        db.close();
        connection = null;
        opening = null;
      };

      /* A connection can be closed by the browser reclaiming storage. Drop the
         handle so the next call opens a fresh one instead of using a dead one. */
      db.onclose = () => {
        connection = null;
        opening = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      unavailable = true;
      reject(new StorageUnavailableError(request.error));
    };

    /**
     * Blocked by an older tab that has not released its connection.
     *
     * Not fatal and not resolved here — the other tab's `versionchange` handler
     * closes it, at which point `onsuccess` fires. Left to hang deliberately
     * rather than rejecting, since rejecting would fail a write that is about
     * to become possible.
     */
    request.onblocked = () => {
      /* no-op: waiting for the other connection to close */
    };
  });
}

/** The shared connection, opening it if this is the first call. */
export function database(): Promise<IDBDatabase> {
  if (connection !== null) return Promise.resolve(connection);
  if (opening !== null) return opening;

  opening = open()
    .then((db) => {
      connection = db;
      return db;
    })
    .catch((error: unknown) => {
      opening = null;
      throw error;
    });

  return opening;
}

/** Whether storage has already proved unusable — the UI says so plainly. */
export function isUnavailable(): boolean {
  return unavailable;
}

/**
 * Prove the database can be opened, without throwing.
 *
 * Called once at startup so the application knows before its first render
 * whether it is running with persistence or in an in-memory session.
 */
export async function isAvailable(): Promise<boolean> {
  try {
    await database();
    return true;
  } catch {
    return false;
  }
}

/* ── request and transaction helpers ────────────────────────────────────── */

/** One `IDBRequest` as a promise. */
export function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    source.onsuccess = () => {
      resolve(source.result);
    };
    source.onerror = () => {
      reject(source.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/**
 * Run `work` inside one transaction over one store.
 *
 * The promise settles on the *transaction*, not on the last request: a `put`
 * can succeed and the transaction still abort afterwards on a quota error, and
 * a caller that resolved early would believe a write landed that did not.
 *
 * `work` must not await anything outside the transaction. IndexedDB commits a
 * transaction as soon as its request queue empties, so an unrelated `await` in
 * the middle silently closes it — which is why this helper hands the store to a
 * synchronous callback and collects the result rather than letting callers hold
 * a store handle across arbitrary code.
 */
export async function withStore<T>(
  name: StoreName,
  mode: Mode,
  work: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await database();

  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(name, mode);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled: T;
    let failed: unknown = null;

    transaction.oncomplete = () => {
      resolve(settled);
    };
    transaction.onerror = () => {
      reject(failed ?? transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(failed ?? transaction.error ?? new Error('IndexedDB transaction aborted'));
    };

    void Promise.resolve(work(transaction.objectStore(name)))
      .then((result) => {
        settled = result;
      })
      .catch((error: unknown) => {
        failed = error;
        try {
          transaction.abort();
        } catch {
          /* Already finished; `onerror` has the failure. */
        }
      });
  });
}

/** The same, across several stores that must commit or fail together. */
export async function withStores<T>(
  names: readonly StoreName[],
  mode: Mode,
  work: (stores: Readonly<Record<string, IDBObjectStore>>) => Promise<T> | T,
): Promise<T> {
  const db = await database();

  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction([...names], mode);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled: T;
    let failed: unknown = null;

    transaction.oncomplete = () => {
      resolve(settled);
    };
    transaction.onerror = () => {
      reject(failed ?? transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(failed ?? transaction.error ?? new Error('IndexedDB transaction aborted'));
    };

    const stores = Object.fromEntries(
      names.map((name) => [name, transaction.objectStore(name)]),
    );

    void Promise.resolve(work(stores))
      .then((result) => {
        settled = result;
      })
      .catch((error: unknown) => {
        failed = error;
        try {
          transaction.abort();
        } catch {
          /* Already finished. */
        }
      });
  });
}

/**
 * Walk a cursor, handing each value to `visit`.
 *
 * The one read primitive that does not materialise the whole result set, which
 * is what makes it safe over a range holding hundreds of thousands of rows.
 * Returning `false` from `visit` stops the walk — how `limit` and "first match"
 * queries avoid reading the rest of the range.
 */
export function walk<T>(
  source: IDBIndex | IDBObjectStore,
  query: IDBKeyRange | null,
  direction: IDBCursorDirection,
  visit: (value: T) => boolean | void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cursorRequest = source.openCursor(query, direction);

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor === null) {
        resolve();
        return;
      }

      if (visit(cursor.value as T) === false) {
        resolve();
        return;
      }

      cursor.continue();
    };

    cursorRequest.onerror = () => {
      reject(cursorRequest.error ?? new Error('IndexedDB cursor failed'));
    };
  });
}

/** Delete every value a cursor visits. Used by the per-shop and account wipes. */
export function deleteWhere(
  source: IDBIndex | IDBObjectStore,
  query: IDBKeyRange | null,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const cursorRequest = source.openCursor(query);
    let removed = 0;

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor === null) {
        resolve(removed);
        return;
      }

      cursor.delete();
      removed += 1;
      cursor.continue();
    };

    cursorRequest.onerror = () => {
      reject(cursorRequest.error ?? new Error('IndexedDB delete cursor failed'));
    };
  });
}

/* ── quota ──────────────────────────────────────────────────────────────── */

export interface StorageEstimate {
  /** Bytes the origin is using, or null when the browser will not say. */
  readonly usage: number | null;
  /** Bytes the origin may use. */
  readonly quota: number | null;
  /** Share of the quota in use, 0–1, or null when unknowable. */
  readonly saturation: number | null;
  /** Whether the browser has promised not to evict this origin under pressure. */
  readonly persisted: boolean;
}

/**
 * What the browser says about this origin's storage.
 *
 * Replaces the character-counting the localStorage tiers had to do. There, the
 * ceiling was a fixed ~5 MB that could only be discovered by a write that threw,
 * so the application budgeted against a guess. Here the browser answers
 * directly, and the figure shown in Settings is the real one.
 */
export async function estimateStorage(): Promise<StorageEstimate> {
  const empty: StorageEstimate = { usage: null, quota: null, saturation: null, persisted: false };

  try {
    if (typeof navigator === 'undefined' || navigator.storage === undefined) return empty;

    const persisted =
      typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted() : false;

    if (typeof navigator.storage.estimate !== 'function') return { ...empty, persisted };

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? null;
    const quota = estimate.quota ?? null;

    return {
      usage,
      quota,
      saturation: usage !== null && quota !== null && quota > 0 ? Math.min(1, usage / quota) : null,
      persisted,
    };
  } catch {
    return empty;
  }
}

/**
 * Ask the browser not to evict this origin under storage pressure.
 *
 * Worth asking for once: the archive is expensive to rebuild — a full backfill
 * is hundreds of rate-limited requests — and without the grant a browser
 * reclaiming space may drop it silently. A refusal is not an error; the app
 * works either way and Settings reports which it got.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.storage === undefined) return false;
    if (typeof navigator.storage.persist !== 'function') return false;
    if (typeof navigator.storage.persisted === 'function' && (await navigator.storage.persisted())) {
      return true;
    }
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/* ── teardown ───────────────────────────────────────────────────────────── */

/** Close the connection. Used by tests and by the "delete everything" path. */
export function closeDatabase(): void {
  connection?.close();
  connection = null;
  opening = null;
}
