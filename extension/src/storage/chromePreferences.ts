/**
 * The seller's preferences (theme, language, number format…) on
 * `chrome.storage.local`, as the storage port the preferences store takes.
 *
 * Why not the site's `localStorage`: the panel is an extension page inside an
 * iframe on seller.uzum.uz, where `localStorage` is partitioned by the embedding
 * site and may be blocked outright. `chrome.storage.local` is the same area
 * the key/value backend uses, shared by every cabinet tab, so a theme chosen in
 * one tab is the theme of the next.
 *
 * The zustand store already serialises itself, so what is kept here is its JSON
 * string, under the store's own key, untouched — no prefix, because the store
 * names the slot and nothing else writes to it.
 *
 * ## Failure
 *
 * Reading a slot that cannot be read answers "nothing stored" and a write that
 * fails is dropped: a preference that cannot be saved still applies for this
 * session, which is the same degradation the site's `localStorage` backend has.
 *
 * ## Other tabs
 *
 * `watch` calls back when another context changes the slot, so the caller can
 * re-read it. Our own write also raises the event; it is recognised by its value
 * and skipped, so a change never bounces between a tab and its own storage.
 */

import type { StateStorage } from 'zustand/middleware';

import { storageNamespace } from './chromeStorageKv';

export interface ChromePreferencesStorage {
  readonly storage: StateStorage;
  /** Calls `listener` when another context changed the slot `name`. Returns an unsubscribe. */
  watch(name: string, listener: () => void): () => void;
}

/** Whether this context has an extension storage API at all (a dev server does not). */
export function hasExtensionStorage(): boolean {
  return storageNamespace()?.local !== undefined;
}

export function createChromePreferencesStorage(): ChromePreferencesStorage {
  /* The last value this context wrote per slot, to tell its own echo apart. */
  const written = new Map<string, string>();

  const storage: StateStorage = {
    getItem: async (name) => {
      try {
        const area = storageNamespace()?.local;
        if (area === undefined) return null;
        const items = await area.get(name);
        const value = items?.[name];
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },
    setItem: async (name, value) => {
      written.set(name, value);
      try {
        await storageNamespace()?.local?.set({ [name]: value });
      } catch {
        /* Applies for this session; see the module header. */
      }
    },
    removeItem: async (name) => {
      written.delete(name);
      try {
        await storageNamespace()?.local?.remove(name);
      } catch {
        /* Nothing to remove from storage that cannot be reached. */
      }
    },
  };

  const watch = (name: string, listener: () => void): (() => void) => {
    const events = storageNamespace()?.onChanged;
    if (events === undefined) return () => undefined;

    const handler = (changes: Record<string, { newValue?: unknown }>, areaName: string): void => {
      if (areaName !== 'local') return;
      const change = changes[name];
      if (change === undefined) return;
      if (typeof change.newValue === 'string' && change.newValue === written.get(name)) return;
      listener();
    };
    events.addListener(handler);
    return () => events.removeListener(handler);
  };

  return { storage, watch };
}
