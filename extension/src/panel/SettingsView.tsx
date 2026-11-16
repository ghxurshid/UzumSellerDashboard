import { ArrowLeft, Cpu, Keyboard, Settings2 } from 'lucide-react';
import { useMemo, type KeyboardEvent, type ReactNode } from 'react';

import type { TranslationKey } from '@core/i18n/dictionary';
import { useTranslation } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import { IconButton } from '@core/ui/kit/IconButton';
import { AiSettings } from '@core/ui/settings/AiSettings';
import { GeneralSettings } from '@core/ui/settings/GeneralSettings';
import { KeyboardSettings } from '@core/ui/settings/KeyboardSettings';

import { HostAccessNotice } from './HostAccessNotice';
import { isApplePlatform, shortcutList } from './shortcuts';
import { SETTINGS_TABS, tabAfterKey, type SettingsTab } from './view';

const TABS: Readonly<
  Record<SettingsTab, { readonly labelKey: TranslationKey; readonly icon: typeof Settings2 }>
> = {
  general: { labelKey: 'sGeneral', icon: Settings2 },
  ai: { labelKey: 'sAi', icon: Cpu },
  keyboard: { labelKey: 'sKeys', icon: Keyboard },
};

const tabId = (tab: SettingsTab): string => `settings-tab-${tab}`;
const panelId = (tab: SettingsTab): string => `settings-pane-${tab}`;

function platformName(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform ?? nav.platform;
}

interface SettingsViewProps {
  readonly tab: SettingsTab;
  readonly onTab: (tab: SettingsTab) => void;
  readonly onBack: () => void;
}

/**
 * The three panes of the site's settings that configure this Copilot — General,
 * AI and Keyboard — under a compact header and a tab strip.
 *
 * General hides the two notification toggles: they drive the site's
 * notification log, which the extension does not have, and a switch that
 * changes nothing is a lie. The rest of the pane is the site's own.
 */
export function SettingsView({ tab, onTab, onBack }: SettingsViewProps): ReactNode {
  const { t } = useTranslation();
  const shortcuts = useMemo(() => shortcutList(isApplePlatform(platformName())), []);

  /* Arrow keys move between tabs and move focus with them, so the strip is one
     tab stop, as a tab strip is expected to be. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = tabAfterKey(tab, event.key);
    if (next === null) return;
    event.preventDefault();
    onTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <section aria-label={t('settings')} className="flex h-full min-h-0 w-full flex-col bg-chrome">
      <header className="flex h-52 shrink-0 items-center gap-9 border-b border-line px-12 pt-safe md:h-46">
        <IconButton
          label={t('extBack')}
          size="md"
          className="md:size-22 md:rounded-5"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden className="size-16 md:size-12" />
        </IconButton>
        <span className="text-sm font-medium">{t('settings')}</span>
      </header>

      <div
        role="tablist"
        aria-label={t('settings')}
        onKeyDown={onKeyDown}
        className="scroll-x flex shrink-0 gap-6 border-b border-line px-10 py-8"
      >
        {SETTINGS_TABS.map((key) => {
          const { icon: Icon, labelKey } = TABS[key];
          const active = tab === key;
          return (
            <button
              key={key}
              id={tabId(key)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(key)}
              tabIndex={active ? 0 : -1}
              onClick={() => onTab(key)}
              className={cn(
                'flex h-38 shrink-0 cursor-pointer items-center gap-7 whitespace-nowrap rounded-8 border-0 px-12 text-sm transition-colors hover:bg-acc-soft md:h-28 md:rounded-7 md:px-10 md:text-xs-plus',
                active ? 'bg-acc-soft text-acc-dim' : 'bg-transparent text-dim',
              )}
            >
              <Icon aria-hidden className="size-14 shrink-0 md:size-13" />
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      <div
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain px-11 pb-26 pt-14 sm:px-16"
      >
        {tab === 'general' && <GeneralSettings toggles={[]} />}
        {tab === 'ai' && (
          <div className="flex flex-col gap-12">
            <HostAccessNotice />
            <AiSettings />
          </div>
        )}
        {tab === 'keyboard' && <KeyboardSettings shortcuts={shortcuts} />}
      </div>
    </section>
  );
}
