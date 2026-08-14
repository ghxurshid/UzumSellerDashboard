import { Ban, CircleCheck, CircleDashed, Download, Loader2, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { SyncProgress } from '@/components/common/SyncProgress';
import { Panel } from '@/components/ui/Panel';
import { formatClock, formatNumber, formatPercent } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import {
  taskFraction,
  useLazyTasks,
  useSyncStore,
  type LazyTask,
  type SourceStatus,
} from '@/store/sync.store';

/**
 * Background and lazy fetches, live.
 *
 * Every other progress indicator in the application belongs to something the
 * user pressed. These do not: a lazy sync starts because a chart, an analysis
 * or a range change asked about a period this machine did not hold, and
 * `sync_metadata` said so. Nobody pressed anything.
 *
 * That is exactly why it needs a home. An unexplained pause after switching the
 * range is indistinguishable from a hang; the same pause with a labelled row
 * saying "ledger · shop 12345, window 2 of 4" is a feature working in the open.
 * Settings is the right place for it for the same reason the coverage bars are:
 * it is a fact about the tool, not about the business.
 *
 * Nothing here is animated or estimated. Progress is counted in windows —
 * the unit the planner actually works in and the only one knowable up front —
 * and a task whose size is not yet known draws an indeterminate bar rather than
 * a percentage it cannot justify.
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

export function LazySyncPanel(): ReactNode {
  const { t } = useTranslation();
  const tasks = useLazyTasks();
  const clearSettled = useSyncStore((state) => state.clearSettledTasks);

  const settled = tasks.filter((task) => task.status !== 'running').length;

  return (
    <Panel className="flex flex-col gap-10 px-14 py-13">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-8">
          <Download aria-hidden className="size-14 shrink-0 text-acc-dim" />
          <span className="text-sm-plus font-medium">{t('lazyTitle')}</span>
          <div className="flex-1" />
          {settled > 0 && (
            <button
              type="button"
              onClick={clearSettled}
              className={cn(
                'h-22 cursor-pointer rounded-6 border border-line-2 bg-transparent px-8',
                'text-tiny text-dim transition-colors hover:border-acc-line hover:text-acc-dim',
              )}
            >
              {t('lazyClear')}
            </button>
          )}
        </div>
        <p className="m-0 text-tiny leading-[1.5] text-faint">{t('lazySub')}</p>
      </div>

      {tasks.length === 0 ? (
        <span className="text-xs text-faint">{t('lazyIdle')}</span>
      ) : (
        <div className="flex flex-col">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function TaskRow({ task }: { readonly task: LazyTask }): ReactNode {
  const { t } = useTranslation();

  const Icon = STATUS_ICON[task.status];
  const fraction = taskFraction(task);

  /* What the caption says, in order of what matters most: the failure, then the
     live count, then the settled count. */
  const caption = ((): string => {
    if (task.status === 'failed') return task.error ?? t('tFail');
    if (task.status === 'running') {
      return task.total > 0
        ? t('lazyWindows', { done: task.done, total: task.total })
        : t('syncNoTotal');
    }
    return `${t('lazyRows', { n: formatNumber(task.rows) })} · ${formatClock(task.at ?? task.startedAt)}`;
  })();

  return (
    <div className="flex flex-col gap-4 border-b border-line py-7 last:border-b-0">
      <div className="flex items-center gap-8 text-xs-plus">
        <Icon
          aria-hidden
          className={cn(
            'size-13 shrink-0',
            STATUS_TONE[task.status],
            task.status === 'running' && 'animate-spin',
          )}
        />
        <span className="shrink-0 font-mono text-dim">{task.label}</span>

        <div className="flex-1" />

        {task.status === 'running' && fraction !== null && (
          <span data-numeric className="shrink-0 text-tiny text-acc-dim">
            {formatPercent(fraction * 100, 0)}
          </span>
        )}

        <span
          data-numeric
          className={cn(
            'min-w-0 max-w-200 shrink truncate text-right text-mini',
            task.status === 'failed' ? 'text-neg' : 'text-faint',
          )}
          title={caption}
        >
          {caption}
        </span>
      </div>

      <SyncProgress status={task.status} fraction={fraction} />
    </div>
  );
}
