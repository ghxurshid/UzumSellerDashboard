import { ApiError, readRetryAfter } from '@/services/api/client';
import type { AiSettings } from '@/types/settings';

import type { JsonSchema } from './jsonSchema';
import { supportsNativeTools, type ChatMessage, type ToolCall, type ToolSchema } from './messages';

/**
 * The same three request shapes as `client.ts`, read as they arrive.
 *
 * `complete()` waits for the whole body, which is right for the insights rail —
 * it runs in the background and nobody is watching. A chat answer is watched.
 * Four seconds of blank panel reads as broken, and the fix is not a faster model
 * but showing the answer as it is written.
 *
 * That cannot go through axios: the browser adapter buffers the response and
 * hands over a finished string. So this uses `fetch` and reads the
 * `ReadableStream` directly, which is also why it does its own error mapping
 * rather than borrowing `toApiError`.
 *
 * ## Server-sent events, three dialects
 *
 * All three providers stream SSE — `data: {json}` lines separated by blank
 * lines — and disagree about where the text sits inside each event, how a tool
 * call is expressed, and what a cached prefix is called. The frame parsing is
 * therefore shared and everything above it is a per-dialect reducer.
 *
 * ## Two things this layer now does that it used to leave to the caller
 *
 *   **Tool calls.** Where the provider has a real tool API, calls come back
 *   parsed and identified instead of being read out of the text. The agent gets
 *   the same `ToolCall` either way — see `messages.ts` for why the conversation
 *   is held in a shape none of the three providers uses.
 *
 *   **Prompt caching.** Every request re-sends the whole conversation, and in an
 *   agent loop most of that conversation is a document the model asked for two
 *   rounds ago. Anthropic will hold a prefix if it is told where the prefix
 *   ends; OpenAI and Gemini do it on their own and only need to be *read*
 *   correctly. Either way the saving is reported back so the cost line stops
 *   charging full price for tokens that were not charged at full price.
 */

export interface StreamRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  /** Declared tools, where the provider has an API for them. */
  readonly tools?: readonly ToolSchema[];
  readonly signal?: AbortSignal;
}

export interface StreamOptions {
  readonly settings: AiSettings;
  readonly request: StreamRequest;
  /** Called with each text fragment, in order, as it arrives. */
  readonly onDelta: (text: string) => void;
}

/** What the caller needs afterwards: what was said, asked for, and spent. */
export interface StreamResult {
  readonly text: string;
  readonly calls: readonly ToolCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Prefix tokens served from the provider's cache, billed at a fraction. */
  readonly cachedInputTokens: number;
}

const ANTHROPIC_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';
const ANTHROPIC_VERSION = '2023-06-01';

/** Rough enough for a cost read-out, and free. See `pricing.ts`. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/* ── accumulation ───────────────────────────────────────────────────────── */

interface PartialCall {
  id: string;
  name: string;
  /** Arguments as they stream in, one JSON fragment at a time. */
  json: string;
  /** Set instead of `json` where the provider sends the arguments whole. */
  args?: unknown;
}

interface Accumulator {
  text: string;
  readonly calls: Map<string, PartialCall>;
  readonly order: string[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

function slotOf(accumulator: Accumulator, key: string): PartialCall {
  const existing = accumulator.calls.get(key);
  if (existing !== undefined) return existing;

  const created: PartialCall = { id: '', name: '', json: '' };
  accumulator.calls.set(key, created);
  accumulator.order.push(key);
  return created;
}

/**
 * The calls, once the stream has ended.
 *
 * A call whose arguments did not parse is kept with `{}` rather than dropped:
 * the schema will reject it and the model will be told why, which is a better
 * outcome than a lookup that silently never happened.
 */
function finishCalls(accumulator: Accumulator): readonly ToolCall[] {
  const calls: ToolCall[] = [];

  for (const key of accumulator.order) {
    const partial = accumulator.calls.get(key);
    if (partial === undefined || partial.name === '') continue;

    let args: unknown = partial.args;
    if (args === undefined) {
      try {
        args = partial.json.trim() === '' ? {} : JSON.parse(partial.json);
      } catch {
        args = {};
      }
    }

    calls.push({ id: partial.id === '' ? `call-${key}` : partial.id, name: partial.name, args });
  }

  return calls;
}

/* ── reading nested values ──────────────────────────────────────────────── */

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

function numberAt(value: unknown, path: readonly (string | number)[]): number | undefined {
  const found = at(value, path);
  return typeof found === 'number' ? found : undefined;
}

/* ── schema dialects ────────────────────────────────────────────────────── */

/**
 * Gemini's function declarations take an OpenAPI subset, not JSON Schema.
 *
 * Two differences matter and both are 400s rather than warnings:
 * `additionalProperties` is not a field it knows, and `type` is an enum spelled
 * in upper case. `pattern` is dropped for the same reason — the Zod schema is
 * the real gate, so losing a regex from the declaration costs nothing.
 */
function geminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (schema.type !== undefined) out['type'] = schema.type.toUpperCase();
  if (schema.description !== undefined) out['description'] = schema.description;
  if (schema.enum !== undefined) out['enum'] = [...schema.enum];
  if (schema.items !== undefined) out['items'] = geminiSchema(schema.items);
  if (schema.required !== undefined) out['required'] = [...schema.required];

  if (schema.properties !== undefined) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      properties[key] = geminiSchema(value);
    }
    out['properties'] = properties;
  }

  return out;
}

/* ── message dialects ───────────────────────────────────────────────────── */

interface AnthropicBlock {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

/**
 * The conversation, as Anthropic wants it.
 *
 * A tool result is a *user* message there, which means a round of the agent
 * loop produces two user messages in a row — and the API expects roles to
 * alternate. So consecutive messages of the same role are merged into one,
 * which is what the format means anyway: several blocks, one turn.
 */
function anthropicMessages(messages: readonly ChatMessage[]): readonly AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  const push = (role: 'user' | 'assistant', blocks: readonly AnthropicBlock[]): void => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last !== undefined && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };

  for (const message of messages) {
    if (message.role === 'user') {
      push('user', [{ type: 'text', text: message.content }]);
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (message.content.trim() !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of message.calls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? {} });
      }
      push('assistant', blocks);
      continue;
    }

    push(
      'user',
      message.replies.map((reply) => ({
        type: 'tool_result',
        tool_use_id: reply.id,
        content: reply.content,
      })),
    );
  }

  return out;
}

/**
 * Where the cached prefix ends.
 *
 * Anthropic holds everything *before* a `cache_control` marker, so marking the
 * last block of the last message on every request means the next request finds
 * its whole history already cached — the standard incremental pattern for a
 * conversation. The system prompt gets its own marker because it is identical
 * on every request of every thread and is worth holding on its own.
 */
function markCachePoints(messages: readonly AnthropicMessage[]): void {
  const last = messages[messages.length - 1];
  if (last === undefined) return;

  const block = last.content[last.content.length - 1];
  if (block === undefined) return;

  last.content[last.content.length - 1] = {
    ...block,
    cache_control: { type: 'ephemeral' },
  };
}

interface OpenAiMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: ReadonlyArray<{
    readonly id: string;
    readonly type: 'function';
    readonly function: { readonly name: string; readonly arguments: string };
  }>;
  readonly tool_call_id?: string;
}

function openAiMessages(messages: readonly ChatMessage[]): readonly OpenAiMessage[] {
  const out: OpenAiMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      const calls = message.calls ?? [];
      out.push({
        role: 'assistant',
        content: message.content === '' ? null : message.content,
        ...(calls.length === 0
          ? {}
          : {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
              })),
            }),
      });
      continue;
    }

    /* One message per result, each pointing back at the call it answers. */
    for (const reply of message.replies) {
      out.push({ role: 'tool', content: reply.content, tool_call_id: reply.id });
    }
  }

  return out;
}

interface GeminiContent {
  readonly role: 'user' | 'model';
  readonly parts: readonly Record<string, unknown>[];
}

function geminiContents(messages: readonly ChatMessage[]): readonly GeminiContent[] {
  const out: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === 'assistant') {
      const parts: Record<string, unknown>[] = [];
      if (message.content.trim() !== '') parts.push({ text: message.content });
      for (const call of message.calls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args ?? {} } });
      }
      if (parts.length > 0) out.push({ role: 'model', parts });
      continue;
    }

    out.push({
      role: 'user',
      parts: message.replies.map((reply) => ({
        functionResponse: { name: reply.name, response: { result: reply.content } },
      })),
    });
  }

  return out;
}

/* ── the three dialects ─────────────────────────────────────────────────── */

interface Dialect {
  readonly url: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
  /** Folds one decoded SSE payload into the accumulator. */
  readonly reduce: (event: unknown, accumulator: Accumulator, onText: (text: string) => void) => void;
}

/**
 * The text of one Gemini chunk: every part of it, minus the model's thinking.
 *
 * `parts` is a list, and reading `parts[0]` treats it as though it were always
 * one thing. A chunk that carries two — which is what happens the moment thought
 * summaries are on, and always happens when a function call rides alongside
 * text — loses everything after the first, silently.
 */
function reduceGemini(
  event: unknown,
  accumulator: Accumulator,
  onText: (text: string) => void,
): void {
  const promptTokens = numberAt(event, ['usageMetadata', 'promptTokenCount']);
  const answer = numberAt(event, ['usageMetadata', 'candidatesTokenCount']);
  /* Thinking is billed as output but counted apart from it, so leaving it out
     under-reports the cost of exactly the slowest answers. */
  const thoughts = numberAt(event, ['usageMetadata', 'thoughtsTokenCount']);
  const cached = numberAt(event, ['usageMetadata', 'cachedContentTokenCount']);

  if (cached !== undefined) accumulator.cachedInputTokens = cached;
  if (promptTokens !== undefined) accumulator.inputTokens = promptTokens - (cached ?? 0);
  if (answer !== undefined || thoughts !== undefined) {
    accumulator.outputTokens = (answer ?? 0) + (thoughts ?? 0);
  }

  const parts = at(event, ['candidates', 0, 'content', 'parts']);
  if (!Array.isArray(parts)) return;

  for (const [index, part] of parts.entries()) {
    if (part === null || typeof part !== 'object') continue;
    const entry = part as { thought?: unknown; text?: unknown; functionCall?: unknown };

    if (entry.thought === true) continue;

    if (typeof entry.text === 'string' && entry.text !== '') {
      accumulator.text += entry.text;
      onText(entry.text);
    }

    const call = entry.functionCall;
    if (call !== null && typeof call === 'object') {
      const { name, args } = call as { name?: unknown; args?: unknown };
      if (typeof name === 'string') {
        /* Gemini has no call id, so one is minted from the position — it only
           ever has to match the response part back to the call. */
        const slot = slotOf(accumulator, `g${accumulator.order.length}-${index}`);
        slot.id = `gemini-${accumulator.order.length}`;
        slot.name = name;
        slot.args = args ?? {};
      }
    }
  }
}

function reduceAnthropic(
  event: unknown,
  accumulator: Accumulator,
  onText: (text: string) => void,
): void {
  const type = textAt(event, ['type']);

  const input = numberAt(event, ['message', 'usage', 'input_tokens']);
  const created = numberAt(event, ['message', 'usage', 'cache_creation_input_tokens']);
  const read = numberAt(event, ['message', 'usage', 'cache_read_input_tokens']);
  const output = numberAt(event, ['usage', 'output_tokens']);

  /* A cache write is billed above the input rate and a read far below it. The
     write is folded into ordinary input — the cost line says "≈" — and the read
     is reported apart, because that is the number that moves. */
  if (input !== undefined) accumulator.inputTokens = input + (created ?? 0);
  if (read !== undefined) accumulator.cachedInputTokens = read;
  if (output !== undefined) accumulator.outputTokens = output;

  if (type === 'content_block_start') {
    const block = at(event, ['content_block']);
    if (textAt(block, ['type']) === 'tool_use') {
      const index = numberAt(event, ['index']) ?? accumulator.order.length;
      const slot = slotOf(accumulator, `a${index}`);
      slot.id = textAt(block, ['id']) ?? '';
      slot.name = textAt(block, ['name']) ?? '';
    }
    return;
  }

  if (type === 'content_block_delta') {
    const text = textAt(event, ['delta', 'text']);
    if (text !== null && text !== '') {
      accumulator.text += text;
      onText(text);
      return;
    }

    const fragment = textAt(event, ['delta', 'partial_json']);
    if (fragment !== null) {
      const index = numberAt(event, ['index']) ?? 0;
      slotOf(accumulator, `a${index}`).json += fragment;
    }
  }
}

function reduceOpenAi(
  event: unknown,
  accumulator: Accumulator,
  onText: (text: string) => void,
): void {
  const prompt = numberAt(event, ['usage', 'prompt_tokens']);
  const cached = numberAt(event, ['usage', 'prompt_tokens_details', 'cached_tokens']);
  const completion = numberAt(event, ['usage', 'completion_tokens']);

  if (cached !== undefined) accumulator.cachedInputTokens = cached;
  if (prompt !== undefined) accumulator.inputTokens = prompt - (cached ?? 0);
  if (completion !== undefined) accumulator.outputTokens = completion;

  const text = textAt(event, ['choices', 0, 'delta', 'content']);
  if (text !== null && text !== '') {
    accumulator.text += text;
    onText(text);
  }

  const calls = at(event, ['choices', 0, 'delta', 'tool_calls']);
  if (!Array.isArray(calls)) return;

  for (const entry of calls) {
    if (entry === null || typeof entry !== 'object') continue;
    const index = numberAt(entry, ['index']) ?? 0;
    const slot = slotOf(accumulator, `o${index}`);

    const id = textAt(entry, ['id']);
    if (id !== null) slot.id = id;

    const name = textAt(entry, ['function', 'name']);
    if (name !== null && name !== '') slot.name = name;

    const fragment = textAt(entry, ['function', 'arguments']);
    if (fragment !== null) slot.json += fragment;
  }
}

function dialectFor(settings: AiSettings, request: StreamRequest): Dialect {
  const base = settings.baseUrl.replace(/\/+$/, '');
  const tools = supportsNativeTools(settings.provider) ? (request.tools ?? []) : [];

  if (settings.provider === 'claude') {
    const messages = anthropicMessages(request.messages);
    markCachePoints(messages);

    return {
      url: `${base}/messages`,
      body: {
        model: settings.model,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        /* An array rather than a string, so the whole instruction can carry a
           cache marker of its own. */
        system: [
          {
            type: 'text',
            text: request.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        stream: true,
        ...(tools.length === 0
          ? {}
          : {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }),
      },
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        [ANTHROPIC_BROWSER_HEADER]: 'true',
      },
      reduce: reduceAnthropic,
    };
  }

  if (settings.provider === 'gemini') {
    /**
     * Gemini thinks before it writes, and is silent for the whole of it.
     *
     * From Gemini 3 on the models think dynamically by default, deciding their
     * own reasoning depth. Thought summaries are withheld unless
     * `includeThoughts` asks for them, so the connection is open and streaming
     * nothing — and then the answer arrives in a burst.
     *
     * `thinkingLevel` puts a floor under that. `low` rather than `minimal`
     * because only some of the Gemini 3 models accept `minimal`, and this is
     * gated on the family rather than on a list of model ids that would fall
     * out of date.
     */
    const thinks = /^gemini-[3-9]/.test(settings.model.trim());

    return {
      url: `${base}/models/${settings.model}:streamGenerateContent?alt=sse`,
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: geminiContents(request.messages),
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxTokens,
          ...(thinks ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
        ...(tools.length === 0
          ? {}
          : {
              tools: [
                {
                  functionDeclarations: tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: geminiSchema(tool.parameters),
                  })),
                },
              ],
            }),
      },
      headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKey },
      reduce: reduceGemini,
    };
  }

  /**
   * `stream_options` is asked for only where it is known to exist.
   *
   * OpenAI reports usage during a stream only when this is set, which is worth
   * having. But "OpenAI-compatible" is a claim about the response shape, not a
   * promise to accept every request field — Ollama, LM Studio and several
   * self-hosted gateways reject an unknown key with a 400 rather than ignoring
   * it. Sending it everywhere would break streaming precisely on the setups
   * least able to diagnose why, so the others fall back to the token estimate.
   */
  const wantsUsage = settings.provider === 'openai' || settings.provider === 'openrouter';

  return {
    url: `${base}/chat/completions`,
    body: {
      model: settings.model,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      messages: [
        { role: 'system', content: request.system },
        ...openAiMessages(request.messages),
      ],
      stream: true,
      ...(wantsUsage ? { stream_options: { include_usage: true } } : {}),
      ...(tools.length === 0
        ? {}
        : {
            tools: tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: 'auto',
          }),
    },
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
      ...(settings.orgId === '' ? {} : { 'openai-organization': settings.orgId }),
    },
    reduce: reduceOpenAi,
  };
}

/* ── retrying ─────────────────────────────────────────────────────── */

/** How many times a failed request is repeated before the seller is asked. */
export const RETRIES = 3;

const BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 8_000;

/**
 * How long to wait before asking again.
 *
 * The provider's own `Retry-After` wins when it sends one — it knows when its
 * window reopens and guessing shorter only spends the budget the header exists
 * to protect. Otherwise the wait doubles, because the failure this exists for
 * is a model under load and the answer to load is to stop adding to it.
 *
 * The jitter is small and deliberate: two tabs that failed on the same overload
 * would otherwise come back in lockstep, which is the same request spike again.
 */
export function retryDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) return Math.min(retryAfterMs, MAX_BACKOFF_MS);

  const base = Math.min(BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * 250);
}

/**
 * Whether to ask again, and the one condition that is not about the error.
 *
 * `isRetryable` already says which failures repeating could fix — a 429, a 503,
 * a dropped connection — and which it could not: a 401 is the same 401 every
 * time. What it cannot know is whether the caller has already *seen* part of
 * the answer. Once a delta has been delivered, the words are on screen and a
 * second attempt would write them again underneath the first, so a stream that
 * died mid-sentence is handed back to the seller rather than silently doubled.
 */
export function shouldRetry(
  error: unknown,
  state: { readonly attempt: number; readonly produced: boolean },
): boolean {
  if (!(error instanceof ApiError) || !error.isRetryable) return false;
  return !state.produced && state.attempt < RETRIES;
}

/** A wait that a cancel can cut short, rather than one the user waits out. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ApiError('Cancelled', { kind: 'cancelled' }));
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ApiError('Cancelled', { kind: 'cancelled' }));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Stream one completion, asking again when the provider says to come back.
 *
 * `503 UNAVAILABLE` from a model under load, a 429, a connection that dropped
 * before it carried anything — all three are answered by waiting and repeating
 * the identical request, and all three used to end the seller's question. The
 * retries happen here rather than in the agent because this is the only layer
 * that knows nothing has been shown yet: above it, a round is a round whether
 * it took one request or four.
 *
 * What is deliberately not retried is a failure the seller must act on. A key
 * that is wrong stays wrong, and repeating a 401 three times only makes the
 * error arrive later.
 */
export async function streamComplete(options: StreamOptions): Promise<StreamResult> {
  /**
   * Whether any of this answer has reached the screen.
   *
   * Tracked across attempts rather than per attempt: once a word has been
   * delivered there is no attempt that can undo it, so from that point the
   * failure belongs to the caller.
   */
  let produced = false;

  const attemptOptions: StreamOptions = {
    ...options,
    onDelta: (text) => {
      produced = true;
      options.onDelta(text);
    },
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await attemptStream(attemptOptions);
    } catch (error) {
      if (!shouldRetry(error, { attempt, produced })) throw error;
      await pause(retryDelay(attempt, (error as ApiError).retryAfterMs), options.request.signal);
    }
  }
}

/**
 * One request, from the connection to the last frame.
 *
 * Throws `ApiError` with the same `kind` vocabulary the rest of the app maps to
 * on-screen states, so a caller does not have to know this went out over
 * `fetch` rather than axios.
 */
async function attemptStream(options: StreamOptions): Promise<StreamResult> {
  const { settings, request, onDelta } = options;

  if (settings.apiKey.trim() === '' || settings.baseUrl.trim() === '' || settings.model.trim() === '') {
    throw new ApiError('AI provider is not configured', { kind: 'unconfigured' });
  }

  const dialect = dialectFor(settings, request);

  /**
   * An idle timeout, not a total one.
   *
   * `complete()` gets `settings.timeoutMs` for free from axios; `fetch` has no
   * timeout at all, so without this a stalled connection hangs until the user
   * happens to press cancel — and a request that never resolves also never
   * releases the pending turn.
   *
   * The clock measures silence rather than duration. A long answer is supposed
   * to take a long time, and cutting it off at a fixed deadline would punish
   * exactly the thorough replies the deep mode exists to get. What is never
   * normal is a stream that stops arriving mid-sentence, so the timer resets on
   * every chunk and only fires when nothing has come for the whole window.
   */
  const internal = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const resetIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      internal.abort();
    }, Math.max(5_000, settings.timeoutMs));
  };

  const onCallerAbort = (): void => internal.abort();
  request.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const release = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    request.signal?.removeEventListener('abort', onCallerAbort);
  };

  /** Cancelled by the user, or given up on — the two need different messages. */
  const abortError = (): ApiError =>
    timedOut
      ? new ApiError('The model stopped responding', { kind: 'timeout' })
      : new ApiError('Cancelled', { kind: 'cancelled' });

  resetIdle();

  let response: Response;
  try {
    response = await fetch(dialect.url, {
      method: 'POST',
      headers: dialect.headers,
      body: JSON.stringify(dialect.body),
      signal: internal.signal,
    });
  } catch (error) {
    release();
    if (error instanceof DOMException && error.name === 'AbortError') throw abortError();
    throw new ApiError('The model could not be reached', { kind: 'network' });
  }

  if (!response.ok || response.body === null) {
    release();
    /* The body is the only place these providers explain themselves, and it is
       short — reading it costs nothing and turns a bare 401 into a sentence. */
    const detail = await response.text().catch(() => '');
    /* A provider that says when to come back is believed — see `retryDelay`. */
    const retryAfterMs = readRetryAfter(response.headers);

    throw new ApiError(detail.slice(0, 300) || `The model returned ${response.status}`, {
      kind:
        response.status === 401
          ? 'unauthorized'
          : response.status === 403
            ? 'forbidden'
            : response.status === 429
              ? 'rateLimited'
              : response.status >= 500
                ? 'server'
                : 'client',
      status: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const accumulator: Accumulator = {
    text: '',
    calls: new Map(),
    order: [],
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };

  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      /* Bytes arrived, so the connection is alive — the silence clock starts
         again from here rather than from when the request went out. */
      resetIdle();
      buffer += decoder.decode(value, { stream: true });

      /**
       * SSE frames end at a blank line — which is `\n\n` or `\r\n\r\n`.
       *
       * Both are legal and both are seen in the wild: Node-based gateways emit
       * the short form, several Python servers and anything behind certain
       * proxies emit the long one. Splitting on only `\n\n` would leave a
       * `\r`-terminated stream with no frame boundary it ever recognises, and
       * the failure is silent — a request that succeeds, streams bytes, and
       * produces an empty answer. Normalising first costs one pass and removes
       * the whole class.
       */
      buffer = buffer.replace(/\r\n/g, '\n');

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '' || payload === '[DONE]') continue;

          let event: unknown;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          dialect.reduce(event, accumulator, onDelta);
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw abortError();
    throw new ApiError('The stream ended unexpectedly', { kind: 'network' });
  } finally {
    release();
    reader.releaseLock();
  }

  return {
    text: accumulator.text,
    calls: finishCalls(accumulator),
    /* Providers that stayed silent about usage get an estimate, so the cost
       read-out is never blank for one adapter and populated for another. */
    inputTokens:
      accumulator.inputTokens > 0 ? accumulator.inputTokens : estimateTokens(request.system),
    outputTokens:
      accumulator.outputTokens > 0 ? accumulator.outputTokens : estimateTokens(accumulator.text),
    cachedInputTokens: accumulator.cachedInputTokens,
  };
}
