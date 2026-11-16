import type { AgentToolkit } from '@core/tools/contract';
import type { Language } from '@core/types/common';

import { createExtensionToolkit } from '@ext/tools';
import type { ExtToolContext } from '@ext/tools/context';
import type { SellerSession } from '@ext/uzum/session';

import { EXT_ACTIONS, type ExtActionId } from './actions';

/**
 * The extension's toolkit, as the shared Copilot loop sees it.
 *
 * Nothing is decided here. The lookups and their document are `@ext/tools`'
 * (copilot-data); the buttons are `actions.ts`. This is where the two meet, so
 * the panel hands `runAgent` one value and cannot pair a toolkit with the
 * wrong registry — the toolkit documents the actions it is built over, and the
 * loop's gate checks every button against the same table.
 */

export const EXTENSION_TOOLKIT: AgentToolkit<ExtToolContext, ExtActionId> =
  createExtensionToolkit(EXT_ACTIONS);

export interface ExtToolContextInput {
  /** The session read for this question — the same one the system prompt was built from. */
  readonly session: SellerSession;
  readonly language: Language;
  readonly now: number;
  readonly signal: AbortSignal | undefined;
}

/**
 * What every lookup of one question is handed.
 *
 * Built from the same session as `buildExtensionSystem`, once per question, so
 * the model is never told one set of shops while its lookups are checked
 * against another.
 */
export function createExtToolContext(input: ExtToolContextInput): ExtToolContext {
  return {
    session: input.session,
    language: input.language,
    now: input.now,
    signal: input.signal,
  };
}
