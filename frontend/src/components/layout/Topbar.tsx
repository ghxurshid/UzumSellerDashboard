import {
  Bell,
  CalendarDays,
  CloudOff,
  GitCompareArrows,
  Languages,
  Moon,
  RefreshCw,
  Search,
  Sparkles,
  Store as StoreIcon,
  Sun,
  X,
} from 'lucide-react';
import { type ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { describeWindow } from '@/lib/dateRange';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useConnection } from '@/services/queries/useConnection';
import { ALL_STORES, useFiltersStore } from '@/store/filters.store';
import { selectUnreadCount, useNotificationsStore } from '@/store/notifications.store';
import { usePreferencesStore } from '@/store/preferences.store';
import { useSessionStore } from '@/store/session.store';
import { selectProgress, useSyncStore } from '@/store/sync.store';
import { useUiStore } from '@/store/ui.store';

import { NotificationsMenu } from './NotificationsMenu';
import { RangeMenu } from './RangeMenu';
import { StoreMenu } from './StoreMenu';

const CHIP = cn(
  'flex h-28 shrink-0 cursor-pointer items-center gap-7 rounded-7 border px-9 text-sm',
  'transition-colors duration-150 hover:border-acc-line hover:bg-acc-soft',
);

interface TopbarProps {
  /** Enough room for labels next to every control. */
  readonly wide: boolean;
  /** Enough room for the secondary metadata inside the store/range chips. */
  readonly mid: boolean;
  readonly onSync: () => void;
  readonly onCancelSync: () => void;
}

/**
 * The 46px action bar: scope pickers on the left, global tools on the right.
 *
 * The sync control reports the real run — how many of the six sources have
 * landed, and how long ago the last successful sync was. While one is running
 * it becomes a cancel button, because a read that walks dozens of pages is not
 * something to be stuck behind.
 */
export function Topbar({ wide, mid, onSync, onCancelSync }: TopbarProps): ReactNode {
  const { t } = useTranslation();

  const menu = useUiStore((state) => state.menu);
  const toggleMenu = useUiStore((state) => state.toggleMenu);
  const togglePalette = useUiStore((state) => state.togglePalette);
  const toggleChat = useUiStore((state) => state.toggleChat);

  const theme = usePreferencesStore((state) => state.theme);
  const toggleTheme = usePreferencesStore((state) => state.toggleTheme);
  const language = usePreferencesStore((state) => state.language);
  const cycleLanguage = usePreferencesStore((state) => state.cycleLanguage);

  const network = useSessionStore((state) => state.network);
  const { shops, status } = useConnection();

  const storeKey = useFiltersStore((state) => state.storeKey);
  const rangeKey = useFiltersStore((state) => state.rangeKey);
  const fromMs = useFiltersStore((state) => state.windowFromMs);
  const toMs = useFiltersStore((state) => state.windowToMs);

  const syncing = useSyncStore((state) => state.phase === 'running');
  const completed = useSyncStore((state) => state.completed);
  const totalSources = useSyncStore((state) => state.total);
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const progress = useSyncStore(selectProgress);
  /* The source in flight, so the button names what it is waiting on rather than
     only counting. It is the same store the settings pane reads in full. */
  const currentSource = useSyncStore((state) => state.current);
  const unread = useNotificationsStore(selectUnreadCount);

  const activeShop = shops.find((shop) => String(shop.id) === storeKey);
  const storeLabel =
    storeKey === ALL_STORES || activeShop === undefined
      ? shops.length === 0
        ? t('connNone')
        : t('allShort')
      : activeShop.name;

  const storeMeta =
    storeKey === ALL_STORES || activeShop === undefined
      ? `shopIds[${shops.length}]`
      : `shopId ${activeShop.id}`;

  const syncLabel = ((): string => {
    if (syncing) {
      return totalSources === 0
        ? t('syncingL')
        : t('syncSources', { done: completed, total: totalSources });
    }
    if (lastSyncAt === null) return t('syncNever');

    const minutes = Math.round((Date.now() - lastSyncAt) / 60_000);
    return minutes < 1 ? t('syncedJust') : t('syncedAgo', { n: minutes });
  })();

  return (
    <div className="relative z-20 flex h-46 shrink-0 items-center gap-8 border-b border-line px-12">
      <StoreMenu
        open={menu === 'store'}
        onOpenChange={() => toggleMenu('store')}
        trigger={
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu === 'store'}
            className={cn(CHIP, menu === 'store' ? 'border-acc-line bg-acc-soft' : 'border-line-2')}
          >
            <StoreIcon aria-hidden className="size-13 text-acc-dim" />
            {wide && storeLabel}
            {mid && <span className="font-mono text-faint">{storeMeta}</span>}
          </button>
        }
      />

      <RangeMenu
        open={menu === 'range'}
        onOpenChange={() => toggleMenu('range')}
        trigger={
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu === 'range'}
            className={cn(CHIP, menu === 'range' ? 'border-acc-line bg-acc-soft' : 'border-line-2')}
          >
            <CalendarDays aria-hidden className="size-13 text-acc-dim" />
            {wide && t(rangeKey)}
            {mid && (
              <span data-numeric className="text-faint">
                {describeWindow({ fromMs, toMs })}
              </span>
            )}
          </button>
        }
      />

      {wide && (
        <>
          <span className="flex items-center gap-5 text-xs text-faint">
            <GitCompareArrows aria-hidden className="size-12" />
            {t('vsPrev')}
          </span>
          <span className="h-18 w-px bg-line" />
        </>
      )}

      <button
        type="button"
        onClick={syncing ? onCancelSync : onSync}
        disabled={status !== 'connected' && !syncing}
        title={
          syncing
            ? `${t('syncCancel')} · ${currentSource ?? ''} ${Math.round(progress * 100)}%`
            : t('syncNow')
        }
        className={cn(
          'relative flex h-28 shrink-0 cursor-pointer items-center gap-6 overflow-hidden rounded-7',
          'border border-transparent bg-transparent px-9 text-xs-plus text-dim transition-colors',
          'hover:bg-acc-soft hover:text-acc-dim disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        {syncing ? (
          <X aria-hidden className="size-12" />
        ) : (
          <RefreshCw aria-hidden className="size-12" />
        )}
        {wide && syncLabel}

        {/* The compact form of what Settings shows in full: which source is
            being read, and how far the run has got. Both come from the same
            store, so the two can never disagree. */}
        {syncing && wide && currentSource !== null && (
          <span className="font-mono text-tiny text-faint">{currentSource}</span>
        )}
        {syncing && (
          <span data-numeric className="text-tiny text-acc-dim">
            {Math.round(progress * 100)}%
          </span>
        )}

        {syncing && (
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-2 bg-acc transition-[width] duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        )}
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={togglePalette}
        className="flex h-28 min-w-30 shrink basis-260 cursor-text items-center gap-8 overflow-hidden rounded-7 border border-line-2 bg-panel px-9 text-left text-sm text-faint transition-colors hover:border-acc-line"
      >
        <Search aria-hidden className="size-13 shrink-0" />
        {wide && (
          <>
            <span className="truncate">{t('searchPh')}</span>
            <kbd className="ml-auto shrink-0 rounded-4 border border-line-2 px-5 py-px text-tiny font-sans">
              ⌘K
            </kbd>
          </>
        )}
      </button>

      <NotificationsMenu
        open={menu === 'bell'}
        onOpenChange={() => toggleMenu('bell')}
        trigger={
          <IconButton
            label={t('notifs')}
            variant="outline"
            size="lg"
            active={menu === 'bell'}
            aria-haspopup="menu"
            aria-expanded={menu === 'bell'}
          >
            <span className="relative">
              <Bell aria-hidden className="size-14" />
              {unread > 0 && (
                <span className="absolute -right-3 -top-2 size-6 rounded-full bg-neg" />
              )}
            </span>
          </IconButton>
        }
      />

      {network === 'offline' && (
        <span className="flex h-28 shrink-0 items-center gap-5 rounded-7 border border-warn-line bg-warn-soft px-9 text-xs text-warn">
          <CloudOff aria-hidden className="size-12" />
          {t('offlineL')}
        </span>
      )}

      <IconButton label={t('theme')} variant="outline" size="lg" onClick={toggleTheme}>
        {theme === 'light' ? (
          <Sun aria-hidden className="size-14" />
        ) : (
          <Moon aria-hidden className="size-14" />
        )}
      </IconButton>

      <button
        type="button"
        onClick={cycleLanguage}
        title={t('lang')}
        className="flex h-28 shrink-0 cursor-pointer items-center gap-5 rounded-7 border border-line-2 bg-transparent px-9 text-xs uppercase tracking-[0.09em] text-dim transition-colors hover:border-acc-line hover:text-acc-dim"
      >
        <Languages aria-hidden className="size-13" />
        {language}
      </button>

      <button
        type="button"
        onClick={toggleChat}
        className="flex h-28 shrink-0 cursor-pointer items-center gap-6 rounded-7 border border-acc bg-acc-soft px-11 text-sm font-medium text-acc-dim transition-colors hover:bg-acc-strong"
      >
        <Sparkles aria-hidden className="size-13" />
        {wide && (
          <>
            {t('askCopilot')}
            <kbd className="ml-2 border-l border-acc-line pl-7 text-tiny font-sans opacity-70">
              ⌘J
            </kbd>
          </>
        )}
      </button>
    </div>
  );
}
