import { describe, expect, it } from 'vitest';

import { FRAME_CLOSE, FRAME_TOGGLE, PANEL_PREFS } from './frameMessages';
import { parsePanelMessage, parsePrefs } from './frameProtocol';
import { INITIAL_FRAME_STATE, reduceFrame } from './frameState';
import { buildFrameUrl, createNonce } from './nonce';
import { languageFromBrowser, resolvePrefs, stringsFor } from './prefs';
import { isToggleShortcut } from './shortcut';
import {
  createUiStorage,
  isContextInvalidated,
  UI_OPEN_KEY,
  UI_PREFS_KEY,
  type UiStorageArea,
} from './uiStorage';

function fakeArea(initial: Record<string, unknown> = {}): UiStorageArea & {
  data: Record<string, unknown>;
} {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items) {
      Object.assign(data, items);
    },
  };
}

describe('frame state', () => {
  it('mounts on the first open and stays mounted after closing', () => {
    let s = reduceFrame(INITIAL_FRAME_STATE, { type: 'toggle' });
    expect(s).toMatchObject({ open: true, mounted: true });
    s = reduceFrame(s, { type: 'close' });
    expect(s).toMatchObject({ open: false, mounted: true });
    s = reduceFrame(s, { type: 'toggle' });
    expect(s.open).toBe(true);
  });

  it('does not mount before the first open', () => {
    expect(reduceFrame(INITIAL_FRAME_STATE, { type: 'close' }).mounted).toBe(false);
    expect(reduceFrame(INITIAL_FRAME_STATE, { type: 'restore', open: false }).mounted).toBe(false);
  });

  it('restores the remembered open state', () => {
    expect(reduceFrame(INITIAL_FRAME_STATE, { type: 'restore', open: true })).toMatchObject({
      open: true,
      mounted: true,
    });
  });

  it('lets the seller win over a restore that arrives late', () => {
    const closedByUser = reduceFrame(INITIAL_FRAME_STATE, { type: 'close' });
    expect(reduceFrame(closedByUser, { type: 'restore', open: true }).open).toBe(false);
  });
});

describe('storage round trip', () => {
  const never = (): never => {
    throw new Error('not expected');
  };

  it('saves and loads the open flag and the prefs', async () => {
    const area = fakeArea();
    const store = createUiStorage(() => area, never);
    expect(await store.loadOpen()).toBe(false);
    await store.saveOpen(true);
    expect(area.data[UI_OPEN_KEY]).toBe(true);
    expect(await store.loadOpen()).toBe(true);

    await store.savePrefs({ theme: 'light', language: 'ru' });
    expect(await store.loadPrefs()).toEqual({ theme: 'light', language: 'ru' });
  });

  it('treats malformed stored prefs as unknown', async () => {
    const store = createUiStorage(() => fakeArea({ [UI_PREFS_KEY]: { theme: 'pink' } }), never);
    expect(await store.loadPrefs()).toBeNull();
  });

  it('survives a missing storage API', async () => {
    const store = createUiStorage(() => null, never);
    expect(await store.loadOpen()).toBe(false);
    expect(await store.loadPrefs()).toBeNull();
    await expect(store.saveOpen(true)).resolves.toBeUndefined();
  });

  it('survives a failing storage API without reporting it as a dead context', async () => {
    const broken: UiStorageArea = {
      get: () => Promise.reject(new Error('quota')),
      set: () => Promise.reject(new Error('quota')),
    };
    const store = createUiStorage(() => broken, never);
    expect(await store.loadOpen()).toBe(false);
    await expect(store.savePrefs({ theme: 'dark', language: 'uz' })).resolves.toBeUndefined();
  });

  it('reports a dead extension context', async () => {
    let reported = 0;
    const store = createUiStorage(
      () => {
        throw new Error('Extension context invalidated.');
      },
      () => (reported += 1),
    );
    expect(await store.loadOpen()).toBe(false);
    expect(reported).toBe(1);
    expect(isContextInvalidated(new Error('Extension context invalidated.'))).toBe(true);
    expect(isContextInvalidated(new Error('other'))).toBe(false);
  });
});

describe('nonce and frame url', () => {
  it('is 32 lowercase hex characters from 16 random bytes', () => {
    expect(createNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createNonce()));
    expect(seen.size).toBe(200);
  });

  it('encodes the bytes it is given, zero padded', () => {
    expect(createNonce((b) => b.fill(1), 4)).toBe('01010101');
  });

  it('puts only the reload counter in the URL', () => {
    expect(buildFrameUrl('chrome-extension://abc/panel.html', 0)).toBe(
      'chrome-extension://abc/panel.html?r=0',
    );
  });

  it('never repeats a URL across reloads and never carries the nonce', () => {
    const nonce = createNonce();
    const urls = [0, 1, 2, 3].map((n) => buildFrameUrl('x://a/panel.html', n));
    expect(new Set(urls).size).toBe(4);
    for (const url of urls) {
      expect(url).not.toContain(nonce);
      expect(url).not.toContain('#');
    }
  });
});

describe('frame messages', () => {
  it('accepts the three panel messages', () => {
    expect(parsePanelMessage({ type: FRAME_CLOSE })).toEqual({ type: FRAME_CLOSE });
    expect(parsePanelMessage({ type: FRAME_TOGGLE, payload: 1 })).toEqual({ type: FRAME_TOGGLE });
    expect(
      parsePanelMessage({
        type: PANEL_PREFS,
        payload: { theme: 'dark', language: 'en', extra: 'x' },
      }),
    ).toEqual({ type: PANEL_PREFS, payload: { theme: 'dark', language: 'en' } });
  });

  it('rejects unknown types and malformed prefs', () => {
    expect(parsePanelMessage({ type: 'frame.explode' })).toBeNull();
    expect(parsePanelMessage({ type: PANEL_PREFS })).toBeNull();
    expect(parsePanelMessage({ type: PANEL_PREFS, payload: { theme: 'dark' } })).toBeNull();
    expect(parsePanelMessage({ type: PANEL_PREFS, payload: { theme: 'x', language: 'uz' } })).toBeNull();
    expect(parsePanelMessage({ type: PANEL_PREFS, payload: { theme: 'dark', language: 'de' } })).toBeNull();
    expect(parsePrefs(null)).toBeNull();
    expect(parsePrefs([])).toBeNull();
  });
});

describe('prefs resolution', () => {
  it('maps browser languages, defaulting to Uzbek', () => {
    expect(languageFromBrowser(['ru-RU', 'en'])).toBe('ru');
    expect(languageFromBrowser(['de', 'en-GB'])).toBe('en');
    expect(languageFromBrowser(['UZ'])).toBe('uz');
    expect(languageFromBrowser(['de', 'fr'])).toBe('uz');
    expect(languageFromBrowser([])).toBe('uz');
  });

  it('prefers the stored choice over the environment', () => {
    const env = { languages: ['en'], prefersDark: true };
    expect(resolvePrefs({ theme: 'light', language: 'ru' }, env)).toEqual({
      theme: 'light',
      language: 'ru',
    });
    expect(resolvePrefs(null, env)).toEqual({ theme: 'dark', language: 'en' });
    expect(resolvePrefs(null, { languages: [], prefersDark: false })).toEqual({
      theme: 'light',
      language: 'uz',
    });
  });

  it('has every string in every language', () => {
    for (const lang of ['en', 'ru', 'uz'] as const) {
      const s = stringsFor(lang);
      expect(s.openLabel).not.toBe('');
      expect(s.closeLabel).not.toBe('');
      expect(s.frameTitle).not.toBe('');
    }
  });
});

describe('shortcut', () => {
  const base = { key: 'j', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

  it('matches Ctrl+J and Cmd+J, any case', () => {
    expect(isToggleShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isToggleShortcut({ ...base, metaKey: true, key: 'J' })).toBe(true);
  });

  it('matches the physical key on a non-Latin layout', () => {
    expect(isToggleShortcut({ ...base, ctrlKey: true, key: 'о', code: 'KeyJ' })).toBe(true);
  });

  it('ignores other modifiers and keys', () => {
    expect(isToggleShortcut(base)).toBe(false);
    expect(isToggleShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isToggleShortcut({ ...base, ctrlKey: true, altKey: true })).toBe(false);
    expect(isToggleShortcut({ ...base, ctrlKey: true, metaKey: true })).toBe(false);
    expect(isToggleShortcut({ ...base, ctrlKey: true, key: 'k' })).toBe(false);
  });
});
