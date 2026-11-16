/**
 * What travels over the private port between the panel and the content script.
 *
 * Both sides import this file, so it holds only types, constants and a tiny
 * guard — no validator library, which the content script cannot carry. Every
 * message is checked by its receiver; the sender is never trusted to have been
 * well-formed.
 *
 * None of these shapes can carry the seller's token: requests name a route and
 * params, results carry parsed JSON or a classified failure, and the session
 * view is built without it. A test pins that for every message the content
 * side sends.
 */
import type { SellerSession } from './session';

/**
 * Tag of the one `window.postMessage` ever used: the handshake that hands over the
 * port. It carries the frame nonce, is addressed to the extension origin only, and
 * is verified against extension storage by the panel (scheme below).
 */
export const HANDSHAKE_TAG = 'savdo-copilot/bridge-handshake';

export interface HandshakeMessage {
  readonly savdo: typeof HANDSHAKE_TAG;
  readonly nonce: string;
}

/** A free-form message the panel and the frame UI exchange; `ui-surface` defines the types. */
export interface AppMessage {
  readonly type: string;
  readonly payload?: unknown;
}

export const WIRE_FAILURE_KINDS = [
  'unauthorized',
  'forbidden',
  'notFound',
  'rateLimited',
  'server',
  'client',
  'network',
  'timeout',
  'cancelled',
] as const;
export type WireFailureKind = (typeof WIRE_FAILURE_KINDS)[number];

export interface WireFailure {
  readonly ok: false;
  readonly kind: WireFailureKind;
  /** A short English sentence for the model; never contains the token. */
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
}

export interface WireSuccess {
  readonly ok: true;
  readonly status: number;
  /** Parsed JSON exactly as the API sent it — its shape is not known here. */
  readonly data: unknown;
}

export type WireResult = WireSuccess | WireFailure;

export interface WireRequest {
  readonly route: string;
  readonly method: string;
  readonly params: unknown;
}

export type PanelToContent =
  | ({ readonly k: 'request'; readonly id: number } & WireRequest)
  | { readonly k: 'abort'; readonly id: number }
  | { readonly k: 'session'; readonly id: number }
  /** The panel accepted the handshake; the content side stops waiting for it. */
  | { readonly k: 'ready' }
  | { readonly k: 'app'; readonly message: AppMessage };

export type ContentToPanel =
  | { readonly k: 'response'; readonly id: number; readonly result: WireResult }
  | { readonly k: 'session'; readonly id: number; readonly session: SellerSession }
  | { readonly k: 'app'; readonly message: AppMessage }
  /** The content side is going away; pending calls can never be answered. */
  | { readonly k: 'bye' };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAppMessage(value: unknown): value is AppMessage {
  return isRecord(value) && typeof value['type'] === 'string';
}

/* ---------------------------------------------------------------------------
 * Frame nonce store. It lives in this file because the content script may only
 * import a fixed set of sibling files (see the lint config).
 * ------------------------------------------------------------------------ */

/**
 * Proof that a panel frame was started by this extension's content script.
 *
 * ## The scheme
 *
 * `panel.html` has to be web-accessible to the cabinet so it can be framed, and
 * on Chromium the extension id is public, so a script already running on the
 * page can build an `<iframe src=".../panel.html">` of its own and post a
 * handshake into it. What it cannot do is write extension storage. The scheme
 * therefore rests on one value, the NONCE: 16 random bytes from the CSPRNG that
 * the content script issues per frame and that exists in exactly three places —
 * the content script's memory, extension storage, and the single handshake
 * message the content script posts to the frame, addressed to the extension's
 * origin only. It is NOT in the frame's URL (the URL is readable through
 * leaks such as resource-timing entries or a closed-shadow escape, so a nonce
 * there would be a nonce the page can learn).
 *
 * - Content side: `registerFrameNonce(nonce)` records it in storage with the
 *   time it was issued. The caller awaits it BEFORE the iframe gets a `src`.
 * - Panel side: a handshake is accepted only when it comes from `window.parent`,
 *   carries the tag and a well-formed nonce, and that nonce is found fresh in
 *   extension storage and removed by this very acceptance — once per document.
 *
 * What an attacker would need: to read the nonce out of the content script or
 * extension storage (a page script cannot), or to guess 128 random bits, before
 * the content script posts at `load`. A page-made frame has no registered nonce
 * and is ignored.
 *
 * What this does not protect: the page already holds the seller's token in its
 * own `localStorage`, so this is about who may drive the panel, not about the
 * token. And a page can always deny service to an in-page frame (remove it,
 * navigate it, never let it load); the content script notices through the
 * panel's `ready` acknowledgement not arriving, and the frame is then reloaded
 * with a fresh nonce. The read-then-remove consumption is not atomic across
 * extension contexts either; a second panel document would need the same
 * unguessable nonce to race it.
 *
 * ## Storage layout
 *
 * One key per nonce, `savdo.bridge.n.<nonce>` -> issue time in ms, plus one
 * index key `savdo.bridge.index` (nonce -> issue time) so pruning never lists
 * the whole area, which also holds provider keys. Losing an index entry to a
 * concurrent write only leaves an orphan, and the panel refuses an expired
 * entry regardless of the index.
 *
 * Imports nothing: the content script bundles this file.
 */

export const BRIDGE_KEY_PREFIX = 'savdo.bridge.';
const NONCE_KEY_PREFIX = `${BRIDGE_KEY_PREFIX}n.`;
export const BRIDGE_INDEX_KEY = `${BRIDGE_KEY_PREFIX}index`;

/**
 * Long enough for a slow panel load between registration and the handshake,
 * short enough that a leftover entry is worthless.
 */
export const NONCE_LIFETIME_MS = 2 * 60_000;

/** The slice of a storage area used here; both `browser` and `chrome` satisfy it. */
export interface NonceStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface Namespace {
  storage?: { local?: NonceStorageArea };
  runtime?: { id?: string };
}

/**
 * `browser.storage.local` first (Firefox), then `chrome.storage.local`, resolved
 * at call time. Null when neither exists, or when the extension context is gone
 * (an orphaned content script loses `runtime.id`).
 */
export function defaultNonceArea(): NonceStorageArea | null {
  const g = globalThis as unknown as { browser?: Namespace; chrome?: Namespace };
  const ns = g.browser?.storage?.local ? g.browser : g.chrome;
  if (!ns?.storage?.local) return null;
  if (ns.runtime !== undefined && !ns.runtime.id) return null;
  return ns.storage.local;
}

/** Hex from a CSPRNG in practice; anything else is refused rather than used as a key. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidNonce(nonce: unknown): nonce is string {
  return typeof nonce === 'string' && NONCE_PATTERN.test(nonce);
}

const keyOf = (nonce: string): string => `${NONCE_KEY_PREFIX}${nonce}`;

function readIndex(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [nonce, at] of Object.entries(raw)) {
    if (isValidNonce(nonce) && typeof at === 'number' && Number.isFinite(at)) out[nonce] = at;
  }
  return out;
}

export interface NonceStoreDeps {
  readonly area?: () => NonceStorageArea | null;
  readonly now?: () => number;
}

/**
 * Content side. Rejects when storage is unavailable or the context is gone —
 * the caller must then not load the frame, because the panel would refuse it.
 */
export async function registerFrameNonce(nonce: string, deps: NonceStoreDeps = {}): Promise<void> {
  if (!isValidNonce(nonce)) throw new Error('Frame nonce has an unusable shape.');
  const area = (deps.area ?? defaultNonceArea)();
  if (area === null) throw new Error('Extension storage is not available.');
  const now = (deps.now ?? Date.now)();

  const index = readIndex((await area.get(BRIDGE_INDEX_KEY))[BRIDGE_INDEX_KEY]);
  const stale = Object.keys(index).filter((n) => now - (index[n] ?? 0) > NONCE_LIFETIME_MS);
  for (const n of stale) delete index[n];
  index[nonce] = now;

  /* The nonce is written first: the index is only bookkeeping for pruning. */
  await area.set({ [keyOf(nonce)]: now });
  await area.set({ [BRIDGE_INDEX_KEY]: index });
  if (stale.length > 0) await area.remove(stale.map(keyOf));
}

/**
 * Panel side, for a batch of candidates at once: the first of `nonces` (in the
 * order given) that was registered, is younger than the lifetime, and has now
 * been removed; otherwise null. One storage read covers the whole batch, so the
 * cost of a flood of candidates is one read per batch, not one per candidate.
 * Expired entries seen on the way are dropped. Any storage failure — including
 * a remove that throws — is null, never an acceptance.
 */
export async function consumeFirstFrameNonce(
  nonces: readonly string[],
  deps: NonceStoreDeps = {},
): Promise<string | null> {
  const candidates = nonces.filter(isValidNonce);
  if (candidates.length === 0) return null;
  try {
    const area = (deps.area ?? defaultNonceArea)();
    if (area === null) return null;
    const now = (deps.now ?? Date.now)();

    const found = await area.get(candidates.map(keyOf));
    let winner: string | null = null;
    const drop: string[] = [];
    for (const nonce of candidates) {
      const issuedAt = found[keyOf(nonce)];
      if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) continue;
      if (winner === null && issuedAt <= now && now - issuedAt <= NONCE_LIFETIME_MS) {
        winner = nonce;
        drop.push(keyOf(nonce));
      } else if (now - issuedAt > NONCE_LIFETIME_MS) {
        drop.push(keyOf(nonce));
      }
    }
    /* Removed before it is reported: an acceptance whose record could not be
       consumed would be replayable. */
    if (drop.length > 0) await area.remove(drop);
    return winner;
  } catch {
    return null;
  }
}

/** One candidate; true only when it was registered, fresh, and is now consumed. */
export async function consumeFrameNonce(nonce: string, deps: NonceStoreDeps = {}): Promise<boolean> {
  return (await consumeFirstFrameNonce([nonce], deps)) === nonce;
}
