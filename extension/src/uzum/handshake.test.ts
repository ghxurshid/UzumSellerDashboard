import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createBridgeClient, type PanelEnv } from './client';
import {
  BRIDGE_INDEX_KEY,
  consumeFirstFrameNonce,
  consumeFrameNonce,
  NONCE_LIFETIME_MS,
  type NonceStorageArea,
  registerFrameNonce,
} from './protocol';

const NONCE = 'abcdef0123456789abcdef0123456789';
const bogus = (i: number): string => `f${String(i).padStart(31, '0')}`;

type Area = NonceStorageArea & { data: Map<string, unknown>; gets: number };

function memoryArea(): Area {
  const data = new Map<string, unknown>();
  const area: Area = {
    data,
    gets: 0,
    get: async (keys) => {
      area.gets += 1;
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
  return area;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake panel window: the parent and the handshake listener. No URL, no hash. */
function panel(area: NonceStorageArea | null, clock: () => number = Date.now) {
  const parent = {};
  let listener: ((event: MessageEvent<unknown>) => void) | undefined;
  const env: PanelEnv = {
    parent,
    consumeFirstNonce: (nonces) => consumeFirstFrameNonce(nonces, { area: () => area, now: clock }),
    addMessageListener: (l) => (listener = l),
  };
  const client = createBridgeClient(env, 50);
  client.connect();
  const channels: MessageChannel[] = [];
  const ready: MessageChannel[] = [];
  const deliver = (nonce: unknown = NONCE, source: unknown = parent): MessageChannel => {
    const channel = new MessageChannel();
    channels.push(channel);
    channel.port1.onmessage = (e) => {
      if ((e.data as { k?: string }).k === 'ready') ready.push(channel);
    };
    listener?.({
      source,
      data: { savdo: 'savdo-copilot/bridge-handshake', nonce },
      ports: [channel.port2],
    } as unknown as MessageEvent<unknown>);
    return channel;
  };
  return { client, deliver, ready, close: () => channels.forEach((c) => c.port1.close()) };
}

describe('nonce store', () => {
  it('registers, then the panel consumes exactly once', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    expect(await consumeFrameNonce(NONCE, { area: () => area })).toBe(true);
    expect(await consumeFrameNonce(NONCE, { area: () => area })).toBe(false);
  });

  it('refuses an expired nonce and drops it', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area, now: () => 1_000 });
    const late = () => 1_000 + NONCE_LIFETIME_MS + 1;
    expect(await consumeFrameNonce(NONCE, { area: () => area, now: late })).toBe(false);
    expect(await consumeFrameNonce(NONCE, { area: () => area, now: () => 1_001 })).toBe(false);
  });

  it('a batch picks the first fresh registered nonce and reads storage once', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    area.gets = 0;
    const winner = await consumeFirstFrameNonce([bogus(1), bogus(2), NONCE, bogus(3)], { area: () => area });
    expect(winner).toBe(NONCE);
    expect(area.gets).toBe(1);
  });

  it('prunes registrations past the lifetime', async () => {
    const area = memoryArea();
    await registerFrameNonce('oldnonce0000', { area: () => area, now: () => 0 });
    await registerFrameNonce(NONCE, { area: () => area, now: () => NONCE_LIFETIME_MS + 5 });
    expect([...area.data.keys()].some((k) => k.endsWith('oldnonce0000'))).toBe(false);
    expect(Object.keys(area.data.get(BRIDGE_INDEX_KEY) as object)).toEqual([NONCE]);
  });

  it('rejects registration when storage is unavailable, fails, or the nonce is unusable', async () => {
    await expect(registerFrameNonce(NONCE, { area: () => null })).rejects.toThrow();
    const broken: NonceStorageArea = {
      get: async () => {
        throw new Error('Extension context invalidated.');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    await expect(registerFrameNonce(NONCE, { area: () => broken })).rejects.toThrow();
    await expect(registerFrameNonce('../x', { area: () => memoryArea() })).rejects.toThrow();
  });

  it('does not accept when the storage read fails or storage is missing', async () => {
    const broken: NonceStorageArea = {
      get: async () => {
        throw new Error('boom');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    expect(await consumeFrameNonce(NONCE, { area: () => broken })).toBe(false);
    expect(await consumeFrameNonce(NONCE, { area: () => null })).toBe(false);
  });
});

describe('panel handshake against a page-started frame', () => {
  it('accepts the real frame and confirms with ready over the port', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    const p = panel(area);
    const real = p.deliver();
    expect(await p.client.whenConnected()).toBe(true);
    await sleep(5);
    expect(p.ready).toEqual([real]);
    p.close();
  });

  it('ignores a page-made frame with any nonce: well-formed, malformed, guessed', async () => {
    const area = memoryArea();
    const p = panel(area);
    for (const nonce of [NONCE, bogus(7), '', 'x', 42, null, '../../etc', 'a'.repeat(500)]) p.deliver(nonce);
    expect(await p.client.whenConnected()).toBe(false);
    await expect(p.client.getSellerSession()).rejects.toMatchObject({ kind: 'unconfigured' });
    expect(p.ready).toEqual([]);
    p.close();
  });

  it('ignores a replay of a consumed nonce (second panel document)', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    const first = panel(area);
    first.deliver();
    expect(await first.client.whenConnected()).toBe(true);
    const replay = panel(area);
    replay.deliver();
    expect(await replay.client.whenConnected()).toBe(false);
    first.close();
    replay.close();
  });

  it('ignores an expired nonce', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area, now: () => 0 });
    const p = panel(area, () => NONCE_LIFETIME_MS + 10);
    p.deliver();
    expect(await p.client.whenConnected()).toBe(false);
    p.close();
  });

  it('a storage failure accepts nothing, and a later genuine handshake is still accepted', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    let failing = true;
    const flaky: NonceStorageArea = {
      get: async (keys) => {
        if (failing) throw new Error('boom');
        return area.get(keys);
      },
      set: area.set,
      remove: area.remove,
    };
    const p = panel(flaky);
    p.deliver();
    await sleep(10);
    expect(p.ready).toEqual([]);
    failing = false;
    p.deliver();
    expect(await p.client.whenConnected()).toBe(true);
    p.close();
  });

  it('flood before the genuine handshake: genuine accepted once, storage reads stay batched', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    area.gets = 0;
    const slow: NonceStorageArea = {
      get: async (keys) => {
        await sleep(5);
        return area.get(keys);
      },
      set: area.set,
      remove: area.remove,
    };
    const p = panel(slow);
    for (let i = 0; i < 500; i += 1) p.deliver(bogus(i));
    const real = p.deliver();
    expect(await p.client.whenConnected()).toBe(true);
    await sleep(10);
    expect(p.ready).toEqual([real]);
    /* 501 candidates, batches of 64: nowhere near one read per candidate. */
    expect(area.gets).toBeLessThanOrEqual(10);
    p.close();
  });

  it('flood during and after the genuine handshake: still exactly one acceptance', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    const slow: NonceStorageArea = {
      get: async (keys) => {
        await sleep(10);
        return area.get(keys);
      },
      set: area.set,
      remove: area.remove,
    };
    const p = panel(slow);
    p.deliver(bogus(1));
    await sleep(2); // first batch is now in flight
    for (let i = 2; i < 80; i += 1) p.deliver(bogus(i));
    const real = p.deliver();
    for (let i = 100; i < 160; i += 1) p.deliver(bogus(i));
    expect(await p.client.whenConnected()).toBe(true);
    for (let i = 200; i < 260; i += 1) p.deliver(bogus(i));
    p.deliver(NONCE); // a duplicate of the consumed nonce, after the fact
    await sleep(30);
    expect(p.ready).toEqual([real]);
    p.close();
  });

  it('a duplicate of the genuine nonce in the same batch cannot produce a second acceptance', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    const p = panel(area);
    const first = p.deliver();
    p.deliver();
    expect(await p.client.whenConnected()).toBe(true);
    await sleep(10);
    expect(p.ready).toEqual([first]);
    p.close();
  });

  it('never connects when there is no extension storage (dev server)', async () => {
    const p = panel(null);
    p.deliver();
    expect(await p.client.whenConnected()).toBe(false);
    await expect(p.client.getSellerSession()).rejects.toMatchObject({ kind: 'unconfigured' });
    p.close();
  });

  it('ignores a handshake from a window that is not the parent, without consuming the nonce', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    const p = panel(area);
    p.deliver(NONCE, {});
    expect(await p.client.whenConnected()).toBe(false);
    expect(area.data.has(`savdo.bridge.n.${NONCE}`)).toBe(true);
    p.close();
  });

  it('no code path of the panel side reads the URL any more', () => {
    for (const file of ['./client.ts', './protocol.ts']) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(text, file).not.toMatch(/location|\bhash\b|href|URLSearchParams|document\./);
    }
  });
});

describe('onConnected', () => {
  it('fires once for a handshake that lands after the wait gave up, even if subscribed before connect', async () => {
    const area = memoryArea();
    const p = panel(area);
    let calls = 0;
    p.client.onConnected(() => (calls += 1));
    expect(await p.client.whenConnected()).toBe(false);
    await registerFrameNonce(NONCE, { area: () => area });
    p.deliver();
    await sleep(10);
    expect(calls).toBe(1);
    p.deliver();
    await sleep(10);
    expect(calls).toBe(1);
    p.close();
  });

  it('fires asynchronously right away when already connected, and not for a failed candidate', async () => {
    const area = memoryArea();
    const failed = panel(area);
    let failedCalls = 0;
    failed.client.onConnected(() => (failedCalls += 1));
    failed.deliver();
    await sleep(10);
    expect(failedCalls).toBe(0);
    failed.close();

    await registerFrameNonce(NONCE, { area: () => area });
    const p = panel(area);
    p.deliver();
    expect(await p.client.whenConnected()).toBe(true);
    let late = 0;
    p.client.onConnected(() => (late += 1));
    expect(late).toBe(0);
    await sleep(5);
    expect(late).toBe(1);
    p.close();
  });

  it('does not call after unsubscribe', async () => {
    const area = memoryArea();
    await registerFrameNonce(NONCE, { area: () => area });
    const p = panel(area);
    let calls = 0;
    const off = p.client.onConnected(() => (calls += 1));
    off();
    p.deliver();
    await p.client.whenConnected();
    await sleep(5);
    expect(calls).toBe(0);
    p.close();
  });
});
