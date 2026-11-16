import { describe, expect, it } from 'vitest';

import { pinnableBlocks, readStoredPin } from './pins';

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

describe('pinnableBlocks', () => {
  /**
   * A pinned card states; it does not act and it does not ask. A question the
   * Copilot asked back belongs to the moment it was asked in — on a dashboard
   * three weeks later its options answer to nothing.
   */
  it('keeps what an answer states and drops what belongs to the conversation', () => {
    const kept = pinnableBlocks([
      { kind: 'trace', tool: 'window.totals', detail: '1204 rows' },
      { kind: 'text', text: 'Ikki mahsulot shu nomga mos keldi.' },
      {
        kind: 'choice',
        question: 'Qaysi biri?',
        options: [{ label: 'Abaya qora' }, { label: 'Abaya oq' }],
      },
      { kind: 'action', actionId: 'copilot.ask', params: { question: 'Nega?' } },
      {
        kind: 'callout',
        tone: 'accent',
        title: 'Tavsiya',
        blocks: [
          {
            kind: 'choice',
            question: 'Qaysi davr?',
            options: [{ label: '7 kun' }, { label: '30 kun' }],
          },
        ],
      },
    ]);

    expect(kept).toEqual([{ kind: 'text', text: 'Ikki mahsulot shu nomga mos keldi.' }]);
  });
});
