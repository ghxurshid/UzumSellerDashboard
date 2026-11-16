import type { z } from 'zod';

import type { ToolSchema } from '@core/ai/messages';
import type { Language } from '@core/types/common';

import type { ActionRegistry } from '@core/agent/actionRegistry';
import type { WidgetHints } from '@core/agent/widgets';

/**
 * What a host hands the Copilot loop so the model has something to look up.
 *
 * The loop (`agent.ts`) speaks a protocol — ask for a document, call a lookup,
 * answer in blocks — and knows nothing about where data comes from. The site
 * reads its own IndexedDB archive; another host may read a live API. Both
 * describe what they can do through this one interface, and the loop drives
 * either without telling them apart.
 *
 * Progressive disclosure is the host's to honour: before the thread holds
 * "tools", `schemas` declares only `open_toolkit`, and the document `describe`
 * writes is what the model reads when it opens it.
 */

/** The one tool a thread starts with; opening it discloses the rest. */
export const OPEN_TOOLKIT = 'open_toolkit';

/**
 * `open_toolkit` as a native tool declaration.
 *
 * The protocol's own entry point, so every host declares it the same way:
 * hosts return this very object (`createToolkit` does), so there is one copy
 * and no second declaration to drift; provider caches key on its wording. The
 * protection is the "declares only open_toolkit" snapshot in
 * `sitePrompt.test.ts`, not an equality check.
 */
export const OPEN_TOOLKIT_SCHEMA: ToolSchema = {
  name: OPEN_TOOLKIT,
  description:
    'Ask for a capability document before using it. "tools" returns every lookup and action ' +
    'available over this shop, with arguments and what each returns — and makes those ' +
    'tools callable. "widgets" returns how to draw an answer on screen. Ask once per thread.',
  parameters: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        enum: ['tools', 'widgets'],
        description: 'Which document to open.',
      },
    },
    required: ['capability'],
    additionalProperties: false,
  },
};

/** What every lookup is handed, whatever the host. A host extends it with its own fields. */
export interface BaseToolContext {
  readonly language: Language;
  readonly now: number;
  /** Cancels the question. A lookup that sees it aborted rethrows rather than reporting a failure. */
  readonly signal: AbortSignal | undefined;
}

export interface ToolResult {
  /** What the model reads. Plain text, self-describing. */
  readonly text: string;
  /** Routes or stores touched, for the answer's context chip. */
  readonly routes?: readonly string[];
  /** One short line for the tool chip in the transcript. */
  readonly trace?: string;
}

/** One lookup in a host's registry. */
export interface ToolSpec<C extends BaseToolContext = BaseToolContext> {
  /** Where the rows come from, shown in the result header. */
  readonly route: string;
  /** The argument shape, for the toolkit document. */
  readonly args: string;
  /** One to three lines telling the model when this is the right lookup. */
  readonly summary: readonly string[];
  readonly schema: z.ZodTypeAny;
  /** Arguments arrive already validated by `schema`. */
  readonly run: (args: Record<string, unknown>, context: C) => Promise<ToolResult>;
}

export interface AgentToolkit<C extends BaseToolContext = BaseToolContext, A extends string = string> {
  /** The toolkit document handed over when the model opens "tools". */
  describe(context: C): string;
  /** Native tool declarations, given what the thread has been granted. */
  schemas(granted: ReadonlySet<string>): readonly ToolSchema[];
  /** Provider-safe tool name -> registry id. */
  idOfName(name: string): string;
  /** Run one lookup. A failure comes back as text for the model; a cancelled question rethrows. */
  run(id: string, args: unknown, context: C): Promise<ToolResult>;
  /** The buttons this host can offer. Always contains copilot.ask. */
  readonly actions: ActionRegistry<A>;
  /** How current the data is, one paragraph or ''. Appended last to the system prompt. Optional. */
  freshness?(context: C): Promise<string>;
  /**
   * Notes the widget guide adds about this host's own lookups — which one feeds
   * which chart. Optional: without them the guide names no lookup at all.
   */
  readonly widgetHints?: WidgetHints;
}
