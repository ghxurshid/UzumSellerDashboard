import { create } from 'zustand';

import { findProvider } from '@/constants/settings';
import {
  isModelRequestEvent,
  pruneUsage,
  subscribeModelRequests,
  type ModelRequestEvent,
} from '@/services/ai/usage';
import { readKv, writeKv } from '@/services/storage/idb/kv.repo';
import { KV_KEYS } from '@/services/storage/idb/schema';

/**
 * The ledger of requests this browser has sent to an AI provider — the raw
 * material `services/ai/usage.ts` turns into the quota gauges Settings draws.
 *
 * Persisted like `pins.store.ts` and for the same reason: unawaited writes,
 * because losing the last few events costs the meter some precision, never
 * correctness — `summarizeUsage` degrades gracefully to "unknown" rather than
 * lying about zero.
 *
 * ## The race this store exists to not lose
 *
 * `restoreModelUsage()` awaits an IndexedDB read, and the transport can (and
 * during a fast reload, does) record a request before that read resolves —
 * the ledger subscription is wired first, from `bootstrap()`, precisely so no
 * request goes unrecorded, but that means an event can already be sitting in
 * `events` by the time the stored list comes back. Restoring must therefore
 * *merge* stored and in-memory by id rather than overwrite one with the
 * other, in either direction.
 *
 * The same race has a second half: a cross-tab `BroadcastChannel` message can
 * arrive in a tab that has not finished its own `restoreModelUsage()` yet —
 * the channel is live from module import, before `bootstrap()` even starts
 * the read. If that event were persisted immediately, it would write `[event]`
 * to `kv` and the read still in flight would come back and be merged against
 * *that* truncated write instead of what was there before — the rest of the
 * day's ledger, lost for good, in the one tab that happened to still be
 * loading. So `applyIncoming` folds every event into `events` unconditionally
 * (nothing must go unrecorded) but persists only once `loaded` is `true`;
 * `restoreModelUsage()` itself does the one persist that matters before that
 * point, after it has merged the stored list against whatever arrived while
 * it was reading.
 */

/** A corrupt or runaway ledger must not grow the `kv` record without bound. */
const MAX_EVENTS = 5_000;

/**
 * Whether the catalogue still publishes rate limits for this event's
 * provider+model.
 *
 * `MAX_EVENTS` is shared by every provider this browser has ever talked to,
 * so an event this meter can never gauge anything from (a free-text adapter,
 * a Gemini model dropped from the catalogue) must not occupy a slot that
 * could instead hold a Gemini request the panel actually draws a bar for.
 */
function hasCatalogueLimits(event: ModelRequestEvent): boolean {
  return findProvider(event.provider).models.some(
    (entry) => entry.id === event.model && entry.limits !== undefined,
  );
}

interface ModelUsageState {
  readonly events: readonly ModelRequestEvent[];
  /** True once the stored ledger has been read, so a bar can show a skeleton instead of a false zero. */
  readonly loaded: boolean;
}

export const useModelUsageStore = create<ModelUsageState>()(() => ({
  events: [],
  loaded: false,
}));

function persist(events: readonly ModelRequestEvent[]): void {
  void writeKv(KV_KEYS.modelUsage, events).catch(() => {
    /* A lost ledger entry costs the meter some precision, not correctness. */
  });
}

/**
 * Dedupe by `id`, oldest first, capped to `MAX_EVENTS`.
 *
 * Sorted by `at` rather than by merge order: the two inputs are not
 * necessarily in chronological order relative to each other (a cross-tab
 * message can arrive after a newer local event), and "the newest 5000" has to
 * mean newest by time for the cap to be a safety net rather than a source of
 * dropped recent data.
 */
function mergeById(
  a: readonly ModelRequestEvent[],
  b: readonly ModelRequestEvent[],
): ModelRequestEvent[] {
  const byId = new Map<string, ModelRequestEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);

  const merged = [...byId.values()].sort((x, y) => x.at - y.at);
  return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
}

/**
 * Fold incoming events into the store, prune what has aged out, and — once
 * the stored ledger has actually been read — persist.
 *
 * Before `loaded`, persisting here would race `restoreModelUsage()`'s own
 * read: see the module header. The event is never lost either way, because
 * it is already folded into `events`, and `restoreModelUsage()` merges
 * against exactly that in-memory state before it does the one write that
 * counts.
 */
function applyIncoming(incoming: readonly ModelRequestEvent[]): void {
  const relevant = incoming.filter(hasCatalogueLimits);
  if (relevant.length === 0) return;

  const state = useModelUsageStore.getState();
  const merged = pruneUsage(mergeById(state.events, relevant), Date.now());
  useModelUsageStore.setState({ events: merged });
  if (state.loaded) persist(merged);
}

/* ── cross-tab ──────────────────────────────────────────────────────────── */

const CHANNEL_NAME = 'savdo.model-usage';

/* `undefined` in any embedding that lacks `BroadcastChannel` (some older
   WebViews); the ledger still works within one tab without it. */
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);

if (channel !== null) {
  channel.onmessage = (message: MessageEvent<unknown>): void => {
    /* Validated like anything else read back from outside this module — a
       message on this channel came from another tab's copy of this same
       code, but a stale tab running an older build could still shape it
       differently. Not re-broadcast: every tab that received it already
       merges and persists the same way, so a relay would only echo forever. */
    if (isModelRequestEvent(message.data)) applyIncoming([message.data]);
  };
}

/* ── subscription (idempotent) ─────────────────────────────────────────── */

let subscribed = false;

/**
 * Wire the ledger to the transport and to other tabs. Called once, from
 * `bootstrap()`, before anything in the app can send a request — a listener
 * registered after the first request would simply miss it.
 *
 * Guarded so a second call is a no-op: React StrictMode double-invokes
 * effects and a Vite HMR reload re-runs module-level setup, and either would
 * double-record every request without this.
 */
export function initModelUsageSync(): void {
  if (subscribed) return;
  subscribed = true;

  subscribeModelRequests((event) => {
    applyIncoming([event]);
    channel?.postMessage(event);
  });
}

/* ── restore ────────────────────────────────────────────────────────────── */

/** Load the stored ledger. Called once, from `bootstrap()`. */
export async function restoreModelUsage(): Promise<void> {
  try {
    const stored = await readKv<unknown>(KV_KEYS.modelUsage);
    const usable = (Array.isArray(stored) ? stored : [])
      .filter(isModelRequestEvent)
      .filter(hasCatalogueLimits);

    /* Merge with whatever is already in memory — see the module header for
       why this must never be a plain overwrite. Everything that arrived
       through `applyIncoming` while this read was pending is already in
       `events` but was never persisted, precisely so this merge — not that
       earlier write — is the first thing to reach `kv`. */
    const merged = pruneUsage(mergeById(usable, useModelUsageStore.getState().events), Date.now());
    useModelUsageStore.setState({ events: merged, loaded: true });

    /* Rewritten unconditionally rather than only "when something was
       dropped": unlike the pin list, a merge with events that arrived during
       the read is an expected, not exceptional, outcome here, and writing
       the merged list is what lets a second tab converge on it too. */
    persist(merged);
  } catch {
    useModelUsageStore.setState((state) => ({ events: state.events, loaded: true }));
  }
}
