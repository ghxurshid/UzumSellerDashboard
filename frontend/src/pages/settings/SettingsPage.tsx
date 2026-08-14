import { Cpu, Database, Keyboard, Loader2, Plug, RotateCcw, Settings2 } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { AiSettings } from '@/features/settings/AiSettings';
import { ApiSettings } from '@/features/settings/ApiSettings';
import { DataSettings } from '@/features/settings/DataSettings';
import { GeneralSettings } from '@/features/settings/GeneralSettings';
import { KeyboardSettings } from '@/features/settings/KeyboardSettings';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useConnection } from '@/services/queries/useConnection';
import { useSync } from '@/services/sync/useSync';
import { useDialogStore } from '@/store/dialog.store';
import { useSettingsStore } from '@/store/settings.store';
import { selectProgress, useFailedSources, useSyncStore } from '@/store/sync.store';
import { useToastStore } from '@/store/toast.store';

type SettingsTab = 'general' | 'api' | 'data' | 'ai' | 'keys';

const TABS: ReadonlyArray<{
  readonly key: SettingsTab;
  readonly labelKey: TranslationKey;
  readonly icon: typeof Settings2;
}> = [
  { key: 'general', labelKey: 'sGeneral', icon: Settings2 },
  { key: 'api', labelKey: 'sApi', icon: Plug },
  /* Sits directly under the API tab: what was fetched belongs next to what
     fetches it, and both are questions about the tool rather than the shop. */
  { key: 'data', labelKey: 'sData', icon: Database },
  { key: 'ai', labelKey: 'sAi', icon: Cpu },
  { key: 'keys', labelKey: 'sKeys', icon: Keyboard },
];

/** Settings — a left nav and one pane per section. */
export default function SettingsPage(): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const requestConfirm = useDialogStore((state) => state.requestConfirm);
  const resetAll = useSettingsStore((state) => state.resetAll);

  const [tab, setTab] = useState<SettingsTab>('general');
  const [backfilling, setBackfilling] = useState(false);
  const connection = useConnection();
  const sync = useSync();

  const syncing = useSyncStore((state) => state.phase === 'running');
  const syncProgress = useSyncStore(selectProgress);
  const failedSources = useFailedSources();

  /* Just starts the run. The outcome is announced by the single subscriber in
     `AppShell` — reporting it here as well would toast twice for one sync. */
  const handleSync = useCallback(() => {
    void sync.run();
  }, [sync]);

  /* The backfill is a long, deliberate walk backwards through history rather
     than a refresh, so it reports what it added rather than a phase. */
  const handleBackfill = useCallback(() => {
    setBackfilling(true);
    void sync
      .backfill()
      .then((reports) => {
        const rows = reports.reduce((sum, report) => sum + report.ledger.added, 0);
        push(t('tBackfillDone', { rows }), { kind: rows > 0 ? 'ok' : 'info' });
      })
      .finally(() => setBackfilling(false));
  }, [push, sync, t]);

  /* Clearing every stored endpoint, key and flag is not undoable — it goes
     through the same confirmation prompt every other destructive action uses. */
  const handleResetAll = useCallback(() => {
    requestConfirm(
      { title: t('resetAllQ'), body: t('resetAllBody'), cta: t('resetAll'), tone: 'warn' },
      () => {
        resetAll();
        push(t('resetT'), { kind: 'info' });
      },
    );
  }, [push, requestConfirm, resetAll, t]);

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label={t('settings')}
        className="flex w-204 shrink-0 flex-col gap-2 border-r border-line px-9 py-12"
      >
        <span className="px-8 pb-6 pt-4 text-meta uppercase tracking-[0.1em] text-faint">
          {t('settings')}
        </span>

        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setTab(item.key)}
              className={cn(
                'flex h-30 cursor-pointer items-center gap-8 rounded-7 border-0 px-9 text-left text-sm transition-colors hover:bg-acc-soft',
                active ? 'bg-acc-soft text-acc-dim' : 'bg-transparent text-dim',
              )}
            >
              <Icon aria-hidden className="size-14" />
              {t(item.labelKey)}

              {/* Short indicator: a run started from anywhere shows here, so the
                  state is legible from a pane that is not the sync log. While
                  one is going it supersedes the connection chip — the live
                  operation is the more urgent fact. */}
              {item.key === 'api' && syncing && (
                <span className="ml-auto flex items-center gap-4 text-meta text-acc-dim">
                  <Loader2 aria-hidden className="size-11 animate-spin" />
                  <span data-numeric>{Math.round(syncProgress * 100)}%</span>
                </span>
              )}
              {item.key === 'api' && !syncing && failedSources.length > 0 && (
                <span className="ml-auto rounded-4 bg-neg-soft px-5 py-px text-meta text-neg">
                  {failedSources.length}
                </span>
              )}
              {item.key === 'api' && !syncing && failedSources.length === 0 &&
                connection.status === 'connected' && (
                  <span className="ml-auto rounded-4 bg-pos-soft px-5 py-px text-meta text-pos">
                    {t('live')}
                  </span>
                )}
            </button>
          );
        })}

        <div className="flex-1" />

        <Button
          size="lg"
          className="mt-2 w-full"
          icon={<RotateCcw aria-hidden className="size-12" />}
          onClick={handleResetAll}
        >
          {t('resetAll')}
        </Button>
      </nav>

      <div className="min-w-0 flex-1 overflow-auto px-16 pb-26 pt-14">
        {tab === 'general' && <GeneralSettings />}
        {tab === 'api' && <ApiSettings onSync={handleSync} syncing={sync.isRunning} />}
        {tab === 'data' && (
          /* Disabled during a sync as well: the engine runs one API-heavy
             operation at a time, so offering the button would be offering a
             no-op. */
          <DataSettings onBackfill={handleBackfill} backfilling={backfilling || syncing} />
        )}
        {tab === 'ai' && <AiSettings />}
        {tab === 'keys' && <KeyboardSettings />}
      </div>
    </div>
  );
}
