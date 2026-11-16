import { describe, expect, it, vi } from 'vitest';

import { wireSettingsRefresh } from './settingsSync';

function setup() {
  const handlers = new Map<string, () => void>();
  let kv: ((key: string) => void) | null = null;
  let unsubscribed = 0;
  const doc = {
    visibilityState: 'hidden' as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => void handlers.set(`doc:${type}`, fn),
    removeEventListener: (type: string) => void handlers.delete(`doc:${type}`),
  };
  const win = {
    addEventListener: (type: string, fn: () => void) => void handlers.set(`win:${type}`, fn),
    removeEventListener: (type: string) => void handlers.delete(`win:${type}`),
  };
  const refresh = vi.fn(async () => true);
  const stop = wireSettingsRefresh({
    onKvChanged: (l) => {
      kv = l;
      return () => void (unsubscribed += 1);
    },
    refresh,
    win: win as never,
    doc: doc as never,
  });
  return { handlers, doc, refresh, stop, emit: (k: string) => kv?.(k), unsubscribed: () => unsubscribed };
}

describe('wireSettingsRefresh', () => {
  it('re-reads when the settings slot changes, and only that slot', () => {
    const s = setup();
    s.emit('usage');
    expect(s.refresh).not.toHaveBeenCalled();
    s.emit('settings');
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it('re-reads on focus and when the document becomes visible, not when it hides', () => {
    const s = setup();
    s.handlers.get('win:focus')?.();
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.handlers.get('doc:visibilitychange')?.();
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.doc.visibilityState = 'visible';
    s.handlers.get('doc:visibilitychange')?.();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it('survives a failed re-read and tears everything down', async () => {
    const s = setup();
    s.refresh.mockRejectedValueOnce(new Error('storage gone'));
    expect(() => s.emit('settings')).not.toThrow();
    await Promise.resolve();
    s.stop();
    expect(s.unsubscribed()).toBe(1);
    expect(s.handlers.size).toBe(0);
  });
});
