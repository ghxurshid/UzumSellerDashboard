import { deleteWhere, request, withStore } from './db';
import { STORES, type KvKey, type KvRecord } from './schema';

/**
 * The key/value store, for the things that are one value rather than a series.
 *
 * Settings, the notification log and the sync log are not time-series and never
 * will be: each is a single document, read once at startup and rewritten whole.
 * Putting them in `records` would mean a store whose rows have no timestamp
 * worth indexing, sitting alongside rows whose timestamp is the point.
 *
 * Values go in as structured clones rather than JSON strings, which is a real
 * difference from the localStorage tier this replaces: no `JSON.parse` on the
 * way out, no escaping, and `undefined`-free round-tripping of numbers that
 * `JSON` would have to stringify. Callers still validate what comes back —
 * stored data is only ever as trustworthy as the build that wrote it — but they
 * validate an object rather than parse a string first.
 */

export async function readKv<T>(key: KvKey): Promise<T | null> {
  const record = await withStore(STORES.kv, 'readonly', (store) =>
    request<KvRecord | undefined>(store.get(key) as IDBRequest<KvRecord | undefined>),
  );

  return record === undefined ? null : (record.value as T);
}

export async function writeKv(key: KvKey, value: unknown): Promise<void> {
  const record: KvRecord = { key, value, at: Date.now() };
  await withStore(STORES.kv, 'readwrite', (store) => {
    store.put(record);
  });
}

export async function removeKv(key: KvKey): Promise<void> {
  await withStore(STORES.kv, 'readwrite', (store) => {
    store.delete(key);
  });
}

/** When a slot was last written — what "settings saved at" reads. */
export async function kvStamp(key: KvKey): Promise<number | null> {
  const record = await withStore(STORES.kv, 'readonly', (store) =>
    request<KvRecord | undefined>(store.get(key) as IDBRequest<KvRecord | undefined>),
  );

  return record?.at ?? null;
}

export function clearKv(): Promise<number> {
  return withStore(STORES.kv, 'readwrite', (store) => deleteWhere(store, null));
}
