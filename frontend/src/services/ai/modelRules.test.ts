import { describe, expect, it } from 'vitest';

import { ApiError } from '@/services/api/client';

import {
  anthropicHeaders,
  canListModels,
  classifyOpenAiFailure,
  claudeSamplingFields,
  claudeSupportsEffort,
  claudeSupportsTemperature,
  geminiHeaders,
  geminiThinkingLevel,
  isAiConfigured,
  isHeaderSafe,
  openAiCompatibleHeaders,
  openAiCompatibleSamplingFields,
  openAiIncompleteError,
  openAiIsReasoningModel,
  openAiResponsesFields,
  openAiSendsTemperature,
  reasoningEffortOptions,
  requiresApiKey,
  samplingSupported,
  thinkingLevelOptions,
} from './modelRules';

/**
 * These rules are what stand between a seller pressing "send" and a 400 that
 * spends nothing but their patience. Anthropic and OpenAI both removed
 * `temperature` on their newest models — a request shape the previous
 * generation accepted without complaint — and the fix has to hold for models
 * that do not exist yet, which is why every table here defaults to "leave it
 * out" rather than "assume it is fine". Every provider now keeps its own
 * complete configuration (`reasoningEffort`, `thinkingLevel`, `thinking`,
 * attribution headers…), so the same rule applies to a *value the seller
 * chose*: a stored effort or level the chosen model does not list is dropped,
 * never guessed at or substituted — see `reasoningEffortOptions` /
 * `thinkingLevelOptions` and the sampling-field tests below.
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

describe('reasoningEffortOptions', () => {
  it('offers the full Anthropic scale on an effort-capable Claude model, nothing on Haiku', () => {
    expect(reasoningEffortOptions('claude', 'claude-opus-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(reasoningEffortOptions('claude', 'claude-haiku-4-5')).toEqual([]);
  });

  it('withholds "none" from GPT-6 Astra but offers it on Sol and Luna', () => {
    expect(reasoningEffortOptions('openai', 'gpt-6-astra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(reasoningEffortOptions('openai', 'gpt-6-sol')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(reasoningEffortOptions('openai', 'gpt-6-luna')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('offers nothing for a non-reasoning OpenAI id', () => {
    expect(reasoningEffortOptions('openai', 'gpt-4o')).toEqual([]);
  });

  it('falls back to the low/medium/high common ground for a reasoning id with no per-model table', () => {
    expect(reasoningEffortOptions('openai', 'o3-mini')).toEqual(['low', 'medium', 'high']);
    expect(reasoningEffortOptions('openai', 'gpt-5.4')).toEqual(['low', 'medium', 'high']);
  });

  it('offers the whole OpenRouter scale regardless of the (unknown) upstream model', () => {
    expect(reasoningEffortOptions('openrouter', 'openrouter/auto')).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('offers xhigh from grok-4.6 on, but not on grok-4.5', () => {
    expect(reasoningEffortOptions('grok', 'grok-4.7')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(reasoningEffortOptions('grok', 'grok-4.6')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(reasoningEffortOptions('grok', 'grok-4.5')).toEqual(['low', 'medium', 'high']);
  });

  it('offers nothing on grok-4.3 — below the 4.5 floor xAI documents', () => {
    expect(reasoningEffortOptions('grok', 'grok-4.3')).toEqual([]);
  });

  it('offers nothing for a provider this field does not apply to at all', () => {
    expect(reasoningEffortOptions('gemini', 'gemini-3.6-flash')).toEqual([]);
    expect(reasoningEffortOptions('deepseek', 'deepseek-v4-pro')).toEqual([]);
    expect(reasoningEffortOptions('mistral', 'mistral-large-latest')).toEqual([]);
    expect(reasoningEffortOptions('ollama', 'llama3')).toEqual([]);
    expect(reasoningEffortOptions('custom', 'whatever')).toEqual([]);
  });
});

describe('thinkingLevelOptions', () => {
  it('offers low/medium/high on 3.7 and 3.8, plus minimal on the other named flash models', () => {
    expect(thinkingLevelOptions('gemini-3.8-flash')).toEqual(['low', 'medium', 'high']);
    expect(thinkingLevelOptions('gemini-3.7-flash')).toEqual(['low', 'medium', 'high']);
    expect(thinkingLevelOptions('gemini-3.6-flash')).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(thinkingLevelOptions('gemini-3.5-flash')).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(thinkingLevelOptions('gemini-3.5-flash-lite')).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(thinkingLevelOptions('gemini-3-flash-preview')).toEqual(['minimal', 'low', 'medium', 'high']);
  });

  it('offers only low and high on 3-pro-preview, the most restrictive named row', () => {
    expect(thinkingLevelOptions('gemini-3-pro-preview')).toEqual(['low', 'high']);
  });

  it('offers low/medium/high on 3.1-pro-preview', () => {
    expect(thinkingLevelOptions('gemini-3.1-pro-preview')).toEqual(['low', 'medium', 'high']);
  });

  it('falls back to low/high — the pair every named row accepts — for a Gemini 3+ id with no table entry', () => {
    // In the catalogue's own model list, but absent from Google's thinking-levels table.
    expect(thinkingLevelOptions('gemini-3.1-flash-lite')).toEqual(['low', 'high']);
  });

  it('offers nothing below Gemini 3', () => {
    expect(thinkingLevelOptions('gemini-2.5-flash')).toEqual([]);
    expect(thinkingLevelOptions('gemini-2.5-flash-lite')).toEqual([]);
  });

  it('offers nothing for a non-Gemini id', () => {
    expect(thinkingLevelOptions('gpt-6-astra')).toEqual([]);
  });
});

describe('claudeSamplingFields', () => {
  it('sends temperature alone for an older model', () => {
    expect(claudeSamplingFields({ model: 'claude-3-5-haiku-20241022', temperature: 0.4, reasoningEffort: 'low' })).toEqual({
      temperature: 0.4,
    });
  });

  it('sends effort alone for a Haiku 4.5 — the model does not support it, whatever the setting says', () => {
    expect(claudeSamplingFields({ model: 'claude-haiku-4-5', temperature: 0.4, reasoningEffort: 'low' })).toEqual({
      temperature: 0.4,
    });
  });

  it('sends effort alone for Opus 5 — temperature is left out', () => {
    expect(claudeSamplingFields({ model: 'claude-opus-5', temperature: 0.4, reasoningEffort: 'low' })).toEqual({
      output_config: { effort: 'low' },
    });
  });

  it('sends both for Opus 4.6', () => {
    expect(claudeSamplingFields({ model: 'claude-opus-4-6', temperature: 0.4, reasoningEffort: 'medium' })).toEqual({
      temperature: 0.4,
      output_config: { effort: 'medium' },
    });
  });

  it('omits output_config when reasoningEffort is blank — the provider default', () => {
    expect(claudeSamplingFields({ model: 'claude-opus-5', temperature: 0.4, reasoningEffort: '' })).toEqual({});
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
    expect(samplingSupported({ provider: 'claude', model: 'claude-opus-5', thinking: false })).toBe(false);
    expect(samplingSupported({ provider: 'claude', model: 'claude-haiku-4-5', thinking: false })).toBe(true);
  });

  it('matches openAiSendsTemperature for openai', () => {
    expect(samplingSupported({ provider: 'openai', model: 'gpt-6-astra', thinking: false })).toBe(false);
    expect(samplingSupported({ provider: 'openai', model: 'gpt-4o', thinking: false })).toBe(true);
  });

  it('is the inverse of `thinking` for deepseek — thinking silently ignores temperature', () => {
    expect(samplingSupported({ provider: 'deepseek', model: 'deepseek-v4-pro', thinking: true })).toBe(false);
    expect(samplingSupported({ provider: 'deepseek', model: 'deepseek-v4-pro', thinking: false })).toBe(true);
  });

  it('is always true for every other provider — nothing here changed their behaviour', () => {
    expect(samplingSupported({ provider: 'gemini', model: 'gemini-3.6-flash', thinking: false })).toBe(true);
    expect(samplingSupported({ provider: 'grok', model: 'grok-4.7', thinking: false })).toBe(true);
    expect(samplingSupported({ provider: 'mistral', model: 'mistral-large-latest', thinking: false })).toBe(true);
    expect(samplingSupported({ provider: 'ollama', model: 'llama3', thinking: false })).toBe(true);
  });
});

describe('openAiCompatibleSamplingFields', () => {
  /* `openai` no longer calls this function at all — see `dialectFor`'s
     `openai` branch, which speaks Responses through `openAiResponsesFields`
     instead — so there is nothing here to pin for it any more. */

  const base = { model: 'deepseek-v4-pro', temperature: 0.2, maxTokens: 4_096, reasoningEffort: '' as const };

  it('disables thinking for DeepSeek by default, keeping max_tokens and temperature', () => {
    expect(openAiCompatibleSamplingFields({ ...base, provider: 'deepseek', thinking: false })).toEqual({
      temperature: 0.2,
      max_tokens: 4_096,
      thinking: { type: 'disabled' },
    });
  });

  it('enables DeepSeek thinking when the seller turns it on, and drops temperature — it has no effect while thinking', () => {
    expect(openAiCompatibleSamplingFields({ ...base, provider: 'deepseek', thinking: true })).toEqual({
      max_tokens: 4_096,
      thinking: { type: 'enabled' },
    });
  });

  it('sends reasoning_effort for Grok 4.7 when set', () => {
    expect(
      openAiCompatibleSamplingFields({
        ...base,
        provider: 'grok',
        model: 'grok-4.7',
        thinking: false,
        reasoningEffort: 'high',
      }),
    ).toEqual({ temperature: 0.2, max_tokens: 4_096, reasoning_effort: 'high' });
  });

  it('never sends reasoning_effort to Grok 4.3 — below the floor that supports it', () => {
    const fields = openAiCompatibleSamplingFields({
      ...base,
      provider: 'grok',
      model: 'grok-4.3',
      thinking: false,
      reasoningEffort: 'high',
    });
    expect(fields['reasoning_effort']).toBeUndefined();
  });

  it('sends a nested reasoning.effort for OpenRouter when set', () => {
    expect(
      openAiCompatibleSamplingFields({
        ...base,
        provider: 'openrouter',
        model: 'openrouter/auto',
        thinking: false,
        reasoningEffort: 'minimal',
      }),
    ).toEqual({ temperature: 0.2, max_tokens: 4_096, reasoning: { effort: 'minimal' } });
  });

  it('keeps the plain OpenAI-compatible body for mistral/ollama/custom — no provider-specific field applies', () => {
    expect(openAiCompatibleSamplingFields({ ...base, provider: 'mistral', model: 'mistral-large-latest', thinking: false })).toEqual({
      temperature: 0.2,
      max_tokens: 4_096,
    });
    expect(openAiCompatibleSamplingFields({ ...base, provider: 'ollama', model: 'llama3', thinking: false })).toEqual({
      temperature: 0.2,
      max_tokens: 4_096,
    });
  });

  it("never lets Grok's reasoning_effort reach a DeepSeek request, or DeepSeek's thinking reach a Grok one", () => {
    const grokFields = openAiCompatibleSamplingFields({
      ...base,
      provider: 'grok',
      model: 'grok-4.7',
      thinking: true, // set, but this field belongs to DeepSeek only
      reasoningEffort: 'high',
    });
    expect(grokFields['thinking']).toBeUndefined();

    const deepseekFields = openAiCompatibleSamplingFields({
      ...base,
      provider: 'deepseek',
      thinking: false,
      reasoningEffort: 'high', // set, but this field belongs to Grok/OpenRouter only
    });
    expect(deepseekFields['reasoning_effort']).toBeUndefined();
    expect(deepseekFields['reasoning']).toBeUndefined();
  });
});

describe('openAiResponsesFields', () => {
  it('sends max_output_tokens, store:false, the chosen reasoning effort and the encrypted-content include for a GPT-6 model', () => {
    expect(
      openAiResponsesFields({ model: 'gpt-6-astra', temperature: 0.2, maxTokens: 4_096, reasoningEffort: 'high' }),
    ).toEqual({
      max_output_tokens: 4_096,
      store: false,
      reasoning: { effort: 'high' },
      include: ['reasoning.encrypted_content'],
    });
  });

  it('never puts "none" on the wire for Astra — the model 400s on it — even though the union allows the value', () => {
    const fields = openAiResponsesFields({
      model: 'gpt-6-astra',
      temperature: 0.2,
      maxTokens: 4_096,
      reasoningEffort: 'none',
    });
    expect(fields['reasoning']).toBeUndefined();
    // include is unaffected — Astra is still a reasoning model.
    expect(fields['include']).toEqual(['reasoning.encrypted_content']);
  });

  it('accepts "none" for Sol and Luna', () => {
    expect(
      openAiResponsesFields({ model: 'gpt-6-sol', temperature: 0.2, maxTokens: 4_096, reasoningEffort: 'none' })[
        'reasoning'
      ],
    ).toEqual({ effort: 'none' });
  });

  it('omits reasoning.effort when the setting is blank, but keeps include for a reasoning model', () => {
    const fields = openAiResponsesFields({ model: 'gpt-6-astra', temperature: 0.2, maxTokens: 4_096, reasoningEffort: '' });
    expect(fields['reasoning']).toBeUndefined();
    expect(fields['include']).toEqual(['reasoning.encrypted_content']);
  });

  it('omits temperature for every reasoning model, Astra, Sol and Luna alike', () => {
    expect(openAiResponsesFields({ model: 'gpt-6-astra', temperature: 0.2, maxTokens: 4_096, reasoningEffort: 'low' })['temperature']).toBeUndefined();
    expect(openAiResponsesFields({ model: 'gpt-6-sol', temperature: 0.2, maxTokens: 4_096, reasoningEffort: 'low' })['temperature']).toBeUndefined();
    expect(openAiResponsesFields({ model: 'gpt-6-luna', temperature: 0.2, maxTokens: 4_096, reasoningEffort: 'low' })['temperature']).toBeUndefined();
  });

  it('sends temperature and no reasoning fields for a known non-reasoning id', () => {
    expect(openAiResponsesFields({ model: 'gpt-4o', temperature: 0.3, maxTokens: 4_096, reasoningEffort: 'low' })).toEqual({
      max_output_tokens: 4_096,
      store: false,
      temperature: 0.3,
    });
  });

  it('sends neither temperature nor reasoning for an id this table has never seen — the conservative default', () => {
    expect(openAiResponsesFields({ model: 'gpt-3.5-turbo', temperature: 0.3, maxTokens: 4_096, reasoningEffort: 'low' })).toEqual({
      max_output_tokens: 4_096,
      store: false,
    });
  });
});

describe('geminiThinkingLevel', () => {
  it('sends the chosen level when the model accepts it', () => {
    expect(geminiThinkingLevel({ model: 'gemini-3.6-flash', thinkingLevel: 'minimal' })).toBe('minimal');
    expect(geminiThinkingLevel({ model: 'gemini-3.8-flash', thinkingLevel: 'medium' })).toBe('medium');
  });

  it('omits it — returns null — when the setting is blank', () => {
    expect(geminiThinkingLevel({ model: 'gemini-3.6-flash', thinkingLevel: '' })).toBeNull();
  });

  it('never sends "minimal" to 3-pro-preview, which does not list it', () => {
    expect(geminiThinkingLevel({ model: 'gemini-3-pro-preview', thinkingLevel: 'minimal' })).toBeNull();
    expect(geminiThinkingLevel({ model: 'gemini-3-pro-preview', thinkingLevel: 'high' })).toBe('high');
  });

  it('never sends a level to a pre-Gemini-3 model, whatever is stored', () => {
    expect(geminiThinkingLevel({ model: 'gemini-2.5-flash', thinkingLevel: 'low' })).toBeNull();
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
  it('builds the Anthropic header set with the stored version', () => {
    expect(anthropicHeaders({ apiKey: 'sk-ant-test', anthropicVersion: '2023-06-01' })).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('falls back to the current stable version when the stored one is blank', () => {
    expect(anthropicHeaders({ apiKey: 'sk-ant-test', anthropicVersion: '' })['anthropic-version']).toBe(
      '2023-06-01',
    );
  });

  it('trims the stored version before deciding whether it is blank', () => {
    expect(anthropicHeaders({ apiKey: 'sk-ant-test', anthropicVersion: '   ' })['anthropic-version']).toBe(
      '2023-06-01',
    );
  });

  it('builds the Gemini header set', () => {
    expect(geminiHeaders('key')).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': 'key',
    });
  });

  const openAiCompatibleBase = { apiKey: '', orgId: '', projectId: '', appUrl: '', appTitle: '' };

  it('sends no authorization header for an empty key — never a bare "Bearer "', () => {
    const headers = openAiCompatibleHeaders({ ...openAiCompatibleBase, provider: 'ollama' });
    expect(headers['authorization']).toBeUndefined();
  });

  it('sends Bearer for a non-empty key', () => {
    const headers = openAiCompatibleHeaders({ ...openAiCompatibleBase, provider: 'deepseek', apiKey: 'sk-test' });
    expect(headers['authorization']).toBe('Bearer sk-test');
  });

  it('sends the organisation and project headers only for openai', () => {
    const openai = openAiCompatibleHeaders({
      ...openAiCompatibleBase,
      provider: 'openai',
      apiKey: 'sk-test',
      orgId: 'org-1',
      projectId: 'proj-1',
    });
    expect(openai['openai-organization']).toBe('org-1');
    expect(openai['openai-project']).toBe('proj-1');

    for (const provider of ['deepseek', 'mistral', 'grok', 'openrouter', 'custom', 'ollama'] as const) {
      const headers = openAiCompatibleHeaders({
        ...openAiCompatibleBase,
        provider,
        apiKey: 'sk-test',
        orgId: 'org-1',
        projectId: 'proj-1',
      });
      expect(headers['openai-organization']).toBeUndefined();
      expect(headers['openai-project']).toBeUndefined();
    }
  });

  it('sends the OpenRouter attribution headers only for openrouter', () => {
    const openrouter = openAiCompatibleHeaders({
      ...openAiCompatibleBase,
      provider: 'openrouter',
      apiKey: 'sk-test',
      appUrl: 'https://savdo.example',
      appTitle: 'Savdo Copilot',
    });
    expect(openrouter['http-referer']).toBe('https://savdo.example');
    expect(openrouter['x-openrouter-title']).toBe('Savdo Copilot');

    const openai = openAiCompatibleHeaders({
      ...openAiCompatibleBase,
      provider: 'openai',
      apiKey: 'sk-test',
      appUrl: 'https://leftover-from-openrouter.example',
      appTitle: 'leftover',
    });
    expect(openai['http-referer']).toBeUndefined();
    expect(openai['x-openrouter-title']).toBeUndefined();
  });

  it('omits a blank attribution or organisation header rather than sending it empty', () => {
    const headers = openAiCompatibleHeaders({ ...openAiCompatibleBase, provider: 'openai', apiKey: 'sk-test' });
    expect(headers['openai-organization']).toBeUndefined();
    expect(headers['openai-project']).toBeUndefined();
  });

  describe('isHeaderSafe', () => {
    it('accepts printable ASCII, including empty', () => {
      expect(isHeaderSafe('')).toBe(true);
      expect(isHeaderSafe('sk-test-123')).toBe(true);
      expect(isHeaderSafe('Savdo Copilot')).toBe(true);
    });

    it('rejects a value outside printable ASCII', () => {
      expect(isHeaderSafe('Savdo doʻkoni')).toBe(false); // U+02BB
      expect(isHeaderSafe('Магазин')).toBe(false); // Cyrillic
      expect(isHeaderSafe('https://мойсайт.рф')).toBe(false); // IDN
    });

    it('trims before judging — trailing whitespace is not itself unsafe', () => {
      expect(isHeaderSafe('  sk-test  ')).toBe(true);
    });
  });

  describe('non-ASCII values are never put on the wire', () => {
    it('throws unauthorized, before fetch, for a non-ASCII Anthropic key — not a fake network error', () => {
      expect(() => anthropicHeaders({ apiKey: 'sk-doʻkoni', anthropicVersion: '' })).toThrow(ApiError);
      try {
        anthropicHeaders({ apiKey: 'sk-doʻkoni', anthropicVersion: '' });
      } catch (error) {
        expect((error as ApiError).kind).toBe('unauthorized');
      }
    });

    it('throws unauthorized for a non-ASCII Gemini key', () => {
      expect(() => geminiHeaders('Магазин-key')).toThrow(ApiError);
    });

    it('throws unauthorized for a non-ASCII OpenAI-compatible key', () => {
      expect(() => openAiCompatibleHeaders({ ...openAiCompatibleBase, provider: 'openai', apiKey: 'Магазин' })).toThrow(
        ApiError,
      );
    });

    it('falls back to ANTHROPIC_VERSION when the stored version is not ASCII, rather than sending it', () => {
      expect(anthropicHeaders({ apiKey: 'sk-test', anthropicVersion: 'нет' })['anthropic-version']).toBe(
        '2023-06-01',
      );
    });

    it('drops a non-ASCII orgId/projectId rather than sending it, without throwing', () => {
      const headers = openAiCompatibleHeaders({
        ...openAiCompatibleBase,
        provider: 'openai',
        apiKey: 'sk-test',
        orgId: 'Магазин',
        projectId: 'proj-1',
      });
      expect(headers['openai-organization']).toBeUndefined();
      expect(headers['openai-project']).toBe('proj-1');
    });

    it('drops a non-ASCII appTitle (e.g. a Uzbek "ʻ") rather than sending it, without throwing', () => {
      const headers = openAiCompatibleHeaders({
        ...openAiCompatibleBase,
        provider: 'openrouter',
        apiKey: 'sk-test',
        appUrl: 'https://savdo.example',
        appTitle: 'Savdo doʻkoni',
      });
      expect(headers['x-openrouter-title']).toBeUndefined();
      expect(headers['http-referer']).toBe('https://savdo.example');
    });

    it('drops a non-ASCII (IDN) appUrl rather than sending it', () => {
      const headers = openAiCompatibleHeaders({
        ...openAiCompatibleBase,
        provider: 'openrouter',
        apiKey: 'sk-test',
        appUrl: 'https://мойсайт.рф',
        appTitle: 'Savdo Copilot',
      });
      expect(headers['http-referer']).toBeUndefined();
      expect(headers['x-openrouter-title']).toBe('Savdo Copilot');
    });
  });
});

describe('openAiIncompleteError', () => {
  it('is a non-retryable client error naming the reason, with a machine-readable code', () => {
    const error = openAiIncompleteError('max_output_tokens');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('client');
    expect(error.code).toBe('incomplete');
    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain('max_output_tokens');
  });
});

describe('classifyOpenAiFailure', () => {
  it('maps a rate-limit code to the rate-limited path', () => {
    expect(classifyOpenAiFailure('rate_limit_exceeded', 'slow down').kind).toBe('rateLimited');
  });

  it('maps insufficient_quota to a non-retryable client failure with its own code, not the rate-limited path', () => {
    // "insufficient_quota" contains "quota", so this has to be checked ahead
    // of the general quota substring rule below, or it would misreport a
    // billing exhaustion as a transient, retryable rate limit.
    const error = classifyOpenAiFailure('insufficient_quota', 'no quota left');
    expect(error.kind).toBe('client');
    expect(error.code).toBe('insufficient_quota');
    expect(error.isRetryable).toBe(false);
  });

  it('still maps a differently-named quota code to the rate-limited path', () => {
    expect(classifyOpenAiFailure('quota_exceeded', 'slow down').kind).toBe('rateLimited');
  });

  it('treats a server_error-like or missing code as a retryable server failure', () => {
    expect(classifyOpenAiFailure('server_error', 'oops').kind).toBe('server');
    expect(classifyOpenAiFailure('internal_error', 'oops').kind).toBe('server');
    expect(classifyOpenAiFailure(null, 'oops').kind).toBe('server');
    expect(classifyOpenAiFailure('', 'oops').kind).toBe('server');
  });

  it('every rate-limited or server classification stays retryable', () => {
    expect(classifyOpenAiFailure('rate_limit_exceeded', 'slow down').isRetryable).toBe(true);
    expect(classifyOpenAiFailure(null, 'oops').isRetryable).toBe(true);
  });

  it('treats any other named code as a non-retryable client failure', () => {
    const error = classifyOpenAiFailure('content_filter', 'blocked');
    expect(error.kind).toBe('client');
    expect(error.isRetryable).toBe(false);
    expect(error.message).toBe('blocked');
  });
});
