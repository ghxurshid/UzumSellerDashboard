import { RefreshCw, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { formatClock } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api/client';
import { useConnection, type ConnectionStatus } from '@/services/queries/useConnection';
import { clearArchive } from '@/services/storage/archive/archive.service';
import { clearBuffer } from '@/services/storage/buffer/buffer.service';
import { resetLazySync } from '@/services/sync/lazySync';
import { fetchShops } from '@/services/uzum/endpoints';
import { useArchiveStore } from '@/store/archive.store';
import { useApiSettings, useFeatureFlags, useSettingsStore } from '@/store/settings.store';
import { useSessionStore } from '@/store/session.store';
import { useSyncStore } from '@/store/sync.store';
import { useToastStore } from '@/store/toast.store';

import { CredentialField } from './CredentialField';
import { SyncPanel } from './SyncPanel';

/**
 * Uzum API credentials, connection state and the sync log.
 *
 * Everything on this pane is observed rather than declared: the connection dot
 * reflects what `GET /v1/shops` last answered, the log is the outcome of the
 * last real sync per source, and diagnostics actually issues a request and
 * times it. Nothing here is a placeholder for a value the API could supply.
 */

type DiagnosticState = 'idle' | 'running' | 'done' | 'failed';

interface DiagnosticResult {
  readonly reachable: boolean;
  readonly latencyMs: number;
  readonly shops: number;
  readonly message: string | null;
}

const STATUS_DOT: Readonly<Record<ConnectionStatus, string>> = {
  connected: 'bg-pos animate-[pulse-ring_2.4s_infinite]',
  checking: 'bg-warn animate-[pulse-ring_1.2s_infinite]',
  unconfigured: 'bg-faint',
  unauthorized: 'bg-neg',
  forbidden: 'bg-neg',
  unreachable: 'bg-warn',
  error: 'bg-neg',
};

const STATUS_LABEL: Readonly<Record<ConnectionStatus, 'connected' | 'connChecking' | 'connNone' | 'blUnauthT' | 'blForbT' | 'blOffT' | 'blErrT'>> = {
  connected: 'connected',
  checking: 'connChecking',
  unconfigured: 'connNone',
  unauthorized: 'blUnauthT',
  forbidden: 'blForbT',
  unreachable: 'blOffT',
  error: 'blErrT',
};

export function ApiSettings({ onSync, syncing }: {
  readonly onSync: () => void;
  readonly syncing: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const api = useApiSettings();
  const features = useFeatureFlags();
  const patch = useSettingsStore((state) => state.patch);
  const resetAuthorization = useSessionStore((state) => state.resetAuthorization);

  const connection = useConnection();
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const refreshArchive = useArchiveStore((state) => state.refresh);

  const [diagnostics, setDiagnostics] = useState<DiagnosticState>('idle');
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  /** A real request, really timed — the only honest way to report latency. */
  const runDiagnostics = useCallback(async (): Promise<void> => {
    setDiagnostics('running');
    const startedAt = performance.now();

    try {
      const shops = await fetchShops();
      setResult({
        reachable: true,
        latencyMs: Math.round(performance.now() - startedAt),
        shops: shops.length,
        message: null,
      });
      setDiagnostics('done');
      push(t('diagDone'), { kind: 'ok' });
    } catch (error) {
      setResult({
        reachable: false,
        latencyMs: Math.round(performance.now() - startedAt),
        shops: 0,
        message: error instanceof ApiError ? error.message : t('tFail'),
      });
      setDiagnostics('failed');
      push(error instanceof ApiError ? error.message : t('tFail'), { kind: 'err' });
    }
  }, [push, t]);

  /* Once per mount, not once per render — the flag means "when this pane
     opens", and the callback is re-created whenever the language changes. */
  const autoRan = useRef(false);
  useEffect(() => {
    if (!features.autoDiagnostics || autoRan.current) return;
    autoRan.current = true;
    void runDiagnostics();
  }, [features.autoDiagnostics, runDiagnostics]);

  const clock = (at: number | null): string => (at === null ? '—' : formatClock(at));

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sApi')}</h1>
        <p className="m-0 text-xs-plus text-dim">{t('apiSub')}</p>
      </header>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-12 max-[980px]:grid-cols-1">
        <div className="flex flex-col gap-11 rounded-11 border border-line bg-panel px-14 py-13">
          <div className="flex flex-wrap items-center gap-8">
            <span className={cn('size-7 rounded-full', STATUS_DOT[connection.status])} />
            <span className="text-sm-plus font-medium">{t(STATUS_LABEL[connection.status])}</span>
            <span className="text-xs text-faint">
              {connection.shops.length > 0
                ? connection.shops.map((shop) => `${shop.name} · ${shop.id}`).join(', ')
                : t('shopsCount', { n: 0 })}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onSync}
              disabled={syncing || connection.status !== 'connected'}
              className={cn(
                'flex h-26 shrink-0 cursor-pointer items-center gap-6 rounded-7 border border-acc',
                'bg-acc-soft px-10 text-xs-plus font-medium text-acc-dim transition-colors',
                'hover:bg-acc-strong disabled:cursor-not-allowed disabled:opacity-45',
              )}
            >
              <RefreshCw aria-hidden className={cn('size-12', syncing && 'animate-spin')} />
              {t('syncNow')}
            </button>
          </div>

          <CredentialField
            label={t('tokenLbl')}
            value={api.token}
            placeholder="paste the seller API token"
            emptyLabel={t('notSet')}
            hint={t('tokenNote')}
            masked={features.maskSecrets}
            copyable
            onCommit={(token) => {
              /**
               * Order matters here, and it matters more now that the deletes
               * are asynchronous.
               *
               * Everything this app stores is keyed by a fingerprint of the
               * token, so the clearing has to happen — and *finish* — while the
               * old token is still the current one. Patching first would leave
               * the previous seller's rows on disk under a fingerprint nothing
               * addresses any more: unreachable, but still occupying the
               * database and still readable by anyone who inspects it.
               *
               * The clears are therefore awaited before the patch rather than
               * fired alongside it. Under localStorage the two were
               * indistinguishable because the writes were synchronous; here
               * they are not, and getting it wrong is a data-retention bug
               * rather than a timing curiosity.
               *
               * Only when the token really changed: re-saving the same one is
               * not a new account, and wiping the archive would throw away a
               * backfill that cost hundreds of requests to build.
               */
              const changed = token !== api.token;

              const apply = async (): Promise<void> => {
                if (changed) {
                  await clearBuffer();
                  await clearArchive();
                  /* Any lazy fetch still in flight belongs to the old account
                     and would write its rows back under the old fingerprint. */
                  resetLazySync();
                }

                patch({ api: { token } });

                /* A new token deserves a clean slate: clear the rejection that
                   the previous one earned so the probe can prove this one. */
                resetAuthorization();
                await refreshArchive();
                connection.retry();
                push(t('tokenSaved'), { kind: 'ok' });
              };

              void apply();
            }}
            onCopy={() => push(t('copied'), { kind: 'ok' })}
          />

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-9 border border-line bg-line max-[720px]:grid-cols-1">
            <Stat label="Base URL" value={api.baseUrl} meta={t('rateLimit')} />
            <Stat
              label="shops"
              value={String(connection.shops.length)}
              meta={connection.checkedAt === null ? '—' : clock(connection.checkedAt)}
            />
            <Stat
              label="last sync"
              value={clock(lastSyncAt)}
              meta={
                lastSyncAt === null
                  ? t('syncNever')
                  : t('syncedAgo', { n: Math.round((Date.now() - lastSyncAt) / 60_000) })
              }
            />
          </div>

          <div className="flex flex-col gap-8 border-t border-line pt-11">
            <span className="text-meta uppercase tracking-[0.09em] text-faint">{t('flags')}</span>
            <FlagRow
              label={t('flMask')}
              hint={t('flMaskH')}
              value={features.maskSecrets}
              onChange={(maskSecrets) => patch({ features: { maskSecrets } })}
            />
            <FlagRow
              label={t('flDiag')}
              hint={t('flDiagH')}
              value={features.autoDiagnostics}
              onChange={(autoDiagnostics) => patch({ features: { autoDiagnostics } })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-9">
          {/* The sync log is its own component because it is the same live view
              the topbar and the banner read — see `SyncPanel`. */}
          <SyncPanel />

          <button
            type="button"
            onClick={() => void runDiagnostics()}
            disabled={diagnostics === 'running'}
            className={cn(
              'flex h-28 cursor-pointer items-center justify-center gap-6 rounded-7 border',
              'bg-transparent px-12 text-xs-plus transition-colors disabled:cursor-not-allowed',
              diagnostics === 'done'
                ? 'border-pos text-pos'
                : diagnostics === 'failed'
                  ? 'border-neg text-neg'
                  : 'border-line-2 text-dim hover:border-acc-line hover:text-acc-dim',
            )}
          >
            <Stethoscope aria-hidden className="size-13" />
            {diagnostics === 'running' ? t('diagRun') : t('runDiag')}
          </button>

          {diagnostics === 'running' && (
            <div className="h-4 overflow-hidden rounded-3 bg-grid">
              <div className="h-full w-1/3 animate-[pulse-ring_1.2s_infinite] bg-acc" />
            </div>
          )}

          {result !== null && diagnostics !== 'running' && (
            <div className="flex flex-col gap-6">
              <DiagnosticRow
                ok={result.reachable}
                label={t('diag1')}
                value={`${result.latencyMs} ms`}
              />
              <DiagnosticRow
                ok={result.reachable}
                label={t('diag2')}
                value={result.reachable ? t('ok') : (result.message ?? t('tFail'))}
              />
              <DiagnosticRow
                ok={result.shops > 0}
                label={t('diag3')}
                value={t('shopsCount', { n: result.shops })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  meta,
}: {
  readonly label: string;
  readonly value: string;
  readonly meta: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 bg-ground px-10 py-9">
      <span className="text-meta uppercase tracking-[0.09em] text-faint">{label}</span>
      <span data-numeric className="truncate text-md">
        {value}
      </span>
      <span className="truncate text-mini leading-[1.4] text-dim">{meta}</span>
    </div>
  );
}

function DiagnosticRow({
  ok,
  label,
  value,
}: {
  readonly ok: boolean;
  readonly label: string;
  readonly value: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-8 rounded-8 border border-line px-9 py-7 text-xs-plus">
      <Icon
        name={ok ? 'circle-check' : 'alert-triangle'}
        className={cn('size-12 shrink-0', ok ? 'text-pos' : 'text-neg')}
      />
      <span className="text-dim">{label}</span>
      <div className="flex-1" />
      <span data-numeric className="truncate text-faint">
        {value}
      </span>
    </div>
  );
}

/** A switch row in the same language the General tab uses for its toggles. */
function FlagRow({
  label,
  hint,
  value,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-10">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn(
          'flex h-20 w-36 shrink-0 cursor-pointer items-center rounded-full border p-0 transition-colors',
          value ? 'justify-end border-acc bg-acc-soft' : 'justify-start border-line-2 bg-grid',
        )}
      >
        <span
          className={cn('mx-2 size-14 rounded-full transition-colors', value ? 'bg-acc-dim' : 'bg-faint')}
        />
      </button>
      <div className="min-w-0">
        <div className="text-xs-plus">{label}</div>
        <div className="text-tiny text-faint">{hint}</div>
      </div>
    </div>
  );
}
