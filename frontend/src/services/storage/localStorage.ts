/**
 * The only module in the app that touches `window.localStorage`.
 *
 * ⚠️ **Legacy.** The application stores nothing here any more — everything lives
 * in IndexedDB, under `storage/idb/`. This module survives for exactly one
 * caller: the one-shot import in `storage/migration/`, which reads the previous
 * engine's payload out of an installed copy so a user's archive is carried
 * across rather than discarded.
 *
 * Do not add new callers. When no installation can still be holding a
 * localStorage archive, this and the `migration/` directory go together.
 *
 * Every access is guarded: storage is missing during SSR and pre-hydration
 * tooling, and Safari's private mode throws on the property access itself
 * rather than on the write. Callers get `null`/`false` instead of an
 * exception, so a browser with storage disabled degrades to an in-memory
 * session rather than a blank screen.
 */

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Whether writes can land at all — private modes and locked-down profiles. */
export function hasStorage(): boolean {
  return getStorage() !== null;
}

export function readStorage(key: string): string | null {
  const storage = getStorage();
  if (storage === null) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns whether the value was persisted — a full quota is not an error. */
export function writeStorage(key: string, value: string): boolean {
  const storage = getStorage();
  if (storage === null) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): boolean {
  const storage = getStorage();
  if (storage === null) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
