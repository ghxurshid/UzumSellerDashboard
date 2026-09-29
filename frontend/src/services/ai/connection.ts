import { ApiError, readRetryAfter } from '@/services/api/client';
import type { AiProvider, AiSettings } from '@/types/settings';

import { supportsNativeTools, type ToolSchema } from './messages';
import {
  anthropicHeaders,
  canListModels,
  geminiHeaders,
  isAiConfigured,
  openAiCompatibleHeaders,
} from './modelRules';
import { streamComplete } from './stream';

/**
 * What the settings screen needs beyond "send a message": whether there is
 * enough here to try at all (`isAiConfigured`, from `modelRules.ts`, also used
 * by `client.ts`/`stream.ts`), a connection test that exercises the exact
 * request `streamComplete` would make, and the list of models the configured
 * key can actually see — gated by the weaker `canListModels` (also
 * `modelRules.ts`), since listing models is how a seller fills in a model id
 * that is still blank.
 *
 * Both async calls here go over the network the seller's own key belongs to,
 * so both throw the `ApiError` vocabulary the rest of the app already branches
 * on — a settings screen that shows "unauthorized" differently from "network"
 * needs nothing new to read this module's failures.
 */

export interface ConnectionCheck {
  readonly latencyMs: number;
  readonly reply: string;
}

/** A tiny prompt: enough to prove the request shape is accepted, nothing more. */
const PROBE_SYSTEM = 'Reply with the single word: ok.';
const PROBE_MESSAGE = 'ok?';

/**
 * A minimal declared tool, sent only where `supportsNativeTools` says the
 * provider has a real tool API.
 *
 * "The test passed" is meant to mean "the chat's request shape is accepted" —
 * and for Claude and Gemini, the chat always declares tools. A probe that
 * left `tools` out would pass on a key that a `tools`-bearing request then
 * fails on, which is exactly the gap a connection test exists to close.
 */
const PROBE_TOOL: ToolSchema = {
  name: 'ok',
  description: 'Acknowledge the connection test. Never call this — just reply with the word.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

function isOpenAiCompatibleProvider(provider: AiProvider): boolean {
  return provider !== 'claude' && provider !== 'gemini';
}

/**
 * A last check when the first one came back as a bare network failure.
 *
 * OpenAI answers a wrong key on `/chat/completions` with a `401` that carries
 * no CORS header at all — the browser never sees the status, only a failed
 * fetch, indistinguishable from the provider being unreachable. `GET /models`
 * with the same key answers with the *same* `401`, but *with* CORS allowed,
 * so this is the one place that can tell "wrong key" apart from "down" for
 * that shape of failure. Run once, and only for the dialects that plausibly
 * share the bug — Anthropic and Gemini both allow CORS on their normal error
 * responses and have no need of this.
 */
async function probeModelsForUnauthorized(
  ai: AiSettings,
  signal?: AbortSignal,
): Promise<ApiError | null> {
  const base = ai.baseUrl.replace(/\/+$/, '');

  let response: Response;
  try {
    response = await fetch(`${base}/models`, {
      method: 'GET',
      headers: openAiCompatibleHeaders(ai),
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch {
    /* Unreachable here too — the original network error already says that. */
    return null;
  }

  if (response.status !== 401 && response.status !== 403) return null;

  const detail = await response.text().catch(() => '');
  return new ApiError(detail.slice(0, 300) || `The model returned ${response.status}`, {
    kind: response.status === 401 ? 'unauthorized' : 'forbidden',
    status: response.status,
  });
}

/**
 * Send the same tiny question the chat would, through `streamComplete` —
 * same dialect, same headers, same declared tools where the provider has
 * them — so a pass here means the chat's own request shape was accepted, not
 * just that some endpoint answered.
 *
 * An empty reply after a completed stream still counts as connected: nothing
 * here asked the model to say anything in particular, only proved the round
 * trip works.
 */
export async function testConnection(ai: AiSettings, signal?: AbortSignal): Promise<ConnectionCheck> {
  if (!isAiConfigured(ai)) {
    throw new ApiError('AI provider is not configured', { kind: 'unconfigured' });
  }

  const startedAt = Date.now();

  try {
    const result = await streamComplete({
      settings: ai,
      request: {
        system: PROBE_SYSTEM,
        messages: [{ role: 'user', content: PROBE_MESSAGE }],
        ...(supportsNativeTools(ai.provider) ? { tools: [PROBE_TOOL] } : {}),
        ...(signal !== undefined ? { signal } : {}),
      },
      onDelta: () => {
        /* Nothing is shown for a connection test — only whether it finished. */
      },
    });

    return { latencyMs: Date.now() - startedAt, reply: result.text.trim() };
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'network' && isOpenAiCompatibleProvider(ai.provider)) {
      const reclassified = await probeModelsForUnauthorized(ai, signal);
      if (reclassified !== null) throw reclassified;
    }
    throw error;
  }
}

/* ── listing models ─────────────────────────────────────────────────────── */

export interface ProviderModel {
  readonly id: string;
  readonly label: string;
}

function at(value: unknown, path: readonly (string | number)[]): unknown {
  let cursor: unknown = value;
  for (const step of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[step];
  }
  return cursor;
}

function textAt(value: unknown, path: readonly (string | number)[]): string | null {
  const found = at(value, path);
  return typeof found === 'string' ? found : null;
}

function numberAt(value: unknown, path: readonly (string | number)[]): number | null {
  const found = at(value, path);
  return typeof found === 'number' ? found : null;
}

/**
 * One unauthenticated GET, classified the same way `stream.ts` classifies a
 * failed POST — this is not a generation request, so it is never handed to
 * `recordModelRequest`; the usage ledger counts requests that could have
 * spent the seller's quota, and listing models never does.
 */
async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers, ...(signal !== undefined ? { signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Cancelled', { kind: 'cancelled' });
    }
    throw new ApiError('The model could not be reached', { kind: 'network' });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryAfterMs = readRetryAfter(response.headers);

    throw new ApiError(detail.slice(0, 300) || `The model returned ${response.status}`, {
      kind:
        response.status === 401
          ? 'unauthorized'
          : response.status === 403
            ? 'forbidden'
            : response.status === 404
              ? 'notFound'
              : response.status === 429
                ? 'rateLimited'
                : response.status >= 500
                  ? 'server'
                  : 'client',
      status: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError('Unexpected response from the model', { kind: 'server' });
  }
}

export function sortModels(models: readonly ProviderModel[]): readonly ProviderModel[] {
  return [...models].sort((a, b) => a.id.localeCompare(b.id));
}

export function readClaudeModels(data: unknown): ProviderModel[] {
  const list = at(data, ['data']);
  if (!Array.isArray(list)) return [];

  const models: ProviderModel[] = [];
  for (const entry of list) {
    const id = textAt(entry, ['id']);
    if (id === null) continue;
    models.push({ id, label: textAt(entry, ['display_name']) ?? id });
  }
  return models;
}

const MODELS_PREFIX = 'models/';

export function readGeminiModels(data: unknown): ProviderModel[] {
  const list = at(data, ['models']);
  if (!Array.isArray(list)) return [];

  const models: ProviderModel[] = [];
  for (const entry of list) {
    const methods = at(entry, ['supportedGenerationMethods']);
    if (!Array.isArray(methods) || !methods.includes('generateContent')) continue;

    const name = textAt(entry, ['name']);
    if (name === null) continue;
    const id = name.startsWith(MODELS_PREFIX) ? name.slice(MODELS_PREFIX.length) : name;

    models.push({ id, label: textAt(entry, ['displayName']) ?? id });
  }
  return models;
}

/**
 * Ids that are never a text chat model, so an OpenAI catalogue — which lists
 * every model type the account can reach — does not offer an embedding or
 * audio model as though it could hold a conversation. `instruct`/`search` ids
 * are chat-shaped requests OpenAI still accepts, but tuned for a legacy
 * completion style or a web-search-augmented answer rather than the ordinary
 * conversation this transport holds, so they are held back the same way.
 */
const OPENAI_NON_CHAT = /embed|tts|whisper|dall-?e|image|audio|realtime|moderation|transcribe|instruct|search/i;

/**
 * The families that can actually hold this application's conversation: GPT
 * (`gpt-…`), ChatGPT's own alias (`chatgpt-…`), and the `o1`/`o3`/`o4`
 * reasoning line. Everything else an OpenAI account's `/models` response
 * lists — embeddings, moderation, TTS, and the legacy
 * `davinci`/`babbage`/`curie`/`ada` completion models this catalogue was
 * never built for — is left off rather than offered and then failing on the
 * first `/responses` call.
 */
const OPENAI_CHAT_PREFIX = /^(gpt-|chatgpt-|o1|o3|o4)/i;

export function readOpenAiModels(data: unknown, provider: AiProvider): ProviderModel[] {
  const list = at(data, ['data']);
  if (!Array.isArray(list)) return [];

  const models: Array<ProviderModel & { readonly created: number | null }> = [];
  for (const entry of list) {
    const id = textAt(entry, ['id']);
    if (id === null) continue;
    if (provider === 'openai' && (!OPENAI_CHAT_PREFIX.test(id) || OPENAI_NON_CHAT.test(id))) continue;

    models.push({ id, label: textAt(entry, ['name']) ?? id, created: numberAt(entry, ['created']) });
  }

  if (provider !== 'openai') return models.map(({ id, label }) => ({ id, label }));

  /**
   * Newest first, so GPT-6 sits above GPT-4.1 without the seller hunting for
   * it — the alphabetical order `sortModels` gives every other provider would
   * put `gpt-4.1` ahead of `gpt-6-astra` and bury the model OpenAI's own docs
   * say to start with. `created` is the Unix-seconds field every model in a
   * real catalogue carries; an id missing it (never seen in practice) sorts
   * after every dated one rather than breaking the comparison.
   */
  return [...models]
    .sort((a, b) => (b.created ?? -1) - (a.created ?? -1))
    .map(({ id, label }) => ({ id, label }));
}

/**
 * The models this key can see, in the same dialect the chat itself uses.
 *
 * Not recorded in the usage ledger — see `fetchJson` — and not cached: the
 * settings screen calls this once when the seller asks for the list, not on
 * every render.
 */
export async function listModels(
  ai: AiSettings,
  signal?: AbortSignal,
): Promise<readonly ProviderModel[]> {
  /* Not `isAiConfigured`: listing models is how a seller fills in a still-
     blank model id, so the gate here must not demand one — see
     `canListModels`. */
  if (!canListModels(ai)) {
    throw new ApiError('AI provider is not configured', { kind: 'unconfigured' });
  }

  const base = ai.baseUrl.replace(/\/+$/, '');

  if (ai.provider === 'claude') {
    const data = await fetchJson(`${base}/models?limit=1000`, anthropicHeaders(ai), signal);
    return sortModels(readClaudeModels(data));
  }

  if (ai.provider === 'gemini') {
    const data = await fetchJson(`${base}/models?pageSize=1000`, geminiHeaders(ai.apiKey), signal);
    return sortModels(readGeminiModels(data));
  }

  const data = await fetchJson(`${base}/models`, openAiCompatibleHeaders(ai), signal);
  const models = readOpenAiModels(data, ai.provider);
  /* `openai` is pre-ordered newest-first by `readOpenAiModels` itself — see
     its own doc for why alphabetising it would bury GPT-6 under GPT-4.1.
     Every other OpenAI-compatible gateway keeps the plain alphabetical
     order every other dialect here already uses. */
  return ai.provider === 'openai' ? models : sortModels(models);
}
