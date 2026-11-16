import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@core/errors/apiError';

import {
  attachBridge,
  createCabinetService,
  type FrameBridge,
  parseRetryAfter,
  withFallback,
} from './bridge.content';
import { createBridgeClient } from './client';
import { consumeFirstFrameNonce, type NonceStorageArea, registerFrameNonce } from './protocol';

const TOKEN = 'tok-INVENTED-123';
const NONCE = 'nonce-abc';
const state = JSON.stringify({
  user: {
    tokens: { access: TOKEN, refresh: 'ref-INVENTED' },
    permissions: { '1001': ['PRODUCT_READ'], '2002': ['FINANCE_READ'] },
    sellerId: 88,
    accountId: 77,
  },
});

interface Call {
  url: string;
  init: RequestInit;
}

function response(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function service(handler: (call: Call) => Promise<Response>, stored: string | null = state) {
  const calls: Call[] = [];
  const svc = createCabinetService({
    storage: { getItem: () => stored },
    pathname: () => '/',
    fetch: (url, init) => {
      calls.push({ url, init });
      return handler({ url, init });
    },
    gapMs: 0,
    sleep: async () => undefined,
  });
  return { svc, calls };
}

function memoryArea(): NonceStorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (keys) => {
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]));
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys) => {
      for (const k of typeof keys === 'string' ? [keys] : keys) data.delete(k);
    },
  };
}

const good = { route: 'products.list', method: 'GET', params: { shopId: 1001, page: 0, size: 5 } };
const live = new AbortController().signal;

describe('content side: validation before any request', () => {
  it('refuses unknown routes, other methods and bad params without fetching', async () => {
    const { svc, calls } = service(async () => response(200, '{}'));
    const cases = [
      { ...good, route: 'nope' },
      { ...good, method: 'POST' },
      { ...good, params: { shopId: 1001, page: 0, size: 500 } },
      { ...good, params: { shopId: 'x', page: 0, size: 5 } },
    ];
    for (const input of cases) {
      expect(await svc.handleRequest(input, live)).toMatchObject({ ok: false, kind: 'client' });
    }
    expect(calls).toHaveLength(0);
  });

  it('reports a shop outside the session and a missing permission as forbidden, unfetched', async () => {
    const { svc, calls } = service(async () => response(200, '{}'));
    const outside = await svc.handleRequest({ ...good, params: { shopId: 5, page: 0, size: 5 } }, live);
    const noPerm = await svc.handleRequest({ ...good, params: { shopId: 2002, page: 0, size: 5 } }, live);
    expect(outside).toMatchObject({ ok: false, kind: 'forbidden' });
    expect(noPerm).toMatchObject({ ok: false, kind: 'forbidden' });
    expect(calls).toHaveLength(0);
  });

  it('reports no token as unauthorized, unfetched', async () => {
    const { svc, calls } = service(async () => response(200, '{}'), null);
    expect(await svc.handleRequest(good, live)).toMatchObject({ ok: false, kind: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });
});

describe('content side: the request itself', () => {
  it('sends a Bearer GET without credentials to the API origin and returns parsed JSON', async () => {
    const { svc, calls } = service(async () => response(200, '{"anything":[1]}'));
    const result = await svc.handleRequest(good, live);
    expect(result).toEqual({ ok: true, status: 200, data: { anything: [1] } });
    const call = calls[0];
    expect(call?.url).toBe(
      'https://api-seller.uzum.uz/api/seller/shop/1001/product/getProducts?page=0&size=5&filter=ALL&sortBy=id&searchQuery=&order=descending',
    );
    expect(call?.init.method).toBe('GET');
    expect(call?.init.credentials).toBe('omit');
    expect(call?.init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  });

  it('classifies statuses and never quotes the body or the token', async () => {
    const table: Array<[number, string]> = [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'notFound'],
      [429, 'rateLimited'],
      [500, 'server'],
      [400, 'client'],
    ];
    for (const [status, kind] of table) {
      const { svc } = service(async () => response(status, `echo ${TOKEN}`, { 'retry-after': '3' }));
      const result = await svc.handleRequest(good, live);
      expect(result).toMatchObject({ ok: false, kind, status });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it('carries Retry-After on a 429', async () => {
    const { svc } = service(async () => response(429, '', { 'retry-after': '3' }));
    expect(await svc.handleRequest(good, live)).toMatchObject({ kind: 'rateLimited', retryAfterMs: 3_000 });
  });

  it('maps a thrown fetch to network without leaking the thrown text', async () => {
    const { svc } = service(async () => {
      throw new TypeError(`failed to fetch with ${TOKEN}`);
    });
    const result = await svc.handleRequest(good, live);
    expect(result).toMatchObject({ ok: false, kind: 'network' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('maps a non-JSON success body to server', async () => {
    const { svc } = service(async () => response(200, '<html>'));
    expect(await svc.handleRequest(good, live)).toMatchObject({ ok: false, kind: 'server' });
  });

  it('cancels a request that is in flight', async () => {
    const controller = new AbortController();
    const { svc } = service(
      (call) =>
        new Promise((_, reject) => {
          call.init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    const pending = svc.handleRequest(good, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, kind: 'cancelled' });
  });

  it('times out', async () => {
    const svc = createCabinetService({
      storage: { getItem: () => state },
      pathname: () => '/',
      fetch: (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
      timeoutMs: 20,
      gapMs: 0,
      sleep: async () => undefined,
    });
    expect(await svc.handleRequest(good, live)).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('parses both Retry-After shapes', () => {
    expect(parseRetryAfter('2', 0)).toBe(2_000);
    expect(parseRetryAfter(new Date(5_000).toUTCString(), 1_000)).toBe(4_000);
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});

/* End to end over a real MessageChannel, with a fake page and frame. */
describe('handshake and request/response over the private port', () => {
  let bridge: FrameBridge | undefined;
  let fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  const seen: unknown[] = [];

  /** The panel's message listener, as a fake window would hold it. */
  async function mount(handshakeNonce = NONCE, source: 'parent' | 'other' = 'parent') {
    const parent = {};
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    let listener: ((event: MessageEvent<unknown>) => void) | undefined;
    const client = createBridgeClient(
      {
        parent,
        consumeFirstNonce: (n) => consumeFirstFrameNonce(n, { area: () => area }),
        addMessageListener: (l) => (listener = l),
      },
      60,
    );
    client.connect();

    vi.stubGlobal('window', {
      localStorage: { getItem: () => state },
      location: { pathname: '/' },
    });
    vi.stubGlobal('MessageChannel', MessageChannel);
    const frame = {
      src: 'chrome-extension://abcdef/panel.html?r=1',
      contentWindow: {
        postMessage: (data: unknown, origin: string, ports: MessagePort[]) => {
          seen.push({ origin });
          listener?.({
            source: source === 'parent' ? parent : {},
            data,
            ports,
          } as unknown as MessageEvent<unknown>);
        },
      },
    } as unknown as HTMLIFrameElement;
    bridge = attachBridge(frame, handshakeNonce);
    return client;
  }

  beforeEach(() => {
    seen.length = 0;
    fetchImpl = async () => response(200, '{"items":[]}');
    vi.stubGlobal('content', { fetch: (url: string, init: RequestInit) => fetchImpl(url, init) });
  });

  afterEach(() => {
    bridge?.dispose();
    bridge = undefined;
    vi.unstubAllGlobals();
  });

  it('serves a request, tags the shop from the call, and sends the handshake only to the extension origin', async () => {
    const client = await mount();
    const result = await client.uzumRequest('products.list', { shopId: 1001, page: 0, size: 5 });
    expect(result).toEqual({
      status: 200,
      data: { items: [] },
      shopId: 1001,
      route: 'GET /api/seller/shop/{shopId}/product/getProducts',
    });
    expect(seen[0]).toEqual({ origin: 'chrome-extension://abcdef' });
  });

  it('turns failures into ApiError with the right kind', async () => {
    fetchImpl = async () => response(429, '', { 'retry-after': '1' });
    const client = await mount();
    const error = await client
      .uzumRequest('products.list', { shopId: 1001, page: 0, size: 5 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'rateLimited', retryAfterMs: 1_000, isRetryable: true });

    const denied = await client
      .uzumRequest('products.list', { shopId: 2002, page: 0, size: 5 })
      .catch((e: unknown) => e);
    expect(denied).toMatchObject({ kind: 'forbidden' });
  });

  it('reads the session fresh and never includes the token', async () => {
    const client = await mount();
    const session = await client.getSellerSession();
    expect(session).toMatchObject({ signedIn: true, shopIds: [1001, 2002], sellerId: 88, accountId: 77 });
    expect(JSON.stringify(session)).not.toContain(TOKEN);
  });

  it('rejects a handshake with the wrong nonce: calls fail as unconfigured, not hang', async () => {
    const client = await mount('wrong-nonce');
    await expect(client.getSellerSession()).rejects.toMatchObject({ kind: 'unconfigured' });
  });

  it('rejects a handshake that does not come from the parent window', async () => {
    const client = await mount(NONCE, 'other');
    await expect(
      client.uzumRequest('products.list', { shopId: 1001, page: 0, size: 5 }),
    ).rejects.toMatchObject({ kind: 'unconfigured' });
  });

  it('cancels from the panel: the caller gets cancelled and the fetch is aborted', async () => {
    let aborted = false;
    fetchImpl = (_url, init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('x', 'AbortError'));
        });
      });
    const client = await mount();
    const controller = new AbortController();
    const pending = client
      .uzumRequest('products.list', { shopId: 1001, page: 0, size: 5 }, controller.signal)
      .catch((e: unknown) => e);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'cancelled', isCancelled: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(aborted).toBe(true);
  });

  it('confirms an accepted handshake to the content side', async () => {
    const client = await mount();
    expect(await bridge?.whenReady(500)).toBe(true);
    await client.getSellerSession();
  });

  it('whenReady is false when the handshake goes nowhere, and when disposed first', async () => {
    await mount(NONCE, 'other');
    expect(await bridge?.whenReady(30)).toBe(false);
    const waiting = bridge?.whenReady(5_000);
    bridge?.dispose();
    expect(await waiting).toBe(false);
  });

  it('after bye every call rejects as closed, not unconfigured, and is not retryable', async () => {
    const client = await mount();
    await client.getSellerSession();
    let closedCalls = 0;
    client.onClosed(() => (closedCalls += 1));
    bridge?.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closedCalls).toBe(1);
    const error = await client.getSellerSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'BRIDGE_CLOSED', isRetryable: false });
    expect((error as ApiError).kind).not.toBe('unconfigured');
    let late = 0;
    client.onClosed(() => (late += 1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(late).toBe(1);
  });

  it('passes app messages both ways', async () => {
    const client = await mount();
    const fromPanel: unknown[] = [];
    const fromFrame: unknown[] = [];
    bridge?.onMessage((m) => fromPanel.push(m));
    client.onFrameMessage((m) => fromFrame.push(m));
    await client.getSellerSession();
    client.sendToFrame({ type: 'ping', payload: 1 });
    bridge?.send({ type: 'pong' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fromPanel).toEqual([{ type: 'ping', payload: 1 }]);
    expect(fromFrame).toEqual([{ type: 'pong' }]);
  });
});

describe('fetch fallback order', () => {
  const ok = async () => response(200, '{}');
  const boom = async (): Promise<Response> => {
    throw new TypeError('Permission denied to access property');
  };
  const init = (signal?: AbortSignal): RequestInit => ({ method: 'GET', ...(signal ? { signal } : {}) });

  it('falls through a throwing first way, then sticks to the one that worked', async () => {
    let firstCalls = 0;
    const f = withFallback([
      async () => {
        firstCalls += 1;
        return boom();
      },
      ok,
    ]);
    expect((await f('u', init())).status).toBe(200);
    await f('u', init());
    expect(firstCalls).toBe(1);
  });

  it('throws when every way throws, and does not retry our own abort', async () => {
    await expect(withFallback([boom, boom])('u', init())).rejects.toBeInstanceOf(TypeError);
    const controller = new AbortController();
    controller.abort();
    let second = 0;
    const f = withFallback([
      boom,
      async () => {
        second += 1;
        return response(200, '{}');
      },
    ]);
    await expect(f('u', init(controller.signal))).rejects.toBeInstanceOf(TypeError);
    expect(second).toBe(0);
  });
});
