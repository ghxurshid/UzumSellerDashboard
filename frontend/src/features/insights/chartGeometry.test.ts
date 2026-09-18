import { describe, expect, it } from 'vitest';

import {
  barLayout,
  catAt,
  CAT_FILL,
  donutLayout,
  resolveChartTone,
  seriesSummary,
} from './chartGeometry';

describe('catAt', () => {
  it('picks the slot by position', () => {
    expect(catAt(CAT_FILL, 'fill-cat-none', 0)).toBe('fill-cat-1');
    expect(catAt(CAT_FILL, 'fill-cat-none', 7)).toBe('fill-cat-8');
  });

  it('never cycles — a 9th position falls back to the neutral tone', () => {
    expect(catAt(CAT_FILL, 'fill-cat-none', 8)).toBe('fill-cat-none');
    expect(catAt(CAT_FILL, 'fill-cat-none', 30)).toBe('fill-cat-none');
  });
});

describe('donutLayout', () => {
  it('splits the ring in proportion to each value, leaving a gap between slices', () => {
    const circumference = 200;
    const { total, slices } = donutLayout([50, 50], circumference);
    expect(total).toBe(100);
    expect(slices).toHaveLength(2);
    expect(slices[0]?.share).toBeCloseTo(50);
    expect(slices[1]?.share).toBeCloseTo(50);
    /* Each half is 100 units of arc; the gap shortens the drawn dash without
       moving where the next slice starts. */
    expect(slices[0]?.dash).toBeCloseTo(98);
    expect(slices[1]?.offset).toBeCloseTo(100);
  });

  it('assigns colour by position among the slices actually drawn, skipping zero items', () => {
    const { slices } = donutLayout([0, 40, 60], 200);
    expect(slices.map((slice) => slice.sourceIndex)).toEqual([1, 2]);
    expect(slices.map((slice) => slice.colorIndex)).toEqual([0, 1]);
  });

  it('draws a single full ring without a gap notch', () => {
    const { slices } = donutLayout([10], 200);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.dash).toBeCloseTo(200);
  });

  it('reports an empty ring when every value is zero — the caller falls back to a list', () => {
    expect(donutLayout([0, 0, 0], 200)).toEqual({ total: 0, slices: [] });
  });

  it('never cycles past the eighth colour slot for 9+ slices', () => {
    const { slices } = donutLayout(Array.from({ length: 10 }, () => 1), 200);
    expect(slices).toHaveLength(10);
    expect(slices[7]?.colorIndex).toBe(7);
    expect(slices[8]?.colorIndex).toBe(8);
    expect(slices[9]?.colorIndex).toBe(9);
  });
});

describe('barLayout', () => {
  it('lines every bar up against the left edge when nothing is negative', () => {
    const { zeroFrac, segments } = barLayout([10, 20, 30]);
    expect(zeroFrac).toBe(0);
    expect(segments[0]).toEqual({ startFrac: 0, widthFrac: 10 / 30 });
    expect(segments[2]).toEqual({ startFrac: 0, widthFrac: 1 });
  });

  it('draws a negative value on the other side of the zero baseline', () => {
    const { zeroFrac, segments } = barLayout([-5, 10]);
    expect(zeroFrac).toBeCloseTo(5 / 15);
    /* The negative bar ends exactly where the baseline is, not past it. */
    expect(segments[0]?.startFrac).toBeCloseTo(0);
    expect(segments[0]?.startFrac !== undefined && segments[0]!.startFrac + segments[0]!.widthFrac).toBeCloseTo(
      zeroFrac,
    );
    expect(segments[1]?.startFrac).toBeCloseTo(zeroFrac);
  });

  it('does not divide by zero when every value is zero', () => {
    const { zeroFrac, segments } = barLayout([0, 0]);
    expect(Number.isFinite(zeroFrac)).toBe(true);
    expect(segments.every((segment) => Number.isFinite(segment.widthFrac))).toBe(true);
  });
});

describe('resolveChartTone', () => {
  it('an explicit tone always wins', () => {
    expect(resolveChartTone('bar', { value: 5, tone: 'warning' }, 0, 3)).toBe('warning');
    expect(resolveChartTone('waterfall', { value: -5, tone: 'accent' }, 1, 3)).toBe('accent');
  });

  it('bar defaults to accent regardless of sign', () => {
    expect(resolveChartTone('bar', { value: 5 }, 0, 3)).toBe('accent');
    expect(resolveChartTone('bar', { value: -5 }, 1, 3)).toBe('accent');
  });

  it('waterfall keeps its running-balance default: totals and ordinary deductions both read accent', () => {
    expect(resolveChartTone('waterfall', { value: 100 }, 0, 3)).toBe('accent'); // opening total
    expect(resolveChartTone('waterfall', { value: 30 }, 1, 3)).toBe('accent'); // ordinary deduction
    expect(resolveChartTone('waterfall', { value: 70 }, 2, 3)).toBe('accent'); // closing total
  });

  it('a negative total reads negative, but a negative mid-run deduction — a credit — reads positive', () => {
    expect(resolveChartTone('waterfall', { value: -20 }, 0, 3)).toBe('negative'); // total gone negative
    expect(resolveChartTone('waterfall', { value: -20 }, 1, 3)).toBe('positive'); // credit: balance recovers
    expect(resolveChartTone('waterfall', { value: -20 }, 2, 3)).toBe('negative'); // total gone negative
  });
});

describe('seriesSummary', () => {
  it('sums a series of amounts', () => {
    expect(seriesSummary([10, 20, 30], 'count', 'en')).toBe('Σ 60');
  });

  it('reads a percent series as where it ended, not a meaningless sum', () => {
    expect(seriesSummary([10, 20, 12], 'percent', 'en')).toBe('→ 12%');
  });

  it('says so plainly for a series with nothing in it', () => {
    expect(seriesSummary([], 'count', 'en')).toBe('—');
  });
});
