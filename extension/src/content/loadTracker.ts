/**
 * Which `load` events of the iframe answer a navigation the content script
 * started, and what to do about the ones that do not.
 *
 * A handshake nonce is single use, so a panel that loaded without our having
 * started it (its own "Reload" button, a page script navigating the frame, the
 * browser restoring it) holds a spent or foreign nonce and can never connect.
 * The only cure is a fresh, registered nonce and a full navigation.
 *
 * That cure must not become a loop: if a few unexpected loads land in a short
 * window, something is fighting the frame, and the right move is to stop and
 * leave it inert (the seller can retry by hand), not to keep minting nonces.
 */
export type LoadVerdict =
  /** Answers a navigation we started: attach the bridge. */
  | 'expected'
  /** Nobody we know started it: dispose, mint, navigate again. */
  | 'unexpected'
  /** Too many of those, too fast: stop. */
  | 'inert';

/**
 * How long the panel gets to confirm, over the port, that it accepted the
 * handshake. Its own "could not connect" notice appears after about 2 s, so a
 * healthy panel has already answered by then; 5 s leaves room for a slow machine
 * (the panel bundle is parsed before it can listen, and verification reads and
 * rewrites extension storage) without leaving the seller on a foreign document
 * for long.
 */
export const ACK_TIMEOUT_MS = 5_000;

export const MAX_UNEXPECTED_LOADS = 3;
export const UNEXPECTED_WINDOW_MS = 30_000;

/** What happened to the confirmation wait that followed an attach. */
export type AckOutcome = 'confirmed' | 'timeout' | 'disposed';
export type AckVerdict = 'confirmed' | 'ignore' | 'unexpected' | 'inert';

export interface LoadTracker {
  /** Call immediately before the frame is given a URL we started. */
  expectLoad(): void;
  /** Call for every `load` event of the iframe. */
  onLoad(now: number): LoadVerdict;
  /**
   * The bridge attached after an expected load either got the panel's
   * confirmation or did not. A timeout means the document in the frame is not
   * the panel that was started (a page navigated it away, or it never came up):
   * it is handled like an unexpected load, under the same bound. A bridge that
   * was disposed while waiting says nothing about the frame.
   */
  onAck(now: number, outcome: AckOutcome): AckVerdict;
  /** After the seller's own retry: forget the history and the inert state. */
  reset(): void;
  readonly inert: boolean;
}

export function createLoadTracker(
  max = MAX_UNEXPECTED_LOADS,
  windowMs = UNEXPECTED_WINDOW_MS,
): LoadTracker {
  let expecting = false;
  let inert = false;
  let unexpectedAt: number[] = [];

  function noteUnexpected(now: number): 'unexpected' | 'inert' {
    unexpectedAt = unexpectedAt.filter((at) => now - at < windowMs);
    unexpectedAt.push(now);
    if (unexpectedAt.length > max) inert = true;
    return inert ? 'inert' : 'unexpected';
  }

  return {
    expectLoad() {
      expecting = true;
    },
    onLoad(now) {
      if (expecting) {
        expecting = false;
        return 'expected';
      }
      return noteUnexpected(now);
    },
    onAck(now, outcome) {
      if (outcome === 'confirmed') return 'confirmed';
      if (outcome === 'disposed') return 'ignore';
      return noteUnexpected(now);
    },
    reset() {
      expecting = false;
      inert = false;
      unexpectedAt = [];
    },
    get inert() {
      return inert;
    },
  };
}
