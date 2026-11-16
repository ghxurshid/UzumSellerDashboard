import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatCalendarDate } from './format';

/**
 * `formatCalendarDate` reformats an ISO calendar date's digits directly — see
 * its own JSDoc for why: a bare calendar date names no instant, so routing it
 * through `Intl`/`Date` the way `formatDay`/`formatClock` do would risk a
 * Pacific-vs-Tashkent (or any other zone) shift pushing it a day either way.
 * This file pins that it stays a pure digit reformat.
 */
describe('formatCalendarDate', () => {
  const originalTz = process.env['TZ'];

  afterEach(() => {
    process.env['TZ'] = originalTz;
    vi.useRealTimers();
  });

  it('reformats an ISO calendar date to day.month.year', () => {
    expect(formatCalendarDate('2026-09-18')).toBe('18.09.2026');
  });

  it('keeps single-digit day and month zero-padded as given', () => {
    expect(formatCalendarDate('2026-01-05')).toBe('05.01.2026');
  });

  it('never shifts the day for any process time zone or "current" instant — no Date is read', () => {
    // A regression guard: reimplementing this as `new
    // Date(dateIso).getDate()`/`getMonth()` — the natural-looking shortcut —
    // is exactly the operation that shifts a bare calendar date by one day
    // depending on the process's own zone. Every zone below, at an instant
    // pinned close to local midnight in case a future version reads
    // `Date.now()` instead of the argument, must reformat the same digits.
    const zones = ['Pacific/Kiritimati', 'Etc/GMT+12', 'UTC', 'Asia/Tashkent'];
    const nearMidnightUtc = Date.UTC(2026, 8, 18, 23, 59, 0);

    for (const tz of zones) {
      process.env['TZ'] = tz;
      vi.useFakeTimers();
      vi.setSystemTime(nearMidnightUtc);

      expect(formatCalendarDate('2026-09-18')).toBe('18.09.2026');

      vi.useRealTimers();
    }
  });

  it('falls back to the raw input when a part is missing', () => {
    expect(formatCalendarDate('')).toBe('');
    expect(formatCalendarDate('2026-09')).toBe('2026-09');
  });
});
