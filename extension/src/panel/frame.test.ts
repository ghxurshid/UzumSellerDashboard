import { describe, expect, it } from 'vitest';

import { parsePanelMessage } from '@ext/content/frameProtocol';

import { closeMessage, parseVisibility, prefsMessage, toggleMessage } from './frame';

describe('what the panel sends', () => {
  it('builds messages the frame itself accepts', () => {
    expect(parsePanelMessage(closeMessage())).toEqual({ type: 'frame.close' });
    expect(parsePanelMessage(toggleMessage())).toEqual({ type: 'frame.toggle' });
    expect(parsePanelMessage(prefsMessage('light', 'ru'))).toEqual({
      type: 'panel.prefs',
      payload: { theme: 'light', language: 'ru' },
    });
  });
});

describe('parseVisibility', () => {
  it('reads a well-formed frame.visibility', () => {
    expect(parseVisibility({ type: 'frame.visibility', payload: { open: true } })).toBe(true);
    expect(parseVisibility({ type: 'frame.visibility', payload: { open: false } })).toBe(false);
  });

  it('refuses everything else', () => {
    expect(parseVisibility({ type: 'frame.visibility' })).toBeNull();
    expect(parseVisibility({ type: 'frame.visibility', payload: null })).toBeNull();
    expect(parseVisibility({ type: 'frame.visibility', payload: 'open' })).toBeNull();
    expect(parseVisibility({ type: 'frame.visibility', payload: { open: 'true' } })).toBeNull();
    expect(parseVisibility({ type: 'frame.visibility', payload: { open: 1 } })).toBeNull();
    expect(parseVisibility({ type: 'frame.close', payload: { open: true } })).toBeNull();
  });
});
