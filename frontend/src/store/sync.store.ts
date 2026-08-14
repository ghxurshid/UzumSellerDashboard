import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { readKv, writeKv } from '@/services/storage/idb/kv.repo';
import { KV_KEYS, type EntityType } from '@/services/storage/idb/schema';
import { SOURCE_IDS, type SourceId } from '@/services/queries/sourceIds';
import type { DateWindow } from '@/services/uzum/endpoints';

/**
 * Synchronisation state — the one place a sync is observable from.
 *
 * A sync is a real, observable operation: it reads N sources in sequence, each
 * one either lands or fails with a reason, and the run as a whole ends in
 * success, partial success, failure or cancellation. Nothing in this store is
 * animated or estimated. A source's progress is the row count the API itself
 * reported against the rows read so far, and where the route publishes no total
 * — the bare-array collections do not — the progress is `null` and the bar that
 * draws it says "working" rather than inventing a percentage.
 *
 * Every trigger point writes here and every indicator reads here, which is what
 * makes the sync single: the topbar button, the command palette, the settings
 * pane and the stale-data banner are four views of this object, not four
 * operations.
 *
 * Three kinds of work are tracked, because they are genuinely different and
 * flattening them would make one of the three lie:
 *
 *   1. **Sources** — the six endpoints a planned run reads, counted into
 *      `completed`/`total`.
 *   2. **The archive pass** — per shop, over historical windows.
 *   3. **Lazy tasks** — a period fetched because something *asked* for it: a
 *      chart, an AI analysis, a range change. These are not part of any planned
 *      run and are deliberately not counted into one, but they are the work a
 *      user is most likely to wonder about, since nothing they pressed started
 *      it. Settings shows them live; that is what `tasks` is for.
 *
 * `lastSyncAt` and the per-source outcomes survive a reload, because "showing
 * the 09:41 snapshot" is only truthful if the app still knows when 09:41 was.
 */

export type SyncPhase = 'idle' | 'running' | 'success' | 'partial' | 'error' | 'cancelled';

export type SourceStatus =
  /** Never read in this session, and nothing stored from a previous one. */
  | 'idle'
  /** Queued in the run that is currently going. */
  | 'pending'
  | 'running'
  | 'ok'
  | 'failed'
  | 'cancelled';

export interface SourceOutcome {
  readonly status: SourceStatus;
  /** Rows the source yielded on its last successful read. */
  readonly rows: number;
  /** Rows read so far in the current run. */
  readonly loaded: number;
  /** Rows the API says exist. 0 means the route publishes no total. */
  readonly total: number;
  /** Human-readable failure reason, kept for the retry banner. */
  readonly error: string | null;
  /** Whether the page ceiling cut the read short. */
  readonly truncated: boolean;
  readonly at: number | null;
  readonly startedAt: number | null;
}

/**
 * The archive pass, tracked beside the six sources rather than among them.
 *
 * It is a different kind of work — per shop, over historical windows, filling
 * gaps rather than replacing a payload — and the screens that count "3 of 6
 * sources loaded" are asking about the six. Keeping it separate lets the
 * settings pane show it in full without changing what every other consumer of
 * `SOURCE_IDS` means.
 */
export interface ArchiveProgress {
  readonly status: SourceStatus;
  /** Shop currently being walked. */
  readonly shopId: number | null;
  readonly shopsDone: number;
  readonly shopsTotal: number;
  /** Windows fetched and planned, for the shop in flight. */
  readonly windowsDone: number;
  readonly windowsTotal: number;
  /** Rows added to the archive across the run. */
  readonly rows: number;
  /** Change-journal entries the run observed. */
  readonly changes: number;
  readonly error: string | null;
  readonly at: number | null;
}

/**
 * A lazy sync in flight, or the one that just finished.
 *
 * Created whenever `sync_metadata` says a requested period is not held and the
 * missing part has to be fetched. Nothing the user pressed started it, which is
 * exactly why it needs to be visible: an unexplained pause on a range change is
 * a bug report, and the same pause with a labelled progress row in Settings is a
 * feature working.
 */
export interface LazyTask {
  readonly id: string;
  /** What it is fetching, in the user's terms. */
  readonly label: string;
  readonly shopId: number;
  readonly entity: EntityType;
  readonly status: SourceStatus;
  /** The period being filled in. */
  readonly window: DateWindow | null;
  /** Windows fetched, of the number planned. */
  readonly done: number;
  readonly total: number;
  readonly rows: number;
  readonly error: string | null;
  readonly startedAt: number;
  readonly at: number | null;
}

export interface LazyTaskInit {
  readonly label: string;
  readonly shopId: number;
  readonly entity: EntityType;
  readonly total: number;
  readonly window?: DateWindow | undefined;
}

interface SyncState {
  readonly phase: SyncPhase;
  readonly startedAt: number | null;
  readonly lastSyncAt: number | null;
  readonly current: SourceId | null;
  readonly completed: number;
  readonly total: number;
  readonly sources: Readonly<Record<SourceId, SourceOutcome>>;
  readonly archive: ArchiveProgress;
  /** Lazy fetches, newest last. Settled ones are kept briefly, then trimmed. */
  readonly tasks: Readonly<Record<string, LazyTask>>;

  begin: (sources: readonly SourceId[]) => void;
  beginSource: (source: SourceId) => void;
  /**
   * A source that started fetching on its own — because a screen asked for a
   * scope the buffer could not answer, not because the sync button was pressed.
   *
   * Reported through the same rows as a planned run so the settings log shows
   * it live, but deliberately *not* counted into `completed`/`total`: those
   * describe a planned run, and a lazy read is not part of one.
   */
  beginLazySource: (source: string) => void;
  settleLazySource: (
    source: string,
    result: { rows: number; truncated?: boolean } | { error: string },
  ) => void;
  /** Whether an id names one of the six tracked sources. */
  isTrackedSource: (source: string) => source is SourceId;
  /** Rows read so far, from the pagination walk itself. */
  reportSource: (source: string, progress: { loaded: number; total: number }) => void;
  settleSource: (
    source: SourceId,
    result: { rows: number; truncated?: boolean } | { error: string },
  ) => void;
  beginArchive: (shopsTotal: number) => void;
  reportArchive: (progress: Partial<ArchiveProgress>) => void;
  settleArchive: (result: { rows: number; changes: number } | { error: string }) => void;

  /** A period fetch that `sync_metadata` said was necessary. */
  beginTask: (id: string, init: LazyTaskInit) => void;
  reportTask: (id: string, progress: { done: number; total: number; rows: number }) => void;
  settleTask: (id: string, result: { rows: number } | { error: string }) => void;
  /** Drop settled tasks, keeping whatever is still running. */
  clearSettledTasks: () => void;

  finish: (phase: Exclude<SyncPhase, 'idle' | 'running'>) => void;
  reset: () => void;
}

const IDLE_OUTCOME: SourceOutcome = {
  status: 'idle',
  rows: 0,
  loaded: 0,
  total: 0,
  error: null,
  truncated: false,
  at: null,
  startedAt: null,
};

const IDLE_ARCHIVE: ArchiveProgress = {
  status: 'idle',
  shopId: null,
  shopsDone: 0,
  shopsTotal: 0,
  windowsDone: 0,
  windowsTotal: 0,
  rows: 0,
  changes: 0,
  error: null,
  at: null,
};

interface PersistedSync {
  readonly lastSyncAt: number | null;
  readonly sources: Readonly<Record<string, SourceOutcome>>;
}

function emptySources(): Record<SourceId, SourceOutcome> {
  return Object.fromEntries(SOURCE_IDS.map((id) => [id, IDLE_OUTCOME])) as Record<
    SourceId,
    SourceOutcome
  >;
}

/**
 * Restore the last run's timestamps.
 *
 * Asynchronous now, which changes when it happens but not what it means: the
 * store starts empty and is filled in once the read lands. Nothing renders a
 * wrong figure in between — an unrestored `lastSyncAt` is `null`, which every
 * consumer already draws as "never synced" — and `bootstrap()` awaits this
 * before the first paint anyway.
 *
 * Anything malformed starts from scratch.
 */
export async function restoreSyncLog(): Promise<void> {
  let parsed: PersistedSync | null = null;
  try {
    parsed = await readKv<PersistedSync>(KV_KEYS.syncLog);
  } catch {
    return;
  }

  if (parsed === null) return;

  const sources = emptySources();
  for (const id of SOURCE_IDS) {
    const stored = parsed.sources?.[id];
    /* Row counts and timestamps are history and are kept; live progress is
       not, and a restored `running` would be a run that is not happening. */
    if (stored !== undefined) {
      sources[id] = {
        ...IDLE_OUTCOME,
        ...stored,
        status: 'idle',
        loaded: 0,
        total: 0,
        startedAt: null,
      };
    }
  }

  useSyncStore.setState({
    lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : null,
    sources,
  });
}

function persist(state: Pick<SyncState, 'lastSyncAt' | 'sources'>): void {
  const payload: PersistedSync = { lastSyncAt: state.lastSyncAt, sources: state.sources };
  /* Fire and forget: the log is a record for the *next* session, so a write
     that has not landed yet costs this one nothing. */
  void writeKv(KV_KEYS.syncLog, payload).catch(() => {
    /* A sync log that cannot be written is not worth failing a sync over. */
  });
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  phase: 'idle',
  startedAt: null,
  lastSyncAt: null,
  current: null,
  completed: 0,
  total: 0,
  sources: emptySources(),
  archive: IDLE_ARCHIVE,
  tasks: {},

  begin: (sources) =>
    set((state) => {
      const next = { ...state.sources };
      /* Everything in this run is marked queued up front, so the settings pane
         can show the whole plan from the first frame rather than growing a list
         as each source starts. */
      for (const id of sources) {
        next[id] = { ...next[id], status: 'pending', error: null, loaded: 0, total: 0 };
      }
      return {
        phase: 'running',
        startedAt: Date.now(),
        current: sources[0] ?? null,
        completed: 0,
        total: sources.length,
        sources: next,
        archive: { ...IDLE_ARCHIVE, status: 'pending' },
      };
    }),

  beginSource: (source) =>
    set((state) => ({
      current: source,
      sources: {
        ...state.sources,
        [source]: {
          ...state.sources[source],
          status: 'running',
          loaded: 0,
          total: 0,
          startedAt: Date.now(),
        },
      },
    })),

  isTrackedSource: (source): source is SourceId =>
    (SOURCE_IDS as readonly string[]).includes(source),

  beginLazySource: (source) =>
    set((state) => {
      if (!(SOURCE_IDS as readonly string[]).includes(source)) return {};
      const id = source as SourceId;

      return {
        sources: {
          ...state.sources,
          [id]: {
            ...state.sources[id],
            status: 'running',
            error: null,
            loaded: 0,
            total: 0,
            startedAt: Date.now(),
          },
        },
      };
    }),

  settleLazySource: (source, result) =>
    set((state) => {
      if (!(SOURCE_IDS as readonly string[]).includes(source)) return {};
      const id = source as SourceId;
      const previous = state.sources[id];

      const outcome: SourceOutcome =
        'error' in result
          ? { ...previous, status: 'failed', error: result.error, at: Date.now() }
          : {
              ...previous,
              status: 'ok',
              rows: result.rows,
              loaded: result.rows,
              total: Math.max(previous.total, result.rows),
              error: null,
              truncated: result.truncated ?? false,
              at: Date.now(),
            };

      /* `completed` is untouched: it counts a planned run's progress, and this
         read was not part of one. */
      return { sources: { ...state.sources, [id]: outcome } };
    }),

  reportSource: (source, progress) =>
    set((state) => {
      if (!(SOURCE_IDS as readonly string[]).includes(source)) return {};
      const id = source as SourceId;
      const outcome = state.sources[id];

      /* A late report from a cancelled or already settled source must not
         reopen it — pagination can resolve one more page after the abort. */
      if (outcome.status !== 'running') return {};
      if (outcome.loaded === progress.loaded && outcome.total === progress.total) return {};

      return {
        sources: {
          ...state.sources,
          [id]: { ...outcome, loaded: progress.loaded, total: progress.total },
        },
      };
    }),

  settleSource: (source, result) =>
    set((state) => {
      const previous = state.sources[source];
      const outcome: SourceOutcome =
        'error' in result
          ? {
              ...previous,
              status: 'failed',
              rows: 0,
              error: result.error,
              truncated: false,
              at: Date.now(),
            }
          : {
              ...previous,
              status: 'ok',
              rows: result.rows,
              loaded: result.rows,
              total: Math.max(previous.total, result.rows),
              error: null,
              truncated: result.truncated ?? false,
              at: Date.now(),
            };

      return {
        completed: state.completed + 1,
        sources: { ...state.sources, [source]: outcome },
      };
    }),

  beginArchive: (shopsTotal) =>
    set((state) => ({
      archive: { ...state.archive, status: 'running', shopsTotal, shopsDone: 0 },
    })),

  reportArchive: (progress) =>
    set((state) => ({ archive: { ...state.archive, ...progress } })),

  settleArchive: (result) =>
    set((state) => ({
      archive:
        'error' in result
          ? { ...state.archive, status: 'failed', error: result.error, at: Date.now() }
          : {
              ...state.archive,
              status: 'ok',
              rows: result.rows,
              changes: result.changes,
              error: null,
              at: Date.now(),
            },
    })),

  beginTask: (id, init) =>
    set((state) => ({
      tasks: {
        ...state.tasks,
        [id]: {
          id,
          label: init.label,
          shopId: init.shopId,
          entity: init.entity,
          status: 'running',
          window: init.window ?? null,
          done: 0,
          total: init.total,
          rows: 0,
          error: null,
          startedAt: Date.now(),
          at: null,
        },
      },
    })),

  reportTask: (id, progress) =>
    set((state) => {
      const task = state.tasks[id];
      /* A late report from a task that already settled must not reopen it. */
      if (task === undefined || task.status !== 'running') return {};

      return {
        tasks: {
          ...state.tasks,
          [id]: { ...task, done: progress.done, total: progress.total, rows: progress.rows },
        },
      };
    }),

  settleTask: (id, result) =>
    set((state) => {
      const task = state.tasks[id];
      if (task === undefined) return {};

      return {
        tasks: {
          ...state.tasks,
          [id]:
            'error' in result
              ? { ...task, status: 'failed', error: result.error, at: Date.now() }
              : {
                  ...task,
                  status: 'ok',
                  rows: result.rows,
                  done: task.total,
                  error: null,
                  at: Date.now(),
                },
        },
      };
    }),

  clearSettledTasks: () =>
    set((state) => ({
      tasks: Object.fromEntries(
        Object.entries(state.tasks).filter(([, task]) => task.status === 'running'),
      ),
    })),

  finish: (phase) => {
    const succeeded = phase === 'success' || phase === 'partial';
    set((state) => {
      /* Whatever never got its turn is marked cancelled rather than left
         showing "queued" against a run that has stopped. */
      const sources = { ...state.sources };
      for (const id of SOURCE_IDS) {
        if (sources[id].status === 'pending' || sources[id].status === 'running') {
          sources[id] = { ...sources[id], status: 'cancelled', at: Date.now() };
        }
      }

      const archive: ArchiveProgress =
        state.archive.status === 'pending' || state.archive.status === 'running'
          ? { ...state.archive, status: 'cancelled', at: Date.now() }
          : state.archive;

      return {
        phase,
        current: null,
        sources,
        archive,
        lastSyncAt: succeeded ? Date.now() : state.lastSyncAt,
      };
    });
    persist(get());
  },

  reset: () => set({ phase: 'idle', current: null, completed: 0, total: 0 }),
}));

/* ── selectors ──────────────────────────────────────────────────────────── */

/**
 * How far one source has got, 0–1, or `null` when it cannot be known.
 *
 * The bare-array routes (`/v1/invoice`, `/v1/return`) report no total, so a
 * percentage for them would be invented. `null` is what the UI draws as an
 * indeterminate bar.
 */
export function sourceFraction(outcome: SourceOutcome): number | null {
  switch (outcome.status) {
    case 'ok':
    case 'failed':
    case 'cancelled':
      return 1;
    case 'running':
      if (outcome.total <= 0) return null;
      return Math.min(1, outcome.loaded / outcome.total);
    default:
      return 0;
  }
}

/**
 * Fraction of the current run that has landed, 0–1.
 *
 * Sources that have settled count whole; the one in flight contributes its own
 * measured share, so the bar moves through a long paginated read instead of
 * sitting still for forty pages and then jumping.
 */
export const selectProgress = (state: SyncState): number => {
  if (state.total === 0) return 0;

  const partial = SOURCE_IDS.reduce((sum, id) => {
    const outcome = state.sources[id];
    if (outcome.status !== 'running') return sum;
    return sum + (sourceFraction(outcome) ?? 0);
  }, 0);

  return Math.min(1, (state.completed + partial) / state.total);
};

/**
 * Sources that failed on the last run — what the "partial data" banner offers
 * to retry.
 *
 * Wrapped in `useShallow` because the selector builds a fresh array on every
 * call: without it, zustand hands React a new snapshot each render and the
 * component re-renders forever.
 */
export const useFailedSources = (): readonly SourceId[] =>
  useSyncStore(
    useShallow((state) => SOURCE_IDS.filter((id) => state.sources[id].status === 'failed')),
  );

/* ── lazy tasks ─────────────────────────────────────────────────────────── */

/**
 * How far a lazy fetch has got, 0–1, or `null` while its size is unknown.
 *
 * Measured in windows, which is the unit the planner works in and therefore the
 * only one that can be known up front. Rows would make the bar lurch: a later
 * window can hold ten times what the first one did.
 */
export function taskFraction(task: LazyTask): number | null {
  if (task.status !== 'running') return 1;
  if (task.total <= 0) return null;
  return Math.min(1, task.done / task.total);
}

/**
 * Lazy fetches, newest first.
 *
 * `useShallow` because the selector builds a fresh array on every call: without
 * it, zustand hands React a new snapshot each render and the component
 * re-renders forever.
 */
export const useLazyTasks = (): readonly LazyTask[] =>
  useSyncStore(
    useShallow((state) =>
      Object.values(state.tasks).sort((a, b) => b.startedAt - a.startedAt),
    ),
  );

/** Whether anything is being fetched in the background right now. */
export const useHasRunningTasks = (): boolean =>
  useSyncStore((state) => Object.values(state.tasks).some((task) => task.status === 'running'));
