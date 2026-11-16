import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { Language, ThemeMode } from '@core/types/common';

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

/* ── where the preferences live ─────────────────────────────────────────── */

/** The key the site has always used; a host that migrates data keeps it. */
export const PREFERENCES_STORAGE_KEY = 'savdo.preferences';

/**
 * The site's own backend: `localStorage`, read synchronously.
 *
 * Synchronous on purpose. The theme and the language are applied before the
 * first paint, and a backend that answered a tick later would flash the
 * defaults at every reload. Looked up on each call rather than captured, so a
 * missing or blocked `localStorage` degrades to "nothing stored" instead of
 * throwing at import.
 */
const localBackend: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* A preference that cannot be saved still applies for this session. */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* Nothing to remove from storage that cannot be reached. */
    }
  },
};

let backend: StateStorage = localBackend;

/**
 * What the store actually talks to — a thin forwarder, so replacing the
 * backend later does not require rebuilding the store.
 */
const switchable: StateStorage = {
  getItem: (name) => backend.getItem(name),
  setItem: (name, value) => backend.setItem(name, value),
  removeItem: (name) => backend.removeItem(name),
};

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
      name: PREFERENCES_STORAGE_KEY,
      storage: createJSONStorage(() => switchable),
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

/**
 * Give the store another place to live, and read what that place holds.
 *
 * For a host whose storage is asynchronous or not `localStorage` at all — the
 * browser extension keeps preferences in `chrome.storage.local`, because a
 * page inside someone else's iframe cannot count on `localStorage`. The site
 * never calls this: it keeps the synchronous `localStorage` default, which
 * hydrates during module evaluation.
 *
 * Await it before the first render. The store has already hydrated once from
 * the default backend by the time a host runs (module evaluation cannot wait),
 * so the call replaces that state with what the host's storage holds; a host
 * whose storage is empty keeps the defaults and writes on the first change.
 * The version and `migrate` above apply to whatever the backend returns.
 */
export async function installPreferencesStorage(storage: StateStorage): Promise<void> {
  backend = storage;
  await usePreferencesStore.persist.rehydrate();
}

/**
 * Read the installed backend again — for a host that learns the stored value
 * changed elsewhere (another context wrote it) and wants this one to follow.
 */
export async function rehydratePreferences(): Promise<void> {
  await usePreferencesStore.persist.rehydrate();
}
