import { ApiError, readRetryAfter } from '@/services/api/client';
import type { ApiFailureKind } from '@/services/api/errors';
import type { AiSettings } from '@/types/settings';

import type { JsonSchema } from './jsonSchema';
import {
  supportsNativeTools,
  type AnthropicReasoningBlock,
  type ChatMessage,
  type OpenAiReasoningItem,
  type ToolCall,
  type ToolSchema,
} from './messages';
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
 * ## Server-sent events, four dialects
 *
 * Anthropic, Gemini, OpenAI's own Responses API, and the OpenAI-compatible
 * Chat Completions every other provider in the list speaks all stream SSE —
 * `data: {json}` lines separated by blank lines — and disagree about where the
 * text sits inside each event, how a tool call is expressed, and what a cached
 * prefix is called. The frame parsing is therefore shared and everything above
 * it is a per-dialect reducer.
 *
 * ## Two things this layer now does that it used to leave to the caller
 *
 *   **Tool calls.** Where the provider has a real tool API, calls come back
 *   parsed and identified instead of being read out of the text. The agent gets
 *   the same `ToolCall` either way — see `messages.ts` for why the conversation
 *   is held in a shape none of the four providers uses.
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
  /** Gemini thought signature for this call, handed back verbatim. */
  signature?: string;
}

/** One Anthropic thinking/redacted_thinking content block, as it streams in. */
interface PartialReasoning {
  readonly type: 'thinking' | 'redacted_thinking';
  thinking: string;
  signature: string;
  data: string;
}

export interface Accumulator {
  text: string;
  readonly calls: Map<string, PartialCall>;
  readonly order: string[];
  /** Anthropic thinking blocks, keyed by content-block index — order matters. */
  readonly reasoning: Map<number, PartialReasoning>;
  /**
   * OpenAI Responses reasoning items for this turn, in the order the stream
   * produced them — see `OpenAiReasoningItem`. Unlike Anthropic's thinking
   * blocks, a reasoning item arrives whole (at `response.output_item.done`),
   * so an array suffices; there is no per-index delta to key on.
   */
  readonly openAiReasoning: OpenAiReasoningItem[];
  inputTokens: number;
  /**
   * Output tokens exactly as the provider stated, reasoning included.
   * `undefined` until a usage frame actually reports one — see
   * `rawInputTokens` below for why a provider that never reports usage must
   * end up `null`, not a false `0`, on the usage ledger.
   */
  outputTokens: number | undefined;
  /** Subset of `outputTokens` spent on reasoning/thinking, where reported apart. */
  reasoningTokens: number | undefined;
  /** Subset of the raw input tokens served from the provider's own cache. */
  cachedInputTokens: number | undefined;
  /**
   * The prompt exactly as the provider counted it — before the cache discount
   * `inputTokens` applies for the cost line. The quota meter needs this raw
   * figure because Gemini's TPM ceiling is billed on it, not on the
   * discounted number. `undefined` until a usage frame actually states it, so
   * a provider that never reports usage reports `null` rather than a false 0.
   */
  rawInputTokens: number | undefined;
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
 * Anthropic's thinking blocks for this turn, in content-block order.
 *
 * `data` on `redacted_thinking` arrives whole in `content_block_start` — it
 * is already-encrypted state, not something that streams incrementally — so
 * only `thinking`/`signature` accumulate across deltas.
 */
function reasoningBlocksOf(accumulator: Accumulator): readonly AnthropicReasoningBlock[] {
  return [...accumulator.reasoning.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, block]) =>
      block.type === 'thinking'
        ? { type: 'thinking' as const, thinking: block.thinking, signature: block.signature }
        : { type: 'redacted_thinking' as const, data: block.data },
    );
}

/**
 * The calls, once the stream has ended.
 *
 * A call whose arguments did not parse is kept with `{}` rather than dropped:
 * the schema will reject it and the model will be told why, which is a better
 * outcome than a lookup that silently never happened.
 */
export function finishCalls(accumulator: Accumulator): readonly ToolCall[] {
  const calls: ToolCall[] = [];
  const reasoning = reasoningBlocksOf(accumulator);
  const openAiReasoning = accumulator.openAiReasoning;

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

    calls.push({
      id: partial.id === '' ? `call-${key}` : partial.id,
      name: partial.name,
      args,
      ...(partial.signature === undefined ? {} : { signature: partial.signature }),
      /* Attached to the first call of the turn only — Claude's thinking is a
         property of the turn, not of one call, and `anthropicMessages` reads
         it off whichever call carries it. */
      ...(calls.length === 0 && reasoning.length > 0 ? { reasoning } : {}),
      /* Same convention, same reason, for OpenAI's own reasoning items — see
         `OpenAiReasoningItem` and `openAiResponsesInput`. A turn only ever
         populates one of the two collections, since each belongs to a
         different provider's accumulator. */
      ...(calls.length === 0 && openAiReasoning.length > 0 ? { openAiReasoning } : {}),
    });
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

export interface AnthropicBlock {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface AnthropicMessage {
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
export function anthropicMessages(messages: readonly ChatMessage[]): readonly AnthropicMessage[] {
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
      const calls = message.calls ?? [];
      const blocks: AnthropicBlock[] = [];

      /* Thinking blocks ride on the first call and must be replayed ahead of
         everything else in the turn — see `ToolCall.reasoning` in
         `messages.ts` for why they are carried there. */
      for (const block of calls[0]?.reasoning ?? []) blocks.push({ ...block });

      if (message.content.trim() !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of calls) {
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
        parts.push({
          functionCall: { name: call.name, args: call.args ?? {} },
          ...(call.signature === undefined ? {} : { thoughtSignature: call.signature }),
        });
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

/**
 * One item of an OpenAI Responses `input` array.
 *
 * Internally tagged, like the Anthropic and Chat Completions shapes above —
 * `type` says which of `message` / `function_call` / `function_call_output` /
 * `reasoning` this is, and the rest of the fields follow from that. Kept as an
 * open record rather than a union because `dialectFor` never inspects one
 * after building it; only OpenAI does.
 */
export interface OpenAiResponsesItem {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * The conversation, as OpenAI's Responses API wants it.
 *
 * Three differences from `openAiMessages` above, all load-bearing:
 *
 *   **Reasoning replay.** A turn's `openAiReasoning` items (see
 *   `OpenAiReasoningItem`) are emitted first, ahead of that same turn's text
 *   and calls — the order the model actually produced them in, and the order
 *   OpenAI's reasoning guide says a `store: false` conversation has to present
 *   them back in to keep the reasoning behind a function call in scope for it.
 *
 *   **No `id` on a replayed call.** A `function_call` input item carries
 *   `call_id` — what `function_call_output` pairs against — but not the `id`
 *   OpenAI minted for the call (`fc_…`). This is deliberate caution rather
 *   than a documented requirement: community reports describe OpenAI
 *   rejecting a later turn over a mismatched or unnecessary `fc_…` id on a
 *   replayed call, and omitting it costs nothing `call_id` does not already
 *   provide.
 *
 *   **A blank assistant turn emits nothing.** A tool-only round — reasoning
 *   straight into a call, no visible text — has no `message` item in the real
 *   output, and manufacturing an empty one here would be a line in `input`
 *   Responses never actually produced.
 *
 *   **No reasoning item without `encrypted_content`.** With `store: false`
 *   nothing is kept on OpenAI's side, so a `{type:'reasoning', id}` replayed
 *   without the encrypted payload cannot be resolved at all — not a
 *   degraded replay, a 400 on round two of every tool-using question. This
 *   only happens when `include` was never asked for — an id outside the
 *   gpt-5/gpt-6/o1/o3/o4 prefixes `openAiIsReasoningModel` recognises, most
 *   often a free-text or future model — so dropping the item here is strictly
 *   better than sending one OpenAI can only reject.
 */
export function openAiResponsesInput(
  messages: readonly ChatMessage[],
): readonly OpenAiResponsesItem[] {
  const out: OpenAiResponsesItem[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ type: 'message', role: 'user', content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      const calls = message.calls ?? [];

      for (const item of calls[0]?.openAiReasoning ?? []) {
        if (item.encryptedContent === null) continue;
        out.push({
          type: 'reasoning',
          id: item.id,
          summary: item.summary,
          encrypted_content: item.encryptedContent,
        });
      }

      if (message.content.trim() !== '') {
        out.push({ type: 'message', role: 'assistant', content: message.content });
      }

      for (const call of calls) {
        out.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        });
      }
      continue;
    }

    /* One item per result, each pointing back at the call it answers. */
    for (const reply of message.replies) {
      out.push({ type: 'function_call_output', call_id: reply.id, output: reply.content });
    }
  }

  return out;
}

/* ── the four dialects ──────────────────────────────────────────────────── */

export interface Dialect {
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
  if (promptTokens !== undefined) {
    accumulator.inputTokens = promptTokens - (cached ?? 0);
    /* The raw count, cache included — what Gemini's TPM ceiling is billed on. */
    accumulator.rawInputTokens = promptTokens;
  }
  if (answer !== undefined || thoughts !== undefined) {
    accumulator.outputTokens = (answer ?? 0) + (thoughts ?? 0);
  }
  /* Reported apart from `answer`, but it is a subset of the `outputTokens`
     sum above — the usage ledger's `reasoningTokens` reads it that way. */
  if (thoughts !== undefined) accumulator.reasoningTokens = thoughts;

  const parts = at(event, ['candidates', 0, 'content', 'parts']);
  if (!Array.isArray(parts)) return;

  for (const [index, part] of parts.entries()) {
    if (part === null || typeof part !== 'object') continue;
    const entry = part as {
      thought?: unknown;
      text?: unknown;
      functionCall?: unknown;
      thoughtSignature?: unknown;
    };

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

        /* The signature is the receipt for the thinking behind this call,
           and the next request has to present it. */
        if (typeof entry.thoughtSignature === 'string' && entry.thoughtSignature !== '') {
          slot.signature = entry.thoughtSignature;
        }
      }
    }
  }
}

export function reduceAnthropic(
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
  if (input !== undefined) {
    accumulator.inputTokens = input + (created ?? 0);
    /* The whole prompt this request processed, cache write and cache read
       both included — a cache hit still occupies the same request slot. */
    accumulator.rawInputTokens = input + (created ?? 0) + (read ?? 0);
  }
  if (read !== undefined) accumulator.cachedInputTokens = read;
  if (output !== undefined) accumulator.outputTokens = output;

  if (type === 'content_block_start') {
    const block = at(event, ['content_block']);
    const blockType = textAt(block, ['type']);
    const index = numberAt(event, ['index']) ?? accumulator.order.length;

    /* Captured but never handed to `onText` — this is the model's reasoning,
       not its answer, and Anthropic requires the whole block replayed
       verbatim on the next request (see `ToolCall.reasoning`). */
    if (blockType === 'thinking') {
      accumulator.reasoning.set(index, {
        type: 'thinking',
        thinking: textAt(block, ['thinking']) ?? '',
        signature: textAt(block, ['signature']) ?? '',
        data: '',
      });
      return;
    }

    if (blockType === 'redacted_thinking') {
      /* Arrives whole here — already-encrypted state, nothing to stream. */
      accumulator.reasoning.set(index, {
        type: 'redacted_thinking',
        thinking: '',
        signature: '',
        data: textAt(block, ['data']) ?? '',
      });
      return;
    }

    if (blockType === 'tool_use') {
      const slot = slotOf(accumulator, `a${index}`);
      slot.id = textAt(block, ['id']) ?? '';
      slot.name = textAt(block, ['name']) ?? '';
    }
    return;
  }

  if (type === 'content_block_delta') {
    const deltaType = textAt(event, ['delta', 'type']);
    const index = numberAt(event, ['index']) ?? 0;

    if (deltaType === 'thinking_delta') {
      const piece = textAt(event, ['delta', 'thinking']);
      if (piece !== null && piece !== '') {
        const slot = accumulator.reasoning.get(index);
        if (slot !== undefined) slot.thinking += piece;
      }
      return;
    }

    if (deltaType === 'signature_delta') {
      const piece = textAt(event, ['delta', 'signature']);
      if (piece !== null && piece !== '') {
        const slot = accumulator.reasoning.get(index);
        if (slot !== undefined) slot.signature += piece;
      }
      return;
    }

    const text = textAt(event, ['delta', 'text']);
    if (text !== null && text !== '') {
      accumulator.text += text;
      onText(text);
      return;
    }

    const fragment = textAt(event, ['delta', 'partial_json']);
    if (fragment !== null) {
      slotOf(accumulator, `a${index}`).json += fragment;
    }
  }
}

export function reduceOpenAi(
  event: unknown,
  accumulator: Accumulator,
  onText: (text: string) => void,
): void {
  const prompt = numberAt(event, ['usage', 'prompt_tokens']);
  /* DeepSeek spells its cache hit apart from the standard
     `prompt_tokens_details.cached_tokens` field — `prompt_cache_hit_tokens`,
     per its own API reference (api-docs.deepseek.com/api/create-chat-completion,
     fetched 2026-09-28) — and reports it only when it is naming something
     real, so it is read only where the standard field said nothing at all,
     never invented for a provider that is silent about caching entirely. */
  const cached =
    numberAt(event, ['usage', 'prompt_tokens_details', 'cached_tokens']) ??
    numberAt(event, ['usage', 'prompt_cache_hit_tokens']);
  const completion = numberAt(event, ['usage', 'completion_tokens']);
  /* Present on OpenAI's own reasoning ids and on some compatible gateways
     that host a reasoning model of their own (DeepSeek's `-reasoner` line) —
     a subset already folded into `completion` above, not additional to it. */
  const reasoningTokens = numberAt(event, ['usage', 'completion_tokens_details', 'reasoning_tokens']);

  if (cached !== undefined) accumulator.cachedInputTokens = cached;
  if (prompt !== undefined) {
    accumulator.inputTokens = prompt - (cached ?? 0);
    accumulator.rawInputTokens = prompt;
  }
  if (completion !== undefined) accumulator.outputTokens = completion;
  if (reasoningTokens !== undefined) accumulator.reasoningTokens = reasoningTokens;

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

/**
 * Usage off a `response.completed` or `response.incomplete` event — the only
 * two Responses events that carry it, and each other field defensively
 * `undefined` until one of them actually arrives, exactly like every other
 * reducer here.
 */
function captureOpenAiResponsesUsage(event: unknown, accumulator: Accumulator): void {
  const input = numberAt(event, ['response', 'usage', 'input_tokens']);
  const cached = numberAt(event, ['response', 'usage', 'input_tokens_details', 'cached_tokens']);
  const output = numberAt(event, ['response', 'usage', 'output_tokens']);
  const reasoningTokens = numberAt(event, ['response', 'usage', 'output_tokens_details', 'reasoning_tokens']);

  if (input !== undefined) {
    accumulator.inputTokens = input - (cached ?? 0);
    accumulator.rawInputTokens = input;
  }
  if (cached !== undefined) accumulator.cachedInputTokens = cached;
  if (output !== undefined) accumulator.outputTokens = output;
  if (reasoningTokens !== undefined) accumulator.reasoningTokens = reasoningTokens;
}

/**
 * OpenAI's Responses API, read off its own event vocabulary — nothing here
 * resembles Chat Completions' `choices[0].delta`.
 *
 * Text streams as `response.output_text.delta`. A function call is assembled
 * from three events keyed by `output_index` — `response.output_item.added`
 * (carries `call_id`/`name`, `arguments` starts `""`),
 * `response.function_call_arguments.delta` (fragments), and
 * `response.function_call_arguments.done`, whose `arguments` is authoritative
 * and overwrites whatever the deltas built — a value that arrived out of
 * order or was double-counted is still corrected by the one event required to
 * be complete. A reasoning item is captured whole at
 * `response.output_item.done`, in the order items complete — see
 * `OpenAiReasoningItem`.
 *
 * `response.incomplete` with neither text nor a call means the run was cut off
 * — most often `max_output_tokens`, per OpenAI's own reasoning guide, which
 * warns this can happen before any visible output even though the tokens were
 * already spent — and is thrown as a non-retryable `ApiError` (see
 * `openAiIncompleteError`) rather than returned as a silent empty answer, so
 * `streamComplete` does not spend three more attempts on the same wall.
 * `response.failed` and a bare `error` event are classified by their `code`
 * instead (`classifyOpenAiFailure`): a rate limit or a genuine server problem
 * still gets retried, anything else does not. All three propagate through
 * `attemptStream`'s read loop unmodified — see the `error instanceof ApiError`
 * branch there — so both the kind and the reason typed here are what the
 * seller actually gets.
 */
export function reduceOpenAiResponses(
  event: unknown,
  accumulator: Accumulator,
  onText: (text: string) => void,
): void {
  const type = textAt(event, ['type']);

  if (type === 'response.output_text.delta') {
    const delta = textAt(event, ['delta']);
    if (delta !== null && delta !== '') {
      accumulator.text += delta;
      onText(delta);
    }
    return;
  }

  if (type === 'response.function_call_arguments.delta') {
    const index = numberAt(event, ['output_index']) ?? 0;
    const delta = textAt(event, ['delta']);
    if (delta !== null) slotOf(accumulator, `r${index}`).json += delta;
    return;
  }

  if (type === 'response.function_call_arguments.done') {
    const index = numberAt(event, ['output_index']) ?? 0;
    const args = textAt(event, ['arguments']);
    if (args !== null) slotOf(accumulator, `r${index}`).json = args;
    return;
  }

  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = at(event, ['item']);
    const itemType = textAt(item, ['type']);
    const index = numberAt(event, ['output_index']) ?? accumulator.order.length;

    if (itemType === 'function_call') {
      const slot = slotOf(accumulator, `r${index}`);
      const callId = textAt(item, ['call_id']);
      const name = textAt(item, ['name']);
      const args = textAt(item, ['arguments']);

      if (callId !== null) slot.id = callId;
      if (name !== null && name !== '') slot.name = name;
      if (args !== null) slot.json = args;
      return;
    }

    /* Only `done` carries `encrypted_content` — `added` fires before the item
       has any content at all, so capturing there would only ever record an
       empty shell. */
    if (itemType === 'reasoning' && type === 'response.output_item.done') {
      const summary = at(item, ['summary']);
      accumulator.openAiReasoning.push({
        id: textAt(item, ['id']) ?? '',
        summary: Array.isArray(summary) ? summary : [],
        encryptedContent: textAt(item, ['encrypted_content']),
      });
    }

    return;
  }

  if (type === 'response.completed') {
    captureOpenAiResponsesUsage(event, accumulator);
    return;
  }

  if (type === 'response.incomplete') {
    captureOpenAiResponsesUsage(event, accumulator);

    const hasText = accumulator.text.trim() !== '';
    const hasCalls = [...accumulator.calls.values()].some((call) => call.name !== '');
    if (hasText || hasCalls) return;

    const reason = textAt(event, ['response', 'incomplete_details', 'reason']) ?? 'unknown reason';
    throw openAiIncompleteError(reason);
  }

  if (type === 'response.failed') {
    const message = textAt(event, ['response', 'error', 'message']) ?? 'The model request failed';
    const code = textAt(event, ['response', 'error', 'code']);
    throw classifyOpenAiFailure(code, message);
  }

  if (type === 'error') {
    const message = textAt(event, ['message']) ?? 'The model request failed';
    const code = textAt(event, ['code']);
    throw classifyOpenAiFailure(code, message);
  }

  /* `response.created`, `response.in_progress`, `response.content_part.*` and
     anything this vocabulary grows later: nothing this reducer needs. */
}

export function dialectFor(settings: AiSettings, request: StreamRequest): Dialect {
  const base = settings.baseUrl.replace(/\/+$/, '');
  const tools = supportsNativeTools(settings.provider) ? (request.tools ?? []) : [];

  if (settings.provider === 'claude') {
    const messages = anthropicMessages(request.messages);
    markCachePoints(messages);

    return {
      url: `${base}/messages`,
      body: {
        model: settings.model,
        max_tokens: effectiveMaxTokens(settings),
        ...claudeSamplingFields(settings),
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
      headers: anthropicHeaders(settings),
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
     * `thinkingLevel` puts a floor under that, now the seller's own choice —
     * see `geminiThinkingLevel` for the per-model table and why a blank or
     * invalid-for-this-model value omits `thinkingConfig` entirely rather
     * than guessing.
     */
    const thinkingLevel = geminiThinkingLevel(settings);

    return {
      url: `${base}/models/${settings.model}:streamGenerateContent?alt=sse`,
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: geminiContents(request.messages),
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: effectiveMaxTokens(settings),
          ...(thinkingLevel === null ? {} : { thinkingConfig: { thinkingLevel } }),
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
      headers: geminiHeaders(settings.apiKey),
      reduce: reduceGemini,
    };
  }

  if (settings.provider === 'openai') {
    return {
      url: `${base}/responses`,
      body: {
        model: settings.model,
        /* Top-level, not an `input` item — Responses keeps the system prompt
           apart from the conversation itself. */
        instructions: request.system,
        input: openAiResponsesInput(request.messages),
        stream: true,
        ...openAiResponsesFields(settings),
        ...(tools.length === 0
          ? {}
          : {
              tools: tools.map((tool) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                /* Responses attempts strict mode the moment this is left out.
                   The zod-derived schemas here carry optional properties
                   strict mode rejects, so it is refused explicitly rather
                   than left to whatever OpenAI infers. */
                strict: false,
              })),
              tool_choice: 'auto',
            }),
      },
      headers: openAiCompatibleHeaders(settings),
      reduce: reduceOpenAiResponses,
    };
  }

  /**
   * `stream_options` is asked for only where it is known to exist.
   *
   * OpenRouter, DeepSeek and Ollama each document `include_usage` on their own
   * `/v1/chat/completions` — OpenRouter's own docs, DeepSeek's API reference
   * (api-docs.deepseek.com/api/create-chat-completion) and Ollama's OpenAI
   * compatibility page (docs.ollama.com/api/openai-compatibility), all
   * fetched 2026-09-28 — and usage during a stream is worth having wherever it
   * is real. But "OpenAI-compatible" is a claim about the response shape, not
   * a promise to accept every request field: Mistral's own docs say plainly
   * that usage is never returned in a stream at all, and an unnamed
   * self-hosted gateway (`custom`) or LM Studio may reject an unrecognised key
   * with a 400 rather than ignore it. Sending it there would break streaming
   * precisely on the setups least able to diagnose why, so everything not
   * named above falls back to the token estimate — Grok included, whose
   * streaming usage support is not verified either way. `openai` itself is no
   * longer decided here at all — it left this branch entirely for the
   * Responses one above.
   */
  const wantsUsage =
    settings.provider === 'openrouter' ||
    settings.provider === 'deepseek' ||
    settings.provider === 'ollama';

  return {
    url: `${base}/chat/completions`,
    body: {
      model: settings.model,
      ...openAiCompatibleSamplingFields(settings),
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
    headers: openAiCompatibleHeaders(settings),
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
 * time. It also already excludes a DAILY quota (`ModelQuotaError` overrides
 * `isRetryable` to say so — see `usage.ts` — because that one does not reopen
 * inside this session, and every retry would be one more request Google's own
 * counter holds against the project for the same refusal), so nothing here has
 * to special-case it again. What `isRetryable` cannot know is whether the
 * caller has already *seen* part of the answer. Once a delta has been
 * delivered, the words are on screen and a second attempt would write them
 * again underneath the first, so a stream that died mid-sentence is handed
 * back to the seller rather than silently doubled.
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

  if (!isAiConfigured(settings)) {
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

  /* Taken just before dispatch, so a retried attempt's event lands where it
     actually happened rather than where the whole `streamComplete` call
     started. */
  const dispatchedAt = Date.now();

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
    /* Nothing answered — not a request this browser can say it "sent" for the
       meter's purposes, since it never occupied a slot on the provider side. */
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

    if (response.status === 429) {
      /* Gemini's quota body says which axis ran out, and for a daily one that
         no wait inside this request will reopen it — see `readQuotaFailure`. */
      const quota = readQuotaFailure(detail);

      recordModelRequest({
        provider: settings.provider,
        model: settings.model,
        at: dispatchedAt,
        inputTokens: null,
        outcome: 'limited',
        ...(quota === null ? {} : { quota }),
      });

      const effectiveRetryAfterMs = retryAfterMs ?? quota?.retryAfterMs ?? undefined;
      throw new ModelQuotaError(detail.slice(0, 300) || `The model returned ${response.status}`, {
        quota,
        ...(effectiveRetryAfterMs === undefined ? {} : { retryAfterMs: effectiveRetryAfterMs }),
      });
    }

    /* A rejected key never occupied a slot in any project's quota — see
       `isKeyRejection` and the "what counts as a request" section of
       `usage.ts`'s header — so it is not recorded at all, rather than
       counted as a `'failed'` request that would push every gauge toward a
       false "exhausted". */
    const keyRejected = isKeyRejection(response.status, detail);
    if (!keyRejected) {
      recordModelRequest({
        provider: settings.provider,
        model: settings.model,
        at: dispatchedAt,
        inputTokens: null,
        outcome: 'failed',
      });
    }

    /* `isKeyRejection` already recognises 401/403 and, per provider, the
       oddly-shaped 400s that mean the same thing (Gemini's
       `API_KEY_INVALID`, xAI's flat `{code:"invalid-argument"}`) — so a
       rejected key is always `unauthorized`, never the generic `client` a
       bare status code would otherwise produce. 403 is kept apart: it is a
       real key that the provider will not extend this way (a model the plan
       excludes), which `isKeyRejection` also treats as a key problem for the
       usage ledger's purposes but which the chat should still call
       `forbidden`, not `unauthorized`. */
    const kind: ApiFailureKind =
      response.status === 403
        ? 'forbidden'
        : keyRejected
          ? 'unauthorized'
          : response.status >= 500
            ? 'server'
            : 'client';

    throw new ApiError(detail.slice(0, 300) || `The model returned ${response.status}`, {
      kind,
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
    reasoning: new Map(),
    openAiReasoning: [],
    inputTokens: 0,
    outputTokens: undefined,
    reasoningTokens: undefined,
    cachedInputTokens: undefined,
    rawInputTokens: undefined,
  };

  let buffer = '';
  /* Set only once the whole SSE stream has been read to its natural end —
     everything else, including a cancel, leaves it `false` and the event
     below reports the request as `'failed'`, matching Google's own counter,
     which counts a request it answered and then lost the connection to. */
  let completed = false;

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
    completed = true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw abortError();
    /* A dialect's own reducer throws `ApiError` for a reason worth keeping —
       `response.incomplete` with nothing to show for it, `response.failed`, a
       bare `error` event (see `reduceOpenAiResponses`) — and that reason is
       exactly what the seller should read, not the generic message below,
       which is reserved for a connection that dropped bytes mid-frame. */
    if (error instanceof ApiError) throw error;
    throw new ApiError('The stream ended unexpectedly', { kind: 'network' });
  } finally {
    release();
    reader.releaseLock();
    /* One event per request that got this far, whatever happened after —
       the provider already spent the round trip on it. Only what the
       provider actually stated is recorded — never `estimateTokens` below,
       which exists for the cost read-out, not the ledger; an unreported
       figure stays `null` rather than a guess dressed up as a fact. */
    recordModelRequest({
      provider: settings.provider,
      model: settings.model,
      at: dispatchedAt,
      inputTokens: accumulator.rawInputTokens ?? null,
      cachedInputTokens: accumulator.cachedInputTokens ?? null,
      outputTokens: accumulator.outputTokens ?? null,
      reasoningTokens: accumulator.reasoningTokens ?? null,
      outcome: completed ? 'ok' : 'failed',
    });
  }

  return {
    text: accumulator.text,
    calls: finishCalls(accumulator),
    /* Providers that stayed silent about usage get an estimate, so the cost
       read-out is never blank for one adapter and populated for another. */
    inputTokens:
      accumulator.inputTokens > 0 ? accumulator.inputTokens : estimateTokens(request.system),
    outputTokens: accumulator.outputTokens ?? estimateTokens(accumulator.text),
    cachedInputTokens: accumulator.cachedInputTokens ?? 0,
  };
}
