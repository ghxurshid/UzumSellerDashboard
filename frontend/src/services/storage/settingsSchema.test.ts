import { describe, expect, it } from 'vitest';

import {
  AI_PROVIDER_IDS,
  AI_TIMEOUT_OPTIONS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_FRESHNESS_MINUTES,
  DEFAULT_SETTINGS,
  FRESHNESS_OPTIONS,
  MAX_TOKENS_BOUNDS,
  SETTINGS_SCHEMA_VERSION,
  TEMPERATURE_BOUNDS,
  defaultAiConnection,
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

/**
 * The v4 -> v5 migration, which turns one shared `ai` connection into nine
 * independent ones. It has to run correctly against *two* different payloads
 * that both carry `version: 4` — v4 was never bumped when `saved` was added
 * (commit 864c4dd) — so both are pinned here, not just the newer of the two.
 */
describe('ai provider migration (v4 -> v5)', () => {
  it('shape (a) — the deployed build, flat fields and no `saved` — carries only the active provider forward', () => {
    const settings = parseStoredSettings({
      version: 4,
      settings: {
        ai: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'openai-secret',
          orgId: 'org-1',
          model: 'gpt-6-astra',
          timeoutMs: 120_000,
          temperature: 0.5,
          maxTokens: 8_192,
        },
      },
    });

    expect(settings.ai.provider).toBe('openai');
    expect(settings.ai.providers.openai).toEqual({
      ...defaultAiConnection('openai'),
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'openai-secret',
      orgId: 'org-1',
      model: 'gpt-6-astra',
      timeoutMs: 120_000,
      temperature: 0.5,
      maxTokens: 8_192,
    });

    /* Nothing to recover for a provider the seller had switched away from in
       this shape — v4 with no `saved` held only the active provider's data —
       so every other provider gets its own fresh catalogue defaults, never a
       trace of OpenAI's key or its sampling choices. */
    for (const id of AI_PROVIDER_IDS) {
      if (id === 'openai') continue;
      expect(settings.ai.providers[id]).toEqual(defaultAiConnection(id));
    }
  });

  it('shape (b) — with `saved` — restores every saved provider\'s own key, and carries the one shared sampling choice into each of them', () => {
    const settings = parseStoredSettings({
      version: 4,
      settings: {
        ai: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'openai-secret',
          orgId: 'org-1',
          model: 'gpt-6-astra',
          timeoutMs: 120_000,
          temperature: 0.5,
          maxTokens: 8_192,
          saved: {
            gemini: {
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
              apiKey: 'gemini-secret',
              orgId: '',
              model: 'gemini-3.6-flash',
            },
          },
        },
      },
    });

    expect(settings.ai.provider).toBe('openai');

    /* The active provider's own connection, complete, including the shared
       sampling it was actually serving requests with. */
    expect(settings.ai.providers.openai).toEqual({
      ...defaultAiConnection('openai'),
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'openai-secret',
      orgId: 'org-1',
      model: 'gpt-6-astra',
      timeoutMs: 120_000,
      temperature: 0.5,
      maxTokens: 8_192,
    });

    /* The saved provider's own key/endpoint/model survive, *and* it receives
       the same shared timeout/temperature/maxTokens the active provider had —
       v4 had exactly one value for those, applied to every provider it
       actually governed, not only the one active when this step runs. */
    expect(settings.ai.providers.gemini).toEqual({
      ...defaultAiConnection('gemini'),
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gemini-secret',
      orgId: '',
      model: 'gemini-3.6-flash',
      timeoutMs: 120_000,
      temperature: 0.5,
      maxTokens: 8_192,
    });

    /* A provider that was neither active nor saved — never configured at
       all — gets its own catalogue defaults, not the shared sampling that
       never applied to it. */
    expect(settings.ai.providers.claude).toEqual(defaultAiConnection('claude'));
  });

  it('chains a v3 store through the freshness step and the ai migration to v5', () => {
    const settings = parseStoredSettings({
      version: 3,
      settings: {
        api: { baseUrl: 'https://api.example.test', token: 'secret' },
        ai: {
          provider: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-secret',
          orgId: '',
          model: 'gemini-3.6-flash',
          timeoutMs: 30_000,
          temperature: 0.1,
          maxTokens: 2_048,
        },
      },
    });

    expect(settings.data.freshnessMinutes).toBe(DEFAULT_FRESHNESS_MINUTES);
    expect(settings.ai.provider).toBe('gemini');
    expect(settings.ai.providers.gemini).toEqual({
      ...defaultAiConnection('gemini'),
      apiKey: 'gemini-secret',
      timeoutMs: 30_000,
      temperature: 0.1,
      maxTokens: 2_048,
    });
    expect(settings.ai.providers.openai).toEqual(defaultAiConnection('openai'));
  });
});

/**
 * The v5 -> v6 migration: the default output budget rose from 4,096 to "Auto"
 * (the `MAX_TOKENS_BOUNDS.max` sentinel, resolved to a balanced budget by the transport). Only a stored 4,096 moves; anything else is a
 * deliberate choice.
 */
describe('output-token default migration (v5 -> v6)', () => {
  it('moves a stored 4,096 to Auto and leaves every other value alone', () => {
    const settings = parseStoredSettings({
      version: 5,
      settings: {
        ai: {
          provider: 'gemini',
          providers: {
            gemini: { apiKey: 'g-key', maxTokens: 4_096 },
            openai: { apiKey: 'o-key', maxTokens: 8_192 },
            claude: { apiKey: 'c-key' },
            deepseek: 'not an object',
          },
        },
      },
    });

    expect(settings.ai.providers.gemini.maxTokens).toBe(MAX_TOKENS_BOUNDS.max);
    expect(settings.ai.providers.gemini.apiKey).toBe('g-key');
    expect(settings.ai.providers.openai.maxTokens).toBe(8_192);
    expect(settings.ai.providers.claude.maxTokens).toBe(defaultAiConnection('claude').maxTokens);
    expect(settings.ai.providers.claude.maxTokens).toBe(MAX_TOKENS_BOUNDS.max);
    expect(settings.ai.providers.deepseek).toEqual(defaultAiConnection('deepseek'));
  });

  it('chains a v4 flat payload through the ai step and this one', () => {
    const settings = parseStoredSettings({
      version: 4,
      settings: { ai: { provider: 'openai', apiKey: 'o-key', maxTokens: 4_096 } },
    });

    expect(settings.ai.providers.openai.apiKey).toBe('o-key');
    expect(settings.ai.providers.openai.maxTokens).toBe(MAX_TOKENS_BOUNDS.max);
  });

  it('does not touch a 4,096 stored by a v6 build — the seller chose it after the step ran', () => {
    const settings = parseStoredSettings({
      version: SETTINGS_SCHEMA_VERSION,
      settings: { ai: { provider: 'gemini', providers: { gemini: { maxTokens: 4_096 } } } },
    });

    expect(settings.ai.providers.gemini.maxTokens).toBe(4_096);
  });

  it('survives a payload with no ai section or a malformed providers value', () => {
    /* `migrate()` swallows a step's exception, so "does not throw" alone can
       never fail. The real check is the outcome: every provider lands on its
       own catalogue default, whose maxTokens is the Auto sentinel. */
    for (const stored of [{}, { ai: { providers: 7 } }]) {
      const settings = parseStoredSettings({ version: 5, settings: stored });

      expect(settings.ai.provider).toBe(DEFAULT_AI_PROVIDER);
      for (const id of AI_PROVIDER_IDS) {
        expect(settings.ai.providers[id].maxTokens).toBe(defaultAiConnection(id).maxTokens);
        expect(settings.ai.providers[id].maxTokens).toBe(MAX_TOKENS_BOUNDS.max);
        expect(settings.ai.providers[id]).toEqual(defaultAiConnection(id));
      }
    }
  });
});

/**
 * `sanitizeAi`/`sanitizeConnection` — every provider's connection is
 * validated on its own, against its own catalogue defaults, never against
 * another provider's or the generic app-wide ones.
 */
describe('sanitizeSettings — ai section', () => {
  it('fills every provider with its own catalogue defaults when `providers` is absent entirely', () => {
    const { ai } = sanitizeSettings({});

    expect(ai.provider).toBe(DEFAULT_AI_PROVIDER);
    for (const id of AI_PROVIDER_IDS) {
      expect(ai.providers[id]).toEqual(defaultAiConnection(id));
    }
  });

  it('falls a blank Claude anthropicVersion back to the required header value, never to empty', () => {
    const { ai } = sanitizeSettings({
      ai: { providers: { claude: { anthropicVersion: '' } } },
    });

    expect(ai.providers.claude.anthropicVersion).toBe(defaultAiConnection('claude').anthropicVersion);
    expect(ai.providers.claude.anthropicVersion).not.toBe('');
  });

  it('rejects an out-of-range timeoutMs to that provider\'s own default', () => {
    const { ai } = sanitizeSettings({
      ai: { providers: { openai: { timeoutMs: 999 } } },
    });

    expect(AI_TIMEOUT_OPTIONS).not.toContain(999);
    expect(ai.providers.openai.timeoutMs).toBe(defaultAiConnection('openai').timeoutMs);
  });

  it('rejects an unknown reasoningEffort/thinkingLevel value to that provider\'s own default', () => {
    const { ai } = sanitizeSettings({
      ai: {
        providers: {
          openai: { reasoningEffort: 'ultra' },
          gemini: { thinkingLevel: 'extreme' },
        },
      },
    });

    expect(ai.providers.openai.reasoningEffort).toBe(defaultAiConnection('openai').reasoningEffort);
    expect(ai.providers.gemini.thinkingLevel).toBe(defaultAiConnection('gemini').thinkingLevel);
  });

  it('honours a valid reasoningEffort/thinkingLevel value, including the empty "provider default" option', () => {
    const { ai } = sanitizeSettings({
      ai: {
        providers: {
          openai: { reasoningEffort: 'high' },
          gemini: { thinkingLevel: '' },
        },
      },
    });

    expect(ai.providers.openai.reasoningEffort).toBe('high');
    expect(ai.providers.gemini.thinkingLevel).toBe('');
  });

  it('clamps temperature and maxTokens to their bounds rather than rejecting to the default', () => {
    const { ai } = sanitizeSettings({
      ai: { providers: { gemini: { temperature: 5, maxTokens: MAX_TOKENS_BOUNDS.max + 1_000_000 } } },
    });

    expect(ai.providers.gemini.temperature).toBe(TEMPERATURE_BOUNDS.max);
    expect(ai.providers.gemini.maxTokens).toBe(MAX_TOKENS_BOUNDS.max);
  });

  it('drops a provider key the running build does not know about', () => {
    const { ai } = sanitizeSettings({
      ai: { providers: { martian: { apiKey: 'x' } } },
    });

    expect(Object.keys(ai.providers)).toEqual(AI_PROVIDER_IDS);
    expect((ai.providers as Record<string, unknown>)['martian']).toBeUndefined();
  });

  it('falls a non-object provider entry back to that one provider\'s own defaults, and leaves its siblings alone', () => {
    const { ai } = sanitizeSettings({
      ai: { providers: { openai: 'not an object', gemini: { apiKey: 'kept' } } },
    });

    expect(ai.providers.openai).toEqual(defaultAiConnection('openai'));
    expect(ai.providers.gemini.apiKey).toBe('kept');
  });

  it('falls back to the default provider on an unknown `provider` id', () => {
    const { ai } = sanitizeSettings({ ai: { provider: 'not-a-real-provider' } });
    expect(ai.provider).toBe(DEFAULT_AI_PROVIDER);
  });
});
