/**
 * The extension's side of the shared Copilot panel.
 *
 * Where the site assembles a host from a query cache and a router, this one
 * reads the seller's session out of the open cabinet tab, once per question,
 * and builds both halves of the run from that single read: the system prompt
 * the model is told, and the context its lookups are checked against. Reading
 * twice could tell the model one set of shops while a lookup is checked against
 * another, so there is exactly one read.
 *
 * What a failed read becomes is decided here, in the seller's language. The
 * shared loop prints an `ApiError`'s message as it stands, and the bridge's own
 * messages are English developer text. A signed-out tab is *not* a failure: the
 * prompt tells the model so (`extensionContext`), and a question that needs no
 * data can still be answered, so it proceeds. A panel outside the cabinet
 * frame has no tab to read and cannot answer anything about a shop, so that
 * one stops the run with a sentence.
 */
import { ASK_ACTION_ID } from '@core/agent/actionRegistry';
import { ApiError } from '@core/errors/apiError';
import { translate, type TranslationKey } from '@core/i18n/dictionary';
import { useChatStore } from '@core/state/chat.store';
import { readGeneralPreferences } from '@core/state/preferences.store';
import type { CopilotHost, PrepareInput, PreparedRun } from '@core/ui/chat/host';
import type { Language } from '@core/types/common';

import { buildExtensionSystem, createExtToolContext, EXTENSION_TOOLKIT, type ExtActionId } from '@ext/host';
import type { ExtToolContext } from '@ext/tools/context';
import { BRIDGE_CLOSED_CODE, getSellerSession, type SellerSession } from '@ext/uzum/client';

export type ExtensionCopilotHost = CopilotHost<ExtToolContext, ExtActionId>;

/**
 * Starter questions `products.list` can answer; the smaller lookups (product
 * counters, supply invoices, shops) have none yet. No sales, profit or stock
 * analysis is promised: the extension cannot read those yet, and a suggestion
 * is a promise.
 */
export const EXTENSION_SUGGESTIONS: readonly TranslationKey[] = [
  'extQStockList',
  'extQOutOfStock',
  'extQReturns',
];

/** Why the session could not be read, as a sentence in the seller's language. */
export function sessionFailure(error: unknown, language: Language): ApiError {
  if (error instanceof ApiError && error.isCancelled) return error;
  if (error instanceof ApiError && error.code === BRIDGE_CLOSED_CODE) {
    /* The connection was real and was closed: say that, not "not in the cabinet". */
    return new ApiError(translate('extBridgeLost', language), { kind: 'client', code: BRIDGE_CLOSED_CODE });
  }
  if (error instanceof ApiError && error.kind === 'unconfigured') {
    return new ApiError(translate('extNotInCabinet', language), { kind: 'unconfigured' });
  }
  /* `client`, not the bridge's own kind: a timeout would be worded "the AI is
     slow" by the loop, which is not what happened here. */
  return new ApiError(translate('extBridgeDown', language), { kind: 'client' });
}

async function readSession(language: Language, signal: AbortSignal): Promise<SellerSession> {
  try {
    return await getSellerSession(signal);
  } catch (error) {
    throw sessionFailure(error, language);
  }
}

export async function prepareRun({
  language,
  now,
  native,
  signal,
}: PrepareInput): Promise<PreparedRun<ExtToolContext>> {
  const session = await readSession(language, signal);
  return {
    /* The zone every timestamp in the panel is shown in, so the model quotes the same clock. */
    system: buildExtensionSystem({ language, native, session, now, timeZone: readGeneralPreferences().timezone }),
    context: createExtToolContext({ session, language, now, signal }),
  };
}

/**
 * The only action is the follow-up chip. The panel lifts a top-level one into a
 * chip itself, but one the model nests inside a callout is drawn by the block
 * renderer as a button, and pressing it lands here: queue the question in the
 * chat store, as the site's runner does. Any other id is ignored rather than
 * acted on — the registry never lets one through, and nothing here writes.
 */
export function runAskAction(action: { readonly actionId: string; readonly params: unknown }): void {
  if (action.actionId !== ASK_ACTION_ID) return;
  const params = action.params;
  const question =
    typeof params === 'object' && params !== null && 'question' in params
      ? (params as { question: unknown }).question
      : undefined;
  if (typeof question !== 'string' || question.trim() === '') return;
  useChatStore.getState().queue(question.trim());
}

export function createExtensionHost(deps: { readonly openSettings: () => void }): ExtensionCopilotHost {
  return {
    toolkit: EXTENSION_TOOLKIT,
    prepare: prepareRun,
    runAction: runAskAction,
    openSettings: deps.openSettings,
    suggestions: EXTENSION_SUGGESTIONS,
  };
}
