import { describe, expect, it } from 'vitest';

import { add, bounds, chunk, clip, density, missing, normalize, span, unseal } from './coverage';

/**
 * The interval algebra, which is the one place a bug is unrecoverable.
 *
 * Every other mistake in this application shows itself: a wrong sum is visibly
 * wrong, a failed request says so. A hole in the coverage record does neither —
 * the planner trusts the record absolutely, so a window wrongly marked as held
 * is a window no future sync will ever look at again, and the screens above it
 * quietly report a period with no sales.
 *
 * These are therefore the tests that matter most, and they are written against
 * the properties rather than against remembered outputs: what is covered, what
 * is still missing, and what survives being re-opened.
 */

const day = 86_400_000;
/** Nominal dates, so a failing case can be read as dates rather than epochs. */
const d = (n: number): number => Date.UTC(2026, 0, n);

describe('normalize', () => {
  it('sorts, merges overlaps and drops empty ranges', () => {
    expect(
      normalize([
        { fromMs: d(5), toMs: d(7) },
        { fromMs: d(1), toMs: d(3) },
        { fromMs: d(2), toMs: d(6) },
        { fromMs: d(9), toMs: d(9) },
      ]),
    ).toEqual([{ fromMs: d(1), toMs: d(7) }]);
  });

  it('closes a seam narrower than a minute', () => {
    /* Two syncs a minute apart leave a gap that is a storage artefact rather
       than a hole in the data, and re-requesting it would cost a call for
       nothing. */
    const merged = normalize([
      { fromMs: d(1), toMs: d(2) },
      { fromMs: d(2) + 30_000, toMs: d(3) },
    ]);

    expect(merged).toEqual([{ fromMs: d(1), toMs: d(3) }]);
  });

  it('keeps a real gap apart', () => {
    const merged = normalize([
      { fromMs: d(1), toMs: d(2) },
      { fromMs: d(4), toMs: d(5) },
    ]);

    expect(merged).toHaveLength(2);
  });

  it('discards a range whose end precedes its start', () => {
    expect(normalize([{ fromMs: d(5), toMs: d(2) }])).toEqual([]);
  });
});

describe('missing', () => {
  const window = { fromMs: d(1), toMs: d(10) };

  it('returns the whole window when nothing is held', () => {
    expect(missing(window, [])).toEqual([window]);
  });

  it('returns nothing when the window is covered', () => {
    expect(missing(window, [{ fromMs: d(1), toMs: d(10) }])).toEqual([]);
  });

  it('returns only the holes', () => {
    expect(
      missing(window, [
        { fromMs: d(1), toMs: d(3) },
        { fromMs: d(6), toMs: d(8) },
      ]),
    ).toEqual([
      { fromMs: d(3), toMs: d(6) },
      { fromMs: d(8), toMs: d(10) },
    ]);
  });

  it('ignores coverage that lies outside the window', () => {
    expect(missing(window, [{ fromMs: d(20), toMs: d(30) }])).toEqual([window]);
  });

  it('drops a hole too small to be worth a request', () => {
    const covered = [
      { fromMs: d(1), toMs: d(5) },
      /* Thirty seconds later — under the one-minute floor. */
      { fromMs: d(5) + 30_000, toMs: d(10) },
    ];

    expect(missing(window, covered)).toEqual([]);
  });

  it('is empty for a window with no width', () => {
    expect(missing({ fromMs: d(4), toMs: d(4) }, [])).toEqual([]);
  });
});

describe('add', () => {
  it('folds a new range into the record', () => {
    const record = add([{ fromMs: d(1), toMs: d(3) }], { fromMs: d(3), toMs: d(6) });
    expect(record).toEqual([{ fromMs: d(1), toMs: d(6) }]);
  });

  it('leaves what is already held unchanged', () => {
    const before = [{ fromMs: d(1), toMs: d(9) }];
    expect(add(before, { fromMs: d(3), toMs: d(4) })).toEqual(before);
  });
});

describe('unseal', () => {
  const now = d(10);
  const lag = 2 * day;

  it('re-opens the tail and keeps the settled history', () => {
    expect(unseal([{ fromMs: d(1), toMs: d(10) }], now, lag)).toEqual([
      { fromMs: d(1), toMs: d(8) },
    ]);
  });

  it('drops a range that lies entirely inside the lag', () => {
    expect(unseal([{ fromMs: d(9), toMs: d(10) }], now, lag)).toEqual([]);
  });

  it('leaves settled ranges alone', () => {
    const settled = [{ fromMs: d(1), toMs: d(4) }];
    expect(unseal(settled, now, lag)).toEqual(settled);
  });

  it('makes the unsealed tail come back as missing', () => {
    /* The property the settlement lag exists for: after unsealing, asking for
       the window again asks for the recent part and nothing else. */
    const record = unseal([{ fromMs: d(1), toMs: d(10) }], now, lag);
    expect(missing({ fromMs: d(1), toMs: d(10) }, record)).toEqual([
      { fromMs: d(8), toMs: d(10) },
    ]);
  });
});

describe('span, bounds and density', () => {
  const holed = [
    { fromMs: d(1), toMs: d(3) },
    { fromMs: d(5), toMs: d(6) },
  ];

  it('sums only what is covered', () => {
    expect(span(holed)).toBe(3 * day);
  });

  it('reports the outer bounds', () => {
    expect(bounds(holed)).toEqual({ fromMs: d(1), toMs: d(6) });
  });

  it('has no bounds when nothing is held', () => {
    expect(bounds([])).toBeNull();
  });

  it('reports density below one when there are holes', () => {
    expect(density(holed)).toBeCloseTo(3 / 5, 6);
    expect(density([{ fromMs: d(1), toMs: d(6) }])).toBe(1);
    expect(density([])).toBe(0);
  });
});

describe('clip', () => {
  it('cuts everything before the retention horizon', () => {
    expect(
      clip(
        [
          { fromMs: d(1), toMs: d(3) },
          { fromMs: d(5), toMs: d(9) },
        ],
        d(6),
      ),
    ).toEqual([{ fromMs: d(6), toMs: d(9) }]);
  });
});

describe('chunk', () => {
  it('splits newest first and covers the whole window', () => {
    const chunks = chunk({ fromMs: d(1), toMs: d(10) }, 4 * day);

    expect(chunks).toEqual([
      { fromMs: d(6), toMs: d(10) },
      { fromMs: d(2), toMs: d(6) },
      { fromMs: d(1), toMs: d(2) },
    ]);
    expect(span(chunks)).toBe(9 * day);
  });

  it('returns the window whole when it is shorter than a chunk', () => {
    const window = { fromMs: d(1), toMs: d(2) };
    expect(chunk(window, 30 * day)).toEqual([window]);
  });
});
