import { describe, expect, it } from 'vitest';

import { createLoadTracker, MAX_UNEXPECTED_LOADS, UNEXPECTED_WINDOW_MS } from './loadTracker';
import { createNavigator, type NavigatorDeps } from './navigator';

describe('confirmation after attach', () => {
  it('keeps a confirmed panel', () => {
    const t = createLoadTracker();
    t.expectLoad();
    expect(t.onLoad(0)).toBe('expected');
    expect(t.onAck(1, 'confirmed')).toBe('confirmed');
    expect(t.inert).toBe(false);
  });

  it('retries once after a timeout and accepts the next confirmation', () => {
    const t = createLoadTracker();
    t.expectLoad();
    t.onLoad(0);
    expect(t.onAck(5_000, 'timeout')).toBe('unexpected');
    t.expectLoad();
    expect(t.onLoad(5_100)).toBe('expected');
    expect(t.onAck(5_200, 'confirmed')).toBe('confirmed');
  });

  it('goes inert when confirmations keep timing out past the bound', () => {
    const t = createLoadTracker();
    let last = '';
    for (let i = 0; i <= MAX_UNEXPECTED_LOADS; i++) {
      t.expectLoad();
      t.onLoad(i * 100);
      last = t.onAck(i * 100 + 50, 'timeout');
    }
    expect(last).toBe('inert');
    expect(t.inert).toBe(true);
  });

  it('ignores a bridge that was disposed while waiting', () => {
    const t = createLoadTracker();
    t.expectLoad();
    t.onLoad(0);
    expect(t.onAck(1, 'disposed')).toBe('ignore');
    expect(t.inert).toBe(false);
    /* And it did not count: the full bound is still available. */
    for (let i = 0; i < MAX_UNEXPECTED_LOADS; i++) expect(t.onLoad(10 + i)).toBe('unexpected');
  });
});

describe('load tracker', () => {
  it('accepts exactly one load per navigation we started', () => {
    const t = createLoadTracker();
    t.expectLoad();
    expect(t.onLoad(0)).toBe('expected');
    expect(t.onLoad(1)).toBe('unexpected');
  });

  it('calls a load with nothing expected unexpected', () => {
    expect(createLoadTracker().onLoad(0)).toBe('unexpected');
  });

  it('goes inert when unexpected loads pile up inside the window', () => {
    const t = createLoadTracker();
    for (let i = 0; i < MAX_UNEXPECTED_LOADS; i++) expect(t.onLoad(i)).toBe('unexpected');
    expect(t.onLoad(MAX_UNEXPECTED_LOADS)).toBe('inert');
    expect(t.inert).toBe(true);
    /* Stays inert: no loop. */
    expect(t.onLoad(MAX_UNEXPECTED_LOADS + 1)).toBe('inert');
  });

  it('forgets unexpected loads older than the window', () => {
    const t = createLoadTracker();
    for (let i = 0; i < MAX_UNEXPECTED_LOADS; i++) t.onLoad(i);
    expect(t.onLoad(UNEXPECTED_WINDOW_MS + 10)).toBe('unexpected');
    expect(t.inert).toBe(false);
  });

  it('does not count expected loads towards the bound', () => {
    const t = createLoadTracker();
    for (let i = 0; i < 10; i++) {
      t.expectLoad();
      expect(t.onLoad(i)).toBe('expected');
    }
    expect(t.inert).toBe(false);
  });

  it('is usable again after a reset', () => {
    const t = createLoadTracker();
    for (let i = 0; i <= MAX_UNEXPECTED_LOADS; i++) t.onLoad(i);
    t.reset();
    expect(t.inert).toBe(false);
    t.expectLoad();
    expect(t.onLoad(100)).toBe('expected');
  });
});

function harness(register: (nonce: string) => Promise<void>) {
  const log: string[] = [];
  const failures: unknown[] = [];
  let n = 0;
  let stopped = false;
  const deps: NavigatorDeps = {
    mintNonce: () => `nonce${++n}`,
    register: async (nonce) => {
      log.push(`register:${nonce}`);
      await register(nonce);
      log.push(`registered:${nonce}`);
    },
    panelUrl: () => 'x://a/panel.html',
    commit: (url, nonce) => log.push(`src:${url}`, `nonce:${nonce}`),
    fail: (e) => failures.push(e),
    isStopped: () => stopped,
  };
  return { log, failures, nav: createNavigator(deps), stop: () => (stopped = true) };
}

describe('navigator', () => {
  it('sets the URL only after the nonce registration resolved', async () => {
    let release = (): void => undefined;
    const h = harness(() => new Promise<void>((r) => (release = r)));
    const done = h.nav.navigate();
    await Promise.resolve();
    expect(h.log).toEqual(['register:nonce1']);
    release();
    await done;
    expect(h.log).toEqual(['register:nonce1', 'registered:nonce1', 'src:x://a/panel.html?r=0', 'nonce:nonce1']);
  });

  it('uses a new query and a new nonce for every navigation', async () => {
    const h = harness(async () => undefined);
    await h.nav.navigate();
    await h.nav.navigate();
    expect(h.log.filter((l) => l.startsWith('src:'))).toEqual([
      'src:x://a/panel.html?r=0',
      'src:x://a/panel.html?r=1',
    ]);
  });

  it('never loads the frame when registration rejects, and reports it', async () => {
    const boom = new Error('quota');
    const h = harness(() => Promise.reject(boom));
    await h.nav.navigate();
    expect(h.log.some((l) => l.startsWith('src:'))).toBe(false);
    expect(h.failures).toEqual([boom]);
  });

  it('lets only the newest of two overlapping starts commit', async () => {
    const releases: Array<() => void> = [];
    const h = harness(() => new Promise<void>((r) => releases.push(r)));
    const first = h.nav.navigate();
    const second = h.nav.navigate();
    releases[1]?.();
    releases[0]?.();
    await Promise.all([first, second]);
    expect(h.log.filter((l) => l.startsWith('src:'))).toEqual(['src:x://a/panel.html?r=0']);
  });

  it('does nothing once stopped', async () => {
    const h = harness(async () => undefined);
    const p = h.nav.navigate();
    h.stop();
    await p;
    expect(h.log.some((l) => l.startsWith('src:'))).toBe(false);
  });
});
