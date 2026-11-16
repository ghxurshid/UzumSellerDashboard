/**
 * The content-script half of the bridge: the only place the seller's token is
 * ever held, and the only place a cabinet request is made.
 *
 * The request runs in the page (Firefox: the page-context `content.fetch` when
 * it exists) so it leaves like the cabinet's own — page origin, the server's
 * existing CORS, no cookies. The token is read from `localStorage` at the
 * moment of each request, attached only to a URL built from the closed route
 * table on the API origin, and never stored, logged, echoed in an error or
 * sent over the port.
 *
 * CORS, as far as one recorded response shows: that response (`products.list`,
 * request B) allowed the cabinet origin, credentials, GET, and request headers
 * including `authorization`, which is consistent with the request sent below
 * (`accept` + `authorization`, no cookies). The preflight has one sample too,
 * sent by hand without a token: asked for `authorization` alone — which is what
 * Chrome and Edge ask for this request — the server allowed the cabinet origin,
 * GET and that header. The GET itself has never been sent from here with a real
 * token, and the recorded response carried no `X-RateLimit-*` or `Retry-After`
 * header (see `queue.ts`).
 *
 * ## Starting the frame
 *
 * The frame's URL carries no secret. The caller makes a nonce, awaits
 * `registerFrameNonce(nonce)` (extension storage, which page scripts cannot
 * write), only then gives the iframe its `src`, and after its `load` calls
 * `attachBridge(frame, nonce)`. The nonce exists in this script's memory, in
 * extension storage and in the one handshake message below, addressed to the
 * extension origin only; the panel accepts a handshake only when storage vouches
 * for the nonce and consumes it (see `protocol.ts` for the full scheme and its
 * limits). The panel answers an accepted handshake with `ready`, and
 * `FrameBridge.whenReady` reports it, so a handshake that went nowhere (frame
 * navigated away during load, verification failed) is noticed instead of assumed.
 *
 *  * Imports are limited to sibling dependency-free modules: this ships as one
 * small classic script (no zod, axios, react, `@core/ui`).
 */
import {
  type AppMessage,
  type ContentToPanel,
  HANDSHAKE_TAG,
  type HandshakeMessage,
  isAppMessage,
  isRecord,
  type WireFailure,
  type WireFailureKind,
  type WireResult,
} from './protocol';
import { registerFrameNonce } from './protocol';
import { QueueCancelled, SerialQueue } from './queue';
import { isRouteId, toApiUrl, UZUM_ROUTES } from './routes';
import { readCabinetState, type SellerSession } from './session';

/* The caller awaits this before it gives the iframe its `src`, so the panel can
   prove the content script started the frame (the store lives in `protocol.ts`). */
export { registerFrameNonce };

export interface FrameBridge {
  send(message: AppMessage): void;
  onMessage(listener: (message: AppMessage) => void): () => void;
  /**
   * True when the panel confirmed over the port that it accepted this handshake;
   * false when `timeoutMs` passed or the bridge was disposed first.
   */
  whenReady(timeoutMs: number): Promise<boolean>;
  dispose(): void;
}

export const REQUEST_TIMEOUT_MS = 30_000;
export const REQUEST_GAP_MS = 400;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CabinetServiceDeps {
  readonly storage: { getItem(key: string): string | null };
  readonly pathname: () => string;
  readonly fetch: FetchLike;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly gapMs?: number;
  readonly timeoutMs?: number;
}

function failure(
  kind: WireFailureKind,
  message: string,
  extra: Partial<Omit<WireFailure, 'ok' | 'kind' | 'message'>> = {},
): WireFailure {
  return { ok: false, kind, message, ...extra };
}

function classify(status: number): WireFailureKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  return status >= 500 ? 'server' : 'client';
}

/** Retry-After in ms, delta-seconds or HTTP-date; a local copy because core's reader imports axios. */
export function parseRetryAfter(raw: string | null, now: number): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1_000 : undefined;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > now ? at - now : undefined;
}

/** Everything the bridge does, with the browser handed in so it can run under test. */
export function createCabinetService(deps: CabinetServiceDeps) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const queue = new SerialQueue({
    gapMs: deps.gapMs ?? REQUEST_GAP_MS,
    now,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });

  function session(): SellerSession {
    return readCabinetState(deps.storage, deps.pathname()).session;
  }

  async function perform(url: string, signal: AbortSignal): Promise<WireResult> {
    /* Read at the last moment: a token the cabinet refreshed while we queued is used. */
    const { token } = readCabinetState(deps.storage, deps.pathname());
    if (token === null) return failure('unauthorized', 'The seller is not signed in to the cabinet.');

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const controller = new AbortController();
    const relay = (): void => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', relay, { once: true });

    try {
      const response = await deps.fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        credentials: 'omit',
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryAfterMs =
          response.status === 429
            ? parseRetryAfter(response.headers.get('retry-after'), now())
            : undefined;
        queue.noteOutcome(response.status === 429, retryAfterMs);
        const kind = classify(response.status);
        /* The body is deliberately not quoted: it is not ours to forward to a model unread. */
        return failure(kind, `The cabinet API answered HTTP ${response.status}.`, {
          status: response.status,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
      }
      queue.noteOutcome(false);

      const text = await response.text();
      try {
        return { ok: true, status: response.status, data: JSON.parse(text) as unknown };
      } catch {
        return failure('server', 'The cabinet API answered with a body that is not JSON.', {
          status: response.status,
        });
      }
    } catch {
      if (timedOut) return failure('timeout', 'The cabinet API did not answer in time.');
      if (signal.aborted) return failure('cancelled', 'Request cancelled.');
      /* The thrown error is dropped: its text can include the URL and says nothing useful. */
      return failure('network', 'The cabinet API could not be reached.');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', relay);
    }
  }

  async function handleRequest(raw: {
    route: unknown;
    method: unknown;
    params: unknown;
  }, signal: AbortSignal): Promise<WireResult> {
    if (!isRouteId(raw.route)) return failure('client', 'Unknown cabinet route.');
    const spec = UZUM_ROUTES[raw.route];
    if (raw.method !== spec.method) return failure('client', `Route only allows ${spec.method}.`);

    const checked = spec.parse(raw.params);
    if (!checked.ok) return failure('client', `Invalid params: ${checked.reason}.`);
    const params = checked.value as never;
    const shopId = spec.shopOf(params);

    const current = readCabinetState(deps.storage, deps.pathname());
    if (current.token === null) {
      return failure('unauthorized', 'The seller is not signed in to the cabinet.');
    }
    const granted = current.session.permissions[shopId];
    if (granted === undefined) {
      return failure('forbidden', `Shop ${shopId} is not among the seller's shops.`);
    }
    if (!granted.includes(spec.permission)) {
      return failure('forbidden', `The seller lacks ${spec.permission} on shop ${shopId}.`);
    }

    const url = toApiUrl(spec.target(params));
    if (url === null) return failure('client', 'Route target left the API origin.');

    try {
      return await queue.enqueue(signal, (s) => perform(url, s));
    } catch (error) {
      if (error instanceof QueueCancelled) return failure('cancelled', 'Request cancelled.');
      return failure('network', 'The cabinet request failed.');
    }
  }

  return { session, handleRequest };
}

/**
 * Try each way of making the request in order; remember the first one that
 * worked after an earlier one threw, and use it from then on.
 *
 * Why: in Firefox `content.fetch` is handed an object built in the content-script
 * compartment, and if the engine refuses it across the Xray boundary the call
 * throws exactly like a dead network. That cannot be told apart from a real
 * outage without a browser, so a throw is answered with the next way once; if
 * that one gets any HTTP answer the first is dropped for the rest of the page,
 * and if every way throws it is a network failure. Our own cancel and timeout
 * are never retried. The cost of the guess is one repeated GET during a real
 * outage.
 */
export function withFallback(candidates: readonly FetchLike[]): FetchLike {
  let first = 0;
  return async (url, init) => {
    let lastError: unknown = new Error('no fetch available');
    for (let i = first; i < candidates.length; i += 1) {
      const attempt = candidates[i];
      if (attempt === undefined) continue;
      try {
        const response = await attempt(url, init);
        first = i;
        return response;
      } catch (error) {
        if (init.signal?.aborted === true) throw error;
        lastError = error;
      }
    }
    throw lastError;
  };
}

type Cloner = (value: unknown, target: unknown, options?: unknown) => unknown;

function pageFetch(): FetchLike {
  const g = globalThis as unknown as {
    content?: { fetch?: FetchLike };
    cloneInto?: Cloner;
  };
  const candidates: FetchLike[] = [];
  const page = g.content;
  if (typeof page?.fetch === 'function') {
    const fetchAsPage = page.fetch.bind(page);
    candidates.push((url, init) => {
      /* Firefox: hand the page compartment its own copy of `init`; `wrapReflectors`
         lets the AbortSignal cross so cancelling still reaches the request. */
      const cloned =
        typeof g.cloneInto === 'function'
          ? (g.cloneInto(init, page, { cloneFunctions: true, wrapReflectors: true }) as RequestInit)
          : init;
      return fetchAsPage(url, cloned);
    });
  }
  /* In MV3 Firefox and in Chromium the content script's own `fetch` is subject to
     the page's origin and CORS, so it is a faithful second choice. */
  candidates.push((url, init) => globalThis.fetch(url, init));
  return withFallback(candidates);
}

/**
 * Hand the iframe one end of a private channel and serve it. Call after the
 * iframe's load event, with the nonce that is in its URL hash.
 */
export function attachBridge(frame: HTMLIFrameElement, nonce: string): FrameBridge {
  const service = createCabinetService({
    storage: window.localStorage,
    pathname: () => window.location.pathname,
    fetch: pageFetch(),
  });
  const channel = new MessageChannel();
  const port = channel.port1;
  const controllers = new Map<number, AbortController>();
  const listeners = new Set<(message: AppMessage) => void>();
  let disposed = false;
  let confirmed = false;
  const readyWaiters = new Set<(value: boolean) => void>();

  const post = (message: ContentToPanel): void => {
    if (!disposed) port.postMessage(message);
  };

  port.onmessage = (event: MessageEvent<unknown>): void => {
    const data = event.data;
    if (!isRecord(data) || typeof data['k'] !== 'string') return;
    const id = data['id'];

    if (data['k'] === 'ready') {
      confirmed = true;
      for (const resolve of [...readyWaiters]) resolve(true);
    } else if (data['k'] === 'app') {
      if (!isAppMessage(data['message'])) return;
      for (const listener of [...listeners]) listener(data['message']);
    } else if (data['k'] === 'session' && typeof id === 'number') {
      post({ k: 'session', id, session: service.session() });
    } else if (data['k'] === 'abort' && typeof id === 'number') {
      controllers.get(id)?.abort();
    } else if (data['k'] === 'request' && typeof id === 'number') {
      const controller = new AbortController();
      controllers.set(id, controller);
      void service
        .handleRequest(
          { route: data['route'], method: data['method'], params: data['params'] },
          controller.signal,
        )
        .then((result) => post({ k: 'response', id, result }))
        .finally(() => controllers.delete(id));
    }
  };

  /* The target origin is the extension's own, taken from the iframe URL, so the
     port goes nowhere else even if the frame is navigated away. */
  const handshake: HandshakeMessage = { savdo: HANDSHAKE_TAG, nonce };
  const framed = new URL(frame.src);
  /* Not `URL.origin`: it is the string "null" for extension schemes in some engines,
     and "null" is not a usable target origin. Protocol plus host is exact. */
  const targetOrigin = `${framed.protocol}//${framed.host}`;
  frame.contentWindow?.postMessage(handshake, targetOrigin, [channel.port2]);

  return {
    send: (message) => post({ k: 'app', message }),
    whenReady(timeoutMs) {
      if (confirmed) return Promise.resolve(true);
      if (disposed) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const settle = (value: boolean): void => {
          clearTimeout(timer);
          readyWaiters.delete(settle);
          resolve(value);
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        readyWaiters.add(settle);
      });
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      post({ k: 'bye' });
      disposed = true;
      for (const resolve of [...readyWaiters]) resolve(false);
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      listeners.clear();
      port.close();
    },
  };
}
