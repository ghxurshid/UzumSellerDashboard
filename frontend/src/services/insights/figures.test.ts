import { describe, expect, it } from 'vitest';

import { formatChange, formatFigure } from './figures';

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
