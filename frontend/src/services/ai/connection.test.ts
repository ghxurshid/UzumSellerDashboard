import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS, defaultAiConnection } from '@/constants/settings';
import { ApiError } from '@/services/api/client';
import type { AiProvider, AiSettings } from '@/types/settings';

import {
  listModels,
  readClaudeModels,
  readGeminiModels,
  readOpenAiModels,
  sortModels,
  testConnection,
} from './connection';
import * as streamModule from './stream';

/**
 * A settings object for one provider, built from that provider's own
 * catalogue defaults — not a fixed provider's connection with the `provider`
 * field swapped out, which would leave an override still carrying a
 * different provider's own parameters.
 */
function settingsFor(overrides: Partial<AiSettings> & { readonly provider?: AiProvider }): AiSettings {
  const provider = overrides.provider ?? DEFAULT_AI_SETTINGS.provider;
  return { provider, ...defaultAiConnection(provider), apiKey: 'test-key', ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── testConnection ─────────────────────────────────────────────────────── */

describe('testConnection', () => {
  it('throws unconfigured without calling the network at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      testConnection(settingsFor({ provider: 'openai', apiKey: '' })),
    ).rejects.toMatchObject({ kind: 'unconfigured' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports success with the trimmed reply and a measured latency', async () => {
    vi.spyOn(streamModule, 'streamComplete').mockResolvedValue({
      text: '  ok  ',
      calls: [],
      inputTokens: 3,
      outputTokens: 1,
      cachedInputTokens: 0,
    });

    const result = await testConnection(settingsFor({ provider: 'gemini' }));
    expect(result.reply).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('counts an empty reply after a completed stream as connected', async () => {
    vi.spyOn(streamModule, 'streamComplete').mockResolvedValue({
      text: '',
      calls: [],
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });

    await expect(testConnection(settingsFor({ provider: 'claude' }))).resolves.toMatchObject({ reply: '' });
  });

  it('declares a tool for a native provider and none for an OpenAI-compatible one', async () => {
    const spy = vi.spyOn(streamModule, 'streamComplete').mockResolvedValue({
      text: 'ok',
      calls: [],
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });

    await testConnection(settingsFor({ provider: 'claude' }));
    expect(spy.mock.calls[0]?.[0].request.tools).toHaveLength(1);

    /* openai is native now too — Responses lifts the restriction Chat
       Completions had on GPT-6's tool calling, see `supportsNativeTools`. */
    await testConnection(settingsFor({ provider: 'openai' }));
    expect(spy.mock.calls[1]?.[0].request.tools).toHaveLength(1);

    await testConnection(settingsFor({ provider: 'deepseek' }));
    expect(spy.mock.calls[2]?.[0].request.tools).toBeUndefined();
  });

  it('passes an unauthorized failure straight through, without probing /models', async () => {
    vi.spyOn(streamModule, 'streamComplete').mockRejectedValue(
      new ApiError('bad key', { kind: 'unauthorized', status: 401 }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(testConnection(settingsFor({ provider: 'openai' }))).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never probes /models for Claude or Gemini on a network failure', async () => {
    vi.spyOn(streamModule, 'streamComplete').mockRejectedValue(
      new ApiError('unreachable', { kind: 'network' }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(testConnection(settingsFor({ provider: 'claude' }))).rejects.toMatchObject({ kind: 'network' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reclassifies an OpenAI-compatible network failure as unauthorized when /models says 401', async () => {
    vi.spyOn(streamModule, 'streamComplete').mockRejectedValue(
      new ApiError('unreachable', { kind: 'network' }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        text: () => Promise.resolve('invalid_api_key'),
      }),
    );

    await expect(testConnection(settingsFor({ provider: 'openai' }))).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
    });
  });

  it('keeps the original network failure when the /models probe cannot say more', async () => {
    vi.spyOn(streamModule, 'streamComplete').mockRejectedValue(
      new ApiError('unreachable', { kind: 'network' }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 500, ok: false, text: () => Promise.resolve('') }),
    );

    await expect(testConnection(settingsFor({ provider: 'openai' }))).rejects.toMatchObject({ kind: 'network' });
  });
});

/* ── listModels ─────────────────────────────────────────────────────────── */

describe('listModels', () => {
  it('throws unconfigured without calling the network at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(listModels(settingsFor({ provider: 'openai', apiKey: '' }))).rejects.toMatchObject({
      kind: 'unconfigured',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws unconfigured when the base URL is blank, regardless of the model', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      listModels(settingsFor({ provider: 'ollama', baseUrl: '', model: '', apiKey: '' })),
    ).rejects.toMatchObject({ kind: 'unconfigured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not require a model id — this is how a seller fills in a still-blank one', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      listModels(settingsFor({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: '', apiKey: '' })),
    ).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('still needs a key for a provider that requires one, even with no model chosen yet', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      listModels(settingsFor({ provider: 'openrouter', model: '', apiKey: '' })),
    ).rejects.toMatchObject({ kind: 'unconfigured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads the Anthropic model list and asks with the chat headers', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [
            { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
            { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const models = await listModels(settingsFor({ provider: 'claude', baseUrl: 'https://api.anthropic.com/v1' }));

    expect(models).toEqual([
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
    ]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('reads the Gemini model list, keeping only generateContent models and stripping the prefix', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          models: [
            {
              name: 'models/gemini-3.6-flash',
              displayName: 'Gemini 3.6 Flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/embedding-001',
              displayName: 'Embedding 001',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const models = await listModels(
      settingsFor({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }),
    );

    expect(models).toEqual([{ id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' }]);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
  });

  it('drops obviously non-chat ids for openai but keeps everything for a compatible gateway', async () => {
    const body = {
      data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'dall-e-3' }],
    };

    expect(readOpenAiModels(body, 'openai')).toEqual([{ id: 'gpt-4o', label: 'gpt-4o' }]);
    expect(readOpenAiModels(body, 'openrouter')).toHaveLength(4);
  });

  it('drops instruct and search-tuned ids for openai, but keeps them for a compatible gateway', async () => {
    const body = {
      data: [{ id: 'gpt-6-astra' }, { id: 'gpt-3.5-turbo-instruct' }, { id: 'gpt-4o-search-preview' }],
    };

    expect(readOpenAiModels(body, 'openai')).toEqual([{ id: 'gpt-6-astra', label: 'gpt-6-astra' }]);
    expect(readOpenAiModels(body, 'openrouter')).toHaveLength(3);
  });

  it('drops legacy completion families for openai even though they are not embeddings or audio', async () => {
    const body = { data: [{ id: 'gpt-6-astra' }, { id: 'davinci-002' }, { id: 'babbage-002' }] };
    expect(readOpenAiModels(body, 'openai')).toEqual([{ id: 'gpt-6-astra', label: 'gpt-6-astra' }]);
  });

  it('orders openai models newest first by the created field, GPT-6 above GPT-4.1', async () => {
    const body = {
      data: [
        { id: 'gpt-4.1', created: 100 },
        { id: 'gpt-6-astra', created: 300 },
        { id: 'gpt-6-sol', created: 200 },
      ],
    };

    expect(readOpenAiModels(body, 'openai').map((model) => model.id)).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-4.1']);
  });

  it('sorts an openai id with no created field after every dated one, rather than breaking the order', async () => {
    const body = {
      data: [
        { id: 'gpt-6-astra', created: 300 },
        { id: 'gpt-oss-no-date' },
      ],
    };

    expect(readOpenAiModels(body, 'openai').map((model) => model.id)).toEqual(['gpt-6-astra', 'gpt-oss-no-date']);
  });

  it('does not alphabetise the openai list through listModels — the created order must survive', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [
            { id: 'gpt-4.1', created: 100 },
            { id: 'gpt-6-astra', created: 300 },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const models = await listModels(settingsFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }));
    expect(models.map((model) => model.id)).toEqual(['gpt-6-astra', 'gpt-4.1']);
  });

  it('sends no authorization header for a keyless custom endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await listModels(settingsFor({ provider: 'custom', baseUrl: 'https://gateway.example.com/v1', apiKey: '' }));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('turns a 401 into an unauthorized ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('nope'), headers: new Headers() }),
    );

    await expect(listModels(settingsFor({ provider: 'openai' }))).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

/* ── the pure readers, pinned against the documented wire shapes ─────────── */

describe('readClaudeModels / readGeminiModels / readOpenAiModels / sortModels', () => {
  it('is defensive about a body that is not the expected shape', () => {
    expect(readClaudeModels(null)).toEqual([]);
    expect(readClaudeModels({})).toEqual([]);
    expect(readGeminiModels({ models: 'not-a-list' })).toEqual([]);
    expect(readOpenAiModels(undefined, 'openai')).toEqual([]);
  });

  it('sorts by id, deterministically', () => {
    expect(sortModels([{ id: 'b', label: 'B' }, { id: 'a', label: 'A' }])).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
  });

  it('falls back to the raw name when Gemini sends no displayName', () => {
    const models = readGeminiModels({
      models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }],
    });
    expect(models).toEqual([{ id: 'gemini-x', label: 'gemini-x' }]);
  });
});
