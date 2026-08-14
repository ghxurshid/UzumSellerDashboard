import * as RadixDialog from '@radix-ui/react-dialog';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Languages,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Store as StoreIcon,
  Sun,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { APP_VERSION_LABEL } from '@/constants/app';
import { NAV_ITEMS, SETTINGS_PATH } from '@/constants/navigation';
import { RANGE_KEYS, describeWindow, resolveWindow } from '@/lib/dateRange';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useConnection } from '@/services/queries/useConnection';
import { ALL_STORES, useFiltersStore } from '@/store/filters.store';
import { usePreferencesStore } from '@/store/preferences.store';
import { useSyncStore } from '@/store/sync.store';
import { useUiStore } from '@/store/ui.store';

import { BrandMark } from './BrandMark';

interface MobileNavDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSync: () => void;
}

/* Every row in this drawer is a 44px target with its label beside it — the
   whole point of the sheet is that nothing in it has to be aimed at. */
const ROW = cn(
  'flex min-h-44 w-full cursor-pointer items-center gap-11 rounded-9 border-0 bg-transparent',
  'px-11 text-left text-sm-plus text-dim transition-colors active:bg-acc-soft',
);

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-2 border-b border-line px-8 py-10 last:border-b-0">
      <h2 className="m-0 px-11 pb-4 text-meta font-normal uppercase tracking-[0.12em] text-faint">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The phone navigation sheet, behind the tab bar's overflow button.
 *
 * It carries everything the desktop chrome spreads across the rail and the
 * topbar: the sections that did not fit in the tab bar, the two scope pickers,
 * and the global tools. The scope pickers are rendered inline as radio lists
 * rather than as the popovers the topbar uses — a dropdown inside a sheet is a
 * second layer to dismiss, and the lists are short enough to simply show.
 *
 * Selecting anything closes the sheet, because on a phone the sheet *is* the
 * screen: leaving it open over the result of the choice hides the thing the
 * user just asked to see.
 */
export function MobileNavDrawer({
  open,
  onOpenChange,
  onSync,
}: MobileNavDrawerProps): ReactNode {
  const { t } = useTranslation();
  const location = useLocation();

  const theme = usePreferencesStore((state) => state.theme);
  const toggleTheme = usePreferencesStore((state) => state.toggleTheme);
  const language = usePreferencesStore((state) => state.language);
  const cycleLanguage = usePreferencesStore((state) => state.cycleLanguage);

  const togglePalette = useUiStore((state) => state.togglePalette);
  const toggleChat = useUiStore((state) => state.toggleChat);

  const { shops, status } = useConnection();
  const storeKey = useFiltersStore((state) => state.storeKey);
  const setStore = useFiltersStore((state) => state.setStore);
  const rangeKey = useFiltersStore((state) => state.rangeKey);
  const setRange = useFiltersStore((state) => state.setRange);
  const syncing = useSyncStore((state) => state.phase === 'running');

  const close = (): void => onOpenChange(false);
  const run = (action: () => void) => (): void => {
    action();
    close();
  };

  const account = shops[0]?.name ?? null;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-[rise_0.16s_ease]" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[min(340px,88vw)] flex-col',
            'border-r border-line-2 bg-chrome shadow-[var(--shadow-menu)]',
            'data-[state=open]:animate-[slide-panel_0.24s_var(--ease-out-soft)]',
          )}
        >
          <header className="flex shrink-0 items-center gap-10 border-b border-line px-14 py-12 pt-safe">
            <BrandMark size={22} />
            <div className="flex min-w-0 flex-col leading-[1.25]">
              <RadixDialog.Title className="truncate text-md font-medium uppercase tracking-[0.14em]">
                Savdo
              </RadixDialog.Title>
              <RadixDialog.Description className="truncate text-tiny text-faint">
                {account ?? t('connNone')} · {APP_VERSION_LABEL}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close
              aria-label={t('mClose')}
              className="ml-auto flex size-44 shrink-0 cursor-pointer items-center justify-center rounded-9 border-0 bg-transparent text-faint active:bg-acc-soft"
            >
              <X aria-hidden className="size-18" />
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-auto pb-safe">
            <Section title={t('navSection')}>
              {[...NAV_ITEMS, {
                screen: 'settings' as const,
                path: SETTINGS_PATH,
                labelKey: 'settings' as const,
                icon: Settings,
              }].map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.screen}
                    to={item.path}
                    onClick={close}
                    aria-current={
                      item.path === SETTINGS_PATH && location.pathname.startsWith(SETTINGS_PATH)
                        ? 'page'
                        : undefined
                    }
                    className={cn(
                      ROW,
                      'aria-[current=page]:bg-acc-soft aria-[current=page]:text-acc-dim',
                    )}
                  >
                    <Icon aria-hidden className="size-17 shrink-0" />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </NavLink>
                );
              })}
            </Section>

            <Section title={t('scopeSection')}>
              <p className="m-0 flex items-center gap-7 px-11 pb-2 pt-4 text-tiny text-faint">
                <StoreIcon aria-hidden className="size-11" />
                {t('storeL')}
              </p>

              {shops.map((shop) => {
                const key = String(shop.id);
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={storeKey === key}
                    onClick={run(() => setStore(key))}
                    className={cn(ROW, storeKey === key && 'bg-acc-soft text-acc-dim')}
                  >
                    <span className="flex min-w-0 flex-col leading-[1.3]">
                      <span className="truncate">{shop.name}</span>
                      <span className="truncate font-mono text-tiny text-faint">
                        shopId {shop.id}
                      </span>
                    </span>
                    <div className="flex-1" />
                    {storeKey === key && (
                      <CheckCircle2 aria-hidden className="size-15 shrink-0 text-acc-dim" />
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                role="menuitemradio"
                aria-checked={storeKey === ALL_STORES}
                onClick={run(() => setStore(ALL_STORES))}
                className={cn(ROW, storeKey === ALL_STORES && 'bg-acc-soft text-acc-dim')}
              >
                <Building2 aria-hidden className="size-15 shrink-0" />
                <span className="truncate">{t('allStores')}</span>
              </button>

              <p className="m-0 flex items-center gap-7 px-11 pb-2 pt-10 text-tiny text-faint">
                <CalendarDays aria-hidden className="size-11" />
                {t('rangeL')}
              </p>

              {RANGE_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={rangeKey === key}
                  onClick={run(() => setRange(key))}
                  className={cn(ROW, rangeKey === key && 'bg-acc-soft text-acc-dim')}
                >
                  <span className="truncate">{t(key)}</span>
                  <div className="flex-1" />
                  <span data-numeric className="shrink-0 text-tiny text-faint">
                    {describeWindow(resolveWindow(key))}
                  </span>
                </button>
              ))}
            </Section>

            <Section title={t('toolsSection')}>
              <button type="button" onClick={run(togglePalette)} className={ROW}>
                <Search aria-hidden className="size-15 shrink-0" />
                <span className="truncate">{t('searchPh')}</span>
              </button>

              <button type="button" onClick={run(toggleChat)} className={ROW}>
                <Sparkles aria-hidden className="size-15 shrink-0 text-acc-dim" />
                <span className="truncate">{t('askCopilot')}</span>
              </button>

              <button
                type="button"
                onClick={run(onSync)}
                disabled={status !== 'connected' || syncing}
                className={cn(ROW, 'disabled:cursor-not-allowed disabled:opacity-45')}
              >
                <RefreshCw
                  aria-hidden
                  className={cn('size-15 shrink-0', syncing && 'animate-spin')}
                />
                <span className="truncate">{t('syncNow')}</span>
              </button>

              <button type="button" onClick={toggleTheme} className={ROW}>
                {theme === 'light' ? (
                  <Sun aria-hidden className="size-15 shrink-0" />
                ) : (
                  <Moon aria-hidden className="size-15 shrink-0" />
                )}
                <span className="truncate">{t('theme')}</span>
                <div className="flex-1" />
                <span className="shrink-0 text-tiny uppercase text-faint">{theme}</span>
              </button>

              <button type="button" onClick={cycleLanguage} className={ROW}>
                <Languages aria-hidden className="size-15 shrink-0" />
                <span className="truncate">{t('lang')}</span>
                <div className="flex-1" />
                <span className="shrink-0 text-tiny uppercase text-faint">{language}</span>
              </button>
            </Section>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
