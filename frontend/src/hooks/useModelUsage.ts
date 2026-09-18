import { useMemo, useSyncExternalStore } from 'react';

import { findProvider } from '@/constants/settings';
import { summarizeUsage, type ModelUsage } from '@/services/ai/usage';
import { useModelUsageStore } from '@/store/modelUsage.store';
import type { AiProvider } from '@/types/settings';

/**
 * One clock, shared by every quota bar and picker option on screen.
 *
 * The gauges in `summarizeUsage` are pure functions of `now`: a bar showing
 * "resets in 12s" is wrong twelve seconds later even though nothing about the
 * ledger changed, so something needs its own reason to re-render besides the
 * store. A `setInterval` per component would work, but the panel and the
 * picker mount their own independently, and two clocks started a few
 * milliseconds apart can tick a second apart — the panel's "resets in 5s"
 * and the picker's "resets in 4s" disagreeing about the same gauge reads as
 * a bug even though neither number is wrong. One module-level ticker, read
 * through `useSyncExternalStore`, means every subscriber re-renders from the
 * same tick — and the ticker itself only runs while at least one component
 * is actually mounted to read it, exactly like the per-component interval it
 * replaces.
 */
let tickAt = Date.now();
/* Bare `setInterval`, not `window.setInterval` — matching `toast.store.ts`'s
   `ReturnType<typeof setTimeout>`, the codebase's existing way round the same
   ambient-typing clash that makes the `window.`-qualified form's return type
   unify with `NodeJS.Timeout` instead of `number` in this project. */
let intervalId: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (intervalId === null) {
    // Fresh the moment the first consumer mounts, not whenever this module
    // first happened to load — those can be far apart.
    tickAt = Date.now();
    intervalId = setInterval(() => {
      tickAt = Date.now();
      for (const subscriber of clockListeners) subscriber();
    }, 1_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getClockSnapshot(): number {
  return tickAt;
}

export function useNow(): number {
  return useSyncExternalStore(subscribeClock, getClockSnapshot);
}

/**
 * What is left of one model's budget, from the catalogue's published limits
 * and the requests this browser has a record of sending.
 *
 * `null` when the catalogue has no `limits` for this model — a free-text
 * adapter, a provider Gemini's rate-limit metadata was never collected for,
 * or a model id no longer in the catalogue — which tells the caller there is
 * nothing to gauge rather than a gauge sitting at zero.
 */
export function useModelUsage(provider: AiProvider, model: string): ModelUsage | null {
  const events = useModelUsageStore((state) => state.events);
  const now = useNow();

  return useMemo(() => {
    const limits = findProvider(provider).models.find((entry) => entry.id === model)?.limits;
    if (limits === undefined) return null;
    return summarizeUsage(events, provider, model, limits, now);
  }, [events, provider, model, now]);
}

/**
 * The same gauges for every model a provider's catalogue offers, keyed by
 * model id — what the model picker needs to show each option's headroom
 * without mounting nine separate subscriptions to the ledger and the clock.
 * A model without published `limits` is absent from the map rather than
 * present with a null entry, so a caller can test with `.has()`.
 */
export function useProviderModelUsage(provider: AiProvider): ReadonlyMap<string, ModelUsage> {
  const events = useModelUsageStore((state) => state.events);
  const now = useNow();

  return useMemo(() => {
    const map = new Map<string, ModelUsage>();
    for (const option of findProvider(provider).models) {
      if (option.limits === undefined) continue;
      map.set(option.id, summarizeUsage(events, provider, option.id, option.limits, now));
    }
    return map;
  }, [events, provider, now]);
}

/** Whether the ledger has finished restoring — gate a bar on this, not on a zero. */
export function useModelUsageLoaded(): boolean {
  return useModelUsageStore((state) => state.loaded);
}
