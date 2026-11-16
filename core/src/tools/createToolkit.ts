import { toJsonSchema } from '@core/ai/jsonSchema';
import { safeToolName, type ToolSchema } from '@core/ai/messages';
import { ASK_ACTION_ID, type ActionDefinition, type ActionRegistry } from '@core/agent/actionRegistry';
import type { WidgetHints } from '@core/agent/widgets';

import {
  OPEN_TOOLKIT_SCHEMA,
  type AgentToolkit,
  type BaseToolContext,
  type ToolResult,
  type ToolSpec,
} from './contract';

/**
 * The toolkit mechanism, written once for every host.
 *
 * A host knows *what* it can look up: a registry of `ToolSpec`s, an
 * `ActionRegistry`, and a few paragraphs about where its data comes from and how
 * fresh it is. It does not know how a toolkit is *presented* to a model, and it
 * should not have to: progressive disclosure (one tool until "tools" is opened,
 * everything after), the provider-safe name map, argument validation, failures
 * handed back as text, the generated LOOKUPS and ACTIONS listings and the
 * wording of the action gate are the same on every host, and two private copies
 * of them would drift the first time one was tuned.
 *
 * So the host supplies its tables and its prose and this builds the
 * `AgentToolkit` the loop drives. The two disclosures — the text document and
 * the native tool declarations — are generated from the same registry entries,
 * so they cannot disagree about what a lookup does.
 *
 * The wording below is shared with the site's snapshot tests
 * (`sitePrompt.test.ts`): provider prompt caches key on the prefix, so a change
 * to a sentence here is a change to what every host sends.
 */

/** A titled block of the toolkit document; `lines` carry their own indentation. */
export interface ToolkitSection {
  readonly title: string;
  readonly lines: readonly string[];
}

export interface ToolkitDefinition<C extends BaseToolContext, A extends string> {
  /** Every lookup, in the order the document lists them. */
  readonly tools: Readonly<Record<string, ToolSpec<C>>>;
  readonly actions: ActionRegistry<A>;
  /**
   * What the host wants said between "what a result is" and the lookup listing —
   * conventions, how to choose, where the data comes from. Receives the question's
   * context because some of it (the selected period) is per question.
   */
  readonly sections: (context: C) => readonly ToolkitSection[];
  /** After the action listing: what this host cannot do at all. */
  readonly closing?: (context: C) => readonly ToolkitSection[];
  /** The id used in the `CALLING` example; the first lookup when omitted. */
  readonly exampleCall?: string;
  readonly freshness?: (context: C) => Promise<string>;
  readonly widgetHints?: WidgetHints;
}

/** An own-property read: `constructor` or `toString` from a model is not a lookup. */
function ownSpec<C extends BaseToolContext>(
  tools: Readonly<Record<string, ToolSpec<C>>>,
  id: string,
): ToolSpec<C> | undefined {
  return Object.prototype.hasOwnProperty.call(tools, id) ? tools[id] : undefined;
}

/**
 * Run one lookup, or explain why it did not run.
 *
 * A failure is returned rather than thrown, and it is returned *to the model* —
 * a bad argument is something it can correct on the next round, and a tool that
 * failed silently is one it will call again the same way. The text is the same
 * plain-text envelope as a success, so nothing downstream has to tell them
 * apart.
 *
 * Membership is an own-property check: `{"call":"constructor"}` would otherwise
 * find `Object.prototype.constructor`, which has no schema, and the loop would
 * die on a TypeError instead of telling the model there is no such lookup.
 */
export async function runLookup<C extends BaseToolContext>(
  tools: Readonly<Record<string, ToolSpec<C>>>,
  id: string,
  args: unknown,
  context: C,
): Promise<ToolResult> {
  const spec = ownSpec(tools, id);
  if (spec === undefined) {
    return {
      trace: `unknown lookup ${id}`,
      text: `[${id}] no such lookup. Available: ${Object.keys(tools).join(', ')}`,
    };
  }

  const parsed = spec.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const why = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
      .join('; ');
    return { trace: `${id} rejected`, text: `[${id}] arguments rejected — ${why}. Expected ${spec.args}` };
  }

  try {
    return await spec.run(parsed.data as Record<string, unknown>, context);
  } catch (error) {
    /* A cancelled question is not a failed lookup. Reporting it as one would
       hand the model an error to narrate about a conversation the seller has
       already walked away from, so it goes back up and ends the run. */
    if (context.signal?.aborted === true) throw error;

    const reason = error instanceof Error ? error.message : 'the lookup failed';
    return {
      trace: `${id} failed`,
      text: `[${id}] failed — ${reason}. Say what you could not read rather than estimating it.`,
    };
  }
}

/** What calling an action does, in the words the model is told. */
function actionGate(id: string, definition: ActionDefinition): string {
  /* A follow-up question is the one `none` action that does not run: asking it
     outright would start a second question underneath the answer to the first. */
  if (id === ASK_ACTION_ID) return 'Places a follow-up question chip under your answer.';
  if (definition.risk === 'none') return 'Runs immediately; changes nothing at Uzum.';
  return `Places a button for the seller to press — it is NOT performed by you. ${definition.endpoint ?? ''} (risk ${definition.risk}).`;
}

function renderSection(section: ToolkitSection): string[] {
  return [section.title, ...section.lines];
}

export function createToolkit<C extends BaseToolContext, A extends string>(
  definition: ToolkitDefinition<C, A>,
): AgentToolkit<C, A> {
  const { tools, actions } = definition;
  const toolIds = Object.keys(tools);

  /**
   * Safe name → registry id.
   *
   * Built from the registries rather than by undoing the substitution, because
   * `open_toolkit` would reverse into `open.toolkit` and name nothing. A lookup
   * cannot drift the way a rule can. A `Map`, so a name the model invents never
   * resolves through the prototype.
   */
  const idBySafeName: ReadonlyMap<string, string> = new Map([
    ...toolIds.map((id) => [safeToolName(id), id] as const),
    ...actions.ids.map((id) => [safeToolName(id), id] as const),
  ]);

  const definitionOf = (id: string): ActionDefinition | undefined => actions.get(id);

  let declared: readonly ToolSchema[] | undefined;

  /**
   * Everything after "tools" is opened — described from the same `summary` lines
   * the text document is generated from. Built once: the registries do not change
   * under a running host.
   */
  const declarations = (): readonly ToolSchema[] => {
    if (declared !== undefined) return declared;

    const reads = toolIds.flatMap((id) => {
      const spec = ownSpec(tools, id);
      if (spec === undefined) return [];
      return [
        {
          name: safeToolName(id),
          description: spec.summary.join(' '),
          parameters: toJsonSchema(spec.schema),
        },
      ];
    });

    const writes = actions.ids.flatMap((id) => {
      const action = definitionOf(id);
      if (action === undefined) return [];
      return [
        {
          name: safeToolName(id),
          description: `${action.summary} ${actionGate(id, action)}`,
          parameters: toJsonSchema(action.params),
        },
      ];
    });

    declared = [OPEN_TOOLKIT_SCHEMA, ...reads, ...writes];
    return declared;
  };

  const toolkit: AgentToolkit<C, A> = {
    actions,

    schemas: (granted) => (granted.has('tools') ? declarations() : [OPEN_TOOLKIT_SCHEMA]),

    idOfName: (name) => idBySafeName.get(name) ?? name,

    run: (id, args, context) => runLookup(tools, id, args, context),

    /**
     * The toolkit, written out when the model asks for it.
     *
     * Generated from the registries rather than maintained beside them, so a tool
     * or an action that exists is a tool or an action the model is told about —
     * the failure mode where a prompt describes a capability that was renamed six
     * months ago cannot happen here.
     */
    describe(context) {
      const reads = toolIds.flatMap((id) => {
        const spec = ownSpec(tools, id);
        if (spec === undefined) return [];
        return [[`  ${id} ${spec.args}`, ...spec.summary.map((line) => `      ${line}`)].join('\n')];
      });

      const writes = actions.ids.flatMap((id) => {
        const action = definitionOf(id);
        if (action === undefined) return [];
        const route = action.endpoint ?? 'no request — the app does it locally';
        return [
          [
            `  ${id} ${action.argsDoc}`,
            `      ${action.summary}`,
            `      ${route} · risk ${action.risk} · ${actionGate(id, action)}`,
          ].join('\n'),
        ];
      });

      const example = definition.exampleCall ?? toolIds[0] ?? 'lookup.id';
      const blocks: string[][] = [
        [
          'CALLING',
          '  One object per line, nothing else in that turn:',
          `    {"call":"${example}","args":{}}`,
          '  Several lines are allowed and run in order; I answer with every result in one message',
          '  and you carry on with the same question. Do not guess at a result before it arrives.',
        ],
        [
          'WHAT A RESULT IS',
          '  The data itself: a header saying what was read, then tables whose first line names the',
          '  columns and whose cells are separated by "|". An empty cell is a value the row does not',
          '  have. Read the header before the rows — it states the window, the shops, the units, and',
          '  whether the rows are TRUNCATED or only one page of more.',
        ],
        ...definition.sections(context).map(renderSection),
        ['LOOKUPS', ...reads],
        [
          'ACTIONS',
          '  You never send a write to Uzum. Naming one places a button in your answer, filled in with',
          '  the parameters you gave; the seller sees the route and the risk and presses it, or does',
          '  not. Say what the button would do — never that it has been done.',
          ...writes,
        ],
        ...(definition.closing?.(context) ?? []).map(renderSection),
      ];

      return [
        'TOOLKIT — what you may read and what you may offer.',
        ...blocks.flatMap((block) => ['', ...block]),
      ].join('\n');
    },

    ...(definition.freshness !== undefined ? { freshness: definition.freshness } : {}),
    ...(definition.widgetHints !== undefined ? { widgetHints: definition.widgetHints } : {}),
  };

  return toolkit;
}
