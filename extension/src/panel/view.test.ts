import { describe, expect, it } from 'vitest';

import { INITIAL_VIEW, reduceView, SETTINGS_TABS, tabAfterKey } from './view';

describe('reduceView', () => {
  it('starts on the chat, with General as the tab settings will open on', () => {
    expect(INITIAL_VIEW).toEqual({ view: 'chat', tab: 'general' });
  });

  it('opens settings on the tab last used unless one is named', () => {
    const onKeyboard = reduceView(INITIAL_VIEW, { type: 'selectTab', tab: 'keyboard' });
    expect(reduceView(onKeyboard, { type: 'openSettings' })).toEqual({
      view: 'settings',
      tab: 'keyboard',
    });
    expect(reduceView(onKeyboard, { type: 'openSettings', tab: 'ai' })).toEqual({
      view: 'settings',
      tab: 'ai',
    });
  });

  it('goes back to the chat and remembers the tab', () => {
    const open = reduceView(INITIAL_VIEW, { type: 'openSettings', tab: 'ai' });
    const back = reduceView(open, { type: 'back' });
    expect(back).toEqual({ view: 'chat', tab: 'ai' });
    expect(reduceView(back, { type: 'back' })).toBe(back);
  });

  it('returns the same object for a no-op tab selection', () => {
    expect(reduceView(INITIAL_VIEW, { type: 'selectTab', tab: 'general' })).toBe(INITIAL_VIEW);
  });
});

describe('tab order and keys', () => {
  it('has exactly the three tabs, General, AI, Keyboard, in that order', () => {
    expect(SETTINGS_TABS).toEqual(['general', 'ai', 'keyboard']);
  });

  it('walks with the arrows and wraps at both ends', () => {
    expect(tabAfterKey('general', 'ArrowRight')).toBe('ai');
    expect(tabAfterKey('keyboard', 'ArrowRight')).toBe('general');
    expect(tabAfterKey('general', 'ArrowLeft')).toBe('keyboard');
    expect(tabAfterKey('ai', 'ArrowLeft')).toBe('general');
  });

  it('jumps with Home and End and ignores every other key', () => {
    expect(tabAfterKey('ai', 'Home')).toBe('general');
    expect(tabAfterKey('ai', 'End')).toBe('keyboard');
    expect(tabAfterKey('ai', 'a')).toBeNull();
    expect(tabAfterKey('ai', 'Enter')).toBeNull();
  });
});
