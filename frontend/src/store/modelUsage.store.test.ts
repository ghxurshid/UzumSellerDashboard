import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiProvider } from '@/types/settings';

import { USAGE_RETENTION_MS, type ModelRequestEvent } from '@/services/ai/usage';
import { KV_KEYS } from '@/services/storage/idb/schema';

const { readKv, writeKv } = vi.hoisted(() => ({ readKv: vi.fn(), writeKv: vi.fn() }));
vi.mock('@/services/storage/idb/kv.repo', () => ({ readKv, writeKv }));

const { useModelUsageStore, initModelUsageSync, restoreModelUsage } = await import('./modelUsage.store');
const { recordModelRequest } = await import('@/services/ai/usage');

/**
 * The ledger: the one race `restoreModelUsage()` exists not to lose, and the
 * two ways a merge can go wrong — an invalid stored row surviving, or a
 * corrupt/runaway ledger growing the `kv` record without bound.
 *
 * `readKv`/`writeKv` are mocked (see the module's own header for why: this is
 * `kv.repo`, storage-idb's territory, not a seam added for this test) so
 * nothing here touches IndexedDB. The store also reads `Date.now()` directly
 * inside `applyIncoming`/`restoreModelUsage` — not an injectable argument, so
 * the clock is pinned with fake timers rather than left to read the real one.
 */

const PROVIDER: AiProvider = 'gemini';
const MODEL = 'gemini-3.6-flash';
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  readKv.mockReset();
  writeKv.mockReset();
  writeKv.mockResolvedValue(undefined);
  useModelUsageStore.setState({ events: [], loaded: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('restoreModelUsage', () => {
  it('merges a stored event with one recorded while the read was still pending', async () => {
    initModelUsageSync(); // idempotent — safe to call from every test

    let resolveRead!: (value: unknown) => void;
    readKv.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );

    const restorePromise = restoreModelUsage();

    // The transport finishes a request before the stored ledger comes back —
    // the exact race the module header describes.
    recordModelRequest({
      provider: PROVIDER,
      model: MODEL,
      at: NOW - 1_000,
      inputTokens: 10,
      outcome: 'ok',
    });

    const duringRead = useModelUsageStore.getState().events[0];
    expect(duringRead).toBeDefined();

    resolveRead([
      {
        id: 'stored-1',
        provider: PROVIDER,
        model: MODEL,
        at: NOW - 2_000,
        inputTokens: 5,
        outcome: 'ok',
      },
    ]);
    await restorePromise;

    const ids = useModelUsageStore.getState().events.map((entry) => entry.id).sort();
    expect(ids).toEqual([duringRead?.id, 'stored-1'].sort());
    expect(useModelUsageStore.getState().loaded).toBe(true);
  });

  it('drops a stored entry that no longer looks like a request event', async () => {
    readKv.mockResolvedValue([
      { id: 'ok-1', provider: PROVIDER, model: MODEL, at: NOW - 1_000, inputTokens: null, outcome: 'ok' },
      { id: 'bad-1', provider: PROVIDER }, // missing at/model/outcome/inputTokens
      'not even an object',
      null,
    ]);

    await restoreModelUsage();

    expect(useModelUsageStore.getState().events.map((entry) => entry.id)).toEqual(['ok-1']);
  });

  it('drops an event older than the retention window once restored', async () => {
    readKv.mockResolvedValue([
      {
        id: 'stale',
        provider: PROVIDER,
        model: MODEL,
        at: NOW - USAGE_RETENTION_MS - 1, // just past the boundary
        inputTokens: null,
        outcome: 'ok',
      },
      {
        id: 'fresh',
        provider: PROVIDER,
        model: MODEL,
        at: NOW - 1_000,
        inputTokens: null,
        outcome: 'ok',
      },
    ]);

    await restoreModelUsage();

    expect(useModelUsageStore.getState().events.map((entry) => entry.id)).toEqual(['fresh']);
  });

  it('does not persist while unloaded, then writes exactly once with stored + in-memory merged after restore resolves', async () => {
    initModelUsageSync();

    let resolveRead!: (value: unknown) => void;
    readKv.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );

    const restorePromise = restoreModelUsage();

    recordModelRequest({ provider: PROVIDER, model: MODEL, at: NOW - 1_000, inputTokens: 10, outcome: 'ok' });

    // The event is folded into `events` immediately (nothing must go
    // unrecorded — see the module header) but `loaded` is still false, so
    // nothing has been written to `kv` yet.
    expect(useModelUsageStore.getState().events).toHaveLength(1);
    expect(writeKv).not.toHaveBeenCalled();

    resolveRead([
      { id: 'stored-1', provider: PROVIDER, model: MODEL, at: NOW - 2_000, inputTokens: 5, outcome: 'ok' },
    ]);
    await restorePromise;

    expect(writeKv).toHaveBeenCalledTimes(1);
    const [key, written] = writeKv.mock.calls[0] as [string, ModelRequestEvent[]];
    expect(key).toBe(KV_KEYS.modelUsage);
    expect(written.map((entry) => entry.id).sort()).toEqual(
      [...useModelUsageStore.getState().events.map((entry) => entry.id)].sort(),
    );
    expect(written.map((entry) => entry.id)).toContain('stored-1');
    expect(written).toHaveLength(2);
  });

  it('folds a BroadcastChannel message that arrives before restore resolves into events without writing, then into the one post-restore write', async () => {
    // The transport listener and the channel listener both funnel into the
    // same `applyIncoming`, but only the transport path is exercised by
    // `recordModelRequest` above — this drives the actual cross-tab wire, a
    // second `BroadcastChannel` on the same private channel name the module
    // uses (`savdo.model-usage`, read off `store/modelUsage.store.ts`).
    // Node delivers a `BroadcastChannel` message on a macrotask, never
    // synchronously and never on a microtask alone (verified against Node 22
    // directly before writing this), so this one test needs the real event
    // loop rather than fake timers.
    vi.useRealTimers();
    try {
      let resolveRead!: (value: unknown) => void;
      readKv.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      );

      const restorePromise = restoreModelUsage();

      const remote = new BroadcastChannel('savdo.model-usage');
      try {
        const incoming = {
          id: 'from-other-tab',
          provider: PROVIDER,
          model: MODEL,
          at: Date.now(),
          inputTokens: null,
          outcome: 'ok',
        };
        remote.postMessage(incoming);
        // Delivery is a macrotask, not a microtask (confirmed against plain
        // Node before writing this) — poll a bounded number of ticks rather
        // than assume exactly one, since the exact number is a Node/libuv
        // scheduling detail, not a contract this test should pin.
        for (let i = 0; i < 50; i += 1) {
          await new Promise((resolve) => setImmediate(resolve));
          if (useModelUsageStore.getState().events.some((entry) => entry.id === 'from-other-tab')) break;
        }

        expect(useModelUsageStore.getState().events.map((entry) => entry.id)).toContain('from-other-tab');
        expect(writeKv).not.toHaveBeenCalled();
      } finally {
        remote.close();
      }

      resolveRead([]);
      await restorePromise;

      expect(writeKv).toHaveBeenCalledTimes(1);
      const [, written] = writeKv.mock.calls[0] as [string, ModelRequestEvent[]];
      expect(written.map((entry) => entry.id)).toContain('from-other-tab');
    } finally {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    }
  });

  it('drops a live event for a provider/model the catalogue publishes no limits for, without touching kv', () => {
    initModelUsageSync();
    useModelUsageStore.setState({ events: [], loaded: true });
    writeKv.mockClear();

    recordModelRequest({ provider: 'openai', model: 'gpt-5.1', at: NOW - 1_000, inputTokens: 10, outcome: 'ok' });

    expect(useModelUsageStore.getState().events).toHaveLength(0);
    expect(writeKv).not.toHaveBeenCalled();
  });

  it('persists a live event straight away once loaded is already true', () => {
    initModelUsageSync();
    useModelUsageStore.setState({ events: [], loaded: true });
    writeKv.mockClear();

    recordModelRequest({ provider: PROVIDER, model: MODEL, at: NOW - 1_000, inputTokens: 10, outcome: 'ok' });

    expect(writeKv).toHaveBeenCalledTimes(1);
    const [key, written] = writeKv.mock.calls[0] as [string, ModelRequestEvent[]];
    expect(key).toBe(KV_KEYS.modelUsage);
    expect(written).toHaveLength(1);
    expect(written[0]?.provider).toBe(PROVIDER);
  });

  it('drops a stored event for a provider/model the catalogue no longer publishes limits for', async () => {
    readKv.mockResolvedValue([
      {
        id: 'no-limits',
        provider: 'openai',
        model: 'gpt-5.1', // openai's catalogue entry carries no `limits` — free-text adapter
        at: NOW - 1_000,
        inputTokens: null,
        outcome: 'ok',
      },
      { id: 'has-limits', provider: PROVIDER, model: MODEL, at: NOW - 1_000, inputTokens: null, outcome: 'ok' },
    ]);

    await restoreModelUsage();

    expect(useModelUsageStore.getState().events.map((entry) => entry.id)).toEqual(['has-limits']);
  });

  it('caps the merged ledger at the private 5 000-event limit, keeping the newest', async () => {
    // MAX_EVENTS is not exported from the store (private, by design — see the
    // ownership note in the report). 5 000 is read off the source comment
    // ("A corrupt or runaway ledger must not grow the `kv` record without
    // bound") and pinned here; a change to that constant should update this
    // test alongside it.
    const stored = Array.from({ length: 5_001 }, (_, i) => ({
      id: `s${i}`,
      provider: PROVIDER,
      model: MODEL,
      at: NOW - (5_001 - i), // ascending — s0 is oldest, s5000 is newest
      inputTokens: null,
      outcome: 'ok' as const,
    }));
    readKv.mockResolvedValue(stored);

    await restoreModelUsage();

    const kept = useModelUsageStore.getState().events;
    expect(kept).toHaveLength(5_000);
    expect(kept.map((entry) => entry.id)).not.toContain('s0'); // the single oldest is dropped
    expect(kept.map((entry) => entry.id)).toContain('s5000'); // the newest survives
  });
});
