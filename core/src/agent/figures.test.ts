import { describe, expect, it } from 'vitest';

import {
  changeFrom,
  compareRow,
  fillOf,
  formatChange,
  formatFigure,
  rankOrder,
  shareOf,
} from './figures';

/**
 * How a figure the model wrote reaches the screen.
 *
 * The model writes plain numbers; this is the one place they become what a
 * seller reads. Whitespace is normalised in the assertions because the grouping
 * character is a thin space, which is right on screen and unreadable in a test.
 */

const plain = (text: string): string => text.replace(/\s/g, ' ');

describe('formatFigure', () => {
  it('groups money and names the currency', () => {
    expect(plain(formatFigure(457_924, 'money', 'uz'))).toBe("457 924 so'm");
  });

  it('keeps money whole even when the model divided its way there', () => {
    expect(plain(formatFigure(1_000.6, 'money', 'uz'))).toBe("1 001 so'm");
  });

  it('writes a percentage as the percentage, not as a ratio', () => {
    expect(formatFigure(9.2, 'percent', 'uz')).toBe('9.2%');
    expect(formatFigure(25, 'percent', 'uz')).toBe('25%');
  });

  it('writes a count as a whole number', () => {
    expect(plain(formatFigure(1_204, 'count', 'uz'))).toBe('1 204');
  });

  it('keeps a small ratio readable without a floating-point tail', () => {
    expect(formatFigure(2 / 3, 'number', 'uz')).toBe('0.67');
    expect(formatFigure(12, undefined, 'uz')).toBe('12');
  });

  it('passes a string through untouched', () => {
    expect(formatFigure('3 / 5', 'count', 'uz')).toBe('3 / 5');
  });

  it('draws a dash rather than NaN', () => {
    expect(formatFigure(Number.NaN, 'money', 'uz')).toBe('—');
  });
});

describe('formatChange', () => {
  it('signs the change the way the KPI tiles do', () => {
    expect(formatChange(12.4)).toBe('+12.4%');
    expect(formatChange(-3)).toBe('−3%');
  });
});

/**
 * The figures a block leaves to the application.
 *
 * Each of these is a number a seller reads that nobody typed, so the cases worth
 * pinning are the ones where the honest answer is "there is no such number".
 */
describe('changeFrom', () => {
  it('is the percent change against the earlier figure', () => {
    expect(changeFrom(457_924, 400_000)).toBeCloseTo(14.481);
    expect(changeFrom(90, 120)).toBeCloseTo(-25);
    expect(formatChange(changeFrom(457_924, 400_000) ?? 0)).toBe('+14.5%');
  });

  it('measures against the magnitude, so a loss that became a profit is a rise', () => {
    expect(changeFrom(50, -100)).toBeCloseTo(150);
  });

  it('states no growth from zero, and no change where nothing moved', () => {
    expect(changeFrom(12, 0)).toBeNull();
    expect(changeFrom(0, 0)).toBe(0);
  });

  it('has nothing to compare without an earlier figure or with a figure that is text', () => {
    expect(changeFrom(12, undefined)).toBeNull();
    expect(changeFrom('3 / 5', 4)).toBeNull();
  });
});

describe('shareOf', () => {
  it('is the part as a percent of the whole', () => {
    expect(shareOf(9, 17)).toBeCloseTo(52.941);
    expect(formatFigure(shareOf(9, 17) ?? 0, 'percent', 'uz')).toBe('52.9%');
  });

  it('is not clamped — a whole that was passed says by how much', () => {
    expect(shareOf(120, 100)).toBe(120);
  });

  it('is nothing when there is no whole to take it of', () => {
    expect(shareOf(5, 0)).toBeNull();
    expect(shareOf(5, -10)).toBeNull();
  });
});

describe('fillOf', () => {
  it('holds the bar between empty and full', () => {
    expect(fillOf(52.9)).toBeCloseTo(0.529);
    expect(fillOf(120)).toBe(1);
    expect(fillOf(-5)).toBe(0);
    expect(fillOf(null)).toBe(0);
  });
});

describe('compareRow', () => {
  it('measures a against b, the way a tile measures now against before', () => {
    expect(compareRow(120, 85, undefined).change).toBeCloseTo(41.176);
    expect(compareRow(9.2, 14.1, undefined).change).toBeCloseTo(-34.752);
  });

  it('takes no side until the row says which way is good', () => {
    expect(compareRow(120, 85, undefined).lead).toBeNull();
  });

  it('gives the lead to the larger figure where higher is better', () => {
    expect(compareRow(120, 85, 'higher').lead).toBe('a');
    expect(compareRow(85, 120, 'higher').lead).toBe('b');
  });

  it('gives the lead to the smaller figure where lower is better', () => {
    /* Returns: a is 9.2% and b is 14.1%, so a leads although its number fell. */
    expect(compareRow(9.2, 14.1, 'lower').lead).toBe('a');
    expect(compareRow(14.1, 9.2, 'lower').lead).toBe('b');
  });

  it('calls a tie a tie', () => {
    expect(compareRow(50, 50, 'higher')).toEqual({ change: 0, lead: null });
  });

  it('still names the leader where there is no percentage to state', () => {
    /* From zero there is no percent change, but 12 is ahead of 0 all the same. */
    expect(compareRow(12, 0, 'higher')).toEqual({ change: null, lead: 'a' });
  });
});

describe('rankOrder', () => {
  it('puts the largest first whatever order the author wrote', () => {
    expect(rankOrder([85, 120, 40])).toEqual([
      { sourceIndex: 1, place: 1 },
      { sourceIndex: 0, place: 2 },
      { sourceIndex: 2, place: 3 },
    ]);
  });

  it('puts the smallest first when asked', () => {
    expect(rankOrder([85, 120, 40], 'asc').map((entry) => entry.sourceIndex)).toEqual([2, 0, 1]);
  });

  it('gives equal values one place and skips the next', () => {
    expect(rankOrder([10, 30, 30, 5]).map((entry) => entry.place)).toEqual([1, 1, 3, 4]);
    /* Tied entries stay in the order they were written. */
    expect(rankOrder([10, 30, 30, 5]).map((entry) => entry.sourceIndex)).toEqual([1, 2, 0, 3]);
  });

  it('ranks a loss below a profit', () => {
    expect(rankOrder([-200, 50, 0]).map((entry) => entry.sourceIndex)).toEqual([1, 2, 0]);
  });
});
