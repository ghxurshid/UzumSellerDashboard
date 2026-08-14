import type { RowActionKey } from '@/types/domain';

/**
 * Which writes need a form before they can be sent, and what that form is
 * opened with.
 *
 * Kept out of the drawer component so the module page can ask "does this action
 * need input?" without importing the whole drawer, and so the drawer file stays
 * a component module.
 */

export const FORM_ACTIONS = [
  'stock',
  'price',
  'cancelOrder',
  'labels',
  'identifiers',
  'complete',
  'createInvoice',
  'updateContent',
  'timeSlot',
] as const satisfies readonly RowActionKey[];

export type FormAction = (typeof FORM_ACTIONS)[number];

export function isFormAction(act: RowActionKey): act is FormAction {
  return (FORM_ACTIONS as readonly string[]).includes(act);
}

export interface ActionContext {
  readonly action: FormAction;
  /** The row the action was started from, or the selection it applies to. */
  readonly label: string;
  readonly endpoint: string;
  readonly raw: Readonly<Record<string, string | number | boolean | null>>;
  /** Ids from a multi-row selection, when the action takes more than one. */
  readonly ids: readonly string[];
  /** Which module opened it — "labels" means different things per screen. */
  readonly moduleKey: string;
}
