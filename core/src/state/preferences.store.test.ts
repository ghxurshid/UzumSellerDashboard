import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GENERAL,
  PREFERENCES_STORAGE_KEY,
  installPreferencesStorage,
  usePreferencesStore,
} from './preferences.store';

/**
 * The seam a host with its own storage uses. The site never calls it, and the
 * site's synchronous `localStorage` hydration is the default this file leaves
 * alone — Node has no `localStorage`, which is itself the "blocked storage"
 * case the default backend must survive at import.
 */

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (name: string) => data.get(name) ?? null,
    setItem: async (name: string, value: string) => void data.set(name, value),
    removeItem: async (name: string) => void data.delete(name),
  };
}

describe('preferences storage', () => {
  it('starts from the defaults when the default backend holds nothing', () => {
    const state = usePreferencesStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.language).toBe('uz');
    expect(state.general).toEqual(DEFAULT_GENERAL);
  });

  it('adopts what an installed async backend holds, under the same key and version', async () => {
    const storage = memoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        state: { theme: 'light', language: 'ru', general: { ...DEFAULT_GENERAL, currency: 'USD' } },
        version: 2,
      }),
    });

    await installPreferencesStorage(storage);

    const state = usePreferencesStore.getState();
    expect(state.theme).toBe('light');
    expect(state.language).toBe('ru');
    expect(state.general.currency).toBe('USD');
  });

  it('writes later changes to the installed backend', async () => {
    const storage = memoryStorage();
    await installPreferencesStorage(storage);

    usePreferencesStore.getState().setLanguage('en');
    await Promise.resolve();

    const written = JSON.parse(storage.data.get(PREFERENCES_STORAGE_KEY) ?? 'null') as {
      state: { language: string };
      version: number;
    } | null;
    expect(written?.version).toBe(2);
    expect(written?.state.language).toBe('en');
  });

  it('migrates an older stored shape the way the site does', async () => {
    const storage = memoryStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({
        state: {
          theme: 'dark',
          language: 'en',
          general: { currency: 'UZS', timezone: 'UTC', retiredToggle: true },
        },
        version: 1,
      }),
    });

    await installPreferencesStorage(storage);

    const { general } = usePreferencesStore.getState();
    expect(general.timezone).toBe('UTC');
    expect(general).not.toHaveProperty('retiredToggle');
    expect(general.numberFormat).toBe(DEFAULT_GENERAL.numberFormat);
  });
});
