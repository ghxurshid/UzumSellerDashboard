import type { BaseToolContext } from '@core/tools/contract';
import type { SellerSession } from '@ext/uzum/session';

/**
 * What every cabinet lookup is handed, per question.
 *
 * The session is read fresh from the open cabinet tab when the question starts
 * (`getSellerSession()`), so a tool decides which shop to ask about from what the
 * seller is looking at now, not from what the panel remembered. It carries ids
 * and permission codes only — the token never leaves the content script.
 */
export interface ExtToolContext extends BaseToolContext {
  readonly session: SellerSession;
}
