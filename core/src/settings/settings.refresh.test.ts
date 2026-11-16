import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KvBackend } from '@core/storage/kv';
import type { AppSettings } from '@core/types/settings';

/**
 * `refreshSettings()` — several panels, one storage.
 *
 * Each "context" is its own module instance (`vi.resetModules`), the way each
 * tab's panel is its own JS realm, all registered on one shared fake storage.
 * The storage can hold operations back (`manual`) and release them in order,
 * which is how read/write interleavings are pinned deterministically.
 */

function sharedStorage() {
  const data = new Map<string, unknown>();
  let manual = false;
  const queue: Array<() => void> = [];
  const run = <T>(op: () => T): Promise<T> =>
    manual
      ? new Promise<T>((resolve, reject) => {
          queue.push(() => {
            try {
              resolve(op());
            } catch (e) {
              reject(e);
            }
          });
        })
      : Promise.resolve().then(op);
  const backend: KvBackend = {
    read: <T>(key: string) => run(() => (data.has(key) ? (structuredClone(data.get(key)) as T) : null)),
    write: (key, value) => run(() => void data.set(key, structuredClone(value))),
    remove: (key) => run(() => void data.delete(key)),
  };
  return {
    data,
    backend,
    hold: () => void (manual = true),
    /** Release held operations in arrival order, letting continuations run between them. */
    async release(count = Infinity) {
      for (let i = 0; i < count && queue.length > 0; i++) {
        queue.shift()?.();
        for (let t = 0; t < 5; t++) await Promise.resolve();
      }
    },
    resume() {
      manual = false;
    },
  };
}

import type * as ServiceModule from './settings.service';
type Service = typeof ServiceModule;
type Storage = ReturnType<typeof sharedStorage>;

async function context(storage: Storage): Promise<Service> {
  vi.resetModules();
  const kv = await import('@core/storage/kv');
  kv.registerKvBackend(storage.backend);
  const service = await import('./settings.service');
  await service.hydrateSettings();
  return service;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const keyOf = (s: AppSettings): string => s.ai.providers.openai.apiKey;

let storage: Storage;
beforeEach(() => {
  storage = sharedStorage();
});

describe('refreshSettings', () => {
  it('is a no-op before hydration', async () => {
    vi.resetModules();
    const kv = await import('@core/storage/kv');
    kv.registerKvBackend(storage.backend);
    const s = await import('./settings.service');
    expect(await s.refreshSettings()).toBe(false);
  });

  it('treats the echo of its own write as nothing', async () => {
    const a = await context(storage);
    const listener = vi.fn();
    a.updateAiConnection('openai', { apiKey: 'sk-a' });
    await flush();
    a.subscribeToSettings(listener);
    const before = a.getSettings();
    expect(await a.refreshSettings()).toBe(false);
    expect(a.getSettings()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("adopts another context's write without persisting, notifying once", async () => {
    const a = await context(storage);
    const b = await context(storage);
    a.updateAiConnection('openai', { apiKey: 'sk-a' });
    await flush();

    const listener = vi.fn();
    b.subscribeToSettings(listener);
    const writes = vi.spyOn(storage.backend, 'write');
    expect(await b.refreshSettings()).toBe(true);
    expect(keyOf(b.getSettings())).toBe('sk-a');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
    expect(await b.refreshSettings()).toBe(false);
  });

  it('keeps the key when a stale panel saves an unrelated field after refreshing', async () => {
    const a = await context(storage);
    const b = await context(storage);
    a.updateAiConnection('openai', { apiKey: 'sk-a' });
    await flush();
    await b.refreshSettings();
    b.updateAiConnection('openai', { temperature: 0.3 });
    await flush();
    const c = await context(storage);
    expect(keyOf(c.getSettings())).toBe('sk-a');
    expect(c.getSettings().ai.providers.openai.temperature).toBe(0.3);
  });

  it('lets a local write that starts during the read win', async () => {
    const a = await context(storage);
    const b = await context(storage);
    a.updateAiConnection('openai', { apiKey: 'sk-a' });
    await flush();

    storage.hold();
    const refresh = b.refreshSettings();
    b.updateAiConnection('openai', { model: 'local-model' });
    await storage.release();
    expect(await refresh).toBe(false);
    storage.resume();
    await flush();
    expect(b.getSettings().ai.providers.openai.model).toBe('local-model');
    const stored = (await context(storage)).getSettings();
    expect(stored.ai.providers.openai.model).toBe('local-model');
  });

  it('does not regress memory to the older stored value while a local write is in flight', async () => {
    const a = await context(storage);
    storage.hold();
    a.updateAiConnection('openai', { apiKey: 'sk-new' });
    expect(await a.refreshSettings()).toBe(false);
    expect(keyOf(a.getSettings())).toBe('sk-new');
    await storage.release();
    storage.resume();
    expect(storage.data.size).toBe(1);
    expect(await a.refreshSettings()).toBe(false);
    expect(keyOf(a.getSettings())).toBe('sk-new');
  });

  it('adopts a slot removed by another context as defaults', async () => {
    const a = await context(storage);
    const b = await context(storage);
    a.updateAiConnection('openai', { apiKey: 'sk-a' });
    await flush();
    await b.refreshSettings();
    storage.data.clear();
    expect(await b.refreshSettings()).toBe(true);
    expect(keyOf(b.getSettings())).toBe('');
  });

  it('leaves everything as it is when the read fails', async () => {
    const a = await context(storage);
    a.updateAiConnection('openai', { apiKey: 'sk-a' });
    await flush();
    const before = a.getSettings();
    vi.spyOn(storage.backend, 'read').mockRejectedValue(new Error('gone'));
    expect(await a.refreshSettings()).toBe(false);
    expect(a.getSettings()).toBe(before);
  });

  it('converges: after writes stop and both refresh, both hold what storage holds', async () => {
    const a = await context(storage);
    const b = await context(storage);
    a.updateAiConnection('openai', { apiKey: 'sk-a' });
    b.updateAiConnection('openai', { model: 'm-b' });
    const ra = a.refreshSettings();
    b.updateAiConnection('openai', { temperature: 0.2 });
    a.updateAiConnection('gemini', { apiKey: 'ak-a' });
    await Promise.all([ra, b.refreshSettings()]);
    await flush();
    await Promise.all([a.refreshSettings(), b.refreshSettings()]);
    await flush();
    const stored = (await context(storage)).getSettings();
    expect(JSON.stringify(a.getSettings())).toBe(JSON.stringify(stored));
    expect(JSON.stringify(b.getSettings())).toBe(JSON.stringify(stored));
  });
});
