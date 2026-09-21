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

/**
 * Treat the stretch between the newest covered instant and the present as held.
 *
 * A window that ends at "now" can never be covered by a record written a moment
 * ago: coverage stops at the instant of the last read, so `[lastRead, now]` is
 * always a hole and a question asked every minute would fetch that sliver every
 * minute. The Copilot asks exactly that window on every question, which is how a
 * freshness window comes to be defeated by arithmetic rather than by policy.
 *
 * `freshMs` is how long the newest covered instant may stand in for the present.
 * Inside it the live edge is sealed and nothing is requested; past it the hole is
 * planned as it always was and the read happens — which is what makes the
 * refresh periodic rather than never.
 *
 * Only the newest range is extended. A hole *between* two covered stretches is a
 * read that failed earlier and stays a hole however recent the record is, and an
 * empty record stays empty — a period this machine has never held is still
 * fetched on demand.
 *
 * ## The condition this function is safe under
 *
 * **`freshMs` must stay strictly below the settlement lag.** This function and
 * `unseal` act on the same end of the record in opposite directions, and the
 * planner applies them in that order: `unseal` drops the trailing lag, leaving
 * the newest covered instant at `now - lagMs`, and this function would close
 * that opening again the moment `freshMs` could reach back that far. The seal
 * applies only while `outer.toMs >= now - freshMs`, so with `outer.toMs` at
 * `now - lagMs` it applies exactly when `freshMs >= lagMs` — at which point the
 * settlement lag is silently switched off and the provisional fortnight is never
 * re-read. Every freshness window the seller can choose is far shorter than
 * `SETTLEMENT_LAG_MS`, so the two never meet; the inequality is asserted in
 * `sync/planning.test.ts` rather than left to review, because a future option of
 * "one month" would break it without touching this file.
 */
export function sealLiveEdge(ranges: Coverage, now: number, freshMs: number): Coverage {
  const covered = normalize(ranges);
  if (freshMs <= 0) return covered;

  const outer = bounds(covered);
  if (outer === null) return covered;
  if (outer.toMs < now - freshMs) return covered;

  return add(covered, { fromMs: outer.toMs, toMs: now });
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
