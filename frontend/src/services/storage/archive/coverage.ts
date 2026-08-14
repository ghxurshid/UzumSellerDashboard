import type { DateWindow } from '@/services/uzum/endpoints';

/**
 * Interval algebra over the archive's coverage record.
 *
 * This is the bookkeeping half of the migration model: the archive remembers
 * *which stretches of time it has already pulled*, and a sync fetches only the
 * complement of that inside the window being asked for. Everything here is
 * pure arithmetic on `[fromMs, toMs]` pairs — no storage, no requests — so the
 * planner's decisions are testable in isolation and never depend on the clock.
 *
 * Invariant maintained by every function that returns ranges: the result is
 * sorted ascending, non-overlapping, and free of touching neighbours. Callers
 * may therefore read `ranges[0].fromMs` as "the earliest instant covered" and
 * `ranges.length > 1` as "there is a hole", without normalising first.
 */

/** Gaps shorter than this are closed rather than recorded. */
const ADJACENCY_MS = 60_000;

/** A window narrower than this is not worth a request of its own. */
const MIN_GAP_MS = 60_000;

export type Coverage = readonly DateWindow[];

/** Sort, merge overlapping and touching pairs, drop empties. */
export function normalize(ranges: Coverage): Coverage {
  const sound = ranges
    .filter(
      (range) =>
        Number.isFinite(range.fromMs) &&
        Number.isFinite(range.toMs) &&
        range.toMs > range.fromMs,
    )
    .sort((a, b) => a.fromMs - b.fromMs);

  const merged: DateWindow[] = [];

  for (const range of sound) {
    const last = merged[merged.length - 1];

    /* Merge when the next range starts before the previous one ends, and also
       when it starts a hair after: two syncs a minute apart leave a one-minute
       seam that is a storage artefact, not a hole in the data. */
    if (last !== undefined && range.fromMs <= last.toMs + ADJACENCY_MS) {
      merged[merged.length - 1] = {
        fromMs: last.fromMs,
        toMs: Math.max(last.toMs, range.toMs),
      };
      continue;
    }

    merged.push({ fromMs: range.fromMs, toMs: range.toMs });
  }

  return merged;
}

export function add(ranges: Coverage, range: DateWindow): Coverage {
  return normalize([...ranges, range]);
}

/**
 * What `window` still needs — the parts of it no range in `covered` accounts
 * for. This is the whole planner in one function: an empty archive returns the
 * window untouched (the genesis case), a fully covered one returns nothing, and
 * a partially covered one returns only the holes.
 */
export function missing(window: DateWindow, covered: Coverage): Coverage {
  if (window.toMs <= window.fromMs) return [];

  const gaps: DateWindow[] = [];
  let cursor = window.fromMs;

  for (const range of normalize(covered)) {
    if (range.toMs <= cursor) continue;
    if (range.fromMs >= window.toMs) break;

    if (range.fromMs > cursor) gaps.push({ fromMs: cursor, toMs: range.fromMs });
    cursor = Math.max(cursor, range.toMs);
    if (cursor >= window.toMs) break;
  }

  if (cursor < window.toMs) gaps.push({ fromMs: cursor, toMs: window.toMs });

  return gaps.filter((gap) => gap.toMs - gap.fromMs >= MIN_GAP_MS);
}

/**
 * Re-open the trailing `lagMs` of the record.
 *
 * Rows in the seller ledger are not immutable the moment they appear: an order
 * item is written `PROCESSING` and only later becomes `TO_WITHDRAW` or
 * `CANCELED`, and its refunds land days after the sale. Sealing coverage right
 * up to the sync instant would freeze those rows in their provisional state
 * forever, so the tail is deliberately forgotten and re-read on the next run.
 * Everything older than the lag is what the archive treats as settled history.
 */
export function unseal(ranges: Coverage, now: number, lagMs: number): Coverage {
  const boundary = now - lagMs;

  return normalize(
    ranges.flatMap((range) => {
      if (range.toMs <= boundary) return [range];
      if (range.fromMs >= boundary) return [];
      return [{ fromMs: range.fromMs, toMs: boundary }];
    }),
  );
}

/** Milliseconds actually covered, holes excluded. */
export function span(ranges: Coverage): number {
  return normalize(ranges).reduce((sum, range) => sum + (range.toMs - range.fromMs), 0);
}

/** Outer bounds of the record, or null when nothing has been synced. */
export function bounds(ranges: Coverage): DateWindow | null {
  const normalized = normalize(ranges);
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first === undefined || last === undefined) return null;
  return { fromMs: first.fromMs, toMs: last.toMs };
}

/**
 * Share of the outer bounds that is actually covered, 0–1.
 *
 * One contiguous range is 1. Anything less means the record has holes, which is
 * what the coverage bar in Settings draws — a figure computed from the record
 * rather than a progress animation.
 */
export function density(ranges: Coverage): number {
  const outer = bounds(ranges);
  if (outer === null) return 0;
  const total = outer.toMs - outer.fromMs;
  return total <= 0 ? 1 : span(ranges) / total;
}

/** Drop everything before `earliest` — what a retention horizon enforces. */
export function clip(ranges: Coverage, earliest: number): Coverage {
  return normalize(
    ranges.flatMap((range) => {
      if (range.toMs <= earliest) return [];
      return [{ fromMs: Math.max(range.fromMs, earliest), toMs: range.toMs }];
    }),
  );
}

/**
 * Split a window into chunks no longer than `chunkMs`, newest first.
 *
 * Backfilling two years in one request is not an option — the route is paged at
 * 50 rows behind a per-hour rate limit — and reading newest-first means an
 * interrupted backfill leaves the *recent* history complete, which is the part
 * every screen reads.
 */
export function chunk(window: DateWindow, chunkMs: number): Coverage {
  if (chunkMs <= 0 || window.toMs <= window.fromMs) return [window];

  const chunks: DateWindow[] = [];
  let end = window.toMs;

  while (end > window.fromMs) {
    const start = Math.max(window.fromMs, end - chunkMs);
    chunks.push({ fromMs: start, toMs: end });
    end = start;
  }

  return chunks;
}
