import { ApiError } from '@/services/api/client';
import {
  ENTITY_TYPES,
  mergeExpenses,
  mergeFbsOrders,
  mergeLedger,
  readMeta,
  recordBackfill,
  stampSynced,
  type MergeOutcome,
} from '@/services/storage/archive/archive.service';
import type { ChangeEvent } from '@/services/storage/archive/codec';
import type { EntityType } from '@/services/storage/idb/schema';
import {
  fetchExpenses,
  fetchFbsOrders,
  fetchFinanceOrderItems,
  fetchSkuStocks,
  type DateWindow,
} from '@/services/uzum/endpoints';
import type { SkuAmount } from '@/services/uzum/types';

import {
  backfillFinished,
  backfillHorizon,
  planShop,
  type PlanStep,
} from './archivePlan';
import { ensureWindow } from './lazySync';
import { captureSnapshots, type SnapshotReport } from './snapshotSync';

/**
 * Running an archive plan.
 *
 * The planner decides *what* to fetch; this decides nothing and simply carries
 * it out, one window at a time, per shop. Requests are sequential throughout —
 * the seller API rate-limits per hour and the pacer in `api/rateLimit.ts`
 * already queues everything through one channel, so firing windows in parallel
 * would buy nothing but 429s.
 *
 * The data falls into three groups, handled on their own terms:
 *
 *   **Windowed history** — order items, expense rows, FBS orders and their
 *   lines. Fetched only for windows `sync_metadata` says are missing, upserted
 *   by record id, and the window recorded as covered *after* the write lands.
 *   These are exactly the entities whose route accepts `dateFrom`/`dateTo`; the
 *   coincidence is not one, since a period can only be claimed for a route that
 *   will filter by it.
 *
 *   **Snapshots** — the catalogue, FBS stock, invoices and returns. Re-read
 *   whole on every run, because there is no window to fill: a stock level is a
 *   claim about this instant, and their routes accept nothing but `page` and
 *   `size` anyway. See `snapshotSync.ts`.
 *
 *   **Changes to snapshots.** The seller API publishes no change history, so it
 *   is produced by diffing the new catalogue capture against the stored one.
 *   See `archive/codec.ts` for why that is the only way to get it.
 */

/** Sub-divisions a truncated window is split into before the result is accepted. */
const MAX_SPLIT_DEPTH = 3;

export interface ShopSyncReport {
  readonly shopId: number;
  /** Windows the plan asked for, and how many were actually read. */
  readonly windows: number;
  readonly windowsDone: number;
  readonly ledger: MergeOutcome;
  readonly expenses: MergeOutcome;
  readonly fbsOrders: MergeOutcome;
  /** Rows captured per snapshot entity. */
  readonly snapshots: Readonly<Partial<Record<EntityType, number>>>;
  /** What changed since the previous catalogue capture. */
  readonly changes: readonly ChangeEvent[];
  readonly genesis: boolean;
  readonly backfillComplete: boolean;
  readonly failures: readonly string[];
}

export interface ArchiveSyncOptions {
  readonly shopId: number;
  readonly now?: number;
  /** An explicit "continue backfill" run, which reaches much further back. */
  readonly deep?: boolean;
  /** The range currently on screen — always brought up to date. */
  readonly visible?: DateWindow | undefined;
  readonly signal?: AbortSignal | undefined;
  /** FBS amounts, read once per sync and shared across shops. */
  readonly stocks?: readonly SkuAmount[];
  readonly onStep?: (done: number, total: number, kind: PlanStep['kind']) => void;
  /** Called when a shop's walk begins, so the UI can name what is in flight. */
  readonly onShop?: (shopId: number, index: number, total: number) => void;
}

const EMPTY_MERGE: MergeOutcome = {
  stored: false,
  added: 0,
  updated: 0,
  rows: 0,
  evicted: 0,
};

function sumMerge(a: MergeOutcome, b: MergeOutcome): MergeOutcome {
  return {
    stored: a.stored || b.stored,
    added: a.added + b.added,
    updated: a.updated + b.updated,
    /* Row counts are totals of the whole entity after the write, not of this
       window, so the later figure supersedes rather than adds. */
    rows: Math.max(a.rows, b.rows),
    evicted: a.evicted + b.evicted,
  };
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function describe(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Unexpected failure';
}

/* ── windowed history ───────────────────────────────────────────────────── */

/**
 * Read one window, splitting it if the page ceiling cut the read short.
 *
 * A truncated read is the one case where recording coverage would corrupt the
 * archive: the window would be marked done while holding only the rows that fit
 * inside forty pages, and no later sync would ever look at it again. So a
 * truncated window is halved and each half read separately, until the reads
 * come back whole or the split depth runs out.
 *
 * At the depth limit the rows that were read are still stored and the window is
 * still recorded — a shop with more than a few thousand items in a two-day
 * window is beyond what one request can express, and looping forever on it
 * would be worse than storing what fits and saying so.
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

  /* Newer half first, for the same reason chunks are ordered newest-first. */
  const newer = await readWindow({ fromMs: middle, toMs: window.toMs }, read, signal, depth + 1);
  if (aborted(signal)) return { rows: newer.rows, capped: newer.capped };

  const older = await readWindow({ fromMs: window.fromMs, toMs: middle }, read, signal, depth + 1);

  return {
    rows: [...newer.rows, ...older.rows],
    capped: newer.capped || older.capped,
  };
}

/* ── the run ────────────────────────────────────────────────────────────── */

/**
 * Bring one shop's archive up to date.
 *
 * Every window that lands is committed immediately rather than at the end, so a
 * run that is cancelled or rate-limited half way keeps what it managed to read
 * and the coverage record reflects exactly that. There is no all-or-nothing
 * transaction here on purpose: partial progress towards a complete archive is
 * progress, and the next run picks up from the record.
 */
export async function syncShopArchive(options: ArchiveSyncOptions): Promise<ShopSyncReport> {
  const { shopId, signal } = options;
  const now = options.now ?? Date.now();

  const meta = await readMeta(shopId, ENTITY_TYPES.orderItem);
  const plan = planShop(meta, {
    now,
    ...(options.deep !== undefined ? { deep: options.deep } : {}),
    visible: options.visible,
  });

  const failures: string[] = [];
  let ledger = EMPTY_MERGE;
  let expenses = EMPTY_MERGE;
  let fbsOrders = EMPTY_MERGE;
  let windowsDone = 0;
  let emptyBackfillChunks = 0;
  let reachedHorizon = false;

  /* Announced before the first request so the plan's size is on screen while it
     runs, not only once it has finished. */
  options.onStep?.(0, plan.steps.length, 'tail');

  for (const step of plan.steps) {
    if (aborted(signal)) break;

    try {
      const orders = await readWindow(
        step.window,
        async (window) => {
          const page = await fetchFinanceOrderItems([shopId], window, { signal });
          return { items: page.items, truncated: page.truncated };
        },
        signal,
      );

      ledger = sumMerge(ledger, await mergeLedger(shopId, orders.rows, step.window));

      if (!aborted(signal)) {
        const payments = await readWindow(
          step.window,
          async (window) => {
            const page = await fetchExpenses([shopId], window, { signal });
            return { items: page.items, truncated: page.truncated };
          },
          signal,
        );

        expenses = sumMerge(expenses, await mergeExpenses(shopId, payments.rows, step.window));
      }

      if (!aborted(signal)) {
        /* Read without a status filter — it is optional at the source, so one
           walk covers the window instead of one per status. */
        const fbs = await readWindow(
          step.window,
          async (window) => {
            const page = await fetchFbsOrders([shopId], window, null, { signal });
            return { items: page.items, truncated: page.truncated };
          },
          signal,
        );

        const outcome = await mergeFbsOrders(shopId, fbs.rows, step.window);
        fbsOrders = sumMerge(fbsOrders, outcome.orders);
      }

      /* Two consecutive empty months, walking backwards, is how the start of a
         shop's history is found — the API has no field that states it. */
      if (step.kind === 'backfill') {
        emptyBackfillChunks = orders.rows.length === 0 ? emptyBackfillChunks + 1 : 0;
        if (step.window.fromMs <= backfillHorizon(now)) reachedHorizon = true;
      }

      windowsDone += 1;
      options.onStep?.(windowsDone, plan.steps.length, step.kind);
    } catch (error) {
      failures.push(describe(error));
      /* A failed window simply stays uncovered; the next run will plan it as a
         gap. Continuing costs one wasted request at worst, and stopping would
         abandon windows that might well succeed. */
    }
  }

  /* The snapshots, once per run rather than once per window. */
  let snapshots: SnapshotReport | null = null;

  if (!aborted(signal)) {
    snapshots = await captureSnapshots({
      shopId,
      now,
      signal,
      /* A planned run means "go and look now", so nothing is skipped for age. */
      force: true,
      ...(options.stocks !== undefined ? { stocks: options.stocks } : {}),
    });
    failures.push(...snapshots.failures);
  }

  const backfillComplete =
    plan.backfillComplete || backfillFinished(emptyBackfillChunks, reachedHorizon);

  await recordBackfill(shopId, { from: plan.backfillFrom, complete: backfillComplete });
  if (!aborted(signal)) await stampSynced(shopId, now);

  return {
    shopId,
    windows: plan.steps.length,
    windowsDone,
    ledger,
    expenses,
    fbsOrders,
    snapshots: snapshots?.captured ?? {},
    changes: snapshots?.changes ?? [],
    genesis: plan.genesis,
    backfillComplete,
    failures,
  };
}

/**
 * Make sure one shop's windowed history covers a window.
 *
 * Kept as a named export because it is the vocabulary the rest of the app uses,
 * but the mechanism lives in `lazySync.ts` — the same code path a chart or an AI
 * analysis takes when it asks about a period. There is deliberately no separate
 * "sync fetches, screens read" split: a screen asking for January and a sync
 * asking for it are the same request, answered by the complement of what
 * `sync_metadata` already claims.
 */
export async function ensureLedgerWindow(options: {
  readonly shopId: number;
  readonly window: DateWindow;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((loaded: number, total: number) => void) | undefined;
}): Promise<{ readonly fetched: number; readonly failures: readonly string[] }> {
  const result = await ensureWindow({
    shopId: options.shopId,
    window: options.window,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  return { fetched: result.fetched, failures: result.failures };
}

/**
 * Sync several shops, one after another.
 *
 * FBS stock amounts are account-wide rather than per shop, so they are read
 * once here and handed to each shop's run — the alternative is the same
 * paginated read repeated per shop for identical rows.
 */
export async function syncArchives(
  shopIds: readonly number[],
  options: Omit<ArchiveSyncOptions, 'shopId'>,
): Promise<readonly ShopSyncReport[]> {
  const reports: ShopSyncReport[] = [];

  let stocks: readonly SkuAmount[] = options.stocks ?? [];
  if (stocks.length === 0 && !aborted(options.signal)) {
    try {
      stocks = (await fetchSkuStocks({ signal: options.signal })).items;
    } catch {
      /* An account without FBS answers this route with nothing useful. The
         catalogue capture still works; those SKUs simply carry no FBS amount. */
      stocks = [];
    }
  }

  for (const [index, shopId] of shopIds.entries()) {
    if (aborted(options.signal)) break;
    options.onShop?.(shopId, index, shopIds.length);
    reports.push(await syncShopArchive({ ...options, shopId, stocks }));
  }

  return reports;
}
