import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chromeStorageKvBackend as kv,
  KV_STORAGE_PREFIX,
  onKvChanged,
  type StorageAreaLike,
} from './chromeStorageKv';

function fakeArea(): StorageAreaLike & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

type Listener = (c: Record<string, { newValue?: unknown }>, area: string) => void;
function fakeNamespace(local: StorageAreaLike) {
  const listeners = new Set<Listener>();
  return {
    listeners,
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

describe('chromeStorageKvBackend', () => {
  it('round-trips a nested object and an array ledger', async () => {
    vi.stubGlobal('chrome', { storage: fakeNamespace(fakeArea()).ns });
    const settings = { v: 1, ai: { provider: 'openai', keys: { openai: 'sk-x' } }, flags: [true, false] };
    const ledger = [
      { at: 1, model: 'm', tokens: 5 },
      { at: 2, model: 'm', tokens: 7 },
    ];
    await kv.write('settings', settings);
    await kv.write('model_usage', ledger);
    expect(await kv.read('settings')).toEqual(settings);
    expect(await kv.read('model_usage')).toEqual(ledger);
  });

  it('returns null for a missing key and after remove', async () => {
    vi.stubGlobal('chrome', { storage: fakeNamespace(fakeArea()).ns });
    expect(await kv.read('settings')).toBeNull();
    await kv.write('settings', { a: 1 });
    await kv.remove('settings');
    expect(await kv.read('settings')).toBeNull();
  });

  it('prefixes stored keys and leaves foreign keys alone', async () => {
    const area = fakeArea();
    area.data.set('panel.open', true);
    vi.stubGlobal('chrome', { storage: fakeNamespace(area).ns });
    await kv.write('settings', { a: 1 });
    expect([...area.data.keys()].sort()).toEqual(['panel.open', `${KV_STORAGE_PREFIX}settings`]);
    await kv.remove('settings');
    expect(area.data.get('panel.open')).toBe(true);
  });

  it('rejects, never throws synchronously, when the API is missing', async () => {
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('browser', undefined);
    let p: Promise<unknown> | undefined;
    expect(() => {
      p = kv.read('settings');
    }).not.toThrow();
    await expect(p).rejects.toThrow(/not available/);
    await expect(kv.write('settings', 1)).rejects.toThrow();
    await expect(kv.remove('settings')).rejects.toThrow();
  });

  it('prefers browser over chrome, and uses chrome alone when browser is absent', async () => {
    const b = fakeArea();
    const c = fakeArea();
    vi.stubGlobal('browser', { storage: fakeNamespace(b).ns });
    vi.stubGlobal('chrome', { storage: fakeNamespace(c).ns });
    await kv.write('settings', 1);
    expect(b.data.size).toBe(1);
    expect(c.data.size).toBe(0);

    vi.stubGlobal('browser', undefined);
    await kv.write('settings', 2);
    expect(c.data.get(`${KV_STORAGE_PREFIX}settings`)).toBe(2);
  });
});

describe('onKvChanged', () => {
  it('reports only local-area core slots and unsubscribes', () => {
    const { ns, listeners } = fakeNamespace(fakeArea());
    vi.stubGlobal('chrome', { storage: ns });
    const seen: Array<[string, unknown]> = [];
    const off = onKvChanged((k, v) => seen.push([k, v]));
    const [fire] = [...listeners];
    fire?.({ [`${KV_STORAGE_PREFIX}settings`]: { newValue: { a: 1 } }, 'panel.open': { newValue: 1 } }, 'local');
    fire?.({ [`${KV_STORAGE_PREFIX}settings`]: { newValue: 9 } }, 'sync');
    fire?.({ [`${KV_STORAGE_PREFIX}model_usage`]: {} }, 'local');
    expect(seen).toEqual([
      ['settings', { a: 1 }],
      ['model_usage', null],
    ]);
    off();
    expect(listeners.size).toBe(0);
  });

  it('is a no-op without the API', () => {
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('browser', undefined);
    expect(() => onKvChanged(() => undefined)()).not.toThrow();
  });
});
