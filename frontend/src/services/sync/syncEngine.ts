import type { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/services/api/client';
import type { Scope } from '@/services/api/queryKeys';
import type { SourceProgressReporter } from '@/services/queries/progress';
import {
  SOURCE_IDS,
  expensesQuery,
  financeQuery,
  invoicesQuery,
  ordersQuery,
  productsQuery,
  stocksQuery,
  type SourceId,
} from '@/services/queries/sources';
import { useArchiveStore } from '@/store/archive.store';
import { useFiltersStore } from '@/store/filters.store';
import { useSyncStore } from '@/store/sync.store';

import { syncArchives, type ShopSyncReport } from './archiveSync';

/**
 * The synchronisation engine — one run, wherever it is started from.
 *
 * There are four places a user can start a sync: the topbar button, the command
 * palette, the settings pane and the "data is stale" banner. They are four
 * buttons, not four operations. This module is the single runner they all call,
 * and it holds the only abort controller and the only in-flight promise, so:
 *
 *   • Pressing sync while one is already going **joins** that run and returns
 *     its promise, rather than starting a second read of the same endpoints
 *     against a rate-limited API.
 *   • Cancelling from anywhere cancels the run, whichever button began it.
 *   • The outcome is published once, to subscribers, so exactly one toast is
 *     raised no matter which surface triggered it.
 *
 * State lives in `store/sync.store.ts` and is written only from here. Every
 * indicator in the application — the topbar bar, the settings pane, the screen
 * banner — is a read of that store, which is what makes them agree with each
 * other by construction rather than by discipline.
 */

/** How many rows a source's result represents, for the progress line and log. */
type RowCounter = (data: unknown) => { rows: number; truncated: boolean };

interface SourcePlan {
  readonly id: SourceId;
  readonly run: (
    client: QueryClient,
    scope: Scope,
    onProgress: SourceProgressReporter,
  ) => Promise<unknown>;
  readonly count: RowCounter;
}

function counted<T>(pick: (data: T) => { rows: number; truncated?: boolean }): RowCounter {
  return (data) => {
    const result = pick(data as T);
    return { rows: result.rows, truncated: result.truncated ?? false };
  };
}

const PLAN: readonly SourcePlan[] = [
  {
    id: 'products',
    run: (client, scope, onProgress) =>
      client.fetchQuery(productsQuery(scope, { sync: true, force: true, onProgress })),
    count: counted<{ products: readonly unknown[]; truncated: boolean }>((data) => ({
      rows: data.products.length,
      truncated: data.truncated,
    })),
  },
  {
    id: 'stocks',
    run: (client, scope, onProgress) => client.fetchQuery(stocksQuery(scope, { sync: true, force: true, onProgress })),
    count: counted<{ stocks: readonly unknown[]; truncated: boolean }>((data) => ({
      rows: data.stocks.length,
      truncated: data.truncated,
    })),
  },
  {
    id: 'finance',
    /* Forced, like every other source in a planned run: pressing sync means
       "go and look now", so the provisional tail is re-read whatever its age.
       A screen asking for the same window never forces, and is answered from
       the archive. */
    run: (client, scope, onProgress) =>
      client.fetchQuery(financeQuery(scope, { sync: true, force: true, onProgress })),
    count: counted<{ items: readonly unknown[]; total: number; truncated: boolean }>((data) => ({
      rows: data.total,
      truncated: data.truncated,
    })),
  },
  {
    id: 'expenses',
    run: (client, scope, onProgress) =>
      client.fetchQuery(expensesQuery(scope, { sync: true, force: true, onProgress })),
    count: counted<{ payments: readonly unknown[]; truncated: boolean }>((data) => ({
      rows: data.payments.length,
      truncated: data.truncated,
    })),
  },
  {
    id: 'orders',
    run: (client, scope, onProgress) =>
      client.fetchQuery(ordersQuery(scope, { sync: true, force: true, onProgress })),
    count: counted<{ total: number }>((data) => ({ rows: data.total })),
  },
  {
    id: 'invoices',
    run: (client, scope, onProgress) =>
      client.fetchQuery(invoicesQuery(scope, { sync: true, force: true, onProgress })),
    count: counted<{ supply: readonly unknown[]; returns: readonly unknown[] }>((data) => ({
      rows: data.supply.length + data.returns.length,
    })),
  },
];

export interface SyncResult {
  readonly phase: 'success' | 'partial' | 'error' | 'cancelled';
  readonly failed: readonly SourceId[];
  readonly rows: number;
  /** What the archive pass added, per shop. Empty when it did not run. */
  readonly archive: readonly ShopSyncReport[];
}

export interface SyncRequest {
  readonly client: QueryClient;
  readonly scope: Scope;
  /** Only these sources — a retry from the partial-data banner. */
  readonly only?: readonly SourceId[] | undefined;
}

/* ── the one in-flight operation ────────────────────────────────────────── */

interface ActiveRun {
  readonly promise: Promise<SyncResult>;
  readonly controller: AbortController;
  /** Sources this run covers, so a narrower retry can tell it is not enough. */
  readonly sources: readonly SourceId[];
}

let active: ActiveRun | null = null;

/** True while any API-heavy run — a sync or a backfill — is going. */
export function isSyncing(): boolean {
  return active !== null;
}

/**
 * Cancel the run in flight, wherever it was started.
 *
 * Both halves have to be told: the six sources go through the query client and
 * stop via `cancelQueries`, while the archive pass reads outside it and stops
 * on the abort signal.
 */
export function cancelSync(client?: QueryClient): void {
  const run = active;
  if (run === null) return;

  run.controller.abort();
  void client?.cancelQueries({ queryKey: ['uzum', 'source'] });
}

/* ── result subscribers ─────────────────────────────────────────────────── */

type ResultListener = (result: SyncResult) => void;

const listeners = new Set<ResultListener>();

/**
 * Be told when a run finishes.
 *
 * Exactly one place in the application subscribes to raise toasts, which is why
 * starting a sync from Settings and from the topbar produce the same single
 * notification instead of one each.
 */
export function subscribeToSyncResult(listener: ResultListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(result: SyncResult): void {
  for (const listener of listeners) listener(result);
}

/* ── the run ────────────────────────────────────────────────────────────── */

async function execute(request: SyncRequest, controller: AbortController): Promise<SyncResult> {
  const { client } = request;
  const store = useSyncStore.getState();

  const selected = request.only ?? SOURCE_IDS;
  const plan = PLAN.filter((entry) => selected.includes(entry.id));

  /* Re-resolve the window against the clock: a sync started at 18:04 must
     report on the period ending 18:04, not the one the tab opened with. */
  useFiltersStore.getState().refreshWindow();
  const current: Scope = {
    ...request.scope,
    fromMs: useFiltersStore.getState().windowFromMs,
    toMs: useFiltersStore.getState().windowToMs,
  };

  store.begin(plan.map((entry) => entry.id));

  const failed: SourceId[] = [];
  let rows = 0;

  for (const entry of plan) {
    if (controller.signal.aborted) break;
    useSyncStore.getState().beginSource(entry.id);

    try {
      const data = await entry.run(client, current, (progress) => {
        useSyncStore
          .getState()
          .reportSource(entry.id, { loaded: progress.loaded, total: progress.total });
      });

      const tally = entry.count(data);
      rows += tally.rows;
      useSyncStore.getState().settleSource(entry.id, tally);
    } catch (error) {
      if (controller.signal.aborted) break;
      const message = error instanceof ApiError ? error.message : 'Unexpected failure';
      failed.push(entry.id);
      useSyncStore.getState().settleSource(entry.id, { error: message });
    }
  }

  const outcome: SyncResult['phase'] = controller.signal.aborted
    ? 'cancelled'
    : failed.length === 0
      ? 'success'
      : failed.length === plan.length
        ? 'error'
        : 'partial';

  /**
   * The archive pass.
   *
   * Runs after the screens have their data, and per shop rather than for the
   * consolidated selection: the archive is partitioned by shop, so a
   * consolidated read would have nowhere truthful to store its rows. It fetches
   * only what the coverage record says is missing, so on a shop that synced an
   * hour ago this costs one short window and a catalogue read — and on an empty
   * one it is the first instalment of the backfill.
   */
  const archive =
    outcome === 'cancelled'
      ? []
      : await runArchivePass(current, controller, { deep: false });

  useSyncStore.getState().finish(outcome);

  return { phase: outcome, failed, rows, archive };
}

/**
 * Walk the archive for every shop in scope, reporting as it goes.
 *
 * Shared by the ordinary sync and the explicit backfill; the only difference
 * between them is how far back the planner is allowed to reach.
 */
async function runArchivePass(
  scope: Scope,
  controller: AbortController,
  options: { readonly deep: boolean },
): Promise<readonly ShopSyncReport[]> {
  const store = useSyncStore.getState();
  store.beginArchive(scope.shopIds.length);

  try {
    const reports = await syncArchives(scope.shopIds, {
      deep: options.deep,
      visible: { fromMs: scope.fromMs, toMs: scope.toMs },
      signal: controller.signal,
      onShop: (shopId, index, total) => {
        useSyncStore.getState().reportArchive({
          shopId,
          shopsDone: index,
          shopsTotal: total,
          windowsDone: 0,
          windowsTotal: 0,
        });
      },
      onStep: (done, total) => {
        useSyncStore.getState().reportArchive({ windowsDone: done, windowsTotal: total });
      },
    });

    const added = reports.reduce(
      (sum, report) => sum + report.ledger.added + report.expenses.added,
      0,
    );
    const changes = reports.reduce((sum, report) => sum + report.changes.length, 0);
    const failure = reports.flatMap((report) => report.failures)[0];

    useSyncStore.getState().reportArchive({ shopsDone: reports.length });

    if (failure !== undefined) useSyncStore.getState().settleArchive({ error: failure });
    else useSyncStore.getState().settleArchive({ rows: added, changes });

    /* Awaited, so the Data pane and the coverage bars are showing the record
       that was just written by the time the run's result is published. */
    await useArchiveStore.getState().refresh();
    return reports;
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Unexpected failure';
    useSyncStore.getState().settleArchive({ error: message });
    return [];
  }
}

/**
 * Start a sync, or join the one already running.
 *
 * Joining rather than queueing is deliberate. A second press while a read is
 * walking forty pages does not mean "do it twice"; it means "I want fresh data",
 * and the run already in flight is fresher than anything a duplicate could
 * produce. The only case that would justify a second run is a retry for sources
 * the active run is not covering, and that is what the check below allows.
 */
export function runSync(request: SyncRequest): Promise<SyncResult> {
  const run = active;

  if (run !== null) {
    const wanted = request.only ?? SOURCE_IDS;
    const covered = wanted.every((id) => run.sources.includes(id));
    if (covered) return run.promise;

    /* A retry for something the active run is not fetching would otherwise be
       silently dropped. Waiting is the honest answer — the API is the shared
       constraint, not this module. */
    return run.promise.then(() => runSync(request));
  }

  const controller = new AbortController();
  const sources = request.only ?? SOURCE_IDS;

  const promise = execute(request, controller)
    .catch((error: unknown): SyncResult => {
      console.error('Sync failed unexpectedly', error);
      useSyncStore.getState().finish('error');
      return { phase: 'error', failed: [...sources], rows: 0, archive: [] };
    })
    .then((result) => {
      active = null;
      publish(result);
      return result;
    });

  active = { promise, controller, sources };
  return promise;
}

/**
 * Extend the archive further back, without touching the screens.
 *
 * Shares the engine's single-run rule: the seller API's rate limit is the
 * reason a sync does not run twice at once, and it applies just as much to a
 * backfill that walks a year of history.
 */
export function runBackfill(scope: Scope): Promise<readonly ShopSyncReport[]> {
  if (active !== null) return active.promise.then(() => []);

  const controller = new AbortController();

  /**
   * Note what this deliberately does *not* do: it never calls `finish`, and so
   * never moves `lastSyncAt`. A backfill fetches history nobody is looking at;
   * the six sources behind the current screen are untouched by it, and stamping
   * the run as a sync would tell the user their screen was refreshed when it
   * was not. Its progress shows on the archive row and in the Data pane, which
   * is where the work actually landed.
   */
  const promise = runArchivePass(scope, controller, { deep: true });

  /* Registered in the same slot so the topbar's cancel and the busy checks see
     it, wrapped to satisfy the slot's result type without inventing figures. */
  active = {
    promise: promise.then(
      (): SyncResult => ({ phase: 'success', failed: [], rows: 0, archive: [] }),
    ),
    controller,
    sources: [],
  };

  return promise.finally(() => {
    active = null;
  });
}
