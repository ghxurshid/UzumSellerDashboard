import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/constants/settings';

import {
  getSettings,
  readAiSettings,
  resetSettings,
  setActiveAiProvider,
  updateAiConnection,
  updateSettings,
} from './settings.service';

/**
 * The settings service's AI writers.
 *
 * `writeKv` rejects in this node test environment — there is no `indexedDB`
 * global — but `persist()` swallows that rejection (see the module's own
 * doc), so every write here still lands on the in-memory snapshot
 * synchronously; only the disk copy silently fails, which is exactly the
 * degraded-but-usable behaviour a browser with storage disabled gets too.
 *
 * `resetSettings()` runs before each test so the module-level snapshot — a
 * singleton for the whole process — starts every test from `DEFAULT_SETTINGS`
 * rather than whatever the previous test left behind.
 */

beforeEach(() => {
  resetSettings();
});

describe('updateAiConnection — the seller\'s reported bug, pinned', () => {
  it('keeps each provider\'s key independent through a switch: Gemini in, then OpenAI in, then back to Gemini', () => {
    updateAiConnection('gemini', { apiKey: 'gemini-key' });
    updateAiConnection('openai', { apiKey: 'openai-key' });
    const settings = setActiveAiProvider('gemini');

    expect(settings.ai.provider).toBe('gemini');
    expect(settings.ai.providers.gemini.apiKey).toBe('gemini-key');
    expect(settings.ai.providers.openai.apiKey).toBe('openai-key');

    // The active read resolves to the provider now named, with its own key —
    // never the previous one's.
    expect(readAiSettings()).toMatchObject({ provider: 'gemini', apiKey: 'gemini-key' });
  });

  it('sanitises the patch the same way a full write would — an out-of-range value is clamped, not stored raw', () => {
    const settings = updateAiConnection('gemini', { maxTokens: 999_999 });
    expect(settings.ai.providers.gemini.maxTokens).toBeLessThanOrEqual(32_000);
  });

  it('reads `snapshot` at call time, not a value the caller captured earlier', () => {
    updateAiConnection('gemini', { apiKey: 'first' });
    // A caller holding an older snapshot reference still only ever asks the
    // module for the current one — there is no snapshot parameter to stale.
    const settings = updateAiConnection('gemini', { model: 'gemini-3.6-flash' });
    expect(settings.ai.providers.gemini.apiKey).toBe('first');
    expect(settings.ai.providers.gemini.model).toBe('gemini-3.6-flash');
  });
});

describe('setActiveAiProvider', () => {
  it('moves only the pointer, leaving every connection exactly as saved', () => {
    updateAiConnection('claude', { apiKey: 'claude-key' });
    const before = getSettings().ai.providers;

    const settings = setActiveAiProvider('claude');

    expect(settings.ai.provider).toBe('claude');
    expect(settings.ai.providers).toEqual(before);
  });
});

describe('readAiSettings', () => {
  it('resolves the active provider\'s configuration, flattened', () => {
    updateAiConnection('openai', { apiKey: 'openai-key', model: 'gpt-6-sol' });
    setActiveAiProvider('openai');

    const ai = readAiSettings();
    expect(ai.provider).toBe('openai');
    expect(ai.apiKey).toBe('openai-key');
    expect(ai.model).toBe('gpt-6-sol');
  });
});

describe('reconcile identity — ai', () => {
  it('an unrelated write (the Uzum token) does not change the identity of settings.ai', () => {
    const before = getSettings().ai;
    updateSettings({ api: { token: 'a-token' } });
    expect(getSettings().ai).toBe(before);
  });

  it('editing one provider does not change the identity of the other eight connection objects', () => {
    const before = getSettings().ai.providers;
    const untouchedIds = (Object.keys(before) as (keyof typeof before)[]).filter(
      (id) => id !== 'openai',
    );

    updateAiConnection('openai', { apiKey: 'openai-key' });

    const after = getSettings().ai.providers;
    for (const id of untouchedIds) {
      expect(after[id]).toBe(before[id]);
    }
    expect(after.openai).not.toBe(before.openai);
  });

  it('switching the active provider does not change any connection\'s identity', () => {
    const before = getSettings().ai.providers;
    setActiveAiProvider('claude');
    const after = getSettings().ai.providers;

    // The active pointer moving means `ai` itself is a new object — that is
    // an ordinary settings change, not a defect — but every one of the nine
    // connection objects underneath it must be the exact one that was there
    // before, since none of their fields were asked to change.
    for (const id of Object.keys(before) as (keyof typeof before)[]) {
      expect(after[id]).toBe(before[id]);
    }
  });

  it('resetSettings restores the exact default section', () => {
    updateAiConnection('gemini', { apiKey: 'temporary' });
    resetSettings();
    expect(getSettings().ai).toEqual(DEFAULT_SETTINGS.ai);
  });
});
