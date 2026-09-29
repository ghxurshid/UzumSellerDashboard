import { create } from 'zustand';

import { describeModel } from '@/constants/settings';
import { resolveAiSettings } from '@/services/storage/aiConnections';
import {
  getSettings,
  resetSettings,
  setActiveAiProvider,
  subscribeToSettings,
  updateAiConnection,
  updateSettings,
} from '@/services/storage/settings.service';
import type {
  AiConnection,
  AiProvider,
  AiSection,
  AiSettings,
  AppSettings,
  FeatureFlags,
  SettingsPatch,
  UzumApiSettings,
} from '@/types/settings';

/**
 * React binding for the settings service.
 *
 * The service — not this store — is the source of truth: it owns the snapshot
 * and the write to IndexedDB. This store only mirrors it so components can
 * subscribe, which is why every action delegates rather than calling `set`.
 * A settings change made outside React therefore still repaints the UI.
 *
 * The snapshot is loaded by `bootstrap()` before the first render, so this store
 * never hands React a half-loaded configuration — see the hydration note in
 * `services/storage/settings.service.ts` for why the reads stayed synchronous
 * when the engine underneath did not.
 */
interface SettingsState {
  readonly settings: AppSettings;
  /** Each action returns the stored result, so a form can re-seed from it. */
  patch: (patch: SettingsPatch) => AppSettings;
  resetAll: () => AppSettings;
  /** One provider's own card committing a field — never touches another provider's entry. */
  updateAiConnection: (provider: AiProvider, patch: Partial<AiConnection>) => AppSettings;
  /** The "make active" button — moves the pointer, copies nothing. */
  setActiveAiProvider: (provider: AiProvider) => AppSettings;
}

/**
 * Only what the UI actually calls is bound here. The service keeps the wider
 * typed surface — `getSection`, `setSection`, `resetSection` — for callers
 * outside React.
 */
export const useSettingsStore = create<SettingsState>()(() => ({
  settings: getSettings(),

  patch: (patch) => updateSettings(patch),
  resetAll: () => resetSettings(),
  updateAiConnection: (provider, patch) => updateAiConnection(provider, patch),
  setActiveAiProvider: (provider) => setActiveAiProvider(provider),
}));

subscribeToSettings((settings) => useSettingsStore.setState({ settings }));

/* ── selectors ──────────────────────────────────────────────────────────── */

export const useApiSettings = (): UzumApiSettings =>
  useSettingsStore((state) => state.settings.api);

/** Every provider's own configuration, side by side, plus the active pointer. */
export const useAiSection = (): AiSection => useSettingsStore((state) => state.settings.ai);

export const useFeatureFlags = (): FeatureFlags =>
  useSettingsStore((state) => state.settings.features);

/**
 * `resolveAiSettings` builds a fresh object on every call — right for a plain
 * function, wrong for a `useSyncExternalStore` selector, which must hand back
 * the *same* reference when nothing it reads has changed or React re-renders
 * forever chasing a snapshot that is never equal to itself. `reconcileAi` in
 * `settings.service.ts` already keeps every untouched provider's `AiConnection`
 * object referentially identical across a write that touched a different
 * provider, so keying this cache on that object's identity is enough to make
 * the resolved result stable too — one slot per provider, at most nine live at
 * once, never growing beyond the catalogue's own size.
 */
const resolvedCache = new Map<AiProvider, { readonly connection: AiConnection; readonly resolved: AiSettings }>();

function cachedResolve(section: AiSection, provider: AiProvider): AiSettings {
  const connection = section.providers[provider];
  const cached = resolvedCache.get(provider);
  if (cached !== undefined && cached.connection === connection) return cached.resolved;

  const resolved = resolveAiSettings(section, provider);
  resolvedCache.set(provider, { connection, resolved });
  return resolved;
}

/** The active provider's configuration, resolved — what the chat and the insights rail send a request with. */
export const useAiSettings = (): AiSettings =>
  useSettingsStore((state) => cachedResolve(state.settings.ai, state.settings.ai.provider));

/** One provider's own configuration, resolved — for that provider's own card, whether or not it is active. */
export const useAiProviderSettings = (provider: AiProvider): AiSettings =>
  useSettingsStore((state) => cachedResolve(state.settings.ai, provider));

/**
 * Display name of the active model, for the chrome and the chat header.
 *
 * Reads through `cachedResolve`, not `state.settings.ai.providers[...]`
 * directly — `aiConnections.ts`'s own contract is that nothing above storage
 * reaches into `AiSection.providers` itself, and this selector is no
 * exception just because it only wants one field off the result.
 */
export const useAiModelLabel = (): string =>
  useSettingsStore((state) => describeModel(cachedResolve(state.settings.ai, state.settings.ai.provider)));
