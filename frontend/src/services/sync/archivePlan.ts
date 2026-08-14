import { bounds, chunk, missing, unseal, type Coverage } from '@/services/storage/archive/coverage';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import type { SyncMetadataRecord } from '@/services/storage/idb/schema';
import type { DateWindow } from '@/services/uzum/endpoints';

/**
 * What a sync should fetch, decided from the coverage record alone.
 *
 * This is the migration model the archive is built on. A migration runner does
 * not ask the database what its tables look like; it reads a table of which
 * migrations have been applied and runs the ones that have not. The same shape
 * applies here: `sync_metadata` says which stretches of a shop's history have
 * already been pulled, and the planner emits requests only for the complement.
 * Nothing scans the stored rows to work this out, so planning costs one keyed
 * read regardless of how many rows the archive holds.
 *
 * Three rules govern every plan.
 *
 *  1. **The tail is never sealed.** An order item is written `PROCESSING` and
 *     becomes `TO_WITHDRAW` or `CANCELED` days later; refunds land later still.
 *     Coverage younger than the settlement lag is deliberately forgotten on
 *     every run and re-read, so provisional rows get corrected. Only rows older
 *     than the lag are treated as the settled history the user described — a
 *     sale on 10 August at 16:12:21 that will never change again.
 *
 *  2. **History is walked backwards, in bounded steps.** A first sync does not
 *     try to pull two years in one run: the route pages at fifty rows behind a
 *     per-hour rate limit, and doing so would spend the day's budget before the
 *     first screen rendered. Each run reaches a little further back, and the
 *     archive converges without anyone waiting for it.
 *
 *  3. **Recent first, always.** Chunks are emitted newest to oldest, so a run
 *     that is cancelled or rate-limited half way leaves the recent history
 *     complete — which is the part every screen actually reads.
 */

const DAY_MS = 86_400_000;

/**
 * How long a row stays provisional.
 *
 * Two weeks covers the ordinary path from order to settlement, including the
 * return window that decides whether `sellerProfit` survives. Sealing sooner
 * would freeze cancellations that had not happened yet; sealing later would
 * re-read months of stable rows on every sync for nothing.
 */
export const SETTLEMENT_LAG_MS = 14 * DAY_MS;

/** One request per month of history: large enough to be few, small enough to page. */
export const LEDGER_CHUNK_MS = 30 * DAY_MS;

const CHUNK_MS = LEDGER_CHUNK_MS;

/** How far back a backfill will ever reach. */
const HORIZON_MS = 730 * DAY_MS;

/** What a first sync pulls before the backfill takes over. */
const INITIAL_DEPTH_MS = 90 * DAY_MS;

/** Chunks of older history an ordinary sync will add. */
const BACKFILL_CHUNKS_PER_SYNC = 2;

/** Chunks an explicit "continue backfill" run will add. */
const BACKFILL_CHUNKS_PER_RUN = 12;

export type StepKind =
  /** The unsealed tail plus anything recent that was never read. */
  | 'tail'
  /** A hole between two covered stretches — usually a failed earlier run. */
  | 'gap'
  /** History older than anything held. */
  | 'backfill';

export interface PlanStep {
  readonly window: DateWindow;
  readonly kind: StepKind;
}

export interface ArchivePlan {
  readonly shopId: number;
  readonly steps: readonly PlanStep[];
  /** True when this shop has never stored a row — the genesis run. */
  readonly genesis: boolean;
  /** Where the backfill has reached, and whether it has found the end. */
  readonly backfillFrom: number | null;
  readonly backfillComplete: boolean;
}

export interface PlanOptions {
  readonly now: number;
  /** An explicit backfill run reaches much further per pass than a sync does. */
  readonly deep?: boolean;
  /** The window currently on screen, always refreshed regardless of coverage. */
  readonly visible?: DateWindow | undefined;
}

/**
 * Steps that bring the recent record up to date.
 *
 * The target is whatever is newer of the initial depth and the window on
 * screen: a user who has switched the range chip to "this year" is asking about
 * a period the archive may not hold yet, and the sync they press afterwards
 * should fetch it rather than report on a window it never read.
 */
function recentSteps(covered: Coverage, options: PlanOptions): readonly PlanStep[] {
  const { now } = options;
  const earliest = Math.min(
    now - INITIAL_DEPTH_MS,
    options.visible?.fromMs ?? now - INITIAL_DEPTH_MS,
  );

  const target: DateWindow = { fromMs: earliest, toMs: now };
  const holes = missing(target, covered);
  const outer = bounds(covered);

  return holes.flatMap((hole) =>
    chunk(hole, CHUNK_MS).map((window): PlanStep => ({
      window,
      /* A hole that ends before the record does is a real gap — an earlier run
         failed there. One that runs to now is just the unsealed tail. */
      kind: outer !== null && hole.toMs < outer.toMs ? 'gap' : 'tail',
    })),
  );
}

/**
 * Steps that extend the record backwards.
 *
 * Nothing is emitted once the backwards walk has found the start of the shop's
 * history, or once it has reached the horizon. Both are recorded in the meta so
 * that the decision survives a reload and the walk never restarts from scratch.
 */
function backfillSteps(
  meta: SyncMetadataRecord,
  covered: Coverage,
  options: PlanOptions,
): readonly PlanStep[] {
  if (meta.backfill_complete) return [];

  const { now } = options;
  const horizon = now - HORIZON_MS;

  const outer = bounds(covered);
  const reached = meta.backfill_from ?? outer?.fromMs ?? now - INITIAL_DEPTH_MS;
  if (reached <= horizon) return [];

  const limit = options.deep === true ? BACKFILL_CHUNKS_PER_RUN : BACKFILL_CHUNKS_PER_SYNC;
  const from = Math.max(horizon, reached - limit * CHUNK_MS);

  return chunk({ fromMs: from, toMs: reached }, CHUNK_MS).map((window): PlanStep => ({
    window,
    kind: 'backfill',
  }));
}

/**
 * Plan one shop's ledger sync.
 *
 * An empty archive produces the genesis plan: the initial depth, in chunks,
 * newest first — which is the "if storage is empty, pull everything" case,
 * bounded so that it cannot spend the whole request budget on the first press.
 * A populated archive produces only the tail, any gaps, and the next couple of
 * chunks of older history.
 */
export function planShop(meta: SyncMetadataRecord, options: PlanOptions): ArchivePlan {
  const ranges = toCoverage(meta.synced_ranges);
  const covered = unseal(ranges, options.now, SETTLEMENT_LAG_MS);
  const genesis = ranges.length === 0;

  const steps = [...recentSteps(covered, options), ...backfillSteps(meta, covered, options)];
  const oldest = steps.reduce<number | null>(
    (lowest, step) => (lowest === null ? step.window.fromMs : Math.min(lowest, step.window.fromMs)),
    null,
  );

  return {
    shopId: meta.store_id,
    steps,
    genesis,
    backfillFrom: oldest ?? meta.backfill_from,
    backfillComplete: meta.backfill_complete,
  };
}

/**
 * Whether the backwards walk has hit the start of the shop's history.
 *
 * The API has no "when did this shop open" field, so the end of history is
 * inferred: two consecutive month-long chunks that come back with nothing mean
 * there is nothing older. One empty chunk is not enough — a shop that paused
 * for a month would otherwise have everything before the pause written off.
 */
export function backfillFinished(emptyChunks: number, reachedHorizon: boolean): boolean {
  return reachedHorizon || emptyChunks >= 2;
}

/** The furthest back any plan will ever reach. */
export function backfillHorizon(now: number): number {
  return now - HORIZON_MS;
}
