import { describe, expect, it } from 'vitest';

import { readStoredPin } from './pins';

/**
 * Pins read back from storage.
 *
 * A pin outlives the build that wrote it. The one shape worth guarding against
 * is the one this build replaced: blocks that cited refs instead of carrying
 * their figures. Drawn, those are cards full of dashes; dropped, they cost the
 * seller one click to pin the answer again.
 */

describe('readStoredPin', () => {
  it('keeps a pin whose blocks carry their own figures', () => {
    const pin = readStoredPin({
      id: 'msg-1',
      title: 'Avgust qanday o‘tdi?',
      createdAt: 1_760_000_000_000,
      window: { fromMs: 1, toMs: 2 },
      blocks: [
        { kind: 'text', text: 'Yaxshi.' },
        { kind: 'metric', label: 'Sof foyda', value: 457_924, format: 'money' },
      ],
    });

    expect(pin?.blocks).toHaveLength(2);
    expect(pin?.window).toEqual({ fromMs: 1, toMs: 2 });
  });

  it('drops a pin written while blocks cited refs', () => {
    expect(
      readStoredPin({
        id: 'msg-2',
        title: 'Foyda',
        createdAt: 1,
        plan: [{ tool: 'window.totals', args: {} }],
        blocks: [{ kind: 'metric', ref: 'totals.netProfit' }],
      }),
    ).toBeNull();
  });

  it('drops what is not a pin at all', () => {
    expect(readStoredPin(null)).toBeNull();
    expect(readStoredPin({ id: 'x' })).toBeNull();
    expect(readStoredPin({ id: 'x', title: 'y', blocks: [] })).toBeNull();
  });
});
