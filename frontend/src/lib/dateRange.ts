import { formatDay } from '@/lib/format';
import type { DateWindow } from '@/services/uzum/endpoints';
import type { RangeKey } from '@/types/domain';

/**
 * The reporting window.
 *
 * Ranges are computed from the clock, never hardcoded: "last 7 days" has to
 * mean the seven days before now, or every figure derived from it is a figure
 * about some other week. `ryear` runs from 1 January of the current year.
 */

const DAY_MS = 86_400_000;

export const RANGE_KEYS = ['r7', 'r30', 'r90', 'ryear'] as const;

const RANGE_DAYS: Readonly<Record<Exclude<RangeKey, 'ryear'>, number>> = {
  r7: 7,
  r30: 30,
  r90: 90,
};

/** Resolve a range key against a reference instant (`now` by default). */
export function resolveWindow(range: RangeKey, now: number = Date.now()): DateWindow {
  if (range === 'ryear') {
    const start = new Date(now);
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    return { fromMs: start.getTime(), toMs: now };
  }

  return { fromMs: now - RANGE_DAYS[range] * DAY_MS, toMs: now };
}

/** `04.08 — 10.08`, the form the design's range chip shows. */
export function describeWindow(window: DateWindow): string {
  return `${formatDay(window.fromMs)} — ${formatDay(window.toMs)}`;
}

/** Whole days the window spans, rounded up — used for per-day rates. */
export function windowDays(window: DateWindow): number {
  return Math.max(1, Math.ceil((window.toMs - window.fromMs) / DAY_MS));
}

/**
 * The window of equal length immediately before this one, which is what every
 * "vs previous period" delta on the overview is measured against.
 */
export function previousWindow(window: DateWindow): DateWindow {
  const span = window.toMs - window.fromMs;
  return { fromMs: window.fromMs - span, toMs: window.fromMs };
}
