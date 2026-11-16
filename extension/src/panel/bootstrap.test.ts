import { describe, expect, it, vi } from 'vitest';

const { order, note } = vi.hoisted(() => {
  const log: string[] = [];
  return {
    order: { log },
    note: (name: string) => () => {
      log.push(name);
    },
  };
});

vi.mock('@ext/uzum/client', () => ({ connectBridge: note('connectBridge') }));
vi.mock('./frameLink', () => ({ startFrameLink: note('startFrameLink') }));
vi.mock('./settingsSync', () => ({ wireSettingsRefresh: note('wireSettingsRefresh') }));
vi.mock('@core/storage/kv', () => ({ registerKvBackend: note('registerKvBackend') }));
vi.mock('@core/settings/settings.service', () => ({
  refreshSettings: async () => true,
  hydrateSettings: async () => {
    order.log.push('hydrateSettings');
  },
}));
vi.mock('@core/state/preferences.store', () => ({
  PREFERENCES_STORAGE_KEY: 'prefs',
  installPreferencesStorage: async () => {
    order.log.push('installPreferencesStorage');
  },
  rehydratePreferences: async () => undefined,
  usePreferencesStore: { getState: () => ({ language: 'uz' }) },
}));
vi.mock('@core/state/modelUsage.store', () => ({
  initModelUsageSync: note('initModelUsageSync'),
  restoreModelUsage: async () => {
    order.log.push('restoreModelUsage');
  },
}));
vi.mock('@core/ui/shell/theme', () => ({
  applyTheme: note('applyTheme'),
  currentResolvedTheme: () => 'dark',
}));
vi.mock('@ext/storage', () => ({
  chromeStorageKvBackend: {},
  devLocalStorageKvBackend: {},
  hasExtensionStorage: () => true,
  onKvChanged: () => () => undefined,
  createChromePreferencesStorage: () => ({ storage: {}, watch: () => () => undefined }),
}));

import { bootstrapPanel, chooseStorage } from './bootstrap';

describe('chooseStorage', () => {
  it('uses extension storage whenever the API exists', () => {
    expect(chooseStorage({ hasExtensionStorage: true, isDevBuild: false })).toBe('extension');
    expect(chooseStorage({ hasExtensionStorage: true, isDevBuild: true })).toBe('extension');
  });

  it('falls back to localStorage only in a dev build outside an extension', () => {
    expect(chooseStorage({ hasExtensionStorage: false, isDevBuild: true })).toBe('dev');
  });

  it('never falls back silently inside an installed extension', () => {
    expect(chooseStorage({ hasExtensionStorage: false, isDevBuild: false })).toBe('unavailable');
  });
});

describe('bootstrapPanel order', () => {
  it('installs the bridge listener and frame link synchronously, before any awaited storage read', async () => {
    Object.defineProperty(globalThis, 'document', {
      value: { documentElement: {} },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    order.log.length = 0;
    const started = bootstrapPanel();
    /* No await has happened yet: these two are already done. */
    expect(order.log.slice(0, 2)).toEqual(['connectBridge', 'startFrameLink']);

    await started;
    expect(order.log.indexOf('connectBridge')).toBeLessThan(order.log.indexOf('installPreferencesStorage'));
    expect(order.log.indexOf('startFrameLink')).toBeLessThan(order.log.indexOf('hydrateSettings'));
  });
});
