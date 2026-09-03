import { formatDay, hourInZone, weekdayInZone } from '@/lib/format';
import type { DateWindow } from '@/services/uzum/endpoints';
import type { FinanceOrderItem } from '@/services/uzum/types';
import type { HeatCell, SeriesPoint } from '@/types/domain';

/**
 * Time-bucketed views of the order-item stream.
 *
 * `date` on an order item is Unix epoch **milliseconds**. Everything here
 * buckets on that field and nothing smooths, models or extrapolates: an empty
 * bucket means no order landed in it, and the chart says so by drawing zero.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Buckets the chart aims for; the real count follows the window's length. */
const TARGET_BUCKETS = 24;

const isLive = (item: FinanceOrderItem): boolean =>
  item.status !== 'CANCELED' && item.cancelled !== true;

function bucketSizeFor(window: DateWindow): number {
  const span = Math.max(HOUR_MS, window.toMs - window.fromMs);
  const raw = span / TARGET_BUCKETS;

  /* Snap to a duration a person reads off an axis: 1h, 6h, or whole days. */
  if (raw <= HOUR_MS) return HOUR_MS;
  if (raw <= 6 * HOUR_MS) return 6 * HOUR_MS;
  return Math.ceil(raw / DAY_MS) * DAY_MS;
}

/**
 * Revenue and profit per bucket across the window.
 *
 * Buckets are labelled only where the day changes, which is how the design
 * draws it — a label under every 6-hour tick is unreadable at this width.
 */
export function buildSeries(
  items: readonly FinanceOrderItem[],
  window: DateWindow,
): readonly SeriesPoint[] {
  const size = bucketSizeFor(window);
  const count = Math.max(1, Math.ceil((window.toMs - window.fromMs) / size));

  const revenue = new Array<number>(count).fill(0);
  const profit = new Array<number>(count).fill(0);

  for (const item of items) {
    if (!isLive(item)) continue;
    const index = Math.floor((item.date - window.fromMs) / size);
    if (index < 0 || index >= count) continue;

    revenue[index] = (revenue[index] ?? 0) + (item.sellPrice ?? 0);
    profit[index] =
      (profit[index] ?? 0) + (item.sellerProfit ?? 0) - (item.purchasePrice ?? 0);
  }

  let lastDay = '';
  return Array.from({ length: count }, (_, index) => {
    const day = formatDay(window.fromMs + index * size);
    const label = day === lastDay ? '' : day;
    lastDay = day;

    return { label, revenue: revenue[index] ?? 0, profit: profit[index] ?? 0 };
  });
}

/** The last `count` buckets of one metric, for a KPI tile's sparkline. */
export function sparkFrom(
  series: readonly SeriesPoint[],
  metric: 'revenue' | 'profit',
  count = 8,
): readonly number[] {
  const values = series.slice(-count).map((point) => point[metric]);
  /* A flat line still needs points to draw; an empty array renders nothing. */
  return values.length === 0 ? [0] : values;
}

/**
 * Order volume by weekday × hour of day, normalised to the busiest cell.
 *
 * The hour is the bucket the API's own `date` falls in, not a four-hour block:
 * a seller reads this grid to decide when to be reachable, and "somewhere
 * between 08:00 and 12:00" is not an answer to that. The 168 cells are what the
 * card is drawn for — see the geometry in `DemandHeatmap`.
 *
 * Cells with no sample are genuinely empty here, which matters: a short window
 * leaves whole weekdays blank, and that is missing sample, not missing demand.
 * Hourly buckets sharpen that trade-off — the same orders now spread over four
 * times as many cells — which is why the card's note says so out loud.
 */
export function buildHeatmap(items: readonly FinanceOrderItem[]): readonly HeatCell[] {
  const counts = new Map<string, number>();
  let peak = 0;

  for (const item of items) {
    if (!isLive(item)) continue;
    const weekday = weekdayInZone(item.date);
    const hour = hourInZone(item.date);
    const key = `${weekday}:${hour}`;

    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next > peak) peak = next;
  }

  const cells: HeatCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const value = counts.get(`${weekday}:${hour}`) ?? 0;
      cells.push({ weekday, hour, intensity: peak === 0 ? 0 : value / peak });
    }
  }
  return cells;
}

/**
 * Items that landed since midnight in the configured zone — what the live
 * ticker reports on. A seller's day starts in Tashkent, not in UTC.
 */
export function itemsToday(
  items: readonly FinanceOrderItem[],
  now: number,
): readonly FinanceOrderItem[] {
  /* The instant is an argument, not a reading: everything in `derive/` is a
     pure function of its input, which is what makes a number reproducible from
     the same rows tomorrow. */
  const today = formatDay(now);
  return items.filter((item) => formatDay(item.date) === today);
}
