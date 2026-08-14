import axios, { type AxiosRequestConfig } from 'axios';

import { toApiError, ApiError } from '@/services/api/client';
import type { AiSettings } from '@/types/settings';

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

async function send<T>(url: string, body: unknown, config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await axios.post<T>(url, body, config);
    return response.data;
  } catch (error) {
    throw toApiError(error);
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
  );

  const text = readText(body, ['choices', 0, 'message', 'content']);
  if (text === null) throw new ApiError('Unexpected response from the model', { kind: 'server' });
  return text;
}
