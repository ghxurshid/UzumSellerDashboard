import axios, { type AxiosRequestConfig } from 'axios';

import { toApiError, ApiError } from '@/services/api/client';
import type { AiProvider, AiSettings } from '@/types/settings';

import { isKeyRejection, ModelQuotaError, readQuotaFailure, recordModelRequest } from './usage';

/**
 * The analysis layer's connection to whichever model the user configured.
 *
 * Three request shapes cover the nine adapters in the registry: Anthropic's
 * Messages API, Google's `generateContent`, and the OpenAI-compatible
 * `/chat/completions` that every other provider in the list speaks. The app
 * never ships a key — it uses the one in Settings, and refuses to call
 * anything when that is empty.
 */

export interface CompletionRequest {
  readonly system: string;
  readonly messages: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }>;
  readonly signal?: AbortSignal;
}

/** Anthropic blocks browser calls unless this header opts in explicitly. */
const ANTHROPIC_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';
const ANTHROPIC_VERSION = '2023-06-01';

function readText(value: unknown, path: readonly (string | number)[]): string | null {
  let cursor: unknown = value;
  for (const step of path) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string | number, unknown>)[step];
  }
  return typeof cursor === 'string' ? cursor : null;
}

function readNumber(value: unknown, path: readonly (string | number)[]): number | null {
  let cursor: unknown = value;
  for (const step of path) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string | number, unknown>)[step];
  }
  return typeof cursor === 'number' ? cursor : null;
}

/**
 * The prompt as the provider counted it, for the quota meter.
 *
 * This is not the number `estimateCost` would want — that one discounts a
 * cached prefix — and there is no accumulator here to carry both through a
 * single response the way the streaming path does, so this reads the raw
 * count straight from the one body there is. `null` when the provider said
 * nothing about usage at all, which `ollama` and most self-hosted gateways
 * never do.
 */
function rawInputTokens(provider: AiProvider, body: unknown): number | null {
  if (provider === 'claude') {
    const input = readNumber(body, ['usage', 'input_tokens']);
    if (input === null) return null;
    const created = readNumber(body, ['usage', 'cache_creation_input_tokens']) ?? 0;
    const read = readNumber(body, ['usage', 'cache_read_input_tokens']) ?? 0;
    return input + created + read;
  }

  if (provider === 'gemini') {
    return readNumber(body, ['usageMetadata', 'promptTokenCount']);
  }

  return readNumber(body, ['usage', 'prompt_tokens']);
}

async function send<T>(
  url: string,
  body: unknown,
  config: AxiosRequestConfig,
  meta: { readonly provider: AiProvider; readonly model: string },
): Promise<T> {
  const dispatchedAt = Date.now();

  try {
    const response = await axios.post<T>(url, body, config);

    recordModelRequest({
      provider: meta.provider,
      model: meta.model,
      at: dispatchedAt,
      inputTokens: rawInputTokens(meta.provider, response.data),
      outcome: 'ok',
    });

    return response.data;
  } catch (error) {
    /* Read the raw body before handing the error to `toApiError` — that
       function classifies and re-shapes it, and does not exist to give
       callers the body itself back. */
    const hasResponse = axios.isAxiosError(error) && error.response !== undefined;
    const rawBody = axios.isAxiosError(error) ? error.response?.data : undefined;
    const apiError = toApiError(error);

    if (hasResponse) {
      const quota = apiError.kind === 'rateLimited' ? readQuotaFailure(rawBody) : null;
      /* A rejected key never occupied a slot in any project's quota — see
         `isKeyRejection` and the "what counts as a request" section of
         `usage.ts`'s header — so it is not recorded at all. A 429 is always
         recorded: Gemini's quota errors never come back as 401/403/400. */
      const keyRejected =
        apiError.kind !== 'rateLimited' && isKeyRejection(apiError.status ?? 0, rawBody);

      if (!keyRejected) {
        recordModelRequest({
          provider: meta.provider,
          model: meta.model,
          at: dispatchedAt,
          inputTokens: null,
          outcome: apiError.kind === 'rateLimited' ? 'limited' : 'failed',
          ...(quota === null ? {} : { quota }),
        });
      }

      if (apiError.kind === 'rateLimited') {
        const retryAfterMs = apiError.retryAfterMs ?? quota?.retryAfterMs ?? undefined;
        throw new ModelQuotaError(apiError.message, {
          quota,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        });
      }
    }
    /* No response at all — network failure, timeout, cancellation — never
       occupied a request slot on the provider's side, so nothing is recorded. */

    throw apiError;
  }
}

/**
 * Ask the configured model. Returns the answer text, or throws an `ApiError`
 * whose `kind` the caller turns into the right on-screen state.
 */
export async function complete(
  settings: AiSettings,
  request: CompletionRequest,
): Promise<string> {
  if (settings.apiKey.trim() === '') {
    throw new ApiError('AI provider is not configured', { kind: 'unconfigured' });
  }
  if (settings.baseUrl.trim() === '' || settings.model.trim() === '') {
    throw new ApiError('AI provider is not configured', { kind: 'unconfigured' });
  }

  const base = settings.baseUrl.replace(/\/+$/, '');
  const common: AxiosRequestConfig = {
    timeout: settings.timeoutMs,
    ...(request.signal !== undefined ? { signal: request.signal } : {}),
  };

  if (settings.provider === 'claude') {
    const body = await send<unknown>(
      `${base}/messages`,
      {
        model: settings.model,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        system: request.system,
        messages: request.messages,
      },
      {
        ...common,
        headers: {
          'content-type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          [ANTHROPIC_BROWSER_HEADER]: 'true',
        },
      },
      { provider: settings.provider, model: settings.model },
    );

    const text = readText(body, ['content', 0, 'text']);
    if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
    return text;
  }

  if (settings.provider === 'gemini') {
    const body = await send<unknown>(
      `${base}/models/${settings.model}:generateContent`,
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxTokens,
        },
      },
      {
        ...common,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKey },
      },
      { provider: settings.provider, model: settings.model },
    );

    const text = readText(body, ['candidates', 0, 'content', 'parts', 0, 'text']);
    if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
    return text;
  }

  /* OpenAI-compatible: OpenAI, OpenRouter, DeepSeek, Mistral, Grok, Ollama and
     anything the user points the custom adapter at. */
  const body = await send<unknown>(
    `${base}/chat/completions`,
    {
      model: settings.model,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    },
    {
      ...common,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`,
        ...(settings.orgId === '' ? {} : { 'openai-organization': settings.orgId }),
      },
    },
    { provider: settings.provider, model: settings.model },
  );

  const text = readText(body, ['choices', 0, 'message', 'content']);
  if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
  return text;
}
