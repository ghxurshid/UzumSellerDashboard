import { create } from 'zustand';

import { describeModel } from '@/constants/settings';
import {
  getSettings,
  resetSettings,
  subscribeToSettings,
  updateSettings,
} from '@/services/storage/settings.service';
import type {
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
}));

subscribeToSettings((settings) => useSettingsStore.setState({ settings }));

/* ── selectors ──────────────────────────────────────────────────────────── */

export const useApiSettings = (): UzumApiSettings =>
  useSettingsStore((state) => state.settings.api);

export const useAiSettings = (): AiSettings => useSettingsStore((state) => state.settings.ai);

export const useFeatureFlags = (): FeatureFlags =>
  useSettingsStore((state) => state.settings.features);

/** Display name of the configured model, for the chrome and the chat header. */
export const useAiModelLabel = (): string =>
  useSettingsStore((state) => describeModel(state.settings.ai));
