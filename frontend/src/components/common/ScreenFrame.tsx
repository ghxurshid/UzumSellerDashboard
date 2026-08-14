import { AlertCircle, CheckCircle2, CloudOff, Clock, Eye, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { STALE_AFTER_MS, type BannerKind, type ScreenStatus } from '@/hooks/useScreenStatus';
import { describeWindow, resolveWindow } from '@/lib/dateRange';
import { formatClock } from '@/lib/format';
import { useTranslation, type Translator } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { SOURCE_IDS } from '@/services/queries/sources';
import { useSync } from '@/services/sync/useSync';
import { useFiltersStore } from '@/store/filters.store';
import { useFailedSources, useSyncStore } from '@/store/sync.store';
import type { Tone } from '@/types/domain';

import { StateBlock } from './StateBlock';

/**
 * The frame every data screen renders inside.
 *
 * It owns the three-way branch — block, skeleton, content — and the banner that
 * sits above content when something is true but not fatal. Centralising it is
 * what keeps the states honest: a screen cannot accidentally render a table
 * while its source is failing, because it never decides that for itself.
 */

export interface ScreenFrameProps {
  readonly status: ScreenStatus;
  /** Shown while the sources are in flight and nothing is cached. */
  readonly skeleton: ReactNode;
  readonly onRetry: () => void;
  /** Clears the search box; required for the `noSearch` state to be escapable. */
  readonly onClearSearch?: () => void;
  readonly onClearFilters?: () => void;
  /** The query that found nothing, quoted back in the empty-search copy. */
  readonly searchQuery?: string;
  /** Rows that were searched, for the same copy. */
  readonly rowsRead?: number;
  readonly children: ReactNode;
}

export function ScreenFrame({
  status,
  skeleton,
  onRetry,
  onClearSearch,
  onClearFilters,
  searchQuery = '',
  rowsRead = 0,
  children,
}: ScreenFrameProps): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rangeKey = useFiltersStore((state) => state.rangeKey);
  const setRange = useFiltersStore((state) => state.setRange);

  if (status.kind === 'block') {
    const toSettings = (): void => void navigate('/settings');

    const primary = ((): (() => void) => {
      switch (status.state) {
        case 'initial':
        case 'unauth':
        case 'forbidden':
          return toSettings;
        case 'empty':
          return () => setRange('r90');
        case 'noSearch':
          return onClearSearch ?? onRetry;
        case 'noFilter':
          return onClearFilters ?? onRetry;
        default:
          return onRetry;
      }
    })();

    /**
     * Anything caused by the connection gets a way into Settings.
     *
     * When Uzum will not answer, the cause is as often a stale token or a wrong
     * base URL as it is an outage — and a screen that only offers "retry" makes
     * the user guess. The rail and the topbar stay usable either way; this is
     * just the shortest path from the message to the thing that fixes it.
     */
    const wantsSettings =
      status.state === 'error' ||
      status.state === 'offline' ||
      status.state === 'timeout';

    return (
      <StateBlock
        state={status.state}
        onPrimaryAction={primary}
        {...(wantsSettings
          ? { secondaryLabel: t('blInitC'), onSecondaryAction: toSettings }
          : {})}
        vars={{
          range: describeWindow(resolveWindow(rangeKey)),
          q: searchQuery,
          n: rowsRead,
        }}
        meta={status.meta}
      />
    );
  }

  if (status.kind === 'skel') return <>{skeleton}</>;

  return (
    <>
      {status.banner !== null && <ScreenBanner kind={status.banner} status={status} t={t} />}
      {children}
    </>
  );
}

/* ── banner ─────────────────────────────────────────────────────────────── */

const BANNER_STYLE: Record<
  BannerKind,
  { readonly icon: ComponentType<{ className?: string }>; readonly tone: Tone }
> = {
  offline: { icon: CloudOff, tone: 'warning' },
  partial: { icon: AlertCircle, tone: 'warning' },
  warning: { icon: Clock, tone: 'warning' },
  readonly: { icon: Eye, tone: 'accent' },
  success: { icon: CheckCircle2, tone: 'positive' },
};

const TONE_CLASS: Record<Tone, string> = {
  positive: 'border-pos-line bg-pos-soft text-pos',
  negative: 'border-neg-line bg-neg-soft text-neg',
  warning: 'border-warn-line bg-warn-soft text-warn',
  accent: 'border-acc-line bg-acc-soft text-acc-dim',
  neutral: 'border-line-2 bg-grid text-dim',
};

function ScreenBanner({
  kind,
  status,
  t,
}: {
  readonly kind: BannerKind;
  readonly status: ScreenStatus;
  readonly t: Translator;
}): ReactNode {
  const sync = useSync();
  const navigate = useNavigate();
  const failed = useFailedSources();
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const resetSync = useSyncStore((state) => state.reset);
  const syncedRows = useSyncStore((state) =>
    SOURCE_IDS.reduce((sum, id) => sum + state.sources[id].rows, 0),
  );

  const style = BANNER_STYLE[kind];
  const Icon = style.icon;

  const ageMinutes =
    status.updatedAt === null
      ? Math.round(STALE_AFTER_MS / 60_000)
      : Math.max(1, Math.round((Date.now() - status.updatedAt) / 60_000));

  const clock = (at: number | null): string => (at === null ? '—' : formatClock(at));

  const { text, actionLabel, onAction } = ((): {
    text: string;
    actionLabel: string | null;
    onAction: () => void;
  } => {
    switch (kind) {
      case 'offline':
        return {
          text: t('bnOffT', { time: clock(lastSyncAt ?? status.updatedAt) }),
          actionLabel: t('retryL'),
          onAction: () => void sync.run(),
        };
      case 'partial':
        return {
          text: t('bnPartT', { ok: SOURCE_IDS.length - failed.length, total: SOURCE_IDS.length }),
          actionLabel: t('bnPartA'),
          onAction: () => void sync.run(failed),
        };
      case 'warning':
        return {
          text: t('bnWarnT', { n: ageMinutes }),
          actionLabel: t('bnWarnA'),
          onAction: () => void sync.run(),
        };
      case 'readonly':
        return {
          text: t('bnRoT'),
          actionLabel: t('bnRoA'),
          onAction: () => void navigate('/settings'),
        };
      case 'success':
        return {
          text: t('bnSuccT', {
            ok: SOURCE_IDS.length - failed.length,
            total: SOURCE_IDS.length,
            rows: syncedRows,
          }),
          actionLabel: null,
          onAction: resetSync,
        };
    }
  })();

  return (
    <div
      role="status"
      className={cn(
        'mx-10 mt-12 flex items-center gap-9 rounded-9 border px-11 py-9 text-xs-plus sm:mx-14 sm:py-8',
        TONE_CLASS[style.tone],
      )}
    >
      <Icon aria-hidden className="size-13 shrink-0" />
      {/* Two lines on a phone rather than an ellipsis: these messages carry a
          timestamp or a count, and truncating them loses exactly the part that
          makes the banner worth reading. */}
      <span className="line-clamp-2 min-w-0 flex-1 sm:truncate">{text}</span>

      {actionLabel !== null ? (
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : (
        <button
          type="button"
          aria-label={t('mClose')}
          onClick={resetSync}
          className="tap shrink-0 cursor-pointer border-0 bg-transparent p-0 opacity-70 hover:opacity-100"
        >
          <X aria-hidden className="size-14 sm:size-12" />
        </button>
      )}
    </div>
  );
}
