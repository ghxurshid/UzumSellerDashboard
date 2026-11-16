import axios, { type AxiosRequestConfig } from 'axios';

import { toApiError, ApiError } from '@core/net/httpError';
import type { AiProvider, AiSettings } from '@core/types/settings';

import {
  anthropicHeaders,
  classifyOpenAiFailure,
  claudeSamplingFields,
  effectiveMaxTokens,
  geminiHeaders,
  geminiThinkingLevel,
  isAiConfigured,
  openAiCompatibleHeaders,
  openAiCompatibleSamplingFields,
  openAiIncompleteError,
  openAiResponsesFields,
} from './modelRules';
import { isKeyRejection, ModelQuotaError, readQuotaFailure, recordModelRequest } from './usage';

/**
 * The analysis layer's connection to whichever model the user configured.
 *
 * Four request shapes cover the nine adapters in the registry: Anthropic's
 * Messages API, Google's `generateContent`, OpenAI's own Responses API, and
 * the OpenAI-compatible `/chat/completions` that every other provider in the
 * list speaks. The app never ships a key — it uses the one in Settings, and
 * refuses to call anything when that is empty (or, for the two providers a
 * key is optional for, when the rest of the connection is empty — see
 * `isAiConfigured`).
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
 * The first assistant message's text in an OpenAI Responses body, walking
 * `output[*]` of type `message` → `content[*]` of type `output_text` →
 * `.text`.
 *
 * The SDK also exposes a top-level `output_text` convenience getter, but that
 * is a client-library computed property, not a field the wire itself sends —
 * relying on it here would read `undefined` forever, since this application
 * parses the JSON body directly rather than through OpenAI's own SDK.
 */
export function firstOpenAiResponsesText(body: unknown): string | null {
  const output = at(body, ['output']);
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (readText(item, ['type']) !== 'message') continue;
    const content = at(item, ['content']);
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (readText(part, ['type']) !== 'output_text') continue;
      const text = readText(part, ['text']);
      if (text !== null) return text;
    }
  }

  return null;
}

/** What a provider's own usage object said about one request, read defensively. */
interface ProviderUsage {
  /** The whole prompt as the provider counted it, cache included. */
  readonly inputTokens: number | null;
  /** Subset of `inputTokens` served from the provider's own cache. */
  readonly cachedInputTokens: number | null;
  /** Output as the provider counted it, reasoning included. */
  readonly outputTokens: number | null;
  /** Subset of `outputTokens` spent on reasoning, where reported apart. */
  readonly reasoningTokens: number | null;
}

const NO_USAGE: ProviderUsage = {
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
};

/**
 * What a provider's own body said it spent, for the usage ledger.
 *
 * `null` on every field a provider said nothing about — `ollama` and most
 * self-hosted gateways never send a usage object at all — because the ledger
 * must never show a guess dressed up as a fact. Not the number `estimateCost`
 * would want either: that one discounts a cached prefix out of `inputTokens`,
 * and the ledger's own meaning for the field is the raw, undiscounted count —
 * see `ModelRequestEvent` in `usage.ts`.
 */
export function usageOf(provider: AiProvider, body: unknown): ProviderUsage {
  if (provider === 'claude') {
    const input = readNumber(body, ['usage', 'input_tokens']);
    if (input === null) return NO_USAGE;
    const created = readNumber(body, ['usage', 'cache_creation_input_tokens']) ?? 0;
    const read = readNumber(body, ['usage', 'cache_read_input_tokens']);
    return {
      inputTokens: input + created + (read ?? 0),
      cachedInputTokens: read,
      outputTokens: readNumber(body, ['usage', 'output_tokens']),
      /* Anthropic's usage object carries no separate thinking-token count —
         `output_tokens` already includes it, undivided. */
      reasoningTokens: null,
    };
  }

  if (provider === 'gemini') {
    const answer = readNumber(body, ['usageMetadata', 'candidatesTokenCount']);
    const thoughts = readNumber(body, ['usageMetadata', 'thoughtsTokenCount']);
    return {
      inputTokens: readNumber(body, ['usageMetadata', 'promptTokenCount']),
      cachedInputTokens: readNumber(body, ['usageMetadata', 'cachedContentTokenCount']),
      outputTokens: answer === null && thoughts === null ? null : (answer ?? 0) + (thoughts ?? 0),
      reasoningTokens: thoughts,
    };
  }

  if (provider === 'openai') {
    return {
      inputTokens: readNumber(body, ['usage', 'input_tokens']),
      cachedInputTokens: readNumber(body, ['usage', 'input_tokens_details', 'cached_tokens']),
      outputTokens: readNumber(body, ['usage', 'output_tokens']),
      reasoningTokens: readNumber(body, ['usage', 'output_tokens_details', 'reasoning_tokens']),
    };
  }

  /* Chat Completions: OpenRouter, DeepSeek, Mistral, Grok, Ollama, custom.
     DeepSeek spells its cache hit apart from the standard
     `prompt_tokens_details.cached_tokens` field — `prompt_cache_hit_tokens`,
     per its own API reference (api-docs.deepseek.com/api/create-chat-completion,
     fetched 2026-09-28) — read only where the standard field said nothing at
     all, never invented for a provider that is silent about caching entirely. */
  return {
    inputTokens: readNumber(body, ['usage', 'prompt_tokens']),
    cachedInputTokens:
      readNumber(body, ['usage', 'prompt_tokens_details', 'cached_tokens']) ??
      readNumber(body, ['usage', 'prompt_cache_hit_tokens']),
    outputTokens: readNumber(body, ['usage', 'completion_tokens']),
    reasoningTokens: readNumber(body, ['usage', 'completion_tokens_details', 'reasoning_tokens']),
  };
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
    const usage = usageOf(meta.provider, response.data);

    recordModelRequest({
      provider: meta.provider,
      model: meta.model,
      at: dispatchedAt,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
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
        max_tokens: effectiveMaxTokens(settings),
        ...claudeSamplingFields(settings),
        system: request.system,
        messages: request.messages,
      },
      { ...common, headers: anthropicHeaders(settings) },
      { provider: settings.provider, model: settings.model },
    );

    const text = firstAnthropicText(body);
    if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
    return text;
  }

  if (settings.provider === 'gemini') {
    const thinkingLevel = geminiThinkingLevel(settings);

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
          maxOutputTokens: effectiveMaxTokens(settings),
          ...(thinkingLevel === null ? {} : { thinkingConfig: { thinkingLevel } }),
        },
      },
      { ...common, headers: geminiHeaders(settings.apiKey) },
      { provider: settings.provider, model: settings.model },
    );

    const text = firstGeminiText(body);
    if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
    return text;
  }

  if (settings.provider === 'openai') {
    /* No tools here — the insights rail asks one question and reads one
       answer; it never runs the agent loop that `streamComplete` serves. */
    const body = await send<unknown>(
      `${base}/responses`,
      {
        model: settings.model,
        instructions: request.system,
        input: request.messages.map((message) => ({ role: message.role, content: message.content })),
        ...openAiResponsesFields(settings),
      },
      { ...common, headers: openAiCompatibleHeaders(settings) },
      { provider: settings.provider, model: settings.model },
    );

    const status = readText(body, ['status']);
    const text = firstOpenAiResponsesText(body);

    /* Cut off before writing anything — most often `max_output_tokens`, per
       OpenAI's own reasoning guide, which warns this can happen with the
       tokens already spent. Non-retryable — see `openAiIncompleteError` — so
       a caller that retries a failed `complete()` does not spend the same
       reasoning tokens again for the same empty answer. */
    if (status === 'incomplete' && (text === null || text === '')) {
      const reason = readText(body, ['incomplete_details', 'reason']) ?? 'unknown reason';
      throw openAiIncompleteError(reason);
    }
    if (status === 'failed') {
      const message = readText(body, ['error', 'message']) ?? 'The model request failed';
      const code = readText(body, ['error', 'code']);
      throw classifyOpenAiFailure(code, message);
    }

    if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
    return text;
  }

  /* OpenAI-compatible: OpenRouter, DeepSeek, Mistral, Grok, Ollama and
     anything the user points the custom adapter at. `openai` itself left this
     branch for the Responses one above. */
  const body = await send<unknown>(
    `${base}/chat/completions`,
    {
      model: settings.model,
      ...openAiCompatibleSamplingFields(settings),
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    },
    {
      ...common,
      headers: openAiCompatibleHeaders(settings),
    },
    { provider: settings.provider, model: settings.model },
  );

  const text = readText(body, ['choices', 0, 'message', 'content']);
  if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
  return text;
}
