import { describe, expect, it } from 'vitest';

import { ApiError } from '@/services/api/client';
import { DEFAULT_SETTINGS } from '@/constants/settings';
import type { AiSettings } from '@/types/settings';

import type { ToolCall } from './messages';
import {
  anthropicMessages,
  dialectFor,
  finishCalls,
  reduceAnthropic,
  RETRIES,
  retryDelay,
  shouldRetry,
  type Accumulator,
} from './stream';
import { ModelQuotaError } from './usage';

/** A settings object for one provider, built by spreading the real defaults. */
function settingsFor(overrides: Partial<AiSettings>): AiSettings {
  return { ...DEFAULT_SETTINGS.ai, apiKey: 'test-key', ...overrides };
}

function newAccumulator(): Accumulator {
  return {
    text: '',
    calls: new Map(),
    order: [],
    reasoning: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
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

  it('uses max_completion_tokens and reasoning_effort for an OpenAI reasoning model, with no tools', () => {
    const dialect = dialectFor(
      settingsFor({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-6-astra',
        maxTokens: 4_096,
      }),
      { ...request, tools: [{ name: 'ok', description: 'd', parameters: { type: 'object' } }] },
    );

    const body = dialect.body as Record<string, unknown>;
    expect(body['max_completion_tokens']).toBe(4_096);
    expect(body['max_tokens']).toBeUndefined();
    expect(body['temperature']).toBeUndefined();
    expect(body['reasoning_effort']).toBe('low');
    /* OpenAI is off the native-tools list — see `supportsNativeTools` — so a
       declared tool must never reach the wire for this provider. */
    expect(body['tools']).toBeUndefined();
  });

  it('sends temperature for a known non-reasoning OpenAI id', () => {
    const dialect = dialectFor(
      settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', temperature: 0.3 }),
      request,
    );

    const body = dialect.body as Record<string, unknown>;
    expect(body['temperature']).toBe(0.3);
    expect(body['reasoning_effort']).toBeUndefined();
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
