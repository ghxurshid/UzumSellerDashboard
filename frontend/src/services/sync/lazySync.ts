import { ApiError } from '@/services/api/client';
import { accountFingerprint } from '@/services/storage/account';
import {
  mergeExpenses,
  mergeFbsOrders,
  mergeLedger,
} from '@/services/storage/archive/archive.service';
import { chunk, normalize } from '@/services/storage/archive/coverage';
import { missingRanges, readMetadata } from '@/services/storage/idb/metadata.repo';
import {
  ENTITY_TYPES,
  WINDOWED_ENTITIES,
  type EntityType,
  type SyncMetadataRecord,
} from '@/services/storage/idb/schema';
import { readDataSettings } from '@/services/storage/settings.service';
import {
  fetchExpenses,
  fetchFbsOrders,
  fetchFinanceOrderItems,
  type DateWindow,
} from '@/services/uzum/endpoints';
import { useSyncStore } from '@/store/sync.store';

import { LEDGER_CHUNK_MS, SETTLEMENT_LAG_MS } from './archivePlan';

/**
 * Lazy sync: fetch a period only when this machine does not already hold it.
 *
 * This is the mechanism the whole storage design exists to support, and it is
 * one sentence long: **before answering any question about a period, consult
 * `sync_metadata`; fetch only the parts of that period it does not claim; then
 * answer from IndexedDB.**
 *
 * Everything follows from that.
 *
 *   • A chart, an AI analysis, a range chip and the sync button all take the
 *     same path. There is no "the sync fetches, the screens read" split, because
 *     a screen asking for January is indistinguishable from a sync asking for
 *     it — both are a window, and both are answered by the complement of what is
 *     already held.
 *
 *   • A period fetched last week costs nothing, forever. A period half held
 *     costs half a read. An empty archive costs the whole window, in chunks.
 *
 *   • The answer is always read back out of storage rather than returned from
 *     the network, so a period that was already held and one that was just
 *     fetched produce identical results. A field the mappers cannot store is
 *     therefore missing immediately and visibly, rather than working until the
 *     first reload.
 *
 * ## The settlement lag, and why it is not re-read on every glance
 *
 * Coverage younger than `SETTLEMENT_LAG_MS` is re-opened before the comparison.
 * An order item is written `PROCESSING` and becomes `TO_WITHDRAW` or `CANCELED`
 * days later; refunds land later still. Sealing coverage right up to the sync
 * instant would freeze those rows in their provisional state forever, so the
 * recent tail is deliberately forgotten and the settled weeks behind it never
 * are.
 *
 * Left at that, though, the lag re-opens the tail on *every* question — and a
 * question is asked whenever the store chip or the range changes. A user who
 * has just synced five shops and then picks one of them out of the dropdown
 * would watch the last fortnight be fetched all over again, for rows that were
 * read a minute ago. So the tail is re-opened only when the record is older than
 * the freshness window from Settings, exactly as the buffer decides for the
 * re-readable sources: within it, the archive answers from disk; past it, the
 * next question re-reads the provisional tail once and reseals it.
 *
 * An explicit sync passes `force` and always re-reads it, because that is what
 * pressing sync means. The planned archive pass in `archivePlan.ts` is
 * unaffected — it plans from the coverage record directly and always unseals.
 *
 * ## Why the in-flight registry
 *
 * Several screens can want overlapping periods at the same instant — the finance
 * source and the expenses source ask for the same window on every render of the
 * overview, and a comparison query asks for the one before it. Without
 * deduplication each would plan the same gaps, issue the same requests against a
 * rate-limited API, and race each other to write the same coverage. `pending`
 * makes the second caller await the first instead.
 */

/* ── in-flight registry ─────────────────────────────────────────────────── */

export interface LazySyncResult {
  /** Rows fetched from the network. Zero means the period was already held. */
  readonly fetched: number;
  /** Windows that were missing and had to be requested. */
  readonly gaps: number;
  /** Whether anything was requested at all — false is the cheap, common path. */
  readonly hitNetwork: boolean;
  readonly failures: readonly string[];
}

const EMPTY_RESULT: LazySyncResult = { fetched: 0, gaps: 0, hitNetwork: false, failures: [] };

/**
 * Requests currently being served, keyed by shop and window.
 *
 * Keyed on the *requested* window rather than on the gaps it resolved to,
 * because two callers asking for the same window is the case worth collapsing
 * and it is knowable before any planning happens.
 */
const pending = new Map<string, Promise<LazySyncResult>>();

function inFlightKey(shopId: number, window: DateWindow, force: boolean): string {
  /* A forced request is a different question from an ordinary one — it re-reads
     the tail — so it must not be answered by joining one already in flight. */
  return `${accountFingerprint()}:${shopId}:${window.fromMs}-${window.toMs}${force ? ':f' : ''}`;
}

/* ── the task view, for Settings ────────────────────────────────────────── */

/**
 * A lazy sync announces itself in the sync store.
 *
 * The requirement this satisfies: background and lazy fetches must be visible in
 * Settings while they happen, not only after they land. The store is the single
 * place sync state lives, so a range change that triggers a fetch shows up in
 * the settings pane, the topbar and the screen's own loading state — the same
 * three places a full sync shows up, because it is the same mechanism.
 */
function taskId(shopId: number, entity: EntityType): string {
  return `${entity}:${shopId}`;
}

/* ── planning ───────────────────────────────────────────────────────────── */

export interface PlannedGaps {
  /** The windows to fetch, newest first, already split into request-sized chunks. */
  readonly gaps: readonly DateWindow[];
  /** True when the period is held in full and no request is needed. */
  readonly covered: boolean;
}

export interface PlanOptions {
  readonly now?: number | undefined;
  /** Re-read the provisional tail whatever its age — what a sync means. */
  readonly force?: boolean | undefined;
}

/** How recent a record has to be for its tail to count as still good. */
function freshnessMs(): number {
  return readDataSettings().freshnessMinutes * 60_000;
}

/**
 * How much of this pair's tail to re-open.
 *
 * `SETTLEMENT_LAG_MS` when the record has not been touched inside the freshness
 * window — the provisional rows at the end of it may have settled since — and
 * zero when it has, because nothing can have changed that a read a moment ago
 * would not already have seen. That zero is the whole of what makes changing the
 * store chip free after a sync.
 *
 * `last_synced_at` is stamped by every coverage commit, including a backfill's,
 * so it can in principle claim the tail is fresh on the strength of a write to
 * an old window. That only ever happens during a sync, whose archive pass reads
 * the tail first and the backfill chunks after — so the claim is true when it is
 * made, and costs one deferred tail read at worst.
 */
function unsealFor(metadata: SyncMetadataRecord, now: number, force: boolean): number {
  if (force) return SETTLEMENT_LAG_MS;

  const last = metadata.last_synced_at;
  if (last === null) return SETTLEMENT_LAG_MS;

  return now - last < freshnessMs() ? 0 : SETTLEMENT_LAG_MS;
}

/**
 * What a window still needs, without fetching anything.
 *
 * Exported so the interface can answer "will changing the range cost a request?"
 * *before* the change is made — the same question `isBuffered` answers for
 * re-readable sources.
 */
export async function planWindow(
  shopId: number,
  window: DateWindow,
  entity: EntityType = ENTITY_TYPES.orderItem,
  options: PlanOptions = {},
): Promise<PlannedGaps> {
  const now = options.now ?? Date.now();
  const metadata = await readMetadata(accountFingerprint(), shopId, entity);

  const holes = missingRanges(metadata, window, {
    now,
    unsealMs: unsealFor(metadata, now, options.force === true),
  });
  const gaps = holes.flatMap((hole) =>
    chunk({ fromMs: hole.fromMs, toMs: hole.toMs }, LEDGER_CHUNK_MS),
  );

  return { gaps, covered: gaps.length === 0 };
}

/**
 * The gaps across **every** windowed entity, merged.
 *
 * Order items, expense rows and FBS orders are fetched together per window, so
 * they usually advance in step — but not always. A request whose order-item
 * write landed and whose expense write failed leaves the records disagreeing,
 * and planning from the ledger alone would then declare the window covered and
 * never repair the expense side.
 *
 * So the plan is the union of what *any* windowed entity is missing. The
 * redundant part of a repair costs one request for rows that are already held
 * and upsert to themselves, which is a far cheaper mistake than a permanent
 * hole in one of the four records.
 *
 * Snapshot entities are deliberately absent. Their routes take no date filter,
 * so a gap in one is not a question that can be asked — `snapshotSync.ts`
 * captures them whole instead.
 */
async function planSettledWindow(
  shopId: number,
  window: DateWindow,
  options: PlanOptions = {},
): Promise<PlannedGaps> {
  const account = accountFingerprint();
  const now = options.now ?? Date.now();
  const force = options.force === true;

  const records = await Promise.all(
    WINDOWED_ENTITIES.map((entity) => readMetadata(account, shopId, entity)),
  );

  /* Each entity's tail is judged on its own record: they are written by the
     same request but a failed one leaves it older than the others. */
  const holes = records.flatMap((record) =>
    missingRanges(record, window, { now, unsealMs: unsealFor(record, now, force) }),
  );

  /* Normalised so overlapping holes — one from each entity — become one request
     rather than several that fetch most of the same period again. */
  const merged = normalize(holes.map((hole) => ({ fromMs: hole.fromMs, toMs: hole.toMs })));
  const gaps = merged.flatMap((hole) => chunk(hole, LEDGER_CHUNK_MS));

  return { gaps, covered: gaps.length === 0 };
}

/** Whether every shop in a scope already holds a window in full. */
export async function isWindowCovered(
  shopIds: readonly number[],
  window: DateWindow,
  entity: EntityType = ENTITY_TYPES.orderItem,
): Promise<boolean> {
  const plans = await Promise.all(
    shopIds.map((shopId) => planWindow(shopId, window, entity)),
  );
  return plans.every((plan) => plan.covered);
}

/* ── truncation handling ────────────────────────────────────────────────── */

/** Sub-divisions a truncated window is split into before its result is accepted. */
const MAX_SPLIT_DEPTH = 3;

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function describe(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Unexpected failure';
}

/**
 * Read one window, splitting it if the page ceiling cut the read short.
 *
 * A truncated read is the one case where recording coverage would corrupt the
 * archive: the window would be marked held while containing only the rows that
 * fit inside forty pages, and no later request would ever look at it again. So a
 * truncated window is halved and each half read separately, until the reads come
 * back whole or the split depth runs out.
 *
 * At the depth limit the rows that were read are still stored and the window is
 * still recorded — a shop with more than a few thousand items in a two-day
 * window is beyond what one request can express, and looping forever on it would
 * be worse than storing what fits and saying so.
 */
async function readWindow<Row>(
  window: DateWindow,
  read: (window: DateWindow) => Promise<{ items: readonly Row[]; truncated: boolean }>,
  signal: AbortSignal | undefined,
  depth = 0,
): Promise<{ rows: readonly Row[]; capped: boolean }> {
  const page = await read(window);

  if (!page.truncated || depth >= MAX_SPLIT_DEPTH) {
    return { rows: page.items, capped: page.truncated };
  }

  const middle = Math.floor((window.fromMs + window.toMs) / 2);
  if (middle <= window.fromMs || middle >= window.toMs) {
    return { rows: page.items, capped: true };
  }

  /* Newer half first, for the same reason chunks are ordered newest-first: an
     interrupted read should leave the recent history complete. */
  const newer = await readWindow({ fromMs: middle, toMs: window.toMs }, read, signal, depth + 1);
  if (aborted(signal)) return { rows: newer.rows, capped: newer.capped };

  const older = await readWindow({ fromMs: window.fromMs, toMs: middle }, read, signal, depth + 1);

  return { rows: [...newer.rows, ...older.rows], capped: newer.capped || older.capped };
}

/* ── the run ────────────────────────────────────────────────────────────── */

export interface EnsureWindowOptions {
  readonly shopId: number;
  readonly window: DateWindow;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((done: number, total: number) => void) | undefined;
  /** Suppress the Settings task row — used by the planned sync, which has its own. */
  readonly silent?: boolean | undefined;
  /** Re-read the provisional tail whatever its age — what a sync means. */
  readonly force?: boolean | undefined;
  /**
   * Called once, only if the window turns out to need requests.
   *
   * The caller's chance to say "this one is really fetching" before it starts.
   * A screen that announced itself before planning would flash a loading row on
   * every store change for a period it already holds, which is exactly what a
   * lazy sync exists to avoid.
   */
  readonly onBegin?: (() => void) | undefined;
}

/**
 * Make sure one shop's settled history covers a window, fetching only what is
 * missing from it.
 *
 * Order items and expense rows are fetched **together** per gap, because they
 * come from the same period and the second one is free once the first has paid
 * for the round trip. Whichever source asks first therefore fills both, and the
 * other finds its window already covered — which is why the overview's finance
 * and expenses panels do not each cost a sync.
 *
 * Each gap is committed as it lands rather than at the end. There is no
 * all-or-nothing transaction here on purpose: partial progress towards a
 * complete archive is progress, and the next call picks up from the record.
 */
export function ensureWindow(options: EnsureWindowOptions): Promise<LazySyncResult> {
  const key = inFlightKey(options.shopId, options.window, options.force === true);

  const existing = pending.get(key);
  if (existing !== undefined) return existing;

  const run = execute(options).finally(() => {
    pending.delete(key);
  });

  pending.set(key, run);
  return run;
}

async function execute(options: EnsureWindowOptions): Promise<LazySyncResult> {
  const { shopId, window, signal } = options;

  const plan = await planSettledWindow(shopId, window, { force: options.force });
  if (plan.covered) {
    /* The cheap path, and the common one. Nothing is announced and nothing is
       requested — the caller reads straight from IndexedDB. */
    return EMPTY_RESULT;
  }

  options.onBegin?.();

  const store = useSyncStore.getState();
  const id = taskId(shopId, ENTITY_TYPES.orderItem);

  if (options.silent !== true) {
    store.beginTask(id, {
      label: `ledger · shop ${shopId}`,
      shopId,
      entity: ENTITY_TYPES.orderItem,
      total: plan.gaps.length,
      window,
    });
  }

  const failures: string[] = [];
  let fetched = 0;

  for (const [index, gap] of plan.gaps.entries()) {
    if (aborted(signal)) break;

    try {
      const orders = await readWindow(
        gap,
        async (slice) => {
          const page = await fetchFinanceOrderItems([shopId], slice, { signal });
          return { items: page.items, truncated: page.truncated };
        },
        signal,
      );

      /* Coverage is committed inside `mergeLedger`, after the rows land. A gap
         whose write fails stays uncovered and is planned again next time. */
      await mergeLedger(shopId, orders.rows, gap);
      fetched += orders.rows.length;

      if (!aborted(signal)) {
        const payments = await readWindow(
          gap,
          async (slice) => {
            const page = await fetchExpenses([shopId], slice, { signal });
            return { items: page.items, truncated: page.truncated };
          },
          signal,
        );

        await mergeExpenses(shopId, payments.rows, gap);
        fetched += payments.rows.length;
      }

      if (!aborted(signal)) {
        /* No status filter: it is optional at the source, so one walk reads
           every order in the window instead of eight walks reading one status
           each. Orders and their lines are written as two entities from the
           one payload. */
        const fbs = await readWindow(
          gap,
          async (slice) => {
            const page = await fetchFbsOrders([shopId], slice, null, { signal });
            return { items: page.items, truncated: page.truncated };
          },
          signal,
        );

        await mergeFbsOrders(shopId, fbs.rows, gap);
        fetched += fbs.rows.length;
      }
    } catch (error) {
      failures.push(describe(error));
      /* A failed gap simply stays uncovered; the next call plans it again.
         Continuing costs one wasted request at worst, and stopping would
         abandon gaps that might well succeed. */
    }

    const done = index + 1;
    options.onProgress?.(done, plan.gaps.length);
    if (options.silent !== true) {
      useSyncStore.getState().reportTask(id, { done, total: plan.gaps.length, rows: fetched });
    }
  }

  if (options.silent !== true) {
    const failure = failures[0];
    if (failure !== undefined && fetched === 0) {
      useSyncStore.getState().settleTask(id, { error: failure });
    } else {
      useSyncStore.getState().settleTask(id, { rows: fetched });
    }
  }

  return { fetched, gaps: plan.gaps.length, hitNetwork: true, failures };
}

/**
 * The same, for every shop in a scope, one after another.
 *
 * Sequential on purpose: the seller API rate-limits per hour and the pacer in
 * `api/rateLimit.ts` already queues everything through one channel, so firing
 * shops in parallel would buy nothing but 429s.
 */
export async function ensureWindowAcross(options: {
  readonly shopIds: readonly number[];
  readonly window: DateWindow;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((loaded: number, total: number) => void) | undefined;
  readonly silent?: boolean | undefined;
  readonly force?: boolean | undefined;
  /** Called once, before the first shop that actually needs requests. */
  readonly onBegin?: (() => void) | undefined;
}): Promise<LazySyncResult> {
  const failures: string[] = [];
  let fetched = 0;
  let gaps = 0;
  let hitNetwork = false;
  let announced = false;

  for (const [index, shopId] of options.shopIds.entries()) {
    if (aborted(options.signal)) break;

    const result = await ensureWindow({
      shopId,
      window: options.window,
      signal: options.signal,
      silent: options.silent,
      force: options.force,
      onBegin: () => {
        /* Once for the scope, not once per shop: the caller is announcing a
           source, and a source is fetched once however many shops it spans. */
        if (announced) return;
        announced = true;
        options.onBegin?.();
      },
      onProgress: (done, total) => {
        /* Progress is reported as "shops done, plus how far through the one in
           flight", scaled to a hundred steps per shop. Reporting raw gap counts
           would make the bar lurch backwards whenever a later shop turned out to
           have more holes than the first. */
        const within = total === 0 ? 1 : done / total;
        options.onProgress?.(
          Math.round((index + within) * 100),
          Math.max(1, options.shopIds.length) * 100,
        );
      },
    });

    fetched += result.fetched;
    gaps += result.gaps;
    hitNetwork = hitNetwork || result.hitNetwork;
    failures.push(...result.failures);
  }

  return { fetched, gaps, hitNetwork, failures };
}

/** Abandon the in-flight registry — used when the account changes. */
export function resetLazySync(): void {
  pending.clear();
}
