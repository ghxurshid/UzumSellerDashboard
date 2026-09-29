import { AI_PROVIDER_IDS, DEFAULT_SETTINGS } from '@/constants/settings';
import type {
  AiConnection,
  AiProvider,
  AiSection,
  AiSettings,
  AppSettings,
  DataSettings,
  SettingsPatch,
  SettingsSection,
  UzumApiSettings,
} from '@/types/settings';

import { resolveAiSettings, withActiveProvider, withAiConnection } from './aiConnections';
import { readKv, removeKv, writeKv } from './idb/kv.repo';
import { KV_KEYS } from './idb/schema';
import { parseStoredSettings, sanitizeSettings, settingsEnvelope } from './settingsSchema';

/**
 * The settings service — the single source of truth for client-side settings.
 *
 * It owns the in-memory snapshot, writes through to IndexedDB on every change,
 * and notifies subscribers. React reads it through `store/settings.store.ts`;
 * non-React callers (the axios interceptor, the buffer's freshness check) read
 * it directly.
 *
 * ## Why the snapshot stays synchronous
 *
 * IndexedDB is asynchronous and localStorage was not, which is the one genuinely
 * awkward consequence of this migration. Two callers cannot tolerate an await:
 * the axios request interceptor, which must attach the token to a request that
 * is already being built, and the read-through layer's freshness check, which
 * runs inside a query function on a hot path.
 *
 * The resolution is to keep the *reads* synchronous and make only the *loading*
 * asynchronous. `hydrate()` runs once, before the first render, and everything
 * afterwards reads the in-memory snapshot. Writes update the snapshot
 * immediately, publish immediately, and persist in the background — so a
 * setting takes effect on the next request whether or not the disk write has
 * landed yet.
 *
 * Until `hydrate()` resolves the snapshot holds the defaults. That is a real
 * state and it is handled honestly rather than papered over: the application
 * bootstraps before rendering (see `app/bootstrap.ts`), so no screen ever
 * observes it, and a browser where storage cannot be opened simply stays in it —
 * an in-memory session rather than a blank screen.
 *
 * ⚠️ Everything stored here is readable by any script on the page. That is fine
 * for a key the user pastes in themselves — it is *their* key, held on *their*
 * machine. Never route a server-side secret through this module.
 */

type Listener = (settings: AppSettings) => void;

const listeners = new Set<Listener>();

let snapshot: AppSettings = DEFAULT_SETTINGS;
let hydrated = false;
let hydrating: Promise<AppSettings> | null = null;

/** The last persistence failure, surfaced in Settings rather than swallowed. */
let lastWriteError: string | null = null;

function publish(): void {
  for (const listener of listeners) listener(snapshot);
}

/* ── hydration ──────────────────────────────────────────────────────────── */

/**
 * Load the stored settings into the snapshot. Idempotent, and safe to await
 * from several places — concurrent callers share one read.
 */
export function hydrateSettings(): Promise<AppSettings> {
  if (hydrated) return Promise.resolve(snapshot);
  if (hydrating !== null) return hydrating;

  hydrating = (async () => {
    try {
      const stored = await readKv<unknown>(KV_KEYS.settings);
      snapshot = parseStoredSettings(stored);
    } catch {
      /* Storage refused. The defaults are already in place and the session
         continues in memory; the failure is reported through `storageError`. */
      lastWriteError = 'Settings could not be read from local storage';
      snapshot = DEFAULT_SETTINGS;
    }

    hydrated = true;
    publish();
    return snapshot;
  })();

  return hydrating;
}

/** Whether the stored settings have been loaded yet. */
export function isHydrated(): boolean {
  return hydrated;
}

export function storageError(): string | null {
  return lastWriteError;
}

/* ── persistence ────────────────────────────────────────────────────────── */

/**
 * Write the snapshot out.
 *
 * Deliberately not awaited by callers. A settings change has already taken
 * effect in memory by the time this runs, and blocking a form's submit handler
 * on a disk write would make the interface feel slower for no gain in
 * correctness. A failure is recorded rather than thrown, and Settings can show
 * it.
 */
function persist(next: AppSettings): void {
  void writeKv(KV_KEYS.settings, settingsEnvelope(next))
    .then(() => {
      lastWriteError = null;
    })
    .catch((error: unknown) => {
      lastWriteError = error instanceof Error ? error.message : 'Settings could not be saved';
    });
}

/**
 * Every section but `ai` holds primitives only, so a shallow key-by-key
 * compare is an exact compare for them. `ai` nests a `providers` map and
 * needs `reconcileAi` below instead.
 */
function sameSection<T extends object>(previous: T, next: T): boolean {
  return (Object.keys(previous) as Array<keyof T>).every((key) => previous[key] === next[key]);
}

/** Field-by-field equality for one provider's connection — every field on
 * `AiConnection` is a primitive, so this is a complete compare, not a subset
 * chosen for one screen. */
function sameConnection(previous: AiConnection, next: AiConnection): boolean {
  return (
    previous === next ||
    (previous.baseUrl === next.baseUrl &&
      previous.apiKey === next.apiKey &&
      previous.model === next.model &&
      previous.timeoutMs === next.timeoutMs &&
      previous.temperature === next.temperature &&
      previous.maxTokens === next.maxTokens &&
      previous.orgId === next.orgId &&
      previous.projectId === next.projectId &&
      previous.reasoningEffort === next.reasoningEffort &&
      previous.anthropicVersion === next.anthropicVersion &&
      previous.thinkingLevel === next.thinkingLevel &&
      previous.appUrl === next.appUrl &&
      previous.appTitle === next.appTitle &&
      previous.thinking === next.thinking)
  );
}

/**
 * `ai`'s own equality: the active pointer compares like any primitive field,
 * and every one of the nine connections compares field by field — `sanitizeAi`
 * rebuilds all nine fresh on every pass, even the eight nobody touched, so a
 * reference compare on the whole section would treat an unrelated settings
 * write (saving the Uzum token, say) as a change to every provider's card.
 */
function sameAiSection(previous: AiSection, next: AiSection): boolean {
  return (
    previous.provider === next.provider &&
    AI_PROVIDER_IDS.every((id) => sameConnection(previous.providers[id], next.providers[id]))
  );
}

/**
 * Reconcile `ai` at the grain of one provider's connection, not the section
 * as a whole. Even when the section did change overall — a different
 * provider made active, one card's field committed — every *other*
 * provider's connection object is carried over by reference, so a card
 * memoized on its own provider's entry never re-renders because a sibling
 * card, or the active pointer, changed.
 */
function reconcileAi(previous: AiSection, next: AiSection): AiSection {
  if (sameAiSection(previous, next)) return previous;

  const providers = {} as Record<AiProvider, AiConnection>;
  for (const id of AI_PROVIDER_IDS) {
    const previousConnection = previous.providers[id];
    const nextConnection = next.providers[id];
    providers[id] = sameConnection(previousConnection, nextConnection)
      ? previousConnection
      : nextConnection;
  }

  return { provider: next.provider, providers };
}

/**
 * Keep the identity of every section that did not actually change, so a
 * component subscribed to `settings.ai` does not re-render when the API token
 * is saved.
 */
function reconcile(previous: AppSettings, next: AppSettings): AppSettings {
  const api = sameSection(previous.api, next.api) ? previous.api : next.api;
  const ai = reconcileAi(previous.ai, next.ai);
  const features = sameSection(previous.features, next.features)
    ? previous.features
    : next.features;
  const data = sameSection(previous.data, next.data) ? previous.data : next.data;

  if (
    api === previous.api &&
    ai === previous.ai &&
    features === previous.features &&
    data === previous.data
  ) {
    return previous;
  }
  return { api, ai, features, data };
}

/** Update the snapshot, notify, then persist — in that order, always. */
function commit(next: AppSettings): AppSettings {
  if (next === snapshot) return snapshot;

  snapshot = next;
  publish();
  persist(next);
  return snapshot;
}

/* ── read ───────────────────────────────────────────────────────────────── */

export function getSettings(): AppSettings {
  return snapshot;
}

export function getSection<K extends SettingsSection>(section: K): AppSettings[K] {
  return snapshot[section];
}

/** Read outside React — the axios interceptor needs this synchronously. */
export const readApiSettings = (): UzumApiSettings => snapshot.api;

/**
 * Buffer policy, read outside React.
 *
 * The read-through layer consults this on every source read, and it runs inside
 * a query function rather than a component, so it cannot go through the store.
 */
export const readDataSettings = (): DataSettings => snapshot.data;

/**
 * The active provider's configuration, resolved and flattened, for callers
 * outside React — the AI transport builds a request from exactly this shape.
 * Mirrors `readApiSettings`/`readDataSettings`: a synchronous read of the
 * committed snapshot, never a copy a caller could hold past the next write.
 */
export const readAiSettings = (): AiSettings => resolveAiSettings(snapshot.ai);

/* ── write ──────────────────────────────────────────────────────────────── */

/**
 * Merge a partial patch over the current settings. The result is sanitised
 * before it is stored, so a value that is out of range in the UI is clamped
 * once, here, rather than checked at every call site.
 */
export function updateSettings(patch: SettingsPatch): AppSettings {
  const merged: AppSettings = {
    api: patch.api === undefined ? snapshot.api : { ...snapshot.api, ...patch.api },
    ai: patch.ai === undefined ? snapshot.ai : { ...snapshot.ai, ...patch.ai },
    features:
      patch.features === undefined
        ? snapshot.features
        : { ...snapshot.features, ...patch.features },
    data: patch.data === undefined ? snapshot.data : { ...snapshot.data, ...patch.data },
  };

  return commit(reconcile(snapshot, sanitizeSettings(merged)));
}

/**
 * Replace one provider's connection with `patch` merged over what it already
 * held. Reads `snapshot.ai` at call time — never a value a caller captured
 * earlier — so two cards editing different providers back to back can never
 * race: the second write starts from whatever the first one actually
 * committed. `withAiConnection` touches only `provider`'s own entry; every
 * other provider's connection, including the active one when a different
 * provider is being edited, passes through `sanitizeSettings` and `reconcile`
 * unchanged in value and, via `reconcileAi`, in identity too.
 */
export function updateAiConnection(provider: AiProvider, patch: Partial<AiConnection>): AppSettings {
  const merged: AppSettings = { ...snapshot, ai: withAiConnection(snapshot.ai, provider, patch) };
  return commit(reconcile(snapshot, sanitizeSettings(merged)));
}

/**
 * Make `provider` the one the Copilot uses. Moves only the active pointer —
 * `withActiveProvider` copies, moves or clears nothing — so every provider's
 * configuration, the one just left and the one just entered alike, reads back
 * exactly as it was last saved.
 */
export function setActiveAiProvider(provider: AiProvider): AppSettings {
  const merged: AppSettings = { ...snapshot, ai: withActiveProvider(snapshot.ai, provider) };
  return commit(reconcile(snapshot, sanitizeSettings(merged)));
}

/** Replace one section wholesale. */
export function setSection<K extends SettingsSection>(
  section: K,
  value: AppSettings[K],
): AppSettings {
  /* `Pick<SettingsPatch, K>` is exactly this object; the assertion is only
     needed because TypeScript cannot infer that shape from a computed key. */
  return updateSettings({ [section]: value } as Pick<SettingsPatch, K>);
}

/* ── reset ──────────────────────────────────────────────────────────────── */

/** Drop the stored record entirely and restore the defined defaults. */
export function resetSettings(): AppSettings {
  snapshot = DEFAULT_SETTINGS;
  publish();

  /* `.catch` here, not only inside `persist`'s own write: `removeKv` can
     reject on its own (storage unavailable, a quota error) before `persist`
     ever runs, and that rejection needs a handler of its own or it surfaces
     as an unhandled promise rejection rather than the recorded write error
     every other failure here becomes. */
  void removeKv(KV_KEYS.settings)
    .then(() => {
      persist(DEFAULT_SETTINGS);
    })
    .catch((error: unknown) => {
      lastWriteError = error instanceof Error ? error.message : 'Settings could not be saved';
    });

  return snapshot;
}

/** Restore the defaults for one section, leaving the others untouched. */
export function resetSection(section: SettingsSection): AppSettings {
  const next: AppSettings = {
    api: section === 'api' ? DEFAULT_SETTINGS.api : snapshot.api,
    ai: section === 'ai' ? DEFAULT_SETTINGS.ai : snapshot.ai,
    features: section === 'features' ? DEFAULT_SETTINGS.features : snapshot.features,
    data: section === 'data' ? DEFAULT_SETTINGS.data : snapshot.data,
  };

  return commit(reconcile(snapshot, next));
}

/* ── subscribe ──────────────────────────────────────────────────────────── */

export function subscribeToSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Seed the snapshot without touching storage.
 *
 * Used by the one-shot localStorage import, which has already read the previous
 * engine's payload and needs the running application to adopt it before the
 * first write goes out. Nothing else should call this.
 */
export function adoptSettings(settings: AppSettings): void {
  snapshot = sanitizeSettings(settings);
  hydrated = true;
  publish();
}
