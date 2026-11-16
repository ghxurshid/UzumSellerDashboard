import { describe, expect, it } from 'vitest';

import { isGated, reduceGate } from './gate';

describe('bridge gate', () => {
  it('gates everything except a dev build outside an extension', () => {
    expect(isGated('extension')).toBe(true);
    expect(isGated('unavailable')).toBe(true);
    expect(isGated('dev')).toBe(false);
  });

  it('waits, then shows the app on a verified handshake', () => {
    expect(reduceGate('waiting', 'connected')).toBe('connected');
  });

  it('reports a failure when the wait runs out', () => {
    expect(reduceGate('waiting', 'timedOut')).toBe('failed');
  });

  it('still turns into the app when the handshake arrives after the timeout', () => {
    expect(reduceGate('failed', 'connected')).toBe('connected');
  });

  it('never takes the app away again', () => {
    expect(reduceGate('connected', 'timedOut')).toBe('connected');
  });
});
