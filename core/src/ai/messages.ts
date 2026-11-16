import type { AiProvider } from '@core/types/settings';

import type { JsonSchema } from './jsonSchema';

/**
 * One conversation, in a shape no provider uses.
 *
 * Four request formats, and they disagree about tool calling more than about
 * anything else: Anthropic puts a `tool_use` block inside the assistant's
 * content and expects a `tool_result` block back in a *user* message; the
 * OpenAI-compatible Chat Completions dialect hangs `tool_calls` off the
 * assistant message and expects a message with the role `tool`; OpenAI's own
 * Responses API drops both roles again for a flat list of typed items —
 * `function_call` and `function_call_output` — that is neither the assistant
 * nor the tool's "message" in either of the other senses; Gemini has no
 * dedicated role either and carries `functionCall` and `functionResponse` as
 * parts.
 *
 * Writing the agent against any one of those would make the other three the
 * odd ones out. So the agent speaks this, and each dialect in `stream.ts`
 * translates on the way out. The translation is the only place that knows a
 * provider exists.
 */

/**
 * One block of Anthropic's own thinking, exactly as the wire sent it.
 *
 * A `thinking` block carries the reasoning text (kept even when it streamed
 * empty — Anthropic's `display: "omitted"` default withholds the content but
 * still sends the block, and `signature` is what has to come back regardless)
 * and the signature that proves it was not tampered with. A `redacted_thinking`
 * block is opaque end to end: `data` is encrypted server-side state this
 * application cannot and does not need to read.
 */
export type AnthropicReasoningBlock =
  | { readonly type: 'thinking'; readonly thinking: string; readonly signature: string }
  | { readonly type: 'redacted_thinking'; readonly data: string };

/**
 * One OpenAI Responses reasoning item, exactly as the wire sent it.
 *
 * With `store: false` — this application's choice, since it ships no server
 * side for OpenAI to hold conversation state on — the reasoning behind a
 * function call is not kept on OpenAI's side at all. OpenAI's own reasoning
 * guide says to replay the item verbatim in the next request's `input`, ahead
 * of the call it preceded, to keep that reasoning in scope for a later
 * function-call turn. `encryptedContent` is opaque, sealed server-side state
 * this application cannot and does not need to read — the same relationship
 * `data` has on an Anthropic `redacted_thinking` block — and `summary` is
 * carried along untouched for the same reason.
 */
export interface OpenAiReasoningItem {
  readonly id: string;
  readonly summary: readonly unknown[];
  readonly encryptedContent: string | null;
}

/** A lookup the model asked for, as it came off the wire. */
export interface ToolCall {
  /** The provider's own id for the call — quoted back with the result. */
  readonly id: string;
  /** The safe name, as declared. `toolIdOf` maps it back to a registry id. */
  readonly name: string;
  readonly args: unknown;
  /**
   * Gemini's sealed record of the thinking that led to the call.
   *
   * From Gemini 3 on, a `functionCall` part arrives carrying a
   * `thoughtSignature`, and the request that answers it must hand the same
   * signature back on the same part. Drop it and the API refuses the whole
   * conversation with `400 Function call is missing a thought_signature` — so
   * the first tool call in a chat succeeds and every turn after it fails.
   *
   * The contents are encrypted reasoning state: unreadable here, meaningless to
   * the other two providers. It rides along unopened and only the Gemini
   * dialect emits it.
   */
  readonly signature?: string;
  /**
   * Anthropic's thinking blocks for the whole turn this call belongs to,
   * attached to the first call of that turn only.
   *
   * Claude's thinking is a property of the *turn*, not of one call — a turn
   * can carry several thinking blocks ahead of several tool_use blocks — and
   * `ToolCall` is the only part of `ChatMessage` that survives untouched from
   * `StreamResult` into the transcript (`agent.ts` pushes `completion.calls`
   * back verbatim). Anthropic's own multi-turn rule is explicit: "pass each
   * thinking block back exactly as received — including blocks whose
   * `thinking` text is empty ... dropping or editing them breaks the turn."
   * The Anthropic dialect in `stream.ts` reads this off the first call and
   * replays it ahead of that turn's text and tool_use blocks — exactly once,
   * exactly where Anthropic requires it. No other provider looks at this
   * field.
   */
  readonly reasoning?: readonly AnthropicReasoningBlock[];
  /**
   * The OpenAI Responses reasoning items for the whole turn this call belongs
   * to, attached to the first call of that turn only — the same convention
   * `reasoning` uses for Claude's thinking blocks, and for the same reason:
   * reasoning is a property of the *turn*, not of one call. See
   * `OpenAiReasoningItem` for why it has to be replayed at all. Only the
   * OpenAI Responses dialect in `stream.ts` reads this field.
   */
  readonly openAiReasoning?: readonly OpenAiReasoningItem[];
}

/** What the application answered with. */
export interface ToolReply {
  readonly id: string;
  readonly name: string;
  readonly content: string;
}

export type ChatMessage =
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly calls?: readonly ToolCall[];
    }
  | { readonly role: 'tool'; readonly replies: readonly ToolReply[] };

/** One tool, as a provider is told about it. */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

/**
 * Whether this provider can be given tools rather than told about them.
 *
 * Anthropic, Gemini, and now OpenAI. OpenAI's own reasoning guide is explicit
 * that Chat Completions does not support function calling with GPT-6 Astra —
 * the model OpenAI's own docs say to start with — and that Sol and Luna only
 * take it there with `reasoning_effort: "none"`, a value Astra rejects with a
 * 400. That restriction is Chat Completions' own, not the model's: Responses
 * takes `tools` from all three GPT-6 models regardless of reasoning effort, so
 * this transport speaks Responses for `openai` specifically — see the
 * `openai` branch of `dialectFor` in `stream.ts` — and reserves Chat
 * Completions, and the text protocol, for the rest of the OpenAI-compatible
 * list.
 *
 * That list stays off native tools on purpose. "OpenAI-compatible" is a claim
 * about the response shape, not a promise that `tools` is accepted — a
 * self-hosted runtime or an unfamiliar aggregator that ignores the field
 * silently produces a model with no way to ask for anything, and one that
 * rejects it produces a 400 on every question. Both are worse than the text
 * protocol, which works everywhere because it is only text. The agent runs
 * the same conversation either way; what changes is whether a call arrives as
 * a parsed structure or as a line of JSON the application reads itself.
 */
export function supportsNativeTools(provider: AiProvider): boolean {
  return provider === 'claude' || provider === 'gemini' || provider === 'openai';
}

/* ── names ──────────────────────────────────────────────────────────────── */

/**
 * A registry id, as a provider will accept it.
 *
 * Tool names are constrained to `[A-Za-z0-9_-]` by both Anthropic and OpenAI,
 * and every id in this application is dotted — `window.totals`, `nav.open`. The
 * mapping is mechanical and reversible because no id contains an underscore of
 * its own.
 */
export function safeToolName(id: string): string {
  return id.replace(/\./g, '_');
}

/** The registry id behind a safe name. */
export function toolIdOf(name: string): string {
  return name.replace(/_/g, '.');
}
