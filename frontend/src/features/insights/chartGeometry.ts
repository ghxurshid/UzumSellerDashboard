import { formatFigure, type FigureFormat } from '@/services/insights/figures';
import type { Language, Tone } from '@/types/domain';

/**
 * The arithmetic behind `ChartBlock.tsx`, kept apart from the drawing.
 *
 * None of this touches the DOM or React, which is what lets it be checked with
 * a plain unit test the same way `figures.ts` is — a slice's share, a bar's
 * side of the baseline and a series' colour slot are all facts about the
 * numbers a block carries, not about how they end up as pixels.
 */

/** Fixed-order categorical palette — see `globals.css` for the validated values. */
export const CAT_FILL = [
  'fill-cat-1',
  'fill-cat-2',
  'fill-cat-3',
  'fill-cat-4',
  'fill-cat-5',
  'fill-cat-6',
  'fill-cat-7',
  'fill-cat-8',
] as const;

export const CAT_STROKE = [
  'stroke-cat-1',
  'stroke-cat-2',
  'stroke-cat-3',
  'stroke-cat-4',
  'stroke-cat-5',
  'stroke-cat-6',
  'stroke-cat-7',
  'stroke-cat-8',
] as const;

export const CAT_BG = [
  'bg-cat-1',
  'bg-cat-2',
  'bg-cat-3',
  'bg-cat-4',
  'bg-cat-5',
  'bg-cat-6',
  'bg-cat-7',
  'bg-cat-8',
] as const;

export const CAT_NEUTRAL_FILL = 'fill-cat-none';
export const CAT_NEUTRAL_STROKE = 'stroke-cat-none';
export const CAT_NEUTRAL_BG = 'bg-cat-none';

/**
 * The class for slot `index` (0-based), or the neutral tone past the eighth.
 *
 * Written as a lookup rather than a template string on purpose — Tailwind's
 * scanner reads this file's literal text, so `` `fill-cat-${n}` `` would never
 * generate the utility it names. The classes above are the only place the
 * full names have to appear.
 */
export function catAt(list: readonly string[], neutral: string, index: number): string {
  return list[index] ?? neutral;
}

/* ── donut ──────────────────────────────────────────────────────────────── */

/** Gap between adjacent slices, and the shortest a sliver is still drawn at. */
const DONUT_GAP = 2;
const DONUT_MIN_DASH = 1.5;

export interface DonutSlice {
  /** Position in the block's own `items` list — what the legend and the ring agree on. */
  readonly sourceIndex: number;
  /** Position among slices actually drawn — the categorical palette's slot. */
  readonly colorIndex: number;
  readonly share: number;
  readonly dash: number;
  readonly offset: number;
}

/**
 * Arc lengths for a ring, each slice's tail shortened by the gap.
 *
 * The gap comes out of the slice's own dash rather than being inserted between
 * offsets, so a slice still starts exactly where its running share says it
 * should — only the last couple of pixels are held back, which is what keeps
 * the legend's percentage matching what the eye measures.
 *
 * A zero-value item is skipped rather than drawn as a zero-width arc, and the
 * schema already refuses a negative one — so `total` can still be zero here
 * only when every item is exactly zero, which is the one case the caller has
 * to draw some other way.
 */
export function donutLayout(
  values: readonly number[],
  circumference: number,
): { readonly total: number; readonly slices: readonly DonutSlice[] } {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) return { total, slices: [] };

  const positiveCount = values.filter((value) => value > 0).length;
  const gap = positiveCount > 1 ? DONUT_GAP : 0;

  let offset = 0;
  let colorIndex = 0;
  const slices: DonutSlice[] = [];

  values.forEach((value, sourceIndex) => {
    if (value <= 0) return;
    const raw = (value / total) * circumference;
    const dash = Math.min(raw, Math.max(DONUT_MIN_DASH, raw - gap));
    slices.push({ sourceIndex, colorIndex, share: (value / total) * 100, dash, offset });
    offset += raw;
    colorIndex += 1;
  });

  return { total, slices };
}

/* ── bar ────────────────────────────────────────────────────────────────── */

export interface BarSegment {
  /** Left edge as a fraction (0..1) of the track's width. */
  readonly startFrac: number;
  readonly widthFrac: number;
}

/**
 * Where each bar sits against a shared zero baseline.
 *
 * A positive value runs from the baseline to the right; a negative one runs
 * from the baseline to the left, which is the "other side" a bar chart owes a
 * negative figure instead of recolouring it and drawing it the same way as a
 * positive one. `zeroFrac` is where that baseline sits along the track — 0
 * when every value is non-negative, so a chart with nothing to show on the
 * left draws exactly like an ordinary left-aligned bar chart.
 */
export function barLayout(values: readonly number[]): {
  readonly zeroFrac: number;
  readonly segments: readonly BarSegment[];
} {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const range = high - low === 0 ? 1 : high - low;
  const zeroFrac = (0 - low) / range;

  const segments = values.map((value) => {
    const startFrac = value >= 0 ? zeroFrac : (value - low) / range;
    const endFrac = value >= 0 ? (value - low) / range : zeroFrac;
    return { startFrac, widthFrac: Math.max(endFrac - startFrac, 0) };
  });

  return { zeroFrac, segments };
}

/* ── tone ───────────────────────────────────────────────────────────────── */

/**
 * The default tone for an items-chart entry that did not name its own.
 *
 * `donut` ignores the result for colour — a slice is coloured by position —
 * but every entry still needs a `Tone` for the shared `Step` shape, so this is
 * where `bar`'s flat default and `waterfall`'s running-balance default both
 * live, kept apart because they disagree on what a negative value means.
 */
export function resolveChartTone(
  chart: 'waterfall' | 'bar' | 'donut',
  item: { readonly value: number; readonly tone?: Tone },
  index: number,
  count: number,
): Tone {
  if (item.tone !== undefined) return item.tone;
  if (chart !== 'waterfall') return 'accent';

  /* Waterfall: a total (first or last column) takes accent when it is the
     amount it claims to be; a deduction in the middle is the usual red, and a
     deduction that is itself negative — a credit, a refund, a payout larger
     than the lines above it explain — reads as the balance recovering, so it
     takes the positive tone instead. */
  const isBridge = index > 0 && index < count - 1;
  return item.value >= 0 ? 'accent' : isBridge ? 'positive' : 'negative';
}

/* ── line ───────────────────────────────────────────────────────────────── */

/**
 * The figure printed under a line series in the legend and in the fallback
 * list alike.
 *
 * A total of daily units or so'm is worth printing; a total of daily
 * percentages is not, so a rate shows where it ended (`→`) rather than a sum
 * that means nothing (`Σ`).
 */
export function seriesSummary(
  values: readonly number[],
  format: FigureFormat | undefined,
  language: Language,
): string {
  if (values.length === 0) return '—';
  if (format === 'percent') {
    return `→ ${formatFigure(values[values.length - 1] ?? 0, format, language)}`;
  }
  return `Σ ${formatFigure(values.reduce((sum, value) => sum + value, 0), format, language)}`;
}
