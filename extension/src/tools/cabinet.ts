import { ApiError } from '@core/errors/apiError';
import { clip, compose, header } from '@core/tools/plaintext';
import { BRIDGE_CLOSED_CODE } from '@ext/uzum/client';
import type { SellerSession } from '@ext/uzum/session';

/**
 * What every cabinet lookup needs around its one request.
 *
 * Three things are the same for any route the extension will ever call, so they
 * live once here and a tool file only says what is particular to its route:
 *
 *   **A deadline.** `uzumRequest` has no clock of its own, and after a 429 the
 *   queue behind it may hold for a long time. A lookup that waits that long hangs
 *   the whole answer, so every call is raced against a deadline and abandoned —
 *   with the far side told to abort — when it passes.
 *
 *   **Which shop.** Routes are addressed per shop, and the seller's session says
 *   which shops exist and which one the cabinet page is showing. An id the model
 *   names must be one of the seller's own, and nothing is requested until a shop
 *   is settled — a refusal is text the model can act on, not a request that fails
 *   on the far side.
 *
 *   **Failures a model can act on.** An `ApiError` is turned into a sentence that
 *   says what happened and what to do, including how long a rate limit asked to
 *   wait. The messages `ApiError` carries never hold the token, but only the ones
 *   that add information are repeated.
 */

/** How long one lookup may wait for the cabinet, queue included. */
export const CABINET_DEADLINE_MS = 30_000;

const cancelled = (): ApiError =>
  new ApiError('Request cancelled', { kind: 'cancelled', code: 'ERR_CANCELED' });

/**
 * Run `run` with the question's own signal and a deadline.
 *
 * The call is raced, not merely signalled: a client that ignores its signal
 * would otherwise hold the answer past the deadline. After the deadline the
 * inner signal is aborted so a well-behaved client stops, and a late settlement
 * of the abandoned call is swallowed rather than reported as unhandled.
 */
export async function withDeadline<T>(
  outer: AbortSignal | undefined,
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (outer?.aborted === true) throw cancelled();

  const inner = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let onOuter: (() => void) | undefined;

  const interrupted = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(
        new ApiError(`The cabinet did not answer within ${Math.round(ms / 1000)} s.`, { kind: 'timeout' }),
      );
      inner.abort();
    }, ms);
    onOuter = () => {
      reject(cancelled());
      inner.abort();
    };
    outer?.addEventListener('abort', onOuter, { once: true });
  });
  /* Whichever of the two never wins the race must not become an unhandled rejection. */
  interrupted.catch(() => undefined);

  const call = run(inner.signal);
  call.catch(() => undefined);

  try {
    return await Promise.race([call, interrupted]);
  } catch (error) {
    /* The deadline aborts the inner signal, which can make the client reject with
       "cancelled" a tick before the timeout does; the cause is the deadline. */
    if (timedOut) {
      throw new ApiError(`The cabinet did not answer within ${Math.round(ms / 1000)} s.`, {
        kind: 'timeout',
      });
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onOuter !== undefined) outer?.removeEventListener('abort', onOuter);
  }
}

/* ── which shop ─────────────────────────────────────────────────────────── */

export type ShopChoice =
  | {
      readonly kind: 'shop';
      readonly shopId: number;
      /** Why this shop: the model named it, the page shows it, or it is the only one. */
      readonly basis: 'asked' | 'current' | 'only';
    }
  | { readonly kind: 'signedOut' }
  | { readonly kind: 'noShops' }
  | { readonly kind: 'notTheirs'; readonly shopId: number; readonly shopIds: readonly number[] }
  | { readonly kind: 'choose'; readonly shopIds: readonly number[] };

/**
 * Settle which shop a lookup is about.
 *
 * An explicit id beats everything but must be the seller's own; otherwise the
 * shop the cabinet page is showing; otherwise the only shop there is; otherwise
 * nothing — guessing a shop would answer about the wrong one with full
 * confidence.
 */
export function resolveShop(session: SellerSession, asked: number | undefined): ShopChoice {
  if (!session.signedIn) return { kind: 'signedOut' };
  if (session.shopIds.length === 0) return { kind: 'noShops' };

  if (asked !== undefined) {
    return session.shopIds.includes(asked)
      ? { kind: 'shop', shopId: asked, basis: 'asked' }
      : { kind: 'notTheirs', shopId: asked, shopIds: session.shopIds };
  }

  if (session.currentShopId !== null && session.shopIds.includes(session.currentShopId)) {
    return { kind: 'shop', shopId: session.currentShopId, basis: 'current' };
  }
  const only = session.shopIds.length === 1 ? session.shopIds[0] : undefined;
  if (only !== undefined) return { kind: 'shop', shopId: only, basis: 'only' };

  return { kind: 'choose', shopIds: session.shopIds };
}

/** The model-readable text for a choice that made no request, or null when there is a shop. */
export function refusalText(tool: string, choice: ShopChoice): string | null {
  switch (choice.kind) {
    case 'shop':
      return null;
    case 'signedOut':
      return compose([
        header(tool, ['not signed in', 'no request was made']),
        'The seller is not signed in to the cabinet in this tab, so there is nothing to read.',
        'Ask them to sign in at seller.uzum.uz, then ask again.',
      ]);
    case 'noShops':
      return compose([
        header(tool, ['no shops', 'no request was made']),
        'The cabinet session lists no shops for this seller, so there is nothing to ask about.',
      ]);
    case 'notTheirs':
      return compose([
        header(tool, [`shopId ${choice.shopId} is not this seller's`, 'no request was made']),
        `The seller's shops are ${choice.shopIds.join(', ')}. Call again with one of those, or without shopId.`,
      ]);
    case 'choose':
      return compose([
        header(tool, ['shop not chosen', 'no request was made']),
        `The seller has ${choice.shopIds.length} shops (${choice.shopIds.join(', ')}) and the cabinet page shows none of them.`,
        'Ask the seller which shop they mean, then call again with shopId.',
      ]);
  }
}

/** What the header says about why this shop was the one asked. */
export function shopLabel(choice: Extract<ShopChoice, { kind: 'shop' }>): string {
  switch (choice.basis) {
    case 'asked':
      return `shop ${choice.shopId}`;
    case 'current':
      return `shop ${choice.shopId} (the one the cabinet page shows)`;
    case 'only':
      return `shop ${choice.shopId} (the seller's only shop)`;
  }
}

/* ── failures ───────────────────────────────────────────────────────────── */

/** A few words about a message, when the message adds something the kind does not. */
const detail = (error: Error): string => (error.message === '' ? '' : ` (${clip(error.message, 160)})`);

/**
 * One sentence about why a request did not return, for the model.
 *
 * It says what to do as well as what happened: a rate limit names the wait the
 * API asked for, a refused session says the seller must act, and an
 * unconfigured panel says plainly that no live request is possible here at all.
 */
export function explainFailure(error: unknown): string {
  if (error instanceof ApiError) {
    /* A closed bridge is told apart by its code, whatever kind it carries: the
       panel did connect once, which is not what "unconfigured" means. */
    if (error.code === BRIDGE_CLOSED_CODE) {
      return 'No request was sent: the panel lost its connection to the cabinet page. The seller needs to reload the panel or the cabinet page.';
    }
    switch (error.kind) {
      case 'rateLimited': {
        const wait =
          error.retryAfterMs === undefined
            ? 'it did not say how long'
            : `it asked to wait about ${Math.max(1, Math.ceil(error.retryAfterMs / 1000))} s`;
        return `The Uzum API is rate limiting requests; ${wait}. Do not call again before then — tell the seller to try again shortly.`;
      }
      /* The bridge also refuses locally — shop not in the session, permission
         missing, no token — and those errors carry no status. A status is named
         only when the API itself answered, never for a request that was not sent. */
      case 'unauthorized':
        return error.status === undefined
          ? 'No request was sent: this tab holds no usable cabinet session token — the seller may need to sign in again in this tab.'
          : `The Uzum API refused the cabinet session (HTTP ${error.status}) — the seller may need to sign in again in this tab.`;
      case 'forbidden':
        return error.status === undefined
          ? "No request was sent: the extension itself refused it — the shop is not among the seller's shops in this session, or the session lacks the permission to read it."
          : `The Uzum API answered HTTP ${error.status}: the seller's account is not allowed to read this.`;
      case 'notFound':
        return error.status === undefined
          ? `No request was sent: the extension found no such address for this shop${detail(error)}.`
          : `The API answered HTTP ${error.status} — nothing exists at that address for this shop.`;
      /* Without a status the API never spoke: a server-kind error is then the
         extension's own bridge failing, a client-kind one its local refusal. */
      case 'server':
        return error.status === undefined
          ? `The extension's own bridge to the cabinet page failed, so nothing was read${detail(error)}. Asking again may work.`
          : `The Uzum API had an error (HTTP ${error.status})${detail(error)}.`;
      case 'client':
        return error.status === undefined
          ? `No request was sent: the extension refused it before it left the cabinet page${detail(error)}.`
          : `The Uzum API rejected the request (HTTP ${error.status})${detail(error)}.`;
      case 'network':
        return `The request did not reach the Uzum API${detail(error)}.`;
      case 'timeout':
        return `${error.message} Nothing was read; asking again may work.`;
      case 'cancelled':
        return 'The request was cancelled before it finished.';
      case 'unconfigured':
        return 'No request was sent: this panel never connected to a seller cabinet page, so no live request can be made from here.';
    }
  }
  return error instanceof Error && error.message !== ''
    ? `The lookup failed: ${clip(error.message, 160)}.`
    : 'The lookup failed.';
}
