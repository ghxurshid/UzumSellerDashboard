import { Archive, Ban, CircleCheck, CircleDashed, Loader2, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { SyncProgress } from '@/components/common/SyncProgress';
import { formatClock, formatNumber, formatPercent } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { SOURCE_IDS } from '@/services/queries/sources';
import {
  selectProgress,
  sourceFraction,
  taskFraction,
  useLazyTasks,
  useSyncStore,
  type ArchiveProgress,
  type SourceOutcome,
  type SourceStatus,
} from '@/store/sync.store';

/**
 * The sync log, live.
 *
 * Between runs this is a record: what each source last returned and when. While
 * a run is going it is a monitor, and every row moves — the one being read
 * shows its pages arriving, the ones behind it say they are queued, and the
 * ones already done keep their counts. That continuity is the point: the same
 * seven rows answer "what happened last time" and "what is happening now",
 * rather than a progress dialog appearing over a static list.
 *
 * Nothing here is driven by a timer. Every number is either the row count the
 * API reported or the count of rows actually read, and where a route publishes
 * no total the row says so instead of showing a percentage it cannot justify.
 */

const STATUS_ICON: Readonly<Record<SourceStatus, typeof CircleCheck>> = {
  idle: CircleDashed,
  pending: CircleDashed,
  running: Loader2,
  ok: CircleCheck,
  failed: TriangleAlert,
  cancelled: Ban,
};

const STATUS_TONE: Readonly<Record<SourceStatus, string>> = {
  idle: 'text-faint',
  pending: 'text-faint',
  running: 'text-acc-dim',
  ok: 'text-pos',
  failed: 'text-neg',
  cancelled: 'text-warn',
};

const STATUS_LABEL: Readonly<Record<SourceStatus, TranslationKey>> = {
  idle: 'syncStIdle',
  pending: 'syncStQueued',
  running: 'syncStRunning',
  ok: 'syncStOk',
  failed: 'syncStFailed',
  cancelled: 'syncStStopped',
};

export function SyncPanel(): ReactNode {
  const { t } = useTranslation();

  const phase = useSyncStore((state) => state.phase);
  const sources = useSyncStore((state) => state.sources);
  const archive = useSyncStore((state) => state.archive);
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const completed = useSyncStore((state) => state.completed);
  const total = useSyncStore((state) => state.total);
  const overall = useSyncStore(selectProgress);

  const running = phase === 'running';

  return (
    <div className="flex flex-col gap-10 rounded-11 border border-line bg-panel px-14 py-13">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-8">
          <span className="text-sm-plus font-medium">{t('syncHistory')}</span>
          <div className="flex-1" />
          <span data-numeric className="text-mini text-faint">
            {lastSyncAt === null ? t('syncNever') : formatClock(lastSyncAt)}
          </span>
        </div>
        <p className="m-0 text-tiny leading-[1.5] text-faint">{t('syncLiveSub')}</p>
      </div>

      {/* The run as a whole, so the pane answers "how far along" at a glance. */}
      {running && (
        <div className="flex flex-col gap-5 rounded-8 border border-acc-line bg-acc-soft px-10 py-8">
          <div className="flex items-baseline gap-8 text-xs-plus">
            <span className="text-acc-dim">{t('syncOverall')}</span>
            <span data-numeric className="text-mini text-dim">
              {t('syncSources', { done: completed, total })}
            </span>
            <div className="flex-1" />
            <span data-numeric className="text-mini text-acc-dim">
              {formatPercent(overall * 100, 0)}
            </span>
          </div>
          <SyncProgress status="running" fraction={overall} />
        </div>
      )}

      <div className="flex flex-col">
        {SOURCE_IDS.map((id) => (
          <SourceRow key={id} id={id} outcome={sources[id]} />
        ))}

        <ArchiveRow progress={archive} />
      </div>

      {/* Background fetches nobody pressed a button for. Shown here as well as
          in the Data pane, because while a run is going they are part of the
          same picture — and between runs they are the only thing moving. */}
      <LazyRows />
    </div>
  );
}

/**
 * The lazy fetches, when there are any.
 *
 * Rendered as nothing at all when idle rather than as an empty section: this
 * panel is a log of what happened, and "no background fetches" is not an event.
 * The Data pane carries the full, always-present view.
 */
function LazyRows(): ReactNode {
  const { t } = useTranslation();
  const tasks = useLazyTasks();
  const running = tasks.filter((task) => task.status === 'running');

  if (running.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-9">
      <span className="text-meta uppercase tracking-[0.09em] text-faint">{t('lazyTitle')}</span>

      {running.map((task) => {
        const fraction = taskFraction(task);

        return (
          <div key={task.id} className="flex flex-col gap-4 py-4">
            <div className="flex items-center gap-8 text-xs-plus">
              <Loader2 aria-hidden className="size-13 shrink-0 animate-spin text-acc-dim" />
              <span className="shrink-0 font-mono text-dim">{task.label}</span>
              <div className="flex-1" />
              <span data-numeric className="shrink-0 text-mini text-faint">
                {task.total > 0
                  ? t('lazyWindows', { done: task.done, total: task.total })
                  : t('syncNoTotal')}
              </span>
            </div>
            <SyncProgress status="running" fraction={fraction} />
          </div>
        );
      })}
    </div>
  );
}

/* ── one source ─────────────────────────────────────────────────────────── */

function SourceRow({
  id,
  outcome,
}: {
  readonly id: string;
  readonly outcome: SourceOutcome;
}): ReactNode {
  const { t } = useTranslation();

  const Icon = STATUS_ICON[outcome.status];
  const fraction = sourceFraction(outcome);

  /* What the right-hand caption says, in order of what matters most: the
     failure, then the live count, then the settled count, then nothing. */
  const caption = ((): string => {
    if (outcome.status === 'failed') return outcome.error ?? t('tFail');
    if (outcome.status === 'running') {
      return outcome.total > 0
        ? t('syncRowsOf', {
            loaded: formatNumber(outcome.loaded),
            total: formatNumber(outcome.total),
          })
        : outcome.loaded > 0
          ? t('syncRowsRead', { n: formatNumber(outcome.loaded) })
          : t('syncNoTotal');
    }
    if (outcome.at === null) return t('syncStIdle');
    if (outcome.status === 'cancelled') return t('syncStStopped');
    return `${t('syncRowsRead', { n: formatNumber(outcome.rows) })} · ${formatClock(outcome.at)}`;
  })();

  return (
    <div className="flex flex-col gap-4 border-b border-line py-7 last:border-b-0">
      <div className="flex items-center gap-8 text-xs-plus">
        <Icon
          aria-hidden
          className={cn(
            'size-13 shrink-0',
            STATUS_TONE[outcome.status],
            outcome.status === 'running' && 'animate-spin',
          )}
        />
        <span className="shrink-0 font-mono text-dim">{id}</span>

        <span className={cn('shrink-0 text-tiny', STATUS_TONE[outcome.status])}>
          {t(STATUS_LABEL[outcome.status])}
        </span>

        {outcome.truncated && (
          <span className="shrink-0 rounded-4 bg-warn-soft px-5 py-px text-tiny text-warn">
            {t('syncTruncL')}
          </span>
        )}

        <div className="flex-1" />

        {outcome.status === 'running' && fraction !== null && (
          <span data-numeric className="shrink-0 text-tiny text-acc-dim">
            {formatPercent(fraction * 100, 0)}
          </span>
        )}

        <span
          data-numeric
          className={cn(
            'min-w-0 max-w-200 shrink truncate text-right text-mini',
            outcome.status === 'failed' ? 'text-neg' : 'text-faint',
          )}
          title={caption}
        >
          {caption}
        </span>
      </div>

      <SyncProgress status={outcome.status} fraction={fraction} />
    </div>
  );
}

/* ── the archive pass ───────────────────────────────────────────────────── */

/**
 * The seventh row.
 *
 * It is shown alongside the six sources because from the user's side it is part
 * of the same press of the same button, and leaving it out would make the pane
 * claim a run had finished while it was still fetching history. Its progress is
 * measured in shops and in the windows planned for the shop in flight, which is
 * what the archive planner actually works in.
 */
function ArchiveRow({ progress }: { readonly progress: ArchiveProgress }): ReactNode {
  const { t } = useTranslation();

  const Icon = progress.status === 'running' ? Loader2 : STATUS_ICON[progress.status];

  const fraction = ((): number | null => {
    if (progress.status !== 'running') return sourceFraction({ ...EMPTY_OUTCOME, status: progress.status });
    if (progress.shopsTotal === 0) return null;

    const within =
      progress.windowsTotal > 0 ? Math.min(1, progress.windowsDone / progress.windowsTotal) : 0;
    return Math.min(1, (progress.shopsDone + within) / progress.shopsTotal);
  })();

  const caption = ((): string => {
    if (progress.status === 'failed') return progress.error ?? t('tFail');
    if (progress.status === 'idle') return t('syncArcIdle');
    if (progress.status === 'pending') return t('syncArcIdle');
    if (progress.status === 'running') {
      return progress.windowsTotal > 0
        ? t('syncArcWindows', { done: progress.windowsDone, total: progress.windowsTotal })
        : t('syncArcShops', { done: progress.shopsDone, total: progress.shopsTotal });
    }
    if (progress.status === 'cancelled') return t('syncStStopped');
    return t('syncArcAdded', { rows: formatNumber(progress.rows), changes: progress.changes });
  })();

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-8">
      <div className="flex items-center gap-8 text-xs-plus">
        <Icon
          aria-hidden
          className={cn(
            'size-13 shrink-0',
            STATUS_TONE[progress.status],
            progress.status === 'running' && 'animate-spin',
          )}
        />
        <Archive aria-hidden className="size-12 shrink-0 text-faint" />
        <span className="shrink-0 font-mono text-dim">{t('syncArchiveL')}</span>

        <span className={cn('shrink-0 text-tiny', STATUS_TONE[progress.status])}>
          {t(STATUS_LABEL[progress.status])}
        </span>

        {progress.status === 'running' && progress.shopId !== null && (
          <span data-numeric className="shrink-0 text-tiny text-faint">
            shopId {progress.shopId}
          </span>
        )}

        <div className="flex-1" />

        <span
          data-numeric
          className={cn(
            'min-w-0 max-w-200 shrink truncate text-right text-mini',
            progress.status === 'failed' ? 'text-neg' : 'text-faint',
          )}
          title={caption}
        >
          {caption}
        </span>
      </div>

      <SyncProgress status={progress.status} fraction={fraction} />
    </div>
  );
}

/** Only the status field is read; the rest satisfies the shared selector. */
const EMPTY_OUTCOME: SourceOutcome = {
  status: 'idle',
  rows: 0,
  loaded: 0,
  total: 0,
  error: null,
  truncated: false,
  at: null,
  startedAt: null,
};
