import axios, { type AxiosRequestConfig } from 'axios';

import { toApiError, ApiError } from '@/services/api/client';
import type { AiProvider, AiSettings } from '@/types/settings';

import {
  anthropicHeaders,
  claudeSamplingFields,
  geminiHeaders,
  isAiConfigured,
  openAiCompatibleHeaders,
  openAiCompatibleSamplingFields,
} from './modelRules';
import { isKeyRejection, ModelQuotaError, readQuotaFailure, recordModelRequest } from './usage';

/**
 * The analysis layer's connection to whichever model the user configured.
 *
 * Three request shapes cover the nine adapters in the registry: Anthropic's
 * Messages API, Google's `generateContent`, and the OpenAI-compatible
 * `/chat/completions` that every other provider in the list speaks. The app
 * never ships a key — it uses the one in Settings, and refuses to call
 * anything when that is empty (or, for the two providers a key is optional
 * for, when the rest of the connection is empty — see `isAiConfigured`).
 */

export interface CompletionRequest {
  readonly system: string;
  readonly messages: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }>;
  readonly signal?: AbortSignal;
}

function at(value: unknown, path: readonly (string | number)[]): unknown {
  let cursor: unknown = value;
  for (const step of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[step];
  }
  return cursor;
}

function readText(value: unknown, path: readonly (string | number)[]): string | null {
  const found = at(value, path);
  return typeof found === 'string' ? found : null;
}

function readNumber(value: unknown, path: readonly (string | number)[]): number | null {
  const found = at(value, path);
  return typeof found === 'number' ? found : null;
}

/**
 * The first real answer in an Anthropic response, skipping thinking blocks.
 *
 * With extended thinking on, `content[0]` is a `thinking` (or
 * `redacted_thinking`) block, not the answer — reading it positionally is
 * what used to turn every thinking-enabled reply into "Unexpected response
 * from the model". The text is wherever it is, after however many reasoning
 * blocks preceded it.
 */
function firstAnthropicText(body: unknown): string | null {
  const content = at(body, ['content']);
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (readText(block, ['type']) === 'text') {
      const text = readText(block, ['text']);
      if (text !== null) return text;
    }
  }

  return null;
}

/**
 * The first real answer in a Gemini response, skipping thought parts.
 *
 * The same positional assumption breaks the same way here: a part carrying
 * `thought: true` can arrive ahead of the text part once thought summaries or
 * a function call ride alongside it.
 */
function firstGeminiText(body: unknown): string | null {
  const parts = at(body, ['candidates', 0, 'content', 'parts']);
  if (!Array.isArray(parts)) return null;

  for (const part of parts) {
    if (at(part, ['thought']) === true) continue;
    const text = readText(part, ['text']);
    if (text !== null) return text;
  }

  return null;
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

      /* `toApiError` classifies purely on status code, so a key rejection
         that arrived as a bare 400 — Gemini's `API_KEY_INVALID`, xAI's flat
         `{code:"invalid-argument"}` — comes back as the generic `client`
         kind. `isKeyRejection` already knows better; 401/403 already landed
         on the right kind from `classify()` and are left alone. */
      if (keyRejected && apiError.kind === 'client') {
        throw new ApiError(apiError.message, {
          kind: 'unauthorized',
          ...(apiError.status === undefined ? {} : { status: apiError.status }),
          ...(apiError.code === undefined ? {} : { code: apiError.code }),
          cause: apiError,
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
  if (!isAiConfigured(settings)) {
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
        ...claudeSamplingFields(settings.model, settings.temperature),
        system: request.system,
        messages: request.messages,
      },
      { ...common, headers: anthropicHeaders(settings.apiKey) },
      { provider: settings.provider, model: settings.model },
    );

    const text = firstAnthropicText(body);
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
      { ...common, headers: geminiHeaders(settings.apiKey) },
      { provider: settings.provider, model: settings.model },
    );

    const text = firstGeminiText(body);
    if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
    return text;
  }

  /* OpenAI-compatible: OpenAI, OpenRouter, DeepSeek, Mistral, Grok, Ollama and
     anything the user points the custom adapter at. */
  const body = await send<unknown>(
    `${base}/chat/completions`,
    {
      model: settings.model,
      ...openAiCompatibleSamplingFields(settings.provider, settings.model, settings.temperature, settings.maxTokens),
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    },
    {
      ...common,
      headers: openAiCompatibleHeaders(settings.provider, settings.apiKey, settings.orgId),
    },
    { provider: settings.provider, model: settings.model },
  );

  const text = readText(body, ['choices', 0, 'message', 'content']);
  if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
  return text;
}
