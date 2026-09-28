import { describe, expect, it } from 'vitest';

import {
  anthropicHeaders,
  canListModels,
  claudeSamplingFields,
  claudeSupportsEffort,
  claudeSupportsTemperature,
  geminiHeaders,
  isAiConfigured,
  openAiCompatibleHeaders,
  openAiCompatibleSamplingFields,
  openAiIsReasoningModel,
  openAiSendsTemperature,
  requiresApiKey,
  samplingSupported,
} from './modelRules';

/**
 * These rules are what stand between a seller pressing "send" and a 400 that
 * spends nothing but their patience. Anthropic and OpenAI both removed
 * `temperature` on their newest models — a request shape the previous
 * generation accepted without complaint — and the fix has to hold for models
 * that do not exist yet, which is why every table here defaults to "leave it
 * out" rather than "assume it is fine".
 */

describe('claudeSupportsTemperature', () => {
  it('omits temperature on the no-sampling generation', () => {
    expect(claudeSupportsTemperature('claude-opus-5-20260101')).toBe(false);
    expect(claudeSupportsTemperature('claude-sonnet-5')).toBe(false);
    expect(claudeSupportsTemperature('claude-opus-4-8')).toBe(false);
    expect(claudeSupportsTemperature('claude-opus-4-7')).toBe(false);
  });

  it('sends temperature on the models that still accept it', () => {
    expect(claudeSupportsTemperature('claude-opus-4-6')).toBe(true);
    expect(claudeSupportsTemperature('claude-sonnet-4-6')).toBe(true);
    expect(claudeSupportsTemperature('claude-haiku-4-5')).toBe(true);
  });

  it('does not let opus-4-6/4-7/4-8 shadow bare opus-4 (4.0/4.1), or the reverse', () => {
    /* Real dated ids: `claude-opus-4-20250514` (4.0), `claude-opus-4-1-...`
       (4.1) — neither starts with the digit that opus-4-6/-4-7/-4-8 need. */
    expect(claudeSupportsTemperature('claude-opus-4-20250514')).toBe(true);
    expect(claudeSupportsTemperature('claude-opus-4-1-20250805')).toBe(true);
    expect(claudeSupportsTemperature('claude-opus-4-7-20260201')).toBe(false);
  });

  it('omits temperature on an id this table has never seen', () => {
    expect(claudeSupportsTemperature('claude-opus-6-preview')).toBe(false);
    expect(claudeSupportsTemperature('')).toBe(false);
  });

  it('sends temperature on the older 3.x generation', () => {
    expect(claudeSupportsTemperature('claude-3-5-haiku-20241022')).toBe(true);
    expect(claudeSupportsTemperature('claude-3-opus-20240229')).toBe(true);
  });
});

describe('claudeSupportsEffort', () => {
  it('supports effort on the models that grew adaptive thinking', () => {
    expect(claudeSupportsEffort('claude-opus-5')).toBe(true);
    expect(claudeSupportsEffort('claude-sonnet-5')).toBe(true);
    expect(claudeSupportsEffort('claude-opus-4-6')).toBe(true);
    expect(claudeSupportsEffort('claude-sonnet-4-6')).toBe(true);
  });

  it('never sends effort to a Haiku model', () => {
    expect(claudeSupportsEffort('claude-haiku-4-5')).toBe(false);
    expect(claudeSupportsEffort('claude-haiku-4')).toBe(false);
  });

  it('omits effort for an older or unrecognised id', () => {
    expect(claudeSupportsEffort('claude-opus-4')).toBe(false);
    expect(claudeSupportsEffort('claude-3-5-sonnet')).toBe(false);
  });
});

describe('claudeSamplingFields', () => {
  it('sends temperature alone for an older model', () => {
    expect(claudeSamplingFields('claude-3-5-haiku-20241022', 0.4)).toEqual({ temperature: 0.4 });
  });

  it('sends effort alone for a Haiku 4.5', () => {
    expect(claudeSamplingFields('claude-haiku-4-5', 0.4)).toEqual({ temperature: 0.4 });
  });

  it('sends effort alone for Opus 5 — temperature is left out', () => {
    expect(claudeSamplingFields('claude-opus-5', 0.4)).toEqual({
      output_config: { effort: 'low' },
    });
  });

  it('sends both for Opus 4.6', () => {
    expect(claudeSamplingFields('claude-opus-4-6', 0.4)).toEqual({
      temperature: 0.4,
      output_config: { effort: 'low' },
    });
  });
});

describe('openAiIsReasoningModel', () => {
  it('recognises the reasoning families', () => {
    expect(openAiIsReasoningModel('gpt-5.4')).toBe(true);
    expect(openAiIsReasoningModel('gpt-6-astra')).toBe(true);
    expect(openAiIsReasoningModel('o3-mini')).toBe(true);
    expect(openAiIsReasoningModel('o4-mini')).toBe(true);
    expect(openAiIsReasoningModel('o1-preview')).toBe(true);
  });

  it('does not flag the non-reasoning families', () => {
    expect(openAiIsReasoningModel('gpt-4.1')).toBe(false);
    expect(openAiIsReasoningModel('gpt-4o-mini')).toBe(false);
  });
});

describe('openAiSendsTemperature', () => {
  it('sends temperature only for the known non-reasoning ids', () => {
    expect(openAiSendsTemperature('gpt-4.1')).toBe(true);
    expect(openAiSendsTemperature('gpt-4o')).toBe(true);
    expect(openAiSendsTemperature('gpt-4o-mini')).toBe(true);
  });

  it('omits temperature for a reasoning model', () => {
    expect(openAiSendsTemperature('gpt-6-astra')).toBe(false);
    expect(openAiSendsTemperature('gpt-5.6-luna')).toBe(false);
  });

  it('omits temperature for an id that is neither list — the conservative default', () => {
    expect(openAiSendsTemperature('gpt-3.5-turbo')).toBe(false);
    expect(openAiSendsTemperature('some-future-model')).toBe(false);
  });
});

describe('samplingSupported', () => {
  it('matches claudeSupportsTemperature for claude', () => {
    expect(samplingSupported({ provider: 'claude', model: 'claude-opus-5' })).toBe(false);
    expect(samplingSupported({ provider: 'claude', model: 'claude-haiku-4-5' })).toBe(true);
  });

  it('matches openAiSendsTemperature for openai', () => {
    expect(samplingSupported({ provider: 'openai', model: 'gpt-6-astra' })).toBe(false);
    expect(samplingSupported({ provider: 'openai', model: 'gpt-4o' })).toBe(true);
  });

  it('is always true for every other provider — nothing here changed their behaviour', () => {
    expect(samplingSupported({ provider: 'gemini', model: 'gemini-3.6-flash' })).toBe(true);
    expect(samplingSupported({ provider: 'deepseek', model: 'deepseek-chat' })).toBe(true);
    expect(samplingSupported({ provider: 'grok', model: 'grok-4.7' })).toBe(true);
    expect(samplingSupported({ provider: 'mistral', model: 'mistral-large-latest' })).toBe(true);
    expect(samplingSupported({ provider: 'ollama', model: 'llama3' })).toBe(true);
  });
});

describe('openAiCompatibleSamplingFields', () => {
  it('sends max_completion_tokens and reasoning_effort for an OpenAI reasoning model', () => {
    expect(openAiCompatibleSamplingFields('openai', 'gpt-6-astra', 0.2, 4_096)).toEqual({
      max_completion_tokens: 4_096,
      reasoning_effort: 'low',
    });
  });

  it('sends temperature and max_completion_tokens for a known non-reasoning OpenAI id', () => {
    expect(openAiCompatibleSamplingFields('openai', 'gpt-4o', 0.2, 4_096)).toEqual({
      temperature: 0.2,
      max_completion_tokens: 4_096,
    });
  });

  it('disables thinking for DeepSeek, keeping max_tokens and temperature', () => {
    expect(openAiCompatibleSamplingFields('deepseek', 'deepseek-chat', 0.2, 4_096)).toEqual({
      temperature: 0.2,
      max_tokens: 4_096,
      thinking: { type: 'disabled' },
    });
  });

  it('keeps the plain OpenAI-compatible body for grok/mistral/openrouter/ollama/custom', () => {
    expect(openAiCompatibleSamplingFields('grok', 'grok-4.7', 0.2, 4_096)).toEqual({
      temperature: 0.2,
      max_tokens: 4_096,
    });
    expect(openAiCompatibleSamplingFields('ollama', 'llama3', 0.2, 4_096)).toEqual({
      temperature: 0.2,
      max_tokens: 4_096,
    });
  });
});

describe('requiresApiKey', () => {
  it('is false only for ollama and custom', () => {
    expect(requiresApiKey('ollama')).toBe(false);
    expect(requiresApiKey('custom')).toBe(false);
  });

  it('is true for every named vendor', () => {
    expect(requiresApiKey('openai')).toBe(true);
    expect(requiresApiKey('claude')).toBe(true);
    expect(requiresApiKey('gemini')).toBe(true);
    expect(requiresApiKey('openrouter')).toBe(true);
    expect(requiresApiKey('deepseek')).toBe(true);
    expect(requiresApiKey('mistral')).toBe(true);
    expect(requiresApiKey('grok')).toBe(true);
  });
});

describe('isAiConfigured', () => {
  const base = {
    baseUrl: 'https://api.example.com/v1',
    model: 'some-model',
    apiKey: '',
  };

  it('needs a key for a vendor that requires one', () => {
    expect(isAiConfigured({ ...base, provider: 'openai' })).toBe(false);
    expect(isAiConfigured({ ...base, provider: 'openai', apiKey: 'sk-test' })).toBe(true);
  });

  it('accepts a blank key for ollama and custom', () => {
    expect(isAiConfigured({ ...base, provider: 'ollama' })).toBe(true);
    expect(isAiConfigured({ ...base, provider: 'custom' })).toBe(true);
  });

  it('still needs a base URL and a model even without a key', () => {
    expect(isAiConfigured({ ...base, provider: 'ollama', baseUrl: '' })).toBe(false);
    expect(isAiConfigured({ ...base, provider: 'ollama', model: '' })).toBe(false);
  });
});

describe('canListModels', () => {
  it('needs a base URL regardless of provider', () => {
    expect(canListModels({ provider: 'openai', baseUrl: '', apiKey: 'sk-test' })).toBe(false);
  });

  it('needs a key for a vendor that requires one', () => {
    expect(
      canListModels({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' }),
    ).toBe(false);
  });

  it('does not need a model id — that is the field this button is meant to fill in', () => {
    expect(
      canListModels({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' }),
    ).toBe(true);
  });

  it('accepts a blank key for ollama and custom', () => {
    expect(canListModels({ provider: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '' })).toBe(
      true,
    );
    expect(
      canListModels({ provider: 'custom', baseUrl: 'https://gateway.example.com', apiKey: '' }),
    ).toBe(true);
  });
});

describe('headers', () => {
  it('builds the Anthropic browser header set', () => {
    expect(anthropicHeaders('sk-ant-test')).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('builds the Gemini header set', () => {
    expect(geminiHeaders('key')).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': 'key',
    });
  });

  it('sends no authorization header for an empty key — never a bare "Bearer "', () => {
    const headers = openAiCompatibleHeaders('ollama', '', '');
    expect(headers['authorization']).toBeUndefined();
  });

  it('sends Bearer for a non-empty key', () => {
    const headers = openAiCompatibleHeaders('deepseek', 'sk-test', '');
    expect(headers['authorization']).toBe('Bearer sk-test');
  });

  it('sends the organisation header only for openai, never for another provider with a leftover orgId', () => {
    expect(openAiCompatibleHeaders('openai', 'sk-test', 'org-1')['openai-organization']).toBe('org-1');
    expect(openAiCompatibleHeaders('deepseek', 'sk-test', 'org-1')['openai-organization']).toBeUndefined();
    expect(openAiCompatibleHeaders('mistral', 'sk-test', 'org-1')['openai-organization']).toBeUndefined();
    expect(openAiCompatibleHeaders('grok', 'sk-test', 'org-1')['openai-organization']).toBeUndefined();
    expect(openAiCompatibleHeaders('openrouter', 'sk-test', 'org-1')['openai-organization']).toBeUndefined();
    expect(openAiCompatibleHeaders('custom', 'sk-test', 'org-1')['openai-organization']).toBeUndefined();
  });
});
