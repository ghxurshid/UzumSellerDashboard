import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StorageAreaLike } from './chromeStorageKv';
import { createChromePreferencesStorage, hasExtensionStorage } from './chromePreferences';

function fakeArea(): StorageAreaLike & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (data.has(k)) out[k] = data.get(k);
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

type Listener = (c: Record<string, { newValue?: unknown }>, area: string) => void;
function fakeNamespace(local: StorageAreaLike) {
  const listeners = new Set<Listener>();
  const emit = (changes: Record<string, { newValue?: unknown }>, area = 'local'): void =>
    listeners.forEach((l) => l(changes, area));
  return {
    listeners,
    emit,
    ns: {
      local,
      onChanged: {
        addListener: (cb: Listener) => void listeners.add(cb),
        removeListener: (cb: Listener) => void listeners.delete(cb),
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('createChromePreferencesStorage', () => {
  it("stores the store's JSON string under the store's own key, unprefixed", async () => {
    const area = fakeArea();
    vi.stubGlobal('chrome', { storage: fakeNamespace(area).ns });
    const { storage } = createChromePreferencesStorage();

    await storage.setItem('savdo.preferences', '{"state":{"theme":"light"},"version":2}');
    expect([...area.data.keys()]).toEqual(['savdo.preferences']);
    expect(await storage.getItem('savdo.preferences')).toBe('{"state":{"theme":"light"},"version":2}');

    await storage.removeItem('savdo.preferences');
    expect(await storage.getItem('savdo.preferences')).toBeNull();
  });

  it('reads a missing or non-string slot as nothing stored', async () => {
    const area = fakeArea();
    area.data.set('savdo.preferences', { not: 'a string' });
    vi.stubGlobal('chrome', { storage: fakeNamespace(area).ns });
    const { storage } = createChromePreferencesStorage();
    expect(await storage.getItem('savdo.preferences')).toBeNull();
    expect(await storage.getItem('other')).toBeNull();
  });

  it('prefers browser.storage over chrome.storage, like the key/value backend', async () => {
    const browserArea = fakeArea();
    const chromeArea = fakeArea();
    vi.stubGlobal('browser', { storage: fakeNamespace(browserArea).ns });
    vi.stubGlobal('chrome', { storage: fakeNamespace(chromeArea).ns });
    await createChromePreferencesStorage().storage.setItem('k', 'v');
    expect(browserArea.data.get('k')).toBe('v');
    expect(chromeArea.data.size).toBe(0);
  });

  it('degrades instead of throwing when storage fails or is missing', async () => {
    const broken: StorageAreaLike = {
      get: () => Promise.reject(new Error('quota')),
      set: () => Promise.reject(new Error('quota')),
      remove: () => Promise.reject(new Error('quota')),
    };
    vi.stubGlobal('chrome', { storage: fakeNamespace(broken).ns });
    const { storage } = createChromePreferencesStorage();
    expect(await storage.getItem('k')).toBeNull();
    await expect(storage.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(storage.removeItem('k')).resolves.toBeUndefined();

    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('browser', undefined);
    expect(await storage.getItem('k')).toBeNull();
    await expect(storage.setItem('k', 'v')).resolves.toBeUndefined();
  });

  it('tells when an extension storage API exists', () => {
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('browser', undefined);
    expect(hasExtensionStorage()).toBe(false);
    vi.stubGlobal('chrome', { storage: fakeNamespace(fakeArea()).ns });
    expect(hasExtensionStorage()).toBe(true);
  });
});

describe('watch', () => {
  it('calls back for a change made elsewhere, and only for its own slot in the local area', () => {
    const fake = fakeNamespace(fakeArea());
    vi.stubGlobal('chrome', { storage: fake.ns });
    const { watch } = createChromePreferencesStorage();
    const listener = vi.fn();
    const stop = watch('savdo.preferences', listener);

    fake.emit({ 'savdo.preferences': { newValue: '{"a":1}' } });
    expect(listener).toHaveBeenCalledTimes(1);

    fake.emit({ 'savdo.kv.settings': { newValue: {} } });
    fake.emit({ 'savdo.preferences': { newValue: '{"a":2}' } }, 'sync');
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    fake.emit({ 'savdo.preferences': { newValue: '{"a":3}' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.listeners.size).toBe(0);
  });

  it("ignores the echo of its own write but not another tab's different value", async () => {
    const fake = fakeNamespace(fakeArea());
    vi.stubGlobal('chrome', { storage: fake.ns });
    const { storage, watch } = createChromePreferencesStorage();
    const listener = vi.fn();
    watch('savdo.preferences', listener);

    await storage.setItem('savdo.preferences', '{"mine":true}');
    fake.emit({ 'savdo.preferences': { newValue: '{"mine":true}' } });
    expect(listener).not.toHaveBeenCalled();

    fake.emit({ 'savdo.preferences': { newValue: '{"theirs":true}' } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without an events API', () => {
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('browser', undefined);
    const stop = createChromePreferencesStorage().watch('k', vi.fn());
    expect(stop).not.toThrow();
  });
});
