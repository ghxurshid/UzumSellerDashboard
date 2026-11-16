/**
 * Everything that must happen before the panel's first render — the site's
 * bootstrap order, with the same reasons.
 *
 * Storage is asynchronous here (`chrome.storage`), and three things read
 * settings synchronously by design: the AI client builds a request from the
 * snapshot, the settings store hands React a snapshot rather than a promise, and
 * the theme and language are applied before paint. So *loading* is awaited
 * first and everything after it is synchronous; a render that came first would
 * flash the default theme, language and an unconfigured provider before
 * replacing them.
 *
 * ## Order
 *
 *   0. connect the bridge and start listening to the frame — synchronously, first
 *      of all, so the handshake cannot arrive before its listener exists;
 *   1. register the key/value backend, then wire the usage ledger to the
 *      transport — both synchronous and before anything can send a request, so
 *      the first request is the one the quota meter hears about;
 *   2. install the preferences storage and await its rehydration;
 *   3. hydrate settings (the provider and its key);
 *   4. restore the usage ledger, which needs the backend registered in (1);
 *   5. apply the theme and the document language to the page;
 *
 * Fonts are CSS, imported by the entry before any of this runs.
 *
 * Nothing here throws. A storage failure degrades to an in-memory session — the
 * settings service and the usage ledger already do that on their own — and is
 * reported in the result so the caller can say so.
 */
import { registerKvBackend } from '@core/storage/kv';
import { hydrateSettings, refreshSettings } from '@core/settings/settings.service';
import {
  installPreferencesStorage,
  PREFERENCES_STORAGE_KEY,
  rehydratePreferences,
  usePreferencesStore,
} from '@core/state/preferences.store';
import { initModelUsageSync, restoreModelUsage } from '@core/state/modelUsage.store';
import { applyTheme, currentResolvedTheme } from '@core/ui/shell/theme';
import {
  chromeStorageKvBackend,
  createChromePreferencesStorage,
  devLocalStorageKvBackend,
  hasExtensionStorage,
  onKvChanged,
} from '@ext/storage';
import { connectBridge } from '@ext/uzum/client';

import { startFrameLink } from './frameLink';
import { wireSettingsRefresh } from './settingsSync';

export interface PanelStartup {
  /** Which backend the settings and the ledger are kept in. */
  readonly storage: 'extension' | 'dev' | 'unavailable';
  readonly failures: readonly string[];
}

/**
 * The backend choice. An installed extension always gets `chrome.storage` — if
 * that is somehow missing, its calls reject and the session degrades in memory,
 * visibly (`storageError`), instead of quietly writing to something else. The
 * `localStorage` stand-in is for a dev build served outside an extension only.
 */
export function chooseStorage(input: {
  readonly hasExtensionStorage: boolean;
  readonly isDevBuild: boolean;
}): PanelStartup['storage'] {
  if (input.hasExtensionStorage) return 'extension';
  return input.isDevBuild ? 'dev' : 'unavailable';
}

export async function bootstrapPanel(): Promise<PanelStartup> {
  /* First, before any await: this installs the bridge's `message` listener. The
     page side posts the handshake on the iframe's `load`, and nothing may sit
     between module evaluation and this listener — a handshake that arrived while
     storage was still being read would be dropped for good. (An async function
     runs synchronously up to its first await, and `main.tsx` calls it while the
     module script is still evaluating, which is before that `load` can fire.) */
  connectBridge();
  startFrameLink();

  const failures: string[] = [];
  const storage = chooseStorage({
    hasExtensionStorage: hasExtensionStorage(),
    isDevBuild: import.meta.env.DEV,
  });

  registerKvBackend(storage === 'dev' ? devLocalStorageKvBackend : chromeStorageKvBackend);
  initModelUsageSync();

  if (storage === 'extension') {
    try {
      const preferences = createChromePreferencesStorage();
      await installPreferencesStorage(preferences.storage);
      /* A theme or language changed in another cabinet tab reaches this one. */
      preferences.watch(PREFERENCES_STORAGE_KEY, () => void rehydratePreferences());
    } catch {
      failures.push('Preferences could not be read from extension storage');
    }
  }

  await hydrateSettings();
  /* Another cabinet tab's panel may save settings; this one re-reads before it
     can overwrite them with a stale snapshot. */
  if (storage === 'extension') {
    wireSettingsRefresh({
      onKvChanged,
      refresh: refreshSettings,
      win: window,
      doc: document,
    });
  }
  await restoreModelUsage();

  applyTheme(currentResolvedTheme());
  document.documentElement.lang = usePreferencesStore.getState().language;

  return { storage, failures };
}
