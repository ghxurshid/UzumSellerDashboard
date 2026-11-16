import { describe, expect, it } from 'vitest';

import { FRESHNESS_OPTIONS } from '@core/constants/settings';
import { trustsEmptyAnswer } from '@/services/storage/archive/archive.service';
import { emptyMetadata, missingRanges } from '@/services/storage/idb/metadata.repo';
import { ENTITY_TYPES, type SyncMetadataRecord } from '@/services/storage/idb/schema';

import { SETTLEMENT_LAG_MS, planShop } from './archivePlan';
import { isDefinitiveRefusal } from './snapshotSync';
import { ApiError } from '@/services/api/client';

/**
 * What a `sync: true` read decides to request, and what it decides to leave.
 *
 * `missingRanges` is where the whole economy of this application is settled: a
 * window it calls a gap becomes a request against an hourly budget, and a window
 * it calls held is answered from disk. Both mistakes are expensive and only one
 * of them is visible — an unnecessary request merely costs, while a gap wrongly
 * called held is a hole no later run will look at again.
 *
 * These tests are written against dates rather than durations so a failure reads
 * as a story: what was asked, what was already held, what got fetched.
 */

const minute = 60_000;
const day = 86_400_000;
const d = (n: number): number => Date.UTC(2026, 0, n);

/** An hour — the freshness window's default, and what the planner is given. */
const FRESH_MS = 60 * minute;

function record(
  ranges: readonly { fromMs: number; toMs: number }[],
  lastSyncedAt: number | null = null,
): SyncMetadataRecord {
  return {
    ...emptyMetadata('account', 7, ENTITY_TYPES.orderItem),
    synced_ranges: ranges.map((range) => ({ start: range.fromMs, end: range.toMs })),
    last_synced_at: lastSyncedAt,
  };
}

describe('missingRanges — the live edge', () => {
  const now = d(10) + 12 * 3_600_000;

  it('asks for nothing when the period is held and the last read is recent', () => {
    /* Asked `[--jan 5 .. now--]`, have `[--jan 1 .. now-5min--]`: the sliver
       since the last read is not a gap while that read is inside the freshness
       window. This is the case the Copilot hits on every single question. */
    const meta = record([{ fromMs: d(1), toMs: now - 5 * minute }], now - 5 * minute);

    expect(
      missingRanges(meta, { fromMs: d(5), toMs: now }, { now, liveEdgeMs: FRESH_MS }),
    ).toEqual([]);
  });

  it('asks for the live edge once the newest covered instant is older', () => {
    /* And this is what makes the refresh periodic rather than never. */
    const meta = record([{ fromMs: d(1), toMs: now - 90 * minute }], now - 90 * minute);

    expect(
      missingRanges(meta, { fromMs: d(5), toMs: now }, { now, liveEdgeMs: FRESH_MS }),
    ).toEqual([{ fromMs: now - 90 * minute, toMs: now }]);
  });

  it('still fetches a period this machine has never held', () => {
    /* The gate is about re-reading what is held, never about refusing history
       the seller asked for. Asked `[--dec .. now--]`, have `[--jan .. now--]`,
       fetch December. */
    const meta = record([{ fromMs: d(1), toMs: now - minute }], now - minute);

    expect(
      missingRanges(
        meta,
        { fromMs: Date.UTC(2025, 11, 1), toMs: now },
        { now, liveEdgeMs: FRESH_MS },
      ),
    ).toEqual([{ fromMs: Date.UTC(2025, 11, 1), toMs: d(1) }]);
  });

  it('keeps a hole between two covered stretches', () => {
    const meta = record(
      [
        { fromMs: d(1), toMs: d(4) },
        { fromMs: d(6), toMs: now - minute },
      ],
      now - minute,
    );

    expect(
      missingRanges(meta, { fromMs: d(1), toMs: now }, { now, liveEdgeMs: FRESH_MS }),
    ).toEqual([{ fromMs: d(4), toMs: d(6) }]);
  });

  it('fetches the whole window when nothing is held, freshness or not', () => {
    expect(
      missingRanges(record([]), { fromMs: d(5), toMs: now }, { now, liveEdgeMs: FRESH_MS }),
    ).toEqual([{ fromMs: d(5), toMs: now }]);
  });

  it('holds nothing on a single-point range', () => {
    const meta = record([{ fromMs: d(5), toMs: d(5) }], now - minute);

    expect(
      missingRanges(meta, { fromMs: d(5), toMs: now }, { now, liveEdgeMs: FRESH_MS }),
    ).toEqual([{ fromMs: d(5), toMs: now }]);
  });

  it('plans the sliver when no freshness window is given — what `force` does', () => {
    const meta = record([{ fromMs: d(1), toMs: now - 5 * minute }], now - 5 * minute);

    expect(missingRanges(meta, { fromMs: d(5), toMs: now }, { now })).toEqual([
      { fromMs: now - 5 * minute, toMs: now },
    ]);
  });
});

describe('missingRanges — the present and the future', () => {
  const now = d(10) + 12 * 3_600_000;
  /** What a day-granular request looks like: both ends of 10 January. */
  const endOfDay = d(11) - 1;

  it('never plans past the present', () => {
    /* A gap committed as covered up to 23:59:59 claims a stretch of the evening
       that has not happened yet, and nothing would ever read it. */
    const meta = record([{ fromMs: d(1), toMs: d(9) }], d(9));

    expect(missingRanges(meta, { fromMs: d(9), toMs: endOfDay }, { now })).toEqual([
      { fromMs: d(9), toMs: now },
    ]);
  });

  it('asks nothing about a window that lies entirely ahead', () => {
    expect(
      missingRanges(record([]), { fromMs: now + 3_600_000, toMs: now + 7_200_000 }, { now }),
    ).toEqual([]);
  });
});

describe('missingRanges — the settlement lag is not weakened', () => {
  const now = d(10);
  const lag = 2 * day;

  it('re-opens the provisional tail even with a freshness window in hand', () => {
    /* An unsealed record's newest covered instant is the lag boundary, which is
       far older than the freshness window — so the live edge cannot seal it and
       the fortnight of provisional rows is re-read exactly as before. */
    const meta = record([{ fromMs: d(1), toMs: now }], now);

    expect(
      missingRanges(meta, { fromMs: d(1), toMs: now }, { now, unsealMs: lag, liveEdgeMs: FRESH_MS }),
    ).toEqual([{ fromMs: d(8), toMs: now }]);
  });

  it('re-opens nothing when the caller unseals nothing', () => {
    const meta = record([{ fromMs: d(1), toMs: now }], now);

    expect(missingRanges(meta, { fromMs: d(1), toMs: now }, { now })).toEqual([]);
  });
});

describe('the freshness window against the settlement lag', () => {
  /**
   * The unwritten condition `sealLiveEdge` is safe under, written down.
   *
   * The unseal opens the trailing `SETTLEMENT_LAG_MS`, leaving the newest
   * covered instant at `now - lag`; the live-edge seal re-closes everything
   * newer than `now - freshMs`. While the widest freshness window is shorter
   * than the lag the seal cannot reach what the unseal opened, and the
   * provisional fortnight is re-read exactly as it was before the seal existed.
   * A new option of "one month" would switch the settlement lag off silently —
   * so it fails here instead.
   */
  it('keeps every freshness window the seller can choose below the settlement lag', () => {
    const widest = Math.max(...FRESHNESS_OPTIONS) * minute;
    expect(widest).toBeLessThan(SETTLEMENT_LAG_MS);
  });

  it('still re-reads the provisional tail at the widest window on offer', () => {
    const now = d(20);
    const widest = Math.max(...FRESHNESS_OPTIONS) * minute;
    const meta = record([{ fromMs: d(1), toMs: now }], now);

    expect(
      missingRanges(
        meta,
        { fromMs: d(1), toMs: now },
        { now, unsealMs: SETTLEMENT_LAG_MS, liveEdgeMs: widest },
      ),
    ).toEqual([{ fromMs: now - SETTLEMENT_LAG_MS, toMs: now }]);
  });
});

describe('planShop — a planned pass always unseals', () => {
  it('emits the provisional tail however recently the shop was synced', () => {
    const now = d(20);
    const meta = record([{ fromMs: now - 90 * day, toMs: now - minute }], now - minute);

    const plan = planShop(meta, { now });
    const tail = plan.steps.filter((step) => step.kind === 'tail');

    expect(tail.length).toBeGreaterThan(0);
    expect(Math.max(...tail.map((step) => step.window.toMs))).toBe(now);
    expect(Math.min(...tail.map((step) => step.window.fromMs))).toBeLessThanOrEqual(
      now - SETTLEMENT_LAG_MS,
    );
  });
});

describe('trustsEmptyAnswer — which empty answers suppress a retry', () => {
  it('believes an empty collection that a seller may honestly not have', () => {
    /* The case the read stamp exists for: no warehouse returns, no supply
       invoices, no FBS shipments. Nothing on screen misreports while that
       holds, and re-asking costs one request per collection per question. */
    expect(trustsEmptyAnswer(ENTITY_TYPES.sellerReturn, null)).toBe(true);
    expect(trustsEmptyAnswer(ENTITY_TYPES.supplyInvoice, null)).toBe(true);
    expect(trustsEmptyAnswer(ENTITY_TYPES.fbsInvoice, null)).toBe(true);
    expect(trustsEmptyAnswer(ENTITY_TYPES.fbsStock, null)).toBe(true);
  });

  it('refuses an empty catalogue that has never been captured', () => {
    /* A route that briefly answered nothing — a rate limit, or an envelope the
       page walker did not recognise — must be asked again on the next read, not
       be believed for a whole freshness window with the products and stock
       screens blank behind it. */
    expect(trustsEmptyAnswer(ENTITY_TYPES.product, null)).toBe(false);
    expect(trustsEmptyAnswer(ENTITY_TYPES.productSku, null)).toBe(false);
  });

  it('believes an empty catalogue once a capture is held', () => {
    /* A shop that has a capture behind it can have emptied its catalogue, and
       the previous rows stay on screen either way — so the cheap answer wins. */
    expect(trustsEmptyAnswer(ENTITY_TYPES.product, Date.UTC(2026, 0, 1))).toBe(true);
    expect(trustsEmptyAnswer(ENTITY_TYPES.productSku, Date.UTC(2026, 0, 1))).toBe(true);
  });
});

describe('isDefinitiveRefusal', () => {
  const fail = (status: number | undefined, kind: ApiError['kind']): ApiError =>
    new ApiError('refused', status === undefined ? { kind } : { status, kind });

  it('accepts a 4xx that is neither a token problem nor a budget one', () => {
    /* `/v1/fbs/invoice` on an FBO-only account: the route will refuse for ever,
       so asking again inside the freshness window buys nothing. */
    expect(isDefinitiveRefusal(fail(400, 'client'))).toBe(true);
    expect(isDefinitiveRefusal(fail(403, 'forbidden'))).toBe(true);
    expect(isDefinitiveRefusal(fail(404, 'notFound'))).toBe(true);
  });

  it('refuses everything that says nothing about the route', () => {
    expect(isDefinitiveRefusal(fail(401, 'unauthorized'))).toBe(false);
    expect(isDefinitiveRefusal(fail(429, 'rateLimited'))).toBe(false);
    expect(isDefinitiveRefusal(fail(500, 'server'))).toBe(false);
    expect(isDefinitiveRefusal(fail(undefined, 'timeout'))).toBe(false);
    expect(isDefinitiveRefusal(fail(undefined, 'network'))).toBe(false);
    expect(isDefinitiveRefusal(fail(undefined, 'cancelled'))).toBe(false);
    expect(isDefinitiveRefusal(fail(undefined, 'unconfigured'))).toBe(false);
    expect(isDefinitiveRefusal(new Error('boom'))).toBe(false);
  });
});
