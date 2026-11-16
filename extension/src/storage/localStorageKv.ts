/**
 * Development-only backend for opening the panel HTML from a plain dev server,
 * where no extension API exists. It is never the default: the panel bootstrap
 * must choose it explicitly, so an installed extension cannot silently fall
 * back to per-origin storage that other panels would not see.
 */

import type { KvBackend } from '@core/storage/kv';

import { storageKey } from './chromeStorageKv';

export const devLocalStorageKvBackend: KvBackend = {
  async read<T>(key: string): Promise<T | null> {
    const raw = globalThis.localStorage.getItem(storageKey(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  },
  async write(key: string, value: unknown): Promise<void> {
    globalThis.localStorage.setItem(storageKey(key), JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    globalThis.localStorage.removeItem(storageKey(key));
  },
};
