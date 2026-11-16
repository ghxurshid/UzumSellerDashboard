import { z } from 'zod';

import type { TranslationKey } from '@core/i18n/dictionary';

/**
 * The mechanism behind every button the Copilot may draw, whatever the host.
 *
 * What proposes an action is partly a language model, and "let the model
 * describe a request" is how you end up sending a `POST` nobody designed. So
 * actions are a **closed registry**: the model names an id and hands over
 * parameters, the parameters are checked against that entry's schema before
 * anything is drawn or run, and an id the registry does not hold is refused with
 * a reason. The model chooses among capabilities; it never describes one.
 *
 * This file is the part of that idea every host shares — the shape of an entry,
 * the gate, and the one action every Copilot has, a follow-up question. *Which*
 * actions exist is the host's business: the site offers price writes, stock
 * writes and screen navigation (`actions.ts`), and another host offers whatever
 * its own surface can perform. The loop only ever sees an `ActionRegistry`.
 *
 * ## Risk decides who presses
 *
 *   `none`  changes nothing and reaches no network. The loop runs it outright
 *           (except `copilot.ask`, which is always a chip).
 *   `low`   sends a request that only reads. A button.
 *   `mid`   writes something reversible. A button.
 *   `high`  changes what the marketplace charges or believes is on the shelf.
 *           A button *and* a confirmation in front of it.
 */

export type ActionRisk = 'none' | 'low' | 'mid' | 'high';

export interface ActionDefinition {
  /** Button label. */
  readonly labelKey: TranslationKey;
  /** The route this performs, verbatim. `null` for what the host does locally. */
  readonly endpoint: string | null;
  readonly risk: ActionRisk;
  /** Parameters this action needs, validated before the button is drawn. */
  readonly params: z.ZodTypeAny;
  /** The argument shape, written out for the toolkit document. */
  readonly argsDoc: string;
  /** One line for the model: what pressing this does. */
  readonly summary: string;
}

/** An action the registry accepted, with the parameters its schema produced. */
export interface ResolvedAction<Id extends string = string> {
  readonly actionId: Id;
  readonly definition: ActionDefinition;
  readonly params: unknown;
}

export interface ActionRegistry<Id extends string = string> {
  /** Every id, in the order the host wants them documented. */
  readonly ids: readonly Id[];
  get(id: string): ActionDefinition | undefined;
  /** null for an unknown id or params the entry refuses. */
  resolve(id: string, params: unknown): ResolvedAction<Id> | null;
  /** One line the model can act on: unknown id, or which param failed. */
  explain(id: string, params: unknown): string;
}

/**
 * A registry over a host's table.
 *
 * Membership is an own-property check rather than `in`, so `toString` or
 * `constructor` arriving from a model is an unknown action and not a prototype
 * method masquerading as one.
 */
export function createActionRegistry<Id extends string>(
  definitions: Readonly<Record<Id, ActionDefinition>>,
): ActionRegistry<Id> {
  const ids = Object.keys(definitions) as Id[];
  const table: Readonly<Record<string, ActionDefinition>> = definitions;

  const get = (id: string): ActionDefinition | undefined =>
    Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;

  return {
    ids,
    get,

    /*
     * Returns `null` for an unknown id or parameters the entry rejects, and the
     * renderer then draws nothing. A card that suggested an impossible action
     * loses its button and keeps its argument, which is the right degradation:
     * the finding may still be true even when the remedy was malformed.
     */
    resolve(id, params) {
      const definition = get(id);
      if (definition === undefined) return null;

      const parsed = definition.params.safeParse(params ?? {});
      if (!parsed.success) return null;

      return { actionId: id as Id, definition, params: parsed.data };
    },

    /*
     * A rejected action used to disappear silently, which is the right
     * behaviour on screen and the wrong one in a conversation: the model asked
     * for something, nothing happened, and it had no way to learn that
     * `entries` needed a barcode. The chat feeds this back and gives it one
     * chance to correct itself.
     */
    explain(id, params) {
      const definition = get(id);
      if (definition === undefined) return `no action named "${id}"`;

      const parsed = definition.params.safeParse(params ?? {});
      if (parsed.success) return 'accepted';

      return parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`)
        .join('; ');
    },
  };
}

/* ── the action every host has ──────────────────────────────────────────── */

/** A follow-up question, offered as a chip under the answer. */
export const ASK_ACTION_ID = 'copilot.ask';

export const ASK_PARAMS = z.object({ question: z.string().trim().min(1).max(300) });

/**
 * The follow-up chip.
 *
 * Risk `none`, and still never run: asking it outright would start a second
 * question underneath the one being answered, so the loop turns a call to it
 * into the chip it was meant to be. A host's table includes this entry as is.
 */
export const ASK_ACTION: ActionDefinition = {
  labelKey: 'askWhy',
  endpoint: null,
  risk: 'none',
  params: ASK_PARAMS,
  argsDoc: '{question:"…"}',
  summary: 'Offer a follow-up question as a chip under your answer. Place it as a widget, not as a call.',
};
