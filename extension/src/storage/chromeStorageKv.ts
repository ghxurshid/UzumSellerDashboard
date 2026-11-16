/**
 * The extension's key/value backend, on `chrome.storage.local`.
 *
 * Why this store: it is not partitioned by the embedding site (the panel is an
 * extension page inside an iframe on seller.uzum.uz, where IndexedDB and
 * localStorage would be keyed to the extension and the top-level site) and it
 * is shared by every panel instance, so settings, provider keys and the usage
 * ledger survive tabs and restarts.
 *
 * ## Namespace
 *
 * Chrome and Edge expose `chrome.storage`; Firefox exposes the promise-based
 * API as `browser.storage` and does not promise to promisify `chrome.*` in
 * every release. The area is therefore resolved on every call, `browser`
 * first, never cached at import time: a module that captured it early would
 * pin whatever existed then, and tests could not swap it.
 *
 * ## Failure
 *
 * Every path is `async`, so a missing API (panel HTML opened from a dev server)
 * is a rejected promise, never a synchronous throw. The settings service reads
 * a rejection as "degrade to an in-memory session".
 *
 * ## Keys
 *
 * Core slots are stored as `savdo.kv.<key>`. The panel keeps its own state in
 * the same area; the prefix keeps the two apart. The core key strings
 * themselves are unchanged.
 */

import type { CoreKvKey, KvBackend } from '@core/storage/kv';

export const KV_STORAGE_PREFIX = 'savdo.kv.';

/** The slice of a storage area this module uses; both namespaces satisfy it. */
export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ChangeLike {
  newValue?: unknown;
}
export type ChangeListener = (changes: Record<string, ChangeLike>, areaName: string) => void;

export interface StorageNamespaceLike {
  local?: StorageAreaLike;
  onChanged?: {
    addListener(cb: ChangeListener): void;
    removeListener(cb: ChangeListener): void;
  };
}
interface ExtensionGlobals {
  browser?: { storage?: StorageNamespaceLike };
  chrome?: { storage?: StorageNamespaceLike };
}

/** `browser.storage` when present (Firefox), otherwise `chrome.storage`. */
export function storageNamespace(): StorageNamespaceLike | null {
  const g = globalThis as unknown as ExtensionGlobals;
  if (g.browser?.storage?.local) return g.browser.storage;
  if (g.chrome?.storage?.local) return g.chrome.storage;
  return null;
}

function area(): StorageAreaLike {
  const local = storageNamespace()?.local;
  if (!local) throw new Error('chrome.storage.local is not available in this context');
  return local;
}

export function storageKey(key: string): string {
  return KV_STORAGE_PREFIX + key;
}

// `area()` throws inside an async function, so absence is always a rejection.
export const chromeStorageKvBackend: KvBackend = {
  async read<T>(key: string): Promise<T | null> {
    const full = storageKey(key);
    const items = await area().get(full);
    const value = items?.[full];
    return value === undefined ? null : (value as T);
  },
  async write(key: string, value: unknown): Promise<void> {
    await area().set({ [storageKey(key)]: value });
  },
  async remove(key: string): Promise<void> {
    await area().remove(storageKey(key));
  },
};

/**
 * Signals that a core slot changed in `chrome.storage.local`.
 *
 * `storage.onChanged` fires in EVERY context, the one that made the write
 * included, so this reports this context's own writes too. Treat it as a
 * signal to re-read, never as a value to adopt: `value` (the new value, or
 * `null` when the slot was removed) is passed for diagnostics only and may
 * already be stale by the time it is handled. The safe wiring is
 * `refreshSettings()`, which re-reads storage and ignores an echo of a local
 * write. Filtering own writes out here would need a per-write token that
 * survives the storage round-trip, and a missed filter would silently drop
 * another tab's change; an idempotent re-read cannot do that. Returns an
 * unsubscribe function; with no storage API it returns a no-op rather than
 * throwing, since there is nothing to hear from.
 */
export function onKvChanged(listener: (key: CoreKvKey, value: unknown) => void): () => void {
  const events = storageNamespace()?.onChanged;
  if (!events) return () => undefined;
  const handler: ChangeListener = (changes, areaName) => {
    if (areaName !== 'local') return;
    for (const [full, change] of Object.entries(changes)) {
      if (!full.startsWith(KV_STORAGE_PREFIX)) continue;
      listener(full.slice(KV_STORAGE_PREFIX.length) as CoreKvKey, change.newValue ?? null);
    }
  };
  events.addListener(handler);
  return () => events.removeListener(handler);
}
