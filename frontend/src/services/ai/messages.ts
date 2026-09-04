import type { AiProvider } from '@/types/settings';

import type { JsonSchema } from './jsonSchema';

/**
 * One conversation, in a shape no provider uses.
 *
 * Three request formats, and they disagree about tool calling more than about
 * anything else: Anthropic puts a `tool_use` block inside the assistant's
 * content and expects a `tool_result` block back in a *user* message; OpenAI
 * hangs `tool_calls` off the assistant message and expects a message with the
 * role `tool`; Gemini has neither role and carries `functionCall` and
 * `functionResponse` as parts.
 *
 * Writing the agent against any one of those would make the other two the odd
 * ones out. So the agent speaks this, and each dialect in `stream.ts`
 * translates on the way out. The translation is the only place that knows a
 * provider exists.
 */

/** A lookup the model asked for, as it came off the wire. */
export interface ToolCall {
  /** The provider's own id for the call — quoted back with the result. */
  readonly id: string;
  /** The safe name, as declared. `toolIdOf` maps it back to a registry id. */
  readonly name: string;
  readonly args: unknown;
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
 * A deliberately short list. "OpenAI-compatible" is a claim about the response
 * shape, not a promise that `tools` is accepted — a gateway that ignores the
 * field silently produces a model with no way to ask for anything, and one that
 * rejects it produces a 400 on every question. Both are worse than the text
 * protocol, which works everywhere because it is only text.
 *
 * So the three first-party APIs get native tools and everything else keeps the
 * protocol that cannot break. The agent runs the same conversation either way;
 * what changes is whether a call arrives as a parsed structure or as a line of
 * JSON the application reads itself.
 */
export function supportsNativeTools(provider: AiProvider): boolean {
  return provider === 'claude' || provider === 'openai' || provider === 'gemini';
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
