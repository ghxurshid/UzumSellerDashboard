import { formatDelta, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import type { Language } from '@/types/domain';

/**
 * A figure, as the author of a block wrote it.
 *
 * Blocks used to cite a `ref` into a fact table and let the application look
 * the number up. That kept the model from ever typing a digit, and it cost more
 * than it bought: a question the table had no ref for — a share, a difference,
 * a seven-day trend — could not be answered at all, and a model three rounds
 * deep cited refs from the wrong window as readily as from the right one.
 *
 * So a block now carries the value itself. The model reads the rows a lookup
 * returned, does the arithmetic the question needs, and writes the result into
 * the block that shows it. What stays with the application is *presentation*:
 * the author says what kind of number it is, and this module writes it the way
 * every other number on screen is written — the same grouping, the same
 * currency suffix, the same decimal separator the seller chose in Settings.
 */

export type FigureFormat = 'money' | 'percent' | 'count' | 'number' | 'text';

export const FIGURE_FORMATS = ['money', 'percent', 'count', 'number', 'text'] as const;

/** A string passes through untouched — "3 / 5", "2026-09-07", "yo‘q". */
export type FigureValue = number | string;

/**
 * Decimals for a plain number: none for an integer, enough to keep a small
 * ratio readable, and never the fifteen a floating-point division leaves.
 */
function decimalsFor(value: number): number {
  if (Number.isInteger(value)) return 0;
  return Math.abs(value) < 10 ? 2 : 1;
}

export function formatFigure(
  value: FigureValue,
  format: FigureFormat | undefined,
  language: Language,
): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';

  switch (format) {
    /* Money is whole so'm everywhere else in the interface; a model that
       divided its way to 457 924.3333 means 457 924. */
    case 'money':
      return formatMoney(Math.round(value), language);
    case 'percent':
      return formatPercent(value, Number.isInteger(value) ? 0 : 1);
    case 'count':
      return formatNumber(Math.round(value));
    case 'text':
      return String(value);
    case 'number':
    case undefined:
      return formatNumber(value, decimalsFor(value));
  }
}

/** A signed change in percent, as the KPI tiles write one: "+12.4%". */
export function formatChange(value: number): string {
  return formatDelta(value, Number.isInteger(value) ? 0 : 1);
}
