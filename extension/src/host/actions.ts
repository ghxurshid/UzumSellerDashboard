import {
  ASK_ACTION,
  ASK_ACTION_ID,
  createActionRegistry,
  type ActionRegistry,
} from '@core/agent/actionRegistry';

/**
 * The buttons the extension's Copilot may draw.
 *
 * One today: the follow-up chip every host has. The site's price, stock and
 * navigation actions are not here and must not be — the site performs them
 * through its own API client and its own screens, and this panel has neither.
 * An id the registry does not hold is refused before it renders, with the list
 * of ids that do exist, so a model that remembers `product.price` from
 * somewhere is told to use what is here instead.
 *
 * A write action, when one comes, is an entry here *and* a route in
 * `@ext/uzum/routes` *and* the confirmation in the panel — and the prompt's
 * "this version only reads" paragraph in `prompt.ts` changes with it.
 */

export type ExtActionId = typeof ASK_ACTION_ID;

export const EXT_ACTIONS: ActionRegistry<ExtActionId> = createActionRegistry<ExtActionId>({
  [ASK_ACTION_ID]: ASK_ACTION,
});
