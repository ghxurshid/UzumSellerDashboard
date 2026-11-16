import { formatDelta, formatMoney, formatNumber, formatPercent } from '@core/lib/format';
import type { Language } from '@core/types/common';

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

/* ── figures the application finishes ───────────────────────────────────── */

/**
 * The derivations a block leaves to the application.
 *
 * A model that reads two figures and writes a third can get the third wrong, and
 * the block then states a percentage its own numbers contradict. Where the third
 * figure is pure arithmetic on the two — a change, a share, a place in a list, a
 * gap between two sides — the author sends only what it read and the result is
 * computed here, once, for the renderer, the export and the summary a follow-up
 * question is sent.
 *
 * They live beside `formatFigure` rather than in the renderer because all three
 * of those readers need the same answer, and two of them have no DOM.
 */

/**
 * Percent change from `previous` to `value`, or null where there is none to state.
 *
 * The same rule as the dashboard's own tiles (`changeBetween` in the site's
 * `derive/finance.ts`): measured against the magnitude of the earlier figure, so
 * a loss that became a profit reads as a rise, and growth from zero is not a
 * percentage at all. A figure that is a string has nothing to compare.
 */
export function changeFrom(value: FigureValue, previous: number | undefined): number | null {
  if (typeof value !== 'number' || previous === undefined) return null;
  if (!Number.isFinite(value) || !Number.isFinite(previous)) return null;
  if (previous === 0) return value === 0 ? 0 : null;
  return ((value - previous) / Math.abs(previous)) * 100;
}

/**
 * What percent of `total` is `value`, or null when there is no whole to take it of.
 *
 * Not clamped: 120 out of 100 is 120%, and saying so is the point of printing
 * it. The bar that draws it is what stops at full — see `fillOf`.
 */
export function shareOf(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return (value / total) * 100;
}

/** How much of a track a share fills, as a fraction held to 0..1. */
export function fillOf(share: number | null): number {
  if (share === null) return 0;
  return Math.min(1, Math.max(0, share / 100));
}

export interface CompareResult {
  /** Percent change from `b` to `a`, or null where `changeFrom` states none. */
  readonly change: number | null;
  /**
   * Which side is ahead, when the row says which way is good.
   *
   * Null for a row that takes no side and for a tie — both are drawn in plain
   * ink, because neither is a lead.
   */
  readonly lead: 'a' | 'b' | null;
}

/**
 * One row of a comparison: how far `a` is from `b`, and who is ahead.
 *
 * The change is `a` measured against `b`, the same division a `metrics` tile
 * does, so "this month against last" reads the way a tile would write it. The
 * lead is a separate question and needs `better`: a larger number wins a row
 * about sales and loses one about returns, and a row that does not say which
 * it is has a difference but no winner.
 */
export function compareRow(
  a: number,
  b: number,
  better: 'higher' | 'lower' | undefined,
): CompareResult {
  const change = changeFrom(a, b);
  if (better === undefined || a === b || !Number.isFinite(a) || !Number.isFinite(b)) {
    return { change, lead: null };
  }
  const aLeads = better === 'higher' ? a > b : a < b;
  return { change, lead: aLeads ? 'a' : 'b' };
}

export interface RankPlace {
  /** Position in the block's own `items` list. */
  readonly sourceIndex: number;
  /** The place in the ranking, from 1. Equal values share one. */
  readonly place: number;
}

/**
 * The order a ranking is drawn in, and the place each entry takes.
 *
 * Equal values share a place and the next one skips — 1, 2, 2, 4 — because two
 * products that sold the same are not second and third, and numbering them so
 * would be a claim the figures do not make. Entries that tie keep the order they
 * were written in.
 */
export function rankOrder(
  values: readonly number[],
  order: 'desc' | 'asc' = 'desc',
): readonly RankPlace[] {
  const direction = order === 'asc' ? 1 : -1;
  const sorted = values
    .map((value, sourceIndex) => ({ value, sourceIndex }))
    .sort((a, b) => (a.value - b.value) * direction || a.sourceIndex - b.sourceIndex);

  let place = 0;
  let last: number | undefined;

  return sorted.map((entry, index) => {
    if (entry.value !== last) place = index + 1;
    last = entry.value;
    return { sourceIndex: entry.sourceIndex, place };
  });
}
