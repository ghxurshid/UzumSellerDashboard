/**
 * The panel half of the bridge: what the Copilot's tools call.
 *
 * The panel never sees a token and never builds a URL. It names a route from
 * the shared table, the content script validates and performs it, and a failed
 * result comes back here to be turned into the `ApiError` the Copilot's
 * existing failure handling already understands.
 *
 * ## Who may drive this panel
 *
 * Only a handshake that proves the content script started this frame. The
 * frame's URL carries no secret; the proof is a one-time nonce the content
 * script put in extension storage (see `protocol.ts` for the scheme, what an
 * attacker would need, and what it does not protect). A handshake is accepted
 * when it comes from `window.parent`, carries the tag and a well-formed nonce,
 * and that nonce is found fresh in extension storage and consumed by the
 * acceptance — once per document. After that everything travels over the port
 * pair, which page scripts can neither read nor forge. A page can always deny
 * service to an in-page frame; it cannot make this panel talk to it.
 *
 * ## Candidates are verified independently
 *
 * Nothing about a handshake is trusted until storage has vouched for it, and
 * nothing a bogus candidate does may cost the genuine one its turn. So no
 * candidate holds a lock: every well-formed one joins a FIFO list and the list
 * is verified in batches of at most `BATCH` with ONE storage read per batch. The
 * first candidate (in arrival order) whose nonce verifies wins, exactly once;
 * every other port is closed the moment its fate is known. A flood therefore
 * costs one read per `BATCH` candidates, never discards anyone, and can delay
 * the genuine handshake by at most the batches queued ahead of it — a delay the
 * content side already tolerates (`whenReady` times out and the frame is
 * reloaded with a fresh nonce). There is deliberately no cap that drops
 * candidates, because a cap cannot tell the genuine one from the flood.
 */
import { ApiError } from '@core/errors/apiError';

import {
  type AppMessage,
  type ContentToPanel,
  consumeFirstFrameNonce,
  HANDSHAKE_TAG,
  isAppMessage,
  isRecord,
  isValidNonce,
  type PanelToContent,
  type WireFailure,
  WIRE_FAILURE_KINDS,
  type WireResult,
} from './protocol';
import { shopOfRoute, UZUM_ROUTES, type UzumRouteId, type UzumRouteParams } from './routes';
import type { SellerSession } from './session';

export type { SellerSession };

export interface UzumResponse {
  readonly status: number;
  readonly data: unknown;
  /** The shop that was asked, never read from the payload; null for a route about the account, not a shop. */
  readonly shopId: number | null;
  /** For the answer's source chip. */
  readonly route: string;
}

/** How long a call waits for the handshake before it fails instead of hanging. */
export const HANDSHAKE_WAIT_MS = 2_000;
const SESSION_WAIT_MS = 10_000;
/** Candidates verified per storage read. */
const BATCH = 64;

/** `ApiError.code` of every call made after the content side said goodbye. */
export const BRIDGE_CLOSED_CODE = 'BRIDGE_CLOSED';

/** The slice of `window` the client needs, so it can be driven by a fake. */
export interface PanelEnv {
  readonly parent: unknown;
  /**
   * The first of `nonces` that the content script registered, is fresh, and has
   * now been consumed; null otherwise (including without extension storage).
   */
  consumeFirstNonce(nonces: readonly string[]): Promise<string | null>;
  addMessageListener(listener: (event: MessageEvent<unknown>) => void): void;
}

type Pending = {
  readonly settle: (message: ContentToPanel | null) => void;
};

function unconfigured(): ApiError {
  return new ApiError('The Copilot panel is not running inside the seller cabinet.', {
    kind: 'unconfigured',
  });
}

/** Not retryable and not `unconfigured`: the bridge was there, and it is gone. */
function closedError(): ApiError {
  return new ApiError('The connection to the cabinet page was closed; the panel must be reloaded.', {
    kind: 'client',
    code: BRIDGE_CLOSED_CODE,
  });
}

function toApiError(failure: WireFailure): ApiError {
  const kind = WIRE_FAILURE_KINDS.includes(failure.kind) ? failure.kind : 'client';
  return new ApiError(failure.message, {
    kind,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    ...(failure.code !== undefined ? { code: failure.code } : {}),
    ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
  });
}

function parseResult(value: unknown): WireResult | null {
  if (!isRecord(value)) return null;
  if (value['ok'] === true && typeof value['status'] === 'number') {
    return { ok: true, status: value['status'], data: value['data'] };
  }
  if (
    value['ok'] === false &&
    typeof value['kind'] === 'string' &&
    typeof value['message'] === 'string'
  ) {
    return value as unknown as WireFailure;
  }
  return null;
}

export function createBridgeClient(env: PanelEnv, handshakeWaitMs = HANDSHAKE_WAIT_MS) {
  let port: MessagePort | null = null;
  let closed = false;
  let draining = false;
  let nextId = 1;
  const candidates: Array<{ nonce: string; port: MessagePort }> = [];
  const pending = new Map<number, Pending>();
  const frameListeners = new Set<(message: AppMessage) => void>();
  const readyWaiters = new Set<() => void>();
  const connectedListeners = new Set<() => void>();
  const closedListeners = new Set<() => void>();

  function onPortMessage(event: MessageEvent<unknown>): void {
    const data = event.data;
    if (!isRecord(data)) return;
    if (data['k'] === 'app' && isAppMessage(data['message'])) {
      for (const listener of [...frameListeners]) listener(data['message']);
    } else if (data['k'] === 'bye') {
      closed = true;
      for (const entry of [...pending.values()]) entry.settle(null);
      for (const listener of [...closedListeners]) {
        closedListeners.delete(listener);
        queueMicrotask(listener);
      }
    } else if (
      (data['k'] === 'response' || data['k'] === 'session') &&
      typeof data['id'] === 'number'
    ) {
      pending.get(data['id'])?.settle(data as unknown as ContentToPanel);
    }
  }

  function connect(): void {
    env.addMessageListener((event) => {
      /* Cheap, synchronous filters only; nothing here waits on another candidate. */
      if (port !== null || event.source !== env.parent) return;
      const data = event.data;
      if (!isRecord(data) || data['savdo'] !== HANDSHAKE_TAG) return;
      const nonce = data['nonce'];
      const received = event.ports[0];
      if (!isValidNonce(nonce) || received === undefined) return;
      candidates.push({ nonce, port: received });
      void drain();
    });
  }

  /** Verify queued candidates in batches until one wins; close every loser's port. */
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (candidates.length > 0 && port === null) {
        const batch = candidates.splice(0, BATCH);
        /* A repeated nonce is the same capability: the first port keeps it. */
        const seen = new Set<string>();
        const distinct = batch.filter((entry) => {
          if (seen.has(entry.nonce)) {
            entry.port.close();
            return false;
          }
          seen.add(entry.nonce);
          return true;
        });

        let winner: string | null = null;
        try {
          winner = await env.consumeFirstNonce(distinct.map((entry) => entry.nonce));
        } catch {
          winner = null;
        }

        for (const entry of distinct) {
          if (winner !== null && entry.nonce === winner && port === null) accept(entry.port);
          else entry.port.close();
        }
      }
      /* Accepted: everything still queued is moot. */
      for (const entry of candidates.splice(0)) entry.port.close();
    } finally {
      draining = false;
      for (const wake of [...readyWaiters]) wake();
    }
  }

  function accept(received: MessagePort): void {
    port = received;
    received.onmessage = onPortMessage;
    /* Tells the content side its handshake did not go nowhere. */
    received.postMessage({ k: 'ready' } satisfies PanelToContent);
    for (const wake of [...readyWaiters]) wake();
    for (const listener of [...connectedListeners]) {
      connectedListeners.delete(listener);
      queueMicrotask(listener);
    }
  }

  /** A verification is queued or in flight: the wait must not give up on it. */
  function busy(): boolean {
    return draining || candidates.length > 0;
  }

  /**
   * Resolves true once a verified handshake has been accepted; false when the
   * wait ran out. A verification already in flight at the deadline is awaited
   * rather than cut off, so a slow storage read does not read as "no bridge".
   */
  function whenConnected(signal?: AbortSignal): Promise<boolean> {
    if (port !== null) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      let expired = false;
      const done = (): void => {
        clearTimeout(timer);
        readyWaiters.delete(wake);
        signal?.removeEventListener('abort', onAbort);
      };
      const wake = (): void => {
        if (port !== null) {
          done();
          resolve(true);
        } else if (expired && !busy()) {
          done();
          resolve(false);
        }
      };
      const onAbort = (): void => {
        done();
        reject(new ApiError('Request cancelled', { kind: 'cancelled', code: 'ERR_CANCELED' }));
      };
      const timer = setTimeout(() => {
        expired = true;
        if (!busy()) {
          done();
          resolve(false);
        }
        /* else: the verification ends in `wake` (accepted) or in the `drain` epilogue. */
      }, handshakeWaitMs);
      readyWaiters.add(wake);
      if (signal?.aborted === true) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Once, on a verified handshake; right away (still async) if it already happened. */
  function onConnected(listener: () => void): () => void {
    let live = true;
    const once = (): void => {
      if (live) {
        live = false;
        listener();
      }
    };
    if (port !== null) queueMicrotask(once);
    else connectedListeners.add(once);
    return () => {
      live = false;
      connectedListeners.delete(once);
    };
  }

  /** Once, when the content side said goodbye; right away (still async) if it already did. */
  function onClosed(listener: () => void): () => void {
    let live = true;
    const once = (): void => {
      if (live) {
        live = false;
        listener();
      }
    };
    if (closed) queueMicrotask(once);
    else closedListeners.add(once);
    return () => {
      live = false;
      closedListeners.delete(once);
    };
  }

  async function whenReady(signal: AbortSignal | undefined): Promise<MessagePort> {
    if (closed) throw closedError();
    if (!(await whenConnected(signal)) || port === null) throw unconfigured();
    return port;
  }

  /** One round trip: post, wait for the reply with the same id, give up on abort or timeout. */
  async function call(
    build: (id: number) => PanelToContent,
    signal: AbortSignal | undefined,
    waitMs: number | null,
  ): Promise<ContentToPanel> {
    const target = await whenReady(signal);
    if (closed) throw closedError();
    const id = nextId++;

    return new Promise<ContentToPanel>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        target.postMessage({ k: 'abort', id } satisfies PanelToContent);
        reject(new ApiError('Request cancelled', { kind: 'cancelled', code: 'ERR_CANCELED' }));
      };
      pending.set(id, {
        settle(message) {
          cleanup();
          if (message === null) reject(closedError());
          else resolve(message);
        },
      });
      if (waitMs !== null) {
        timer = setTimeout(() => {
          cleanup();
          target.postMessage({ k: 'abort', id } satisfies PanelToContent);
          reject(new ApiError('The cabinet bridge did not answer in time.', { kind: 'timeout' }));
        }, waitMs);
      }
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      target.postMessage(build(id));
    });
  }

  async function getSellerSession(signal?: AbortSignal): Promise<SellerSession> {
    const reply = await call((id) => ({ k: 'session', id }), signal, SESSION_WAIT_MS);
    if (reply.k !== 'session') throw unconfigured();
    return reply.session;
  }

  async function uzumRequest<R extends UzumRouteId>(
    route: R,
    params: UzumRouteParams<R>,
    signal?: AbortSignal,
  ): Promise<UzumResponse> {
    const spec = UZUM_ROUTES[route];
    /* The queue on the other side can hold for minutes after a 429, and the
       content side has its own timeout; the caller's signal is the bound here. */
    const reply = await call(
      (id) => ({ k: 'request', id, route, method: spec.method, params }),
      signal,
      null,
    );
    const result = reply.k === 'response' ? parseResult(reply.result) : null;
    if (result === null) throw new ApiError('Malformed bridge reply.', { kind: 'server' });
    if (!result.ok) throw toApiError(result);

    return {
      status: result.status,
      data: result.data,
      shopId: shopOfRoute(route, params),
      route: spec.source,
    };
  }

  function sendToFrame(message: AppMessage): void {
    port?.postMessage({ k: 'app', message } satisfies PanelToContent);
  }

  function onFrameMessage(listener: (message: AppMessage) => void): () => void {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  }

  return {
    connect,
    whenConnected,
    onConnected,
    onClosed,
    getSellerSession,
    uzumRequest,
    sendToFrame,
    onFrameMessage,
  };
}

let shared: ReturnType<typeof createBridgeClient> | null = null;

function instance(): ReturnType<typeof createBridgeClient> {
  shared ??= createBridgeClient({
    parent: window.parent === window ? null : window.parent,
    consumeFirstNonce: (nonces) => consumeFirstFrameNonce(nonces),
    addMessageListener: (listener) => window.addEventListener('message', listener),
  });
  return shared;
}

/** Once, at panel startup; waits for the handshake. */
export function connectBridge(): void {
  instance().connect();
}

/**
 * True once a verified handshake has been accepted, false when the wait ran out
 * (panel opened outside the cabinet frame, or a frame the content script did not
 * start). The panel renders its interactive app only after `true`.
 */
export function whenBridgeConnected(signal?: AbortSignal): Promise<boolean> {
  return instance().whenConnected(signal);
}

/**
 * Calls `listener` exactly once, when a verified handshake has been accepted —
 * asynchronously right away if that already happened. Never fires for a
 * candidate that failed verification. Returns an unsubscribe. The message
 * listener installed by `connectBridge` stays active after `whenBridgeConnected`
 * gave up, so a handshake that lands late still fires this.
 */
export function onBridgeConnected(listener: () => void): () => void {
  return instance().onConnected(listener);
}

/**
 * Once, when the content side said goodbye; asynchronously right away if that
 * already happened. Calls made after that reject with `BRIDGE_CLOSED_CODE`.
 */
export function onBridgeClosed(listener: () => void): () => void {
  return instance().onClosed(listener);
}

export function getSellerSession(signal?: AbortSignal): Promise<SellerSession> {
  return instance().getSellerSession(signal);
}

export function uzumRequest<R extends UzumRouteId>(
  route: R,
  params: UzumRouteParams<R>,
  signal?: AbortSignal,
): Promise<UzumResponse> {
  return instance().uzumRequest(route, params, signal);
}

export function sendToFrame(message: AppMessage): void {
  instance().sendToFrame(message);
}

export function onFrameMessage(listener: (message: AppMessage) => void): () => void {
  return instance().onFrameMessage(listener);
}
