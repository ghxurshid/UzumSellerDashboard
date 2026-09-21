import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FRESHNESS_MINUTES,
  DEFAULT_SETTINGS,
  FRESHNESS_OPTIONS,
  SETTINGS_SCHEMA_VERSION,
} from '@/constants/settings';

import { parseStoredSettings, sanitizeSettings, settingsEnvelope } from './settingsSchema';

/**
 * The migration chain, which runs once per session against whatever a
 * seller's browser happened to have written months or schema versions ago.
 *
 * A step that silently stops running — the wrong version key registered, an
 * off-by-one in the loop bound — is invisible in every manual check: the
 * sanitiser still returns a complete `AppSettings`, just with a stale value
 * nobody chose. These tests pin the v3 -> v4 freshness step (`MIGRATIONS[3]`
 * in `settingsSchema.ts`) against the property that makes it safe to ship:
 * only a stored value equal to the *old* default moves, and it moves exactly
 * once — a store already at v4 is left alone even if it holds the same
 * number.
 */

describe('freshness migration (v3 -> v4)', () => {
  it('moves a stored default of 15 forward to the new default of 60', () => {
    const settings = parseStoredSettings({
      version: 3,
      settings: { data: { freshnessMinutes: 15 } },
    });

    expect(settings.data.freshnessMinutes).toBe(60);
  });

  it('leaves a deliberately chosen 30 alone', () => {
    const settings = parseStoredSettings({
      version: 3,
      settings: { data: { freshnessMinutes: 30 } },
    });

    expect(settings.data.freshnessMinutes).toBe(30);
  });

  it('does not run again on a v4 store that already reads 15', () => {
    /* The step is registered under version 3 — it upgrades a v3 payload, not
       a v4 one. A seller who upgrades and then deliberately dials the
       freshness back down to fifteen must keep that choice on every later
       read, not have it bounced back to sixty. */
    const settings = parseStoredSettings({
      version: 4,
      settings: { data: { freshnessMinutes: 15 } },
    });

    expect(settings.data.freshnessMinutes).toBe(15);
  });

  it('gives a pre-v3 store — with no data section at all — the current default', () => {
    const fromV2 = parseStoredSettings({
      version: 2,
      settings: {
        api: { baseUrl: 'https://api.example.test', token: 'secret' },
        ai: { provider: 'gemini', model: 'gemini-3.6-flash' },
      },
    });

    expect(fromV2.data).toEqual({ freshnessMinutes: DEFAULT_FRESHNESS_MINUTES });
  });

  it('carries a v1 store through every step to the same default', () => {
    /* v1 also renames the provider and relocates the request timeout, so this
       exercises the whole chain (MIGRATIONS[1] -> [2] -> [3]) rather than
       just the last step in isolation. */
    const fromV1 = parseStoredSettings({
      version: 1,
      settings: {
        api: { baseUrl: 'https://api.example.test', token: 'secret', timeoutMs: 15_000 },
        ai: { provider: 'google', model: 'gemini-3.6-flash', modelTier: 'high' },
      },
    });

    expect(fromV1.data).toEqual({ freshnessMinutes: DEFAULT_FRESHNESS_MINUTES });
    expect(fromV1.ai.provider).toBe('gemini');
  });
});

describe('parseStoredSettings — malformed or absent input', () => {
  it('falls back to defaults when nothing was ever stored', () => {
    expect(parseStoredSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults on a string that is not valid JSON', () => {
    expect(parseStoredSettings('{not json')).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when the stored value is not envelope-shaped', () => {
    expect(parseStoredSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('just a string')).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a full settings object written by this build unchanged', () => {
    const envelope = settingsEnvelope(DEFAULT_SETTINGS);
    expect(parseStoredSettings(envelope)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('data.freshnessMinutes — offered spread', () => {
  it('rejects a value outside FRESHNESS_OPTIONS to the default rather than honouring it', () => {
    /* Between two options rather than a typo, so this pins the "snapped, not
       clamped" comment in sanitizeData: an in-between value must not be
       honoured just because it is numeric and in range. */
    expect(FRESHNESS_OPTIONS).not.toContain(45);
    expect(sanitizeSettings({ data: { freshnessMinutes: 45 } }).data.freshnessMinutes).toBe(
      DEFAULT_FRESHNESS_MINUTES,
    );
  });

  it('honours every option on the offered spread', () => {
    for (const minutes of FRESHNESS_OPTIONS) {
      expect(sanitizeSettings({ data: { freshnessMinutes: minutes } }).data.freshnessMinutes).toBe(
        minutes,
      );
    }
  });
});

describe('settingsEnvelope', () => {
  it('stamps the current schema version onto whatever settings are passed', () => {
    expect(settingsEnvelope(DEFAULT_SETTINGS)).toEqual({
      version: SETTINGS_SCHEMA_VERSION,
      settings: DEFAULT_SETTINGS,
    });
  });
});
