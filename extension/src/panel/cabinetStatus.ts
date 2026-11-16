/**
 * What the panel can honestly say about the cabinet it sits in.
 *
 * `getSellerSession` answers a question the seller never asks directly — "can
 * the Copilot read my shop right now?" — and the answer is one of a handful of
 * states, each with its own sentence. Kept apart from the component so the
 * mapping is plain data in, plain state out.
 */
import { ApiError } from '@core/errors/apiError';
import type { TranslationKey } from '@core/i18n/dictionary';

import { BRIDGE_CLOSED_CODE } from '@ext/uzum/client';
import type { SellerSession } from '@ext/uzum/session';

export type CabinetStatus =
  /** Not asked yet, or being asked — nothing is shown. */
  | 'checking'
  | 'ready'
  | 'signedOut'
  | 'noShops'
  /**
   * The page is not inside the cabinet frame. Only a development build can be
   * here: a production panel renders its app only after a verified connection.
   */
  | 'outside'
  /** The connection was there and the cabinet page said goodbye (reloaded, navigated away). */
  | 'closed'
  /** The cabinet tab did not answer. */
  | 'unreachable';

export function statusOfSession(session: SellerSession): CabinetStatus {
  if (session.signedIn !== true) return 'signedOut';
  return Array.isArray(session.shopIds) && session.shopIds.length > 0 ? 'ready' : 'noShops';
}

/** `null` for a cancelled read: the one that replaced it will report. */
export function statusOfError(error: unknown): CabinetStatus | null {
  if (error instanceof ApiError) {
    if (error.isCancelled) return null;
    if (error.code === BRIDGE_CLOSED_CODE) return 'closed';
    if (error.kind === 'unconfigured') return 'outside';
  }
  return 'unreachable';
}

/** The sentence for a status; `ready` and `checking` have none. */
export const NOTICE_TEXT: Readonly<Record<CabinetStatus, TranslationKey | null>> = {
  checking: null,
  ready: null,
  signedOut: 'extSignedOut',
  noShops: 'extNoShops',
  outside: 'extNotInCabinet',
  closed: 'extBridgeLost',
  unreachable: 'extBridgeDown',
};

/** Whether asking again can change the answer — in a dev server or after a goodbye it cannot. */
export function canRecheck(status: CabinetStatus): boolean {
  return status === 'signedOut' || status === 'noShops' || status === 'unreachable';
}
