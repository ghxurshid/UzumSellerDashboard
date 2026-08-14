import { Maximize2 } from 'lucide-react';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { StateBlock } from '@/components/common/StateBlock';
import { ProgressOverlay } from '@/components/common/ProgressOverlay';
import { IconButton } from '@/components/ui/IconButton';
import { SkeletonTiles } from '@/components/ui/Skeleton';
import { Toaster } from '@/components/ui/Toaster';
import { WINDOW } from '@/constants/app';
import { CopilotPanel } from '@/features/chat/CopilotPanel';
import { InsightsRail } from '@/features/insights/InsightsRail';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useElementWidth } from '@/hooks/useElementWidth';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useProgressTask } from '@/hooks/useProgressTask';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useConnection } from '@/services/queries/useConnection';
import { useSync } from '@/services/sync/useSync';
import { subscribeToSyncResult } from '@/services/sync/syncEngine';
import { selectUnreadCount, useNotificationsStore } from '@/store/notifications.store';
import { useSyncStore } from '@/store/sync.store';
import { useToastStore } from '@/store/toast.store';
import { useUiStore } from '@/store/ui.store';

import { BottomNav } from './BottomNav';
import { BrandMark } from './BrandMark';
import { MobileNavDrawer } from './MobileNavDrawer';
import { MobileTopbar } from './MobileTopbar';
import { RailNav } from './RailNav';
import { TitleBar } from './TitleBar';
import { Topbar } from './Topbar';

const WIDE_BREAKPOINT = 1080;
const MID_BREAKPOINT = 760;

/** Routes that carry an insights rail when there is room for one. */
const INSIGHT_ROUTES = ['/overview', '/products'] as const;

/**
 * The extension window.
 *
 * Three chrome states — open, minimised, closed — mirror how the panel behaves
 * inside the Uzum seller cabinet. Layout decisions read the measured window
 * width rather than the viewport, because docking changes the panel's width
 * without the browser resizing.
 */
export function AppShell(): ReactNode {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Below 768px the window metaphor is dropped entirely.
   *
   * Docking, minimising and the floating-panel look all describe a panel
   * inside a host page — on a phone there is no host page and no room to float
   * in, so the app fills the viewport and the chrome becomes a header, a tab
   * bar and a navigation sheet. This is the one layout decision that reads the
   * *viewport* rather than the measured window: at this size they are the same
   * thing, and the window's own width has not been measured yet on first paint.
   */
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

  const windowState = useUiStore((state) => state.windowState);
  const setWindowState = useUiStore((state) => state.setWindowState);
  const docked = useUiStore((state) => state.docked);
  const maximized = useUiStore((state) => state.maximized);
  const chatOpen = useUiStore((state) => state.chatOpen);
  const insightsOpen = useUiStore((state) => state.insightsOpen);
  const togglePalette = useUiStore((state) => state.togglePalette);
  const toggleChat = useUiStore((state) => state.toggleChat);

  const pushToast = useToastStore((state) => state.push);
  const notify = useNotificationsStore((state) => state.notify);
  const progress = useProgressTask();
  const sync = useSync();
  const connection = useConnection();
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const unread = useNotificationsStore(selectUnreadCount);

  const [windowRef, windowWidth] = useElementWidth<HTMLDivElement>();
  const contentWidth = windowWidth - WINDOW.railWidth - (chatOpen ? WINDOW.chatWidth : 0);

  const showInsights =
    insightsOpen &&
    !chatOpen &&
    !isMobile &&
    contentWidth > WINDOW.insightsMinAvailable &&
    INSIGHT_ROUTES.some((route) => location.pathname.startsWith(route));

  /**
   * Where a sync's outcome is reported — once, for every run.
   *
   * A sync can be started from four places, and the engine collapses them into
   * a single run. Reporting has to collapse the same way, or pressing sync in
   * Settings while the topbar is watching would raise two toasts for one
   * operation. So nothing subscribes but this, the one component that is always
   * mounted, and every trigger elsewhere simply starts the run.
   */
  useEffect(
    () =>
      subscribeToSyncResult((result) => {
        if (result.phase === 'success') {
          pushToast(t('tSyncDone', { rows: result.rows }), { kind: 'ok' });
          notify(t('tSyncDone', { rows: result.rows }), {
            icon: 'circle-check',
            tone: 'positive',
            dedupeKey: 'sync',
          });
          return;
        }
        if (result.phase === 'cancelled') {
          pushToast(t('tCancelled'), { kind: 'info' });
          return;
        }

        const message = t('tSyncFailed', { n: result.failed.length });
        pushToast(message, { kind: result.phase === 'error' ? 'err' : 'warn' });
        notify(message, { icon: 'alert-triangle', tone: 'negative', dedupeKey: 'sync' });
      }),
    [notify, pushToast, t],
  );

  const handleSync = useCallback(() => {
    void sync.run();
  }, [sync]);

  /**
   * The first sync after a token is accepted.
   *
   * Screens fetch what they need on their own, but until a full sync has run
   * the app has no idea how fresh anything is and half the sources are
   * untouched. This runs it once, when the connection first proves itself, and
   * never again — every later refresh is the user's decision.
   */
  const initialSyncStarted = useRef(false);
  useEffect(() => {
    if (initialSyncStarted.current) return;
    if (connection.status !== 'connected' || connection.shops.length === 0) return;
    if (lastSyncAt !== null) return;

    initialSyncStarted.current = true;
    handleSync();
  }, [connection.shops.length, connection.status, handleSync, lastSyncAt]);

  const hotkeys = useMemo(
    () => [
      { key: 'k', meta: true, handler: togglePalette },
      { key: 'j', meta: true, handler: toggleChat },
    ],
    [togglePalette, toggleChat],
  );
  useHotkeys(hotkeys);

  /* Keyed on the path so navigating away clears a caught error instead of
     stranding the user on it. Shared by both shells — the route content does
     not know or care which chrome is wrapped around it. */
  const routeOutlet = (
    <ErrorBoundary
      key={location.pathname}
      fallback={(error, reset) => (
        <StateBlock
          state="error"
          meta={error.message}
          onPrimaryAction={reset}
          secondaryLabel={t('blInitC')}
          onSecondaryAction={() => void navigate('/settings')}
        />
      )}
    >
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );

  if (isMobile) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-ground text-base leading-[1.45]">
        <MobileTopbar
          onOpenMenu={() => setNavOpen(true)}
          onSync={handleSync}
          onCancelSync={sync.cancel}
        />

        {/* `overscroll-contain` keeps a fling inside the screen instead of
            handing the momentum to the document underneath it. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {routeOutlet}
        </main>

        <BottomNav onOpenMenu={() => setNavOpen(true)} />

        <MobileNavDrawer open={navOpen} onOpenChange={setNavOpen} onSync={handleSync} />
        {chatOpen && <CopilotPanel />}

        <ProgressOverlay onCancel={progress.cancel} />
        <Toaster />
        <CommandPalette />
        <ConfirmDialog />
      </div>
    );
  }

  if (windowState === 'closed') {
    return <ClosedLauncher onOpen={() => setWindowState('open')} label={t('reopen')} />;
  }

  if (windowState === 'min') {
    return (
      <MinimisedBar
        onRestore={() => setWindowState('open')}
        label={t('restore')}
        unread={unread}
      />
    );
  }

  /* Maximised means the whole viewport — no backdrop, no rounding, no shadow —
     so the app reads as a site rather than a panel floating in a page. */
  const fullscreen = maximized && !docked;

  return (
    <div
      className={cn(
        'flex h-full overflow-hidden bg-backdrop',
        /* The floating-panel inset is a desktop luxury: on a tablet the 24px
           gutter costs 48px of a 768px screen for decoration. */
        !fullscreen && 'items-center justify-center p-12 lg:p-24',
      )}
    >
      <div
        ref={windowRef}
        data-screen-label="Extension window"
        className={cn(
          'relative flex flex-col overflow-hidden bg-ground text-base leading-[1.45]',
          fullscreen
            ? 'h-full w-full'
            : cn(
                'rounded-14 shadow-[0_0_0_1px_var(--s-line-2),var(--shadow-window)]',
                docked
                  ? 'ml-auto h-[94vh] w-[min(470px,100%)]'
                  : 'h-[min(900px,90vh)] w-[min(1420px,100%)]',
              ),
        )}
      >
        <TitleBar wide={contentWidth >= MID_BREAKPOINT} />

        <div className="flex min-h-0 flex-1">
          <RailNav />

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar
              wide={contentWidth >= WIDE_BREAKPOINT}
              mid={contentWidth >= MID_BREAKPOINT}
              onSync={handleSync}
              onCancelSync={sync.cancel}
            />

            <div className="flex min-h-0 flex-1">
              <main className="min-w-0 flex-1 overflow-auto">{routeOutlet}</main>

              {showInsights && <InsightsRail />}
            </div>
          </div>

          {chatOpen && <CopilotPanel />}
        </div>

        <ProgressOverlay onCancel={progress.cancel} />
        <Toaster />
      </div>

      <CommandPalette />
      <ConfirmDialog />
    </div>
  );
}

function RouteFallback(): ReactNode {
  return (
    <div className="flex flex-col gap-12 px-14 pb-22 pt-12">
      <SkeletonTiles count={7} />
    </div>
  );
}

function ClosedLauncher({
  onOpen,
  label,
}: {
  readonly onOpen: () => void;
  readonly label: string;
}): ReactNode {
  return (
    <div className="flex h-full items-center justify-center bg-backdrop">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex h-46 cursor-pointer items-center gap-10 rounded-full border border-acc-line',
          'bg-chrome pl-14 pr-18 text-base text-text transition-colors hover:border-acc',
          'shadow-[var(--shadow-float)]',
        )}
      >
        <BrandMark size={24} />
        {label}
        <kbd className="rounded-5 border border-line-2 px-6 py-px text-tiny font-sans text-faint">
          ⌘J
        </kbd>
      </button>
    </div>
  );
}

function MinimisedBar({
  onRestore,
  label,
  unread,
}: {
  readonly onRestore: () => void;
  readonly label: string;
  /** Real unread count from the event log — no badge when there is nothing. */
  readonly unread: number;
}): ReactNode {
  return (
    <div className="relative h-full bg-backdrop">
      <div className="absolute bottom-28 right-34 flex h-40 items-center gap-9 rounded-11 border border-line-2 bg-chrome pl-13 pr-8 text-sm shadow-[var(--shadow-float)]">
        <BrandMark size={18} />
        <span className="text-mini uppercase tracking-[0.14em]">Savdo</span>
        {unread > 0 && (
          <span data-numeric className="rounded-5 bg-neg-soft px-7 py-px text-mini text-neg">
            {unread}
          </span>
        )}
        <IconButton label={label} size="md" onClick={onRestore}>
          <Maximize2 aria-hidden className="size-13" />
        </IconButton>
      </div>
    </div>
  );
}
