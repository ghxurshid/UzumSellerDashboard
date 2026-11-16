/**
 * The key/value port — how the shared settings layer reaches persistence
 * without knowing which host it runs in.
 *
 * The site persists these slots in the `savdo` IndexedDB `kv` store; the
 * browser extension persists them in `chrome.storage.local`. Code that must
 * work in both (the settings service, the model-usage ledger) calls the three
 * functions below and nothing else, and each host registers its own backend
 * once at startup, before `hydrateSettings()`.
 *
 * ## What travels through here
 *
 * Plain JSON-serialisable values only: the settings envelope (nested objects of
 * strings, numbers and booleans) and the model-usage ledger (an array of flat
 * records of strings, numbers and booleans). A backend may therefore store
 * them untouched, whether by structured clone or by JSON. Keep it that way —
 * no `Date`, `Map`, `Set` or class instances in a value passed to `writeKv`.
 *
 * ## Unregistered means unavailable
 *
 * With no backend the three functions reject, exactly like storage that cannot
 * be opened. Callers already treat a rejection as "degrade to in-memory", so
 * a host that forgets to register gets a working session that does not persist
 * rather than a crash. The functions are `async` so even a missing backend
 * surfaces as a rejected promise, never a synchronous throw.
 */

export interface KvBackend {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * The slots the shared engine itself persists. The strings are the ones already
 * stored in users' browsers, so they must never change.
 */
export const CORE_KV_KEYS = {
  settings: 'settings',
  modelUsage: 'model_usage',
} as const;

export type CoreKvKey = (typeof CORE_KV_KEYS)[keyof typeof CORE_KV_KEYS];

let backend: KvBackend | null = null;

/** The host calls this once at startup, before `hydrateSettings()`. */
export function registerKvBackend(next: KvBackend): void {
  backend = next;
}

function current(): KvBackend {
  if (backend === null) throw new Error('No key-value backend is registered');
  return backend;
}

export async function readKv<T>(key: CoreKvKey): Promise<T | null> {
  return current().read<T>(key);
}

export async function writeKv(key: CoreKvKey, value: unknown): Promise<void> {
  return current().write(key, value);
}

export async function removeKv(key: CoreKvKey): Promise<void> {
  return current().remove(key);
}
