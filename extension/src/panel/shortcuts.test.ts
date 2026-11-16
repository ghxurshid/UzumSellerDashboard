import { describe, expect, it } from 'vitest';

import { escapeAction, isApplePlatform, isToggleKey, shortcutList, TOGGLE_KEY } from './shortcuts';

const key = (over: Partial<Parameters<typeof isToggleKey>[0]>): Parameters<typeof isToggleKey>[0] => ({
  key: 'j',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('shortcutList', () => {
  it('lists exactly what the extension binds, in the order a new user meets them', () => {
    expect(shortcutList(false).map((s) => s.labelKey)).toEqual([
      'kbToggle',
      'copilotSend',
      'kbNewLine',
      'kbEsc',
    ]);
  });

  it('writes the modifier for the platform, with the key the matcher accepts', () => {
    expect(shortcutList(false)[0]?.keys).toEqual(['Ctrl', TOGGLE_KEY]);
    expect(shortcutList(true)[0]?.keys).toEqual(['⌘', TOGGLE_KEY]);
    /* The listed key and the matcher cannot drift apart. */
    expect(isToggleKey(key({ key: TOGGLE_KEY.toLowerCase(), ctrlKey: true }))).toBe(true);
    expect(isToggleKey(key({ key: TOGGLE_KEY, metaKey: true }))).toBe(true);
  });

  it('has no two entries with the same keys', () => {
    const joined = shortcutList(false).map((s) => s.keys.join('+'));
    expect(new Set(joined).size).toBe(joined.length);
  });
});

describe('isToggleKey', () => {
  it('accepts Ctrl+J, Cmd+J and the physical key on a Cyrillic layout', () => {
    expect(isToggleKey(key({ ctrlKey: true }))).toBe(true);
    expect(isToggleKey(key({ metaKey: true }))).toBe(true);
    expect(isToggleKey(key({ key: 'о', code: 'KeyJ', ctrlKey: true }))).toBe(true);
  });

  it('refuses the browser console and a bare J', () => {
    expect(isToggleKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isToggleKey(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isToggleKey(key({ ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isToggleKey(key({}))).toBe(false);
  });
});

describe('isApplePlatform', () => {
  it('recognises Apple platforms only', () => {
    expect(isApplePlatform('MacIntel')).toBe(true);
    expect(isApplePlatform('macOS')).toBe(true);
    expect(isApplePlatform('iPhone')).toBe(true);
    expect(isApplePlatform('Win32')).toBe(false);
    expect(isApplePlatform('Linux x86_64')).toBe(false);
    expect(isApplePlatform('')).toBe(false);
  });
});

describe('escapeAction', () => {
  const base = {
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    layerOpen: false,
    view: 'chat' as const,
  };

  it('closes the frame from the chat and steps back from settings', () => {
    expect(escapeAction(base)).toBe('close');
    expect(escapeAction({ ...base, view: 'settings' })).toBe('back');
  });

  it('leaves Escape to whatever has a better claim on it', () => {
    expect(escapeAction({ ...base, defaultPrevented: true })).toBe('ignore');
    expect(escapeAction({ ...base, layerOpen: true })).toBe('ignore');
    expect(escapeAction({ ...base, isComposing: true })).toBe('ignore');
  });

  it('ignores every other key', () => {
    expect(escapeAction({ ...base, key: 'Enter' })).toBe('ignore');
    expect(escapeAction({ ...base, key: 'Esc' })).toBe('ignore');
  });
});
