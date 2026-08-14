import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Language, ThemeMode } from '@/types/domain';

/**
 * User preferences.
 *
 * Every row here changes something observable, which is the whole reason it is
 * a setting: `currency` and `numberFormat` are read by the formatter,
 * `timezone` by every timestamp on screen, and `criticalAlerts`/`sound` by the
 * notification log. A switch that toggled nothing would be a lie with a nice
 * animation, so there are none.
 */
export interface GeneralPreferences {
  /** Suffix every money figure carries. */
  readonly currency: 'UZS' | 'USD';
  /** IANA zone that timestamps and demand buckets are rendered in. */
  readonly timezone: string;
  /** Decimal separator; thousands are always a thin space. */
  readonly numberFormat: 'space-dot' | 'space-comma';
  /** Raise a browser notification when something critical is logged. */
  readonly criticalAlerts: boolean;
  /** Play a short tone with it. */
  readonly sound: boolean;
}

export const DEFAULT_GENERAL: GeneralPreferences = {
  currency: 'UZS',
  timezone: 'Asia/Tashkent',
  numberFormat: 'space-dot',
  criticalAlerts: true,
  sound: false,
};

interface PreferencesState {
  readonly theme: ThemeMode;
  readonly language: Language;
  readonly general: GeneralPreferences;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setLanguage: (language: Language) => void;
  cycleLanguage: () => void;
  patchGeneral: (patch: Partial<GeneralPreferences>) => void;
  resetGeneral: () => void;
}

const LANGUAGE_CYCLE: readonly Language[] = ['uz', 'en', 'ru'];

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'dark',
      language: 'uz',
      general: DEFAULT_GENERAL,

      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

      setLanguage: (language) => set({ language }),
      cycleLanguage: () =>
        set((state) => {
          const index = LANGUAGE_CYCLE.indexOf(state.language);
          const next = LANGUAGE_CYCLE[(index + 1) % LANGUAGE_CYCLE.length];
          return { language: next ?? 'uz' };
        }),

      patchGeneral: (patch) =>
        set((state) => ({ general: { ...state.general, ...patch } })),
      resetGeneral: () => set({ general: DEFAULT_GENERAL }),
    }),
    {
      name: 'savdo.preferences',
      /* v2 dropped two toggles that nothing in this build could honour. */
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<PreferencesState> | null;
        const stored = state?.general as Record<string, unknown> | undefined;
        if (state === null || stored === undefined) return state as PreferencesState;

        /* Keep only the keys v2 still has; the defaults fill any gap. */
        const general = { ...DEFAULT_GENERAL };
        for (const key of Object.keys(DEFAULT_GENERAL) as Array<keyof GeneralPreferences>) {
          const value = stored[key];
          if (value !== undefined) Object.assign(general, { [key]: value });
        }
        return { ...state, general } as PreferencesState;
      },
    },
  ),
);

/** Read outside React — the formatter is called from non-component code. */
export const readGeneralPreferences = (): GeneralPreferences =>
  usePreferencesStore.getState().general;
