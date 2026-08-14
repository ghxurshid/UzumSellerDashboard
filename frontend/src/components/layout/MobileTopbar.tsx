import {
  Bell,
  CalendarDays,
  CloudOff,
  Menu,
  RefreshCw,
  Search,
  Sparkles,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { describeWindow } from '@/lib/dateRange';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useConnection } from '@/services/queries/useConnection';
import { ALL_STORES, useFiltersStore } from '@/store/filters.store';
import { selectUnreadCount, useNotificationsStore } from '@/store/notifications.store';
import { useSessionStore } from '@/store/session.store';
import { selectProgress, useSyncStore } from '@/store/sync.store';
import { useUiStore } from '@/store/ui.store';

import { BrandMark } from './BrandMark';
import { NotificationsMenu } from './NotificationsMenu';

interface MobileTopbarProps {
  readonly onOpenMenu: () => void;
  readonly onSync: () => void;
  readonly onCancelSync: () => void;
}

/* 44px minimum on every icon control, and a real gap between them — the
   desktop bar packs 28px buttons 8px apart, which is a coin toss under a
   thumb. */
const ICON_BUTTON = cn(
  'flex size-44 shrink-0 cursor-pointer items-center justify-center rounded-9 border-0',
  'bg-transparent text-dim transition-colors active:bg-acc-soft active:text-acc-dim',
  'disabled:cursor-not-allowed disabled:opacity-45',
);

const CHIP = cn(
  'flex h-34 shrink-0 cursor-pointer items-center gap-6 rounded-8 border border-line-2',
  'px-11 text-xs-plus text-dim transition-colors active:border-acc-line active:bg-acc-soft',
);

/**
 * The phone header: two short rows instead of the desktop bar's one long one.
 *
 * The desktop topbar puts eleven controls on a single 46px line and hides
 * their labels as the window narrows. Below 768px there is no width left to
 * hide into, so the controls split by how often they are reached for: the
 * first row keeps what is pressed constantly (menu, search, Copilot,
 * notifications) at full finger size, and the scope pickers move to a second
 * row that scrolls sideways rather than wrapping.
 *
 * Everything demoted from here — theme, language, sync, the full section list
 * — is one tap away in the drawer the menu button opens, so nothing is lost,
 * only re-ranked.
 */
export function MobileTopbar({
  onOpenMenu,
  onSync,
  onCancelSync,
}: MobileTopbarProps): ReactNode {
  const { t } = useTranslation();

  const menu = useUiStore((state) => state.menu);
  const toggleMenu = useUiStore((state) => state.toggleMenu);
  const togglePalette = useUiStore((state) => state.togglePalette);
  const toggleChat = useUiStore((state) => state.toggleChat);

  const network = useSessionStore((state) => state.network);
  const { shops, status } = useConnection();

  const storeKey = useFiltersStore((state) => state.storeKey);
  const rangeKey = useFiltersStore((state) => state.rangeKey);
  const fromMs = useFiltersStore((state) => state.windowFromMs);
  const toMs = useFiltersStore((state) => state.windowToMs);

  const syncing = useSyncStore((state) => state.phase === 'running');
  const progress = useSyncStore(selectProgress);
  const unread = useNotificationsStore(selectUnreadCount);

  const activeShop = shops.find((shop) => String(shop.id) === storeKey);
  const storeLabel =
    storeKey === ALL_STORES || activeShop === undefined
      ? shops.length === 0
        ? t('connNone')
        : t('allShort')
      : activeShop.name;

  return (
    <header className="relative z-20 shrink-0 border-b border-line bg-chrome pt-safe">
      <div className="flex h-52 items-center gap-2 pl-6 pr-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-haspopup="dialog"
          aria-label={t('menuL')}
          className={ICON_BUTTON}
        >
          <Menu aria-hidden className="size-20" />
        </button>

        <BrandMark size={20} />
        <span className="ml-6 truncate text-sm font-medium uppercase tracking-[0.14em]">
          Savdo
        </span>

        <div className="flex-1" />

        {/* The sync control keeps its dual nature from the desktop bar: while a
            run is in flight it is the cancel button, and it reports how far the
            run has got rather than only spinning. */}
        <button
          type="button"
          onClick={syncing ? onCancelSync : onSync}
          disabled={status !== 'connected' && !syncing}
          aria-label={syncing ? t('syncCancel') : t('syncNow')}
          className={cn(ICON_BUTTON, 'relative')}
        >
          {syncing ? (
            <>
              <X aria-hidden className="size-17" />
              <span
                data-numeric
                className="absolute bottom-4 text-meta text-acc-dim"
              >
                {Math.round(progress * 100)}%
              </span>
            </>
          ) : (
            <RefreshCw aria-hidden className="size-17" />
          )}
        </button>

        <button
          type="button"
          onClick={togglePalette}
          aria-label={t('searchPh')}
          className={ICON_BUTTON}
        >
          <Search aria-hidden className="size-18" />
        </button>

        <NotificationsMenu
          open={menu === 'bell'}
          onOpenChange={() => toggleMenu('bell')}
          trigger={
            <button
              type="button"
              aria-label={t('notifs')}
              aria-haspopup="menu"
              aria-expanded={menu === 'bell'}
              className={cn(ICON_BUTTON, menu === 'bell' && 'bg-acc-soft text-acc-dim')}
            >
              <span className="relative">
                <Bell aria-hidden className="size-18" />
                {unread > 0 && (
                  <span className="absolute -right-3 -top-2 size-7 rounded-full bg-neg" />
                )}
              </span>
            </button>
          }
        />

        <button
          type="button"
          onClick={toggleChat}
          aria-label={t('askCopilot')}
          className={cn(
            ICON_BUTTON,
            'border border-acc bg-acc-soft text-acc-dim active:bg-acc-strong',
          )}
        >
          <Sparkles aria-hidden className="size-17" />
        </button>
      </div>

      <div className="scroll-x flex items-center gap-7 border-t border-line px-10 py-7">
        <button
          type="button"
          onClick={onOpenMenu}
          className={cn(CHIP, 'max-w-[55%]')}
        >
          <StoreIcon aria-hidden className="size-13 shrink-0 text-acc-dim" />
          <span className="truncate">{storeLabel}</span>
        </button>

        <button type="button" onClick={onOpenMenu} className={CHIP}>
          <CalendarDays aria-hidden className="size-13 shrink-0 text-acc-dim" />
          <span className="truncate">{t(rangeKey)}</span>
          <span data-numeric className="hidden shrink-0 text-tiny text-faint xs:inline">
            {describeWindow({ fromMs, toMs })}
          </span>
        </button>

        {network === 'offline' && (
          <span className="flex h-34 shrink-0 items-center gap-5 rounded-8 border border-warn-line bg-warn-soft px-11 text-xs text-warn">
            <CloudOff aria-hidden className="size-13" />
            {t('offlineL')}
          </span>
        )}
      </div>

      {syncing && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2 bg-acc transition-[width] duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      )}
    </header>
  );
}
