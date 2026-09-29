import { ChevronRight, ExternalLink, PlugZap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import {
  AI_TIMEOUT_OPTIONS,
  MAX_TOKENS_BOUNDS,
  MAX_TOKENS_STEP,
  TEMPERATURE_BOUNDS,
  TEMPERATURE_STEP,
  findProvider,
} from '@/constants/settings';
import { formatNumber } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api/client';
import { testConnection } from '@/services/ai/connection';
import {
  canListModels,
  isAiConfigured,
  isHeaderSafe,
  requiresApiKey,
  samplingSupported,
} from '@/services/ai/modelRules';
import { useAiProviderSettings, useSettingsStore } from '@/store/settings.store';
import { useToastStore } from '@/store/toast.store';
import type { AiConnection, AiProvider, AiProviderDefinition } from '@/types/settings';

import { AiModelField } from './AiModelField';
import type { ModelLoadState } from './aiModelLoadState';
import { AiParamFields } from './AiParamFields';
import { describeAiError } from './aiErrors';
import { CommitField } from './CommitField';
import { CredentialField } from './CredentialField';
import { ModelQuotaPanel } from './ModelQuotaPanel';
import { TokenUsagePanel } from './TokenUsagePanel';

type TestState = 'idle' | 'testing' | 'ok' | 'failed';

interface TestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

interface AiProviderCardProps {
  readonly id: AiProvider;
  /** Whether this is the provider the Copilot currently sends requests through. */
  readonly active: boolean;
  /** This provider's own "Load models" cache, kept in the parent so it survives switching cards and back. */
  readonly loadState: ModelLoadState;
  readonly onLoadModels: () => void;
}

/**
 * One provider's whole card: its own credential, endpoint, model and
 * parameters, a connection test against exactly that configuration, its own
 * token spend, and a "make active" button.
 *
 * Every field here writes through `updateAiConnection(id, patch)` — never a
 * shared `ai` object — so editing this card can never touch another
 * provider's entry, active or not. That structural separation, not a smarter
 * card, is what fixes the bug this pane used to have: a key typed for one
 * provider ending up under another's after a switch.
 */
export function AiProviderCard({ id, active, loadState, onLoadModels }: AiProviderCardProps): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const resolved = useAiProviderSettings(id);
  const updateConnection = useSettingsStore((state) => state.updateAiConnection);
  const setActive = useSettingsStore((state) => state.setActiveAiProvider);
  const maskSecrets = useSettingsStore((state) => state.settings.features.maskSecrets);

  const [test, setTest] = useState<TestState>('idle');
  const [result, setResult] = useState<TestResult | null>(null);
  const testControllerRef = useRef<AbortController | null>(null);

  const provider = findProvider(id);
  const configured = isAiConfigured(resolved);
  const loadDisabledReason = canListModels(resolved) ? null : t('aiFinishSetup');
  const headerSafeValidate = (value: string): string | null =>
    isHeaderSafe(value) ? null : t('aiParamHeaderUnsafe');

  // A pending probe belongs to this card; it must not outlive it.
  useEffect(() => {
    return () => {
      testControllerRef.current?.abort();
    };
  }, []);

  const commit = (patch: Partial<AiConnection>): void => {
    updateConnection(id, patch);
  };

  /* A real round trip to this card's own configured endpoint and key, through
     the exact request the chat itself would send — whether or not this
     provider is the one currently active. */
  const runTest = (): void => {
    testControllerRef.current?.abort();
    const controller = new AbortController();
    testControllerRef.current = controller;

    setTest('testing');
    const startedAt = performance.now();

    testConnection(resolved, controller.signal)
      .then((check) => {
        setResult({ ok: true, latencyMs: check.latencyMs, detail: check.reply.slice(0, 80) });
        setTest('ok');
        push(t('testOk', { ms: check.latencyMs }), { kind: 'ok' });
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          const message = t('aiErrUnknown');
          setResult({ ok: false, latencyMs: Math.round(performance.now() - startedAt), detail: message });
          setTest('failed');
          push(message, { kind: 'err' });
          return;
        }

        const message = describeAiError(error, id, t);
        if (message === null) {
          // Cancelled — the card was closed or the seller ran another test.
          setTest('idle');
          return;
        }

        setResult({ ok: false, latencyMs: Math.round(performance.now() - startedAt), detail: message });
        setTest('failed');
        push(message, { kind: 'err' });
      });
  };

  return (
    <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-12 max-[980px]:grid-cols-1">
      {/* this provider's own configuration */}
      <div className="overflow-hidden rounded-11 border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-9 gap-y-7 border-b border-line px-11 py-11 sm:px-14">
          <Icon name={provider.icon} className="size-15 shrink-0 text-acc-dim" />
          <span className="text-base font-medium">{t('providerConfig', { name: provider.label })}</span>
          <div className="hidden flex-1 sm:block" />

          {active ? (
            <Pill tone="positive" size="md">
              <Icon name="circle-check" className="size-11" />
              {t('aiActiveBadge')}
            </Pill>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActive(id)}
              disabled={!configured}
              title={!configured ? t('aiFinishSetup') : undefined}
            >
              {t('aiMakeActive')}
            </Button>
          )}

          <Button
            variant="secondary"
            size="md"
            icon={<PlugZap aria-hidden className="size-12" />}
            onClick={runTest}
            disabled={test === 'testing' || !configured}
            title={!configured ? t('aiFinishSetup') : undefined}
          >
            {test === 'testing'
              ? t('testing')
              : test === 'ok'
                ? t('testOk', { ms: result?.latencyMs ?? 0 })
                : t('testConn')}
          </Button>
        </div>

        <div className="flex flex-col gap-11 px-11 py-12 sm:px-14">
          <div className="grid grid-cols-2 gap-10 max-[720px]:grid-cols-1">
            <div className="col-span-2 flex flex-col gap-6 max-[720px]:col-span-1">
              <CredentialField
                label={requiresApiKey(id) ? t('apiKey') : `${t('apiKey')} · ${t('optional')}`}
                value={resolved.apiKey}
                placeholder={provider.keyPlaceholder === '' ? t('keyNoFormat') : provider.keyPlaceholder}
                emptyLabel={t('notSet')}
                masked={maskSecrets}
                validate={headerSafeValidate}
                onCommit={(apiKey) => {
                  commit({ apiKey });
                  push(t('savedT'), { kind: 'ok' });
                }}
              />
              {provider.keyUrl !== null && (
                <a
                  href={provider.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap inline-flex w-fit items-center gap-4 text-mini text-acc-dim hover:underline"
                >
                  {t('getKeyLink')}
                  <ExternalLink aria-hidden className="size-10" />
                </a>
              )}
            </div>

            <BaseUrlControl provider={provider} value={resolved.baseUrl} onCommit={(baseUrl) => commit({ baseUrl })} />

            <AiModelField
              label={t('model')}
              provider={provider}
              value={resolved.model}
              onChange={(model) => commit({ model })}
              loaded={loadState.models}
              loading={loadState.loading}
              loadDisabledReason={loadDisabledReason}
              loadError={loadState.error}
              onLoad={onLoadModels}
            />

            <SelectField
              label={t('timeout')}
              value={String(resolved.timeoutMs)}
              onChange={(event) => commit({ timeoutMs: Number(event.target.value) })}
              options={AI_TIMEOUT_OPTIONS.map((ms) => ({ value: String(ms), label: `${ms / 1000} s` }))}
            />

            <AiParamFields provider={id} params={provider.params} connection={resolved} onCommit={commit} />
          </div>

          {id === 'ollama' && (
            <p className="m-0 rounded-8 border border-line-2 bg-grid px-10 py-8 text-xs leading-[1.55] text-dim">
              {t('ollamaHint', { origin: window.location.origin })}
            </p>
          )}
          {id === 'custom' && (
            <p className="m-0 rounded-8 border border-line-2 bg-grid px-10 py-8 text-xs leading-[1.55] text-dim">
              {t('customHint')}
            </p>
          )}

          <div className="grid grid-cols-2 gap-10 max-[720px]:grid-cols-1">
            <div className="flex flex-col gap-5">
              {samplingSupported(resolved) ? (
                <>
                  <label htmlFor={`ai-temperature-${id}`} className="flex items-center gap-6 text-xs text-dim">
                    {t('temp')}
                    <span data-numeric className="ml-auto text-text">
                      {resolved.temperature.toFixed(2)}
                    </span>
                  </label>
                  <input
                    id={`ai-temperature-${id}`}
                    type="range"
                    min={TEMPERATURE_BOUNDS.min}
                    max={TEMPERATURE_BOUNDS.max}
                    step={TEMPERATURE_STEP}
                    value={resolved.temperature}
                    onChange={(event) => commit({ temperature: Number(event.target.value) })}
                    className="w-full cursor-pointer bg-transparent"
                  />
                  <span className="text-tiny text-faint">{t('tempHint')}</span>
                </>
              ) : (
                <>
                  <span className="text-xs text-dim">{t('temp')}</span>
                  <p className="m-0 text-tiny leading-[1.45] text-faint">{t('noSamplingHint')}</p>
                </>
              )}
            </div>

            <div className="flex flex-col gap-5">
              <label htmlFor={`ai-max-tokens-${id}`} className="flex items-center gap-6 text-xs text-dim">
                {t('maxTok')}
                <span data-numeric className="ml-auto text-text">
                  {formatNumber(resolved.maxTokens)}
                </span>
              </label>
              <input
                id={`ai-max-tokens-${id}`}
                type="range"
                min={MAX_TOKENS_BOUNDS.min}
                max={MAX_TOKENS_BOUNDS.max}
                step={MAX_TOKENS_STEP}
                value={resolved.maxTokens}
                onChange={(event) => commit({ maxTokens: Number(event.target.value) })}
                className="w-full cursor-pointer bg-transparent"
              />
              <span className="text-tiny text-faint">{t('tokHint')}</span>
            </div>
          </div>

          <p className="m-0 text-xs leading-[1.55] text-dim">{t('storedLocal')}</p>
        </div>
      </div>

      {/* budget, spend and connection test */}
      <div className="flex flex-col gap-12">
        <ModelQuotaPanel provider={id} model={resolved.model} />
        <TokenUsagePanel provider={id} />

        <div className="flex flex-col gap-10 rounded-11 border border-line bg-panel px-11 py-13 sm:px-14">
          <div className="flex items-center gap-8">
            <span className="text-sm-plus font-medium">{t('testConn')}</span>
            <div className="flex-1" />
            {test !== 'idle' && (
              <span
                className={cn(
                  'flex items-center gap-5 text-mini',
                  test === 'ok' ? 'text-pos' : test === 'failed' ? 'text-neg' : 'text-faint',
                )}
              >
                <span
                  className={cn(
                    'size-5 rounded-full',
                    test === 'ok' ? 'bg-pos' : test === 'failed' ? 'bg-neg' : 'bg-faint',
                  )}
                />
                {test === 'testing' ? t('testing') : test === 'ok' ? t('testOk', { ms: result?.latencyMs ?? 0 }) : t('testFailed')}
              </span>
            )}
          </div>

          <p className="m-0 text-xs leading-[1.55] text-dim">{t('storedLocal')}</p>

          {result !== null && test !== 'testing' && (
            <div className="flex flex-col gap-6 border-t border-line pt-10">
              <div className="flex items-center gap-8 text-xs-plus">
                <span className="text-faint">{t('latencyLabel')}</span>
                <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
                <span data-numeric className="text-dim">
                  {result.latencyMs} ms
                </span>
              </div>
              <div className="flex items-center gap-8 text-xs-plus">
                <span className="shrink-0 text-faint">{result.ok ? t('responseLabel') : t('errorLabel')}</span>
                <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
                <span className={cn('min-w-0 truncate text-right', result.ok ? 'text-dim' : 'text-neg')}>
                  {result.detail}
                </span>
              </div>
            </div>
          )}

          {requiresApiKey(id) && resolved.apiKey.trim() === '' && (
            <p className="m-0 rounded-8 border border-warn-line bg-warn-soft px-10 py-8 text-xs text-warn">
              {t('aiNoKey')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The base URL field, laid out by the catalogue's `endpoint` mode.
 *
 * `fixed` hides its own URL behind a deliberate click — a seller who edits a
 * vendor's endpoint by accident gets a connection that can never answer, so
 * "Advanced" exists to make that a choice rather than a slip. `editable` and
 * `required` have no wrong-by-accident default to protect, so both show the
 * field up front.
 */
function BaseUrlControl({
  provider,
  value,
  onCommit,
}: {
  readonly provider: AiProviderDefinition;
  readonly value: string;
  readonly onCommit: (value: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (provider.endpoint === 'editable') {
    return <CommitField label={t('baseUrl')} value={value} mono onCommit={onCommit} />;
  }

  if (provider.endpoint === 'required') {
    return (
      <div className="flex flex-col gap-4">
        <CommitField label={t('baseUrl')} value={value} mono onCommit={onCommit} />
        {value.trim() === '' && (
          <p role="alert" className="m-0 text-tiny leading-[1.4] text-neg">
            {t('baseUrlRequiredWarn')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`ai-base-url-advanced-${provider.id}`}
        onClick={() => setOpen((current) => !current)}
        className="tap flex w-fit cursor-pointer items-center gap-5 border-0 bg-transparent p-0 text-xs text-dim hover:text-acc-dim"
      >
        <ChevronRight aria-hidden className={cn('size-11 shrink-0 transition-transform', open && 'rotate-90')} />
        {t('advanced')}
      </button>

      {open && (
        <div id={`ai-base-url-advanced-${provider.id}`} className="flex flex-col gap-6">
          <CommitField label={t('baseUrl')} value={value} mono onCommit={onCommit} />
          {value !== provider.baseUrl && (
            <button
              type="button"
              onClick={() => onCommit(provider.baseUrl)}
              className="tap w-fit cursor-pointer border-0 bg-transparent p-0 text-mini text-acc-dim hover:underline"
            >
              {t('restoreDefault')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
