import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS, MAX_TOKENS_BOUNDS, defaultAiConnection } from '@/constants/settings';
import type { AiProvider, AiSettings } from '@/types/settings';

/**
 * The one-shot completion path — `complete()` and the pure readers it is
 * built from. `axios` itself is mocked at the module boundary, the same
 * boundary `complete()` calls through, so these pin the request this
 * application actually sends and the response shapes it actually reads,
 * without needing a real key or a real network.
 */

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({
  /* `@/services/api/client` — pulled in transitively through `toApiError`/
     `ApiError` — calls `axios.create(...)` at module scope for the unrelated
     Uzum seller-API client, so the mock has to answer that call too, not just
     the `axios.post` this module calls directly. */
  default: {
    post,
    isAxiosError: () => false,
    create: () => ({ interceptors: { request: { use: () => {} }, response: { use: () => {} } } }),
  },
}));

const { complete, firstOpenAiResponsesText, usageOf } = await import('./client');

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

beforeEach(() => {
  post.mockReset();
});

describe('firstOpenAiResponsesText', () => {
  it('reads the first output_text part of the first message item, skipping a leading reasoning item', () => {
    const body = {
      output: [
        { type: 'reasoning', id: 'rs_1' },
        { type: 'message', content: [{ type: 'output_text', text: 'hello there' }] },
      ],
    };
    expect(firstOpenAiResponsesText(body)).toBe('hello there');
  });

  it('returns null when there is no message item at all', () => {
    expect(firstOpenAiResponsesText({ output: [{ type: 'reasoning' }] })).toBeNull();
  });

  it('returns null for a body that is not the expected shape', () => {
    expect(firstOpenAiResponsesText(null)).toBeNull();
    expect(firstOpenAiResponsesText({})).toBeNull();
  });

  it('never reads a top-level output_text field — an SDK convenience property, not a wire field', () => {
    expect(firstOpenAiResponsesText({ output_text: 'shortcut', output: [] })).toBeNull();
  });
});

describe('usageOf', () => {
  it('reads Claude usage, folding the cache write into input and reporting the cache read apart', () => {
    const usage = usageOf('claude', {
      usage: { input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 50 },
    });
    expect(usage).toEqual({ inputTokens: 130, cachedInputTokens: 20, outputTokens: 50, reasoningTokens: null });
  });

  it('reads Gemini usage, folding thoughts into output and reporting them apart', () => {
    const usage = usageOf('gemini', {
      usageMetadata: {
        promptTokenCount: 80,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 15,
        cachedContentTokenCount: 5,
      },
    });
    expect(usage).toEqual({ inputTokens: 80, cachedInputTokens: 5, outputTokens: 45, reasoningTokens: 15 });
  });

  it('reads OpenAI Responses usage', () => {
    const usage = usageOf('openai', {
      usage: {
        input_tokens: 120,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 60,
        output_tokens_details: { reasoning_tokens: 40 },
      },
    });
    expect(usage).toEqual({ inputTokens: 120, cachedInputTokens: 20, outputTokens: 60, reasoningTokens: 40 });
  });

  it('reads Chat Completions usage for the rest of the OpenAI-compatible list', () => {
    const usage = usageOf('deepseek', {
      usage: {
        prompt_tokens: 90,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens: 40,
        completion_tokens_details: { reasoning_tokens: 25 },
      },
    });
    expect(usage).toEqual({ inputTokens: 90, cachedInputTokens: 10, outputTokens: 40, reasoningTokens: 25 });
  });

  it("falls back to DeepSeek's own prompt_cache_hit_tokens when the standard cache field is absent", () => {
    const usage = usageOf('deepseek', {
      usage: { prompt_tokens: 90, prompt_cache_hit_tokens: 15, completion_tokens: 40 },
    });
    expect(usage.cachedInputTokens).toBe(15);
  });

  it('never invents a cache figure for a Chat Completions body that states neither field', () => {
    const usage = usageOf('deepseek', { usage: { prompt_tokens: 90, completion_tokens: 40 } });
    expect(usage.cachedInputTokens).toBeNull();
  });

  it('reports everything as null when the provider said nothing about usage at all', () => {
    const provider: AiProvider = 'ollama';
    expect(usageOf(provider, {})).toEqual({
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
    });
  });
});

describe('complete — the Auto sentinel never reaches the wire', () => {
  const request = { system: 's', messages: [{ role: 'user' as const, content: 'hi' }] };

  /** Every number anywhere in a JSON body, so a leak cannot hide under a renamed field. */
  function numbersIn(value: unknown): number[] {
    if (typeof value === 'number') return [value];
    if (Array.isArray(value)) return value.flatMap(numbersIn);
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
    return [];
  }

  function sentBody(): Record<string, unknown> {
    return (post.mock.calls[0] as [string, Record<string, unknown>])[1];
  }

  it('sends claude-opus-5 the balanced 32,000 as max_tokens on Auto', async () => {
    post.mockResolvedValue({ data: { content: [{ type: 'text', text: 'ok' }] } });

    await complete(
      settingsFor({ provider: 'claude', model: 'claude-opus-5', maxTokens: MAX_TOKENS_BOUNDS.max }),
      request,
    );

    expect(sentBody()['max_tokens']).toBe(32_000);
    expect(numbersIn(sentBody())).not.toContain(MAX_TOKENS_BOUNDS.max);
  });

  it('sends gemini-3.6-flash the balanced 32,000 as generationConfig.maxOutputTokens', async () => {
    post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } });

    await complete(
      settingsFor({ provider: 'gemini', model: 'gemini-3.6-flash', maxTokens: MAX_TOKENS_BOUNDS.max }),
      request,
    );

    const config = sentBody()['generationConfig'] as Record<string, unknown>;
    expect(config['maxOutputTokens']).toBe(32_000);
    expect(numbersIn(sentBody())).not.toContain(MAX_TOKENS_BOUNDS.max);
  });

  it('keeps the sentinel off the OpenAI Responses body', async () => {
    post.mockResolvedValue({
      data: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] },
    });

    await complete(
      settingsFor({ provider: 'openai', model: 'gpt-6-sol', maxTokens: MAX_TOKENS_BOUNDS.max }),
      request,
    );

    expect(sentBody()['max_output_tokens']).toBe(16_384);
    expect(numbersIn(sentBody())).not.toContain(MAX_TOKENS_BOUNDS.max);
  });

  it('keeps the sentinel off an OpenAI-compatible body', async () => {
    post.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }] } });

    await complete(
      settingsFor({ provider: 'deepseek', model: 'deepseek-flash', maxTokens: MAX_TOKENS_BOUNDS.max }),
      request,
    );

    expect(numbersIn(sentBody())).not.toContain(MAX_TOKENS_BOUNDS.max);
  });
});

describe('complete — openai speaks Responses', () => {
  it('posts to /responses with instructions, input and the model-dependent fields', async () => {
    post.mockResolvedValue({
      data: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] },
    });

    const text = await complete(
      settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' }),
      { system: 'be terse', messages: [{ role: 'user', content: 'hi' }] },
    );

    expect(text).toBe('ok');
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body['instructions']).toBe('be terse');
    expect(body['input']).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body['store']).toBe(false);
    expect(body['reasoning']).toEqual({ effort: 'low' });
    /* No tools — the insights rail never runs the agent loop. */
    expect(body['tools']).toBeUndefined();
  });

  it('throws a non-retryable client error naming the reason when the response is incomplete with no text at all', async () => {
    post.mockResolvedValue({
      data: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] },
    });

    await expect(
      complete(settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' }), {
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      // 'client', not 'server': the identical request hits the identical wall
      // again, so this must never be retried — see `openAiIncompleteError`.
    ).rejects.toMatchObject({ kind: 'client', isRetryable: false });
  });

  it('returns the partial text of an incomplete response rather than throwing', async () => {
    post.mockResolvedValue({
      data: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial answer' }] }],
      },
    });

    await expect(
      complete(settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' }), {
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBe('partial answer');
  });

  it('throws a retryable server error for a failed response with no code — OpenAI\'s own server_error shape', async () => {
    post.mockResolvedValue({ data: { status: 'failed', error: { message: 'boom' } } });

    await expect(
      complete(settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' }), {
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ kind: 'server', message: 'boom' });
  });

  it('throws a non-retryable client error for a failed response with a specific, deterministic code', async () => {
    post.mockResolvedValue({ data: { status: 'failed', error: { code: 'content_filter', message: 'blocked' } } });

    await expect(
      complete(settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra' }), {
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ kind: 'client', isRetryable: false, message: 'blocked' });
  });
});
