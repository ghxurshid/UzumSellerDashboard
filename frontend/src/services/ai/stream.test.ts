import { describe, expect, it } from 'vitest';

import { ApiError } from '@/services/api/client';
import { DEFAULT_AI_SETTINGS, defaultAiConnection } from '@/constants/settings';
import type { AiProvider, AiSettings } from '@/types/settings';

import type { OpenAiReasoningItem, ToolCall } from './messages';
import {
  anthropicMessages,
  dialectFor,
  finishCalls,
  openAiResponsesInput,
  reduceAnthropic,
  reduceOpenAi,
  reduceOpenAiResponses,
  RETRIES,
  retryDelay,
  shouldRetry,
  type Accumulator,
} from './stream';
import { ModelQuotaError } from './usage';

/**
 * A settings object for one provider, built from that provider's own
 * catalogue defaults — not a fixed provider's connection with the `provider`
 * field swapped out, which would leave, say, an `openai` override still
 * carrying Gemini's `thinkingLevel` and no `reasoningEffort` at all.
 */
function settingsFor(overrides: Partial<AiSettings> & { readonly provider?: AiProvider }): AiSettings {
  const provider = overrides.provider ?? DEFAULT_AI_SETTINGS.provider;
  return { provider, ...defaultAiConnection(provider), apiKey: 'test-key', ...overrides };
}

function newAccumulator(): Accumulator {
  return {
    text: '',
    calls: new Map(),
    order: [],
    reasoning: new Map(),
    openAiReasoning: [],
    inputTokens: 0,
    outputTokens: undefined,
    reasoningTokens: undefined,
    cachedInputTokens: undefined,
    rawInputTokens: undefined,
  };
}

/**
 * When a failed request is worth repeating.
 *
 * The provider this exists for answers `503 UNAVAILABLE` under load and means
 * "come back in a moment" — so the two questions are how long to wait and when
 * to stop asking. The second one has an answer that is not about the error at
 * all: once part of the answer is on screen, no retry is safe, because the
 * words would be written a second time underneath the first.
 */

const busy = (retryAfterMs?: number): ApiError =>
  new ApiError('overloaded', {
    kind: 'server',
    status: 503,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

describe('shouldRetry', () => {
  it('repeats an overloaded model', () => {
    expect(shouldRetry(busy(), { attempt: 0, produced: false })).toBe(true);
  });

  it('repeats a rate limit and a dropped connection', () => {
    const limited = new ApiError('slow down', { kind: 'rateLimited', status: 429 });
    const dropped = new ApiError('unreachable', { kind: 'network' });

    expect(shouldRetry(limited, { attempt: 1, produced: false })).toBe(true);
    expect(shouldRetry(dropped, { attempt: 1, produced: false })).toBe(true);
  });

  it('does not repeat what repeating cannot fix', () => {
    const key = new ApiError('bad key', { kind: 'unauthorized', status: 401 });
    const bad = new ApiError('unknown model', { kind: 'client', status: 400 });

    expect(shouldRetry(key, { attempt: 0, produced: false })).toBe(false);
    expect(shouldRetry(bad, { attempt: 0, produced: false })).toBe(false);
  });

  it('does not repeat once the seller has read part of the answer', () => {
    /* The retry would stream the same sentences again, under the first copy. */
    expect(shouldRetry(busy(), { attempt: 0, produced: true })).toBe(false);
  });

  it('gives up after three attempts and hands it over', () => {
    expect(shouldRetry(busy(), { attempt: RETRIES - 1, produced: false })).toBe(true);
    expect(shouldRetry(busy(), { attempt: RETRIES, produced: false })).toBe(false);
  });

  it('ignores anything that is not an ApiError', () => {
    expect(shouldRetry(new Error('boom'), { attempt: 0, produced: false })).toBe(false);
    expect(shouldRetry(null, { attempt: 0, produced: false })).toBe(false);
  });

  describe('a daily quota', () => {
    /* A DAILY quota does not reopen inside this session — only the Pacific day
       turning over frees it — so a retry here is a request Google's own
       counter would hold against the project for the same refusal. */
    it('never repeats an rpd 429, however early in the attempts it is', () => {
      const rpdExhausted = new ModelQuotaError('quota', { quota: { axis: 'rpd', limit: 20, retryAfterMs: null } });
      expect(shouldRetry(rpdExhausted, { attempt: 0, produced: false })).toBe(false);
    });

    it('repeats an rpm 429 exactly like any other rate limit', () => {
      const rpmExhausted = new ModelQuotaError('quota', { quota: { axis: 'rpm', limit: 5, retryAfterMs: null } });
      expect(shouldRetry(rpmExhausted, { attempt: 0, produced: false })).toBe(true);
      expect(shouldRetry(rpmExhausted, { attempt: 0, produced: true })).toBe(false);
      expect(shouldRetry(rpmExhausted, { attempt: RETRIES, produced: false })).toBe(false);
    });

    it('repeats a 429 whose body said nothing about which axis ran out', () => {
      const unspecified = new ModelQuotaError('quota', { quota: { axis: null, limit: null, retryAfterMs: null } });
      expect(shouldRetry(unspecified, { attempt: 0, produced: false })).toBe(true);
    });

    it('repeats a 429 the body could not even be read as a quota error for', () => {
      const noQuotaInfo = new ModelQuotaError('quota', { quota: null });
      expect(shouldRetry(noQuotaInfo, { attempt: 0, produced: false })).toBe(true);
    });
  });
});

describe('retryDelay', () => {
  it('believes the provider over its own arithmetic', () => {
    expect(retryDelay(0, 2_500)).toBe(2_500);
  });

  it('doubles the wait when the provider says nothing', () => {
    /* Jitter is added on top, so the floor is what is asserted. */
    expect(retryDelay(0)).toBeGreaterThanOrEqual(1_000);
    expect(retryDelay(1)).toBeGreaterThanOrEqual(2_000);
    expect(retryDelay(2)).toBeGreaterThanOrEqual(4_000);
  });

  it('caps the wait, however long the header asks for', () => {
    expect(retryDelay(0, 600_000)).toBe(8_000);
    expect(retryDelay(9)).toBeLessThanOrEqual(8_250);
  });
});

/**
 * Anthropic's thinking blocks, captured off the wire and replayed.
 *
 * A turn that used a tool wrote a `thinking` block ahead of the `tool_use`
 * block, and the next request has to send that same block back, in the same
 * position, or Anthropic 400s the whole conversation on the second round —
 * see `ToolCall.reasoning` in `messages.ts`. These pin the two halves of that
 * contract: what `reduceAnthropic`/`finishCalls` capture off the stream, and
 * what `anthropicMessages` replays.
 */
describe('Anthropic thinking capture and replay', () => {
  it('never hands thinking text to onDelta, and attaches it to the first call', () => {
    const accumulator = newAccumulator();
    const seenText: string[] = [];
    const onText = (text: string): void => {
      seenText.push(text);
    };

    reduceAnthropic(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      accumulator,
      onText,
    );
    reduceAnthropic(
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'checking the numbers' } },
      accumulator,
      onText,
    );
    reduceAnthropic(
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
      accumulator,
      onText,
    );
    reduceAnthropic(
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'window_totals' } },
      accumulator,
      onText,
    );
    reduceAnthropic(
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"days":30}' } },
      accumulator,
      onText,
    );

    expect(seenText).toEqual([]);

    const calls = finishCalls(accumulator);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'toolu_01',
      name: 'window_totals',
      args: { days: 30 },
      reasoning: [{ type: 'thinking', thinking: 'checking the numbers', signature: 'sig-abc' }],
    });
  });

  it('captures a redacted_thinking block whole, with no delta needed', () => {
    const accumulator = newAccumulator();

    reduceAnthropic(
      { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data: 'ENCRYPTED' } },
      accumulator,
      () => {},
    );
    reduceAnthropic(
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_02', name: 'stock_levels' } },
      accumulator,
      () => {},
    );

    const calls = finishCalls(accumulator);
    expect(calls[0]?.reasoning).toEqual([{ type: 'redacted_thinking', data: 'ENCRYPTED' }]);
  });

  it('leaves later calls in the same turn without their own copy of the reasoning', () => {
    const accumulator = newAccumulator();

    reduceAnthropic(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'x', signature: 's' } },
      accumulator,
      () => {},
    );
    reduceAnthropic(
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'a', name: 'one' } },
      accumulator,
      () => {},
    );
    reduceAnthropic(
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'b', name: 'two' } },
      accumulator,
      () => {},
    );

    const calls = finishCalls(accumulator);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.reasoning).toHaveLength(1);
    expect(calls[1]?.reasoning).toBeUndefined();
  });

  it('still streams ordinary text deltas and leaves calls without reasoning untouched', () => {
    const accumulator = newAccumulator();
    const seenText: string[] = [];

    reduceAnthropic(
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      accumulator,
      (text) => seenText.push(text),
    );

    expect(seenText).toEqual(['Hello']);
    expect(accumulator.text).toBe('Hello');
    expect(finishCalls(accumulator)).toEqual([]);
  });

  it('replays the reasoning ahead of the text and tool_use blocks, in order', () => {
    const call: ToolCall = {
      id: 'toolu_01',
      name: 'window_totals',
      args: { days: 30 },
      reasoning: [{ type: 'thinking', thinking: 'checking the numbers', signature: 'sig-abc' }],
    };

    const [message] = anthropicMessages([
      { role: 'assistant', content: 'One moment.', calls: [call] },
    ]);

    expect(message?.content).toEqual([
      { type: 'thinking', thinking: 'checking the numbers', signature: 'sig-abc' },
      { type: 'text', text: 'One moment.' },
      { type: 'tool_use', id: 'toolu_01', name: 'window_totals', input: { days: 30 } },
    ]);
  });

  it('replays reasoning with no text block when the turn said nothing', () => {
    const call: ToolCall = {
      id: 'toolu_01',
      name: 'window_totals',
      args: {},
      reasoning: [{ type: 'redacted_thinking', data: 'ENCRYPTED' }],
    };

    const [message] = anthropicMessages([{ role: 'assistant', content: '', calls: [call] }]);

    expect(message?.content).toEqual([
      { type: 'redacted_thinking', data: 'ENCRYPTED' },
      { type: 'tool_use', id: 'toolu_01', name: 'window_totals', input: {} },
    ]);
  });
});

/**
 * The request bodies and headers each provider actually receives.
 *
 * `client.ts` and `stream.ts` both build these from the same `modelRules.ts`
 * functions; these tests pin the streaming side's assembly of them so a
 * future edit cannot quietly reintroduce `temperature` on a model that 400s
 * on it, or leak `authorization`/`openai-organization` to the wrong adapter.
 */
describe('dialectFor', () => {
  const request = { system: 'system prompt', messages: [] };

  it('omits temperature and sends effort for a no-sampling Claude model', () => {
    const dialect = dialectFor(
      settingsFor({ provider: 'claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5' }),
      request,
    );

    const body = dialect.body as Record<string, unknown>;
    expect(body['temperature']).toBeUndefined();
    expect(body['output_config']).toEqual({ effort: 'low' });
    expect(dialect.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('sends temperature and no effort for Claude Haiku 4.5', () => {
    const dialect = dialectFor(
      settingsFor({
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-haiku-4-5',
        temperature: 0.4,
      }),
      request,
    );

    const body = dialect.body as Record<string, unknown>;
    expect(body['temperature']).toBe(0.4);
    expect(body['output_config']).toBeUndefined();
  });

  it('speaks Responses for openai: max_output_tokens, store:false, reasoning effort, and tools with strict:false', () => {
    const dialect = dialectFor(
      settingsFor({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-6-astra',
        maxTokens: 4_096,
      }),
      { ...request, tools: [{ name: 'ok', description: 'd', parameters: { type: 'object' } }] },
    );

    expect(dialect.url).toBe('https://api.openai.com/v1/responses');

    const body = dialect.body as Record<string, unknown>;
    expect(body['instructions']).toBe('system prompt');
    expect(body['max_output_tokens']).toBe(4_096);
    expect(body['max_completion_tokens']).toBeUndefined();
    expect(body['max_tokens']).toBeUndefined();
    expect(body['store']).toBe(false);
    expect(body['temperature']).toBeUndefined();
    expect(body['reasoning']).toEqual({ effort: 'low' });
    expect(body['include']).toEqual(['reasoning.encrypted_content']);
    /* OpenAI is on the native-tools list now — see `supportsNativeTools` —
       and Responses' own shape for a declared tool: no nested `function`
       wrapper, and `strict` stated explicitly rather than left to whatever
       OpenAI infers for a schema with optional properties. */
    expect(body['tools']).toEqual([{ type: 'function', name: 'ok', description: 'd', parameters: { type: 'object' }, strict: false }]);
    expect(body['tool_choice']).toBe('auto');
  });

  it('sends temperature and no reasoning fields for a known non-reasoning OpenAI id', () => {
    const dialect = dialectFor(
      settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', temperature: 0.3 }),
      request,
    );

    const body = dialect.body as Record<string, unknown>;
    expect(body['temperature']).toBe(0.3);
    expect(body['reasoning']).toBeUndefined();
    expect(body['include']).toBeUndefined();
  });

  it('declares no tools on the openai Responses body when none were asked for', () => {
    const dialect = dialectFor(
      settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }),
      request,
    );

    const body = dialect.body as Record<string, unknown>;
    expect(body['tools']).toBeUndefined();
    expect(body['tool_choice']).toBeUndefined();
  });

  it('disables thinking for DeepSeek and keeps max_tokens/temperature', () => {
    const dialect = dialectFor(
      settingsFor({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.2,
        maxTokens: 4_096,
      }),
      request,
    );

    const body = dialect.body as Record<string, unknown>;
    expect(body['thinking']).toEqual({ type: 'disabled' });
    expect(body['max_tokens']).toBe(4_096);
    expect(body['temperature']).toBe(0.2);
  });

  it('asks deepseek and ollama for usage in the stream — both document stream_options', () => {
    const deepseek = dialectFor(
      settingsFor({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
      request,
    );
    expect((deepseek.body as Record<string, unknown>)['stream_options']).toEqual({ include_usage: true });

    const ollama = dialectFor(
      settingsFor({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3' }),
      request,
    );
    expect((ollama.body as Record<string, unknown>)['stream_options']).toEqual({ include_usage: true });
  });

  it('never asks mistral, grok or a custom gateway for stream usage — unverified or documented absent', () => {
    const mistral = dialectFor(
      settingsFor({ provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' }),
      request,
    );
    expect((mistral.body as Record<string, unknown>)['stream_options']).toBeUndefined();

    const grok = dialectFor(settingsFor({ provider: 'grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7' }), request);
    expect((grok.body as Record<string, unknown>)['stream_options']).toBeUndefined();

    const custom = dialectFor(
      settingsFor({ provider: 'custom', baseUrl: 'https://gateway.example.com/v1', model: 'whatever' }),
      request,
    );
    expect((custom.body as Record<string, unknown>)['stream_options']).toBeUndefined();
  });

  it('never sends a bare "Bearer " for a keyless Ollama connection', () => {
    const dialect = dialectFor(
      settingsFor({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3', apiKey: '' }),
      request,
    );

    expect(dialect.headers['authorization']).toBeUndefined();
  });

  it('never leaks an OpenAI organisation id to a different provider', () => {
    const dialect = dialectFor(
      settingsFor({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        orgId: 'org-leftover-from-openai',
      }),
      request,
    );

    expect(dialect.headers['openai-organization']).toBeUndefined();
  });

  it('keeps the Gemini request unchanged: temperature, maxOutputTokens and the thinking floor', () => {
    const dialect = dialectFor(
      settingsFor({
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-3.6-flash',
        temperature: 0.2,
        maxTokens: 4_096,
      }),
      request,
    );

    expect(dialect.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse',
    );
    expect(dialect.body).toEqual({
      systemInstruction: { parts: [{ text: 'system prompt' }] },
      contents: [],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4_096,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    });
    expect(dialect.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': 'test-key' });
  });
});

/**
 * The Chat Completions reducer — OpenRouter, DeepSeek, Mistral, Grok, Ollama,
 * a custom gateway. Covers only what changed here: DeepSeek's own spelling of
 * a cache hit, read as a fallback and never invented.
 */
describe('reduceOpenAi', () => {
  it('reads the standard prompt_tokens_details.cached_tokens field when present', () => {
    const accumulator = newAccumulator();
    reduceOpenAi(
      { usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens: 20 } },
      accumulator,
      () => {},
    );
    expect(accumulator.cachedInputTokens).toBe(30);
    expect(accumulator.inputTokens).toBe(70);
  });

  it("falls back to DeepSeek's prompt_cache_hit_tokens when the standard field is absent", () => {
    const accumulator = newAccumulator();
    reduceOpenAi(
      { usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 40, completion_tokens: 20 } },
      accumulator,
      () => {},
    );
    expect(accumulator.cachedInputTokens).toBe(40);
    expect(accumulator.inputTokens).toBe(60);
  });

  it('prefers the standard field over prompt_cache_hit_tokens when both are present', () => {
    const accumulator = newAccumulator();
    reduceOpenAi(
      {
        usage: {
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 30 },
          prompt_cache_hit_tokens: 999,
          completion_tokens: 20,
        },
      },
      accumulator,
      () => {},
    );
    expect(accumulator.cachedInputTokens).toBe(30);
  });

  it('never invents a cache figure when the provider states neither field', () => {
    const accumulator = newAccumulator();
    reduceOpenAi({ usage: { prompt_tokens: 100, completion_tokens: 20 } }, accumulator, () => {});
    expect(accumulator.cachedInputTokens).toBeUndefined();
    expect(accumulator.inputTokens).toBe(100);
  });
});

/**
 * The OpenAI Responses `input` array — the analogue of `anthropicMessages` /
 * `openAiMessages` / `geminiContents` for the fourth dialect. See its own
 * JSDoc in `stream.ts` for the three ways it differs from the Chat
 * Completions conversion.
 */
describe('openAiResponsesInput', () => {
  it('turns a user message into a plain role/content item', () => {
    expect(openAiResponsesInput([{ role: 'user', content: 'hello' }])).toEqual([
      { type: 'message', role: 'user', content: 'hello' },
    ]);
  });

  it('turns an assistant message with only text into a plain role/content item', () => {
    expect(openAiResponsesInput([{ role: 'assistant', content: 'hi there' }])).toEqual([
      { type: 'message', role: 'assistant', content: 'hi there' },
    ]);
  });

  it('emits no message item for a blank assistant turn — a tool-only round produced no text', () => {
    const call: ToolCall = { id: 'call_1', name: 'window_totals', args: { days: 30 } };
    expect(openAiResponsesInput([{ role: 'assistant', content: '', calls: [call] }])).toEqual([
      { type: 'function_call', call_id: 'call_1', name: 'window_totals', arguments: '{"days":30}' },
    ]);
  });

  it('replays reasoning ahead of the text and the calls, in order, with no fc_ id on the call', () => {
    const reasoning: readonly OpenAiReasoningItem[] = [
      { id: 'rs_1', summary: [{ type: 'summary_text', text: 'checking the numbers' }], encryptedContent: 'ENC' },
    ];
    const call: ToolCall = {
      id: 'call_1',
      name: 'window_totals',
      args: { days: 30 },
      openAiReasoning: reasoning,
    };

    expect(openAiResponsesInput([{ role: 'assistant', content: 'One moment.', calls: [call] }])).toEqual([
      {
        type: 'reasoning',
        id: 'rs_1',
        summary: [{ type: 'summary_text', text: 'checking the numbers' }],
        encrypted_content: 'ENC',
      },
      { type: 'message', role: 'assistant', content: 'One moment.' },
      { type: 'function_call', call_id: 'call_1', name: 'window_totals', arguments: '{"days":30}' },
    ]);
  });

  it('drops a reasoning item with no encrypted_content — OpenAI cannot resolve one at all under store:false', () => {
    const reasoning: readonly OpenAiReasoningItem[] = [{ id: 'rs_1', summary: [], encryptedContent: null }];
    const call: ToolCall = { id: 'call_1', name: 'one', args: {}, openAiReasoning: reasoning };

    const items = openAiResponsesInput([{ role: 'assistant', content: '', calls: [call] }]);
    expect(items).toEqual([{ type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' }]);
  });

  it('leaves a later call in the same turn without its own copy of the reasoning', () => {
    const reasoning: readonly OpenAiReasoningItem[] = [{ id: 'rs_1', summary: [], encryptedContent: 'ENC' }];
    const calls: ToolCall[] = [
      { id: 'call_1', name: 'one', args: {}, openAiReasoning: reasoning },
      { id: 'call_2', name: 'two', args: {} },
    ];

    const items = openAiResponsesInput([{ role: 'assistant', content: '', calls }]);
    expect(items.filter((item) => item.type === 'reasoning')).toHaveLength(1);
  });

  it('turns a tool message into one function_call_output per reply, keyed by call_id', () => {
    const items = openAiResponsesInput([
      {
        role: 'tool',
        replies: [
          { id: 'call_1', name: 'window_totals', content: '{"total":100}' },
          { id: 'call_2', name: 'stock_levels', content: '{"count":5}' },
        ],
      },
    ]);

    expect(items).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: '{"total":100}' },
      { type: 'function_call_output', call_id: 'call_2', output: '{"count":5}' },
    ]);
  });
});

/**
 * The Responses SSE reducer — assembled from the event vocabulary in OpenAI's
 * own streaming reference (`response.output_text.delta`,
 * `response.output_item.added/done`, `response.function_call_arguments.delta/
 * done`, `response.completed`/`incomplete`, `response.failed`, a bare
 * `error`).
 */
describe('reduceOpenAiResponses', () => {
  it('streams text deltas to onText and the accumulator', () => {
    const accumulator = newAccumulator();
    const seen: string[] = [];

    reduceOpenAiResponses({ type: 'response.output_text.delta', delta: 'Hel' }, accumulator, (t) => seen.push(t));
    reduceOpenAiResponses({ type: 'response.output_text.delta', delta: 'lo' }, accumulator, (t) => seen.push(t));

    expect(seen).toEqual(['Hel', 'lo']);
    expect(accumulator.text).toBe('Hello');
  });

  it('assembles a function call from added + delta fragments, with done overwriting them', () => {
    const accumulator = newAccumulator();
    const onText = (): void => {};

    reduceOpenAiResponses(
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'window_totals', arguments: '' },
      },
      accumulator,
      onText,
    );
    reduceOpenAiResponses(
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"day' },
      accumulator,
      onText,
    );
    reduceOpenAiResponses(
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: 's":3' },
      accumulator,
      onText,
    );
    /* Authoritative — overwrites the fragments above rather than appending,
       so an out-of-order or double-counted delta cannot corrupt the call. */
    reduceOpenAiResponses(
      { type: 'response.function_call_arguments.done', output_index: 0, arguments: '{"days":30}' },
      accumulator,
      onText,
    );

    const [call] = finishCalls(accumulator);
    expect(call).toMatchObject({ id: 'call_1', name: 'window_totals', args: { days: 30 } });
  });

  it('captures a reasoning item only at output_item.done, in output order, and attaches it to the first call', () => {
    const accumulator = newAccumulator();
    const onText = (): void => {};

    reduceOpenAiResponses(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [] } },
      accumulator,
      onText,
    );
    /* Nothing captured yet — `added` fires before the item has content. */
    expect(accumulator.openAiReasoning).toHaveLength(0);

    reduceOpenAiResponses(
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'thinking' }], encrypted_content: 'ENC' },
      },
      accumulator,
      onText,
    );
    reduceOpenAiResponses(
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      },
      accumulator,
      onText,
    );

    const [call] = finishCalls(accumulator);
    expect(call?.openAiReasoning).toEqual([
      { id: 'rs_1', summary: [{ type: 'summary_text', text: 'thinking' }], encryptedContent: 'ENC' },
    ]);
  });

  it('reads input/output/cached/reasoning token counts off response.completed', () => {
    const accumulator = newAccumulator();

    reduceOpenAiResponses(
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 120,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens: 60,
            output_tokens_details: { reasoning_tokens: 40 },
          },
        },
      },
      accumulator,
      () => {},
    );

    expect(accumulator.rawInputTokens).toBe(120);
    expect(accumulator.inputTokens).toBe(100);
    expect(accumulator.cachedInputTokens).toBe(20);
    expect(accumulator.outputTokens).toBe(60);
    expect(accumulator.reasoningTokens).toBe(40);
  });

  it('does not throw on response.incomplete when partial text already arrived', () => {
    const accumulator = newAccumulator();
    reduceOpenAiResponses({ type: 'response.output_text.delta', delta: 'partial' }, accumulator, () => {});

    expect(() =>
      reduceOpenAiResponses(
        { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
        accumulator,
        () => {},
      ),
    ).not.toThrow();
    expect(accumulator.text).toBe('partial');
  });

  it('does not throw on response.incomplete when a call already arrived, even with no text', () => {
    const accumulator = newAccumulator();
    reduceOpenAiResponses(
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', call_id: 'call_1', name: 'one', arguments: '{}' },
      },
      accumulator,
      () => {},
    );

    expect(() =>
      reduceOpenAiResponses(
        { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
        accumulator,
        () => {},
      ),
    ).not.toThrow();
  });

  it('throws a non-retryable client ApiError naming the reason when response.incomplete arrives with neither text nor a call', () => {
    const accumulator = newAccumulator();
    let thrown: unknown;

    try {
      reduceOpenAiResponses(
        { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
        accumulator,
        () => {},
      );
    } catch (error) {
      thrown = error;
    }

    // 'client', not 'server': the identical request hits the identical wall
    // again, so `shouldRetry` must never repeat it — see `openAiIncompleteError`.
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).kind).toBe('client');
    expect((thrown as ApiError).isRetryable).toBe(false);
    expect((thrown as ApiError).message).toContain('max_output_tokens');
  });

  it('throws a retryable server ApiError for response.failed with no code — OpenAI\'s own server_error shape', () => {
    const accumulator = newAccumulator();
    let thrown: unknown;

    try {
      reduceOpenAiResponses(
        { type: 'response.failed', response: { error: { message: 'the model exploded' } } },
        accumulator,
        () => {},
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).kind).toBe('server');
    expect((thrown as ApiError).isRetryable).toBe(true);
    expect((thrown as ApiError).message).toBe('the model exploded');
  });

  it('throws an ApiError for a bare error event, classified by its code like response.failed', () => {
    const accumulator = newAccumulator();

    expect(() =>
      reduceOpenAiResponses({ type: 'error', message: 'invalid request' }, accumulator, () => {}),
    ).toThrow('invalid request');

    let thrown: unknown;
    try {
      reduceOpenAiResponses(
        { type: 'error', code: 'rate_limit_exceeded', message: 'slow down' },
        accumulator,
        () => {},
      );
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ApiError).kind).toBe('rateLimited');

    try {
      reduceOpenAiResponses({ type: 'error', code: 'content_filter', message: 'blocked' }, accumulator, () => {});
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ApiError).kind).toBe('client');
    expect((thrown as ApiError).isRetryable).toBe(false);
  });

  it('ignores event types it does not know about', () => {
    const accumulator = newAccumulator();
    expect(() =>
      reduceOpenAiResponses({ type: 'response.created' }, accumulator, () => {}),
    ).not.toThrow();
    expect(accumulator.text).toBe('');
  });
});
