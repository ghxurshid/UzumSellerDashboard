import { ChevronRight, ExternalLink, PlugZap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { SelectField } from '@/components/ui/Field';
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
import { listModels, testConnection, type ProviderModel } from '@/services/ai/connection';
import { isAiConfigured, requiresApiKey, samplingSupported } from '@/services/ai/modelRules';
import { switchAiProvider } from '@/services/storage/aiConnections';
import { useAiSettings, useFeatureFlags, useSettingsStore } from '@/store/settings.store';
import { useToastStore } from '@/store/toast.store';
import type { AiProvider, AiProviderDefinition, AiSettings as AiSettingsModel } from '@/types/settings';

import { AiModelField } from './AiModelField';
import { AiProviderGrid } from './AiProviderGrid';
import { describeAiError } from './aiErrors';
import { CommitField } from './CommitField';
import { CredentialField } from './CredentialField';
import { ModelQuotaPanel } from './ModelQuotaPanel';

type TestState = 'idle' | 'testing' | 'ok' | 'failed';

interface TestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

interface ModelLoadState {
  readonly models: readonly ProviderModel[];
  readonly loading: boolean;
  readonly error: string | null;
}

const EMPTY_LOAD_STATE: ModelLoadState = { models: [], loading: false, error: null };

/**
 * Whether "Load models" has enough to try at all: the same base-URL/key check
 * `isAiConfigured` makes, minus the model itself. Requiring a model id before
 * the seller can see what models exist would defeat the button's own purpose
 * — this is exactly the case a fresh Ollama or custom gateway starts in.
 */
function canListModels(ai: Pick<AiSettingsModel, 'provider' | 'baseUrl' | 'apiKey'>): boolean {
  if (ai.baseUrl.trim() === '') return false;
  if (requiresApiKey(ai.provider) && ai.apiKey.trim() === '') return false;
  return true;
}

/**
 * AI provider configuration.
 *
 * The registry on top is nine real facts about nine adapters, never a fixed
 * "operational" label the bundle shipped with — every card reads its state
 * from `AiSettings` itself (`isAiConfigured`, `saved`). The panel below
 * configures whichever one is active; switching adapters carries a saved
 * connection back in, or the catalogue's own defaults the first time, via
 * `switchAiProvider`. There is no save step anywhere here — what is on
 * screen is what is stored.
 */
export function AiSettings(): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const ai = useAiSettings();
  const features = useFeatureFlags();
  const patch = useSettingsStore((state) => state.patch);

  const [test, setTest] = useState<TestState>('idle');
  const [result, setResult] = useState<TestResult | null>(null);
  const testControllerRef = useRef<AbortController | null>(null);

  /* Kept per provider so switching back to one already probed this session
     does not have to ask the network again — and lost the moment the pane
     unmounts, which is exactly what "for the session" means here. */
  const [loadState, setLoadState] = useState<Partial<Record<AiProvider, ModelLoadState>>>({});
  const loadControllerRef = useRef<AbortController | null>(null);

  const provider = findProvider(ai.provider);
  const currentLoad = loadState[ai.provider] ?? EMPTY_LOAD_STATE;
  const loadDisabledReason = canListModels(ai) ? null : t('aiFinishSetup');

  // A pending probe belongs to the pane, not to the seller's next click.
  useEffect(() => {
    return () => {
      testControllerRef.current?.abort();
      loadControllerRef.current?.abort();
    };
  }, []);

  /* Switching adapters files the outgoing connection under `saved` and
     restores the incoming one — its own saved connection, or the catalogue's
     defaults the first time — so the pane never shows one vendor's model
     against another's base URL. Any probe in flight belonged to the provider
     that is leaving. */
  const selectProvider = (next: AiProvider): void => {
    if (next === ai.provider) return;
    testControllerRef.current?.abort();
    loadControllerRef.current?.abort();
    setTest('idle');
    setResult(null);
    patch({ ai: switchAiProvider(ai, next) });
  };

  /* A real round trip to the configured endpoint with the stored key, through
     the exact request the chat itself would send. */
  const runTest = (): void => {
    testControllerRef.current?.abort();
    const controller = new AbortController();
    testControllerRef.current = controller;

    setTest('testing');
    const startedAt = performance.now();

    testConnection(ai, controller.signal)
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

        const message = describeAiError(error, ai.provider, t);
        if (message === null) {
          // Cancelled — the seller switched providers or left the pane.
          setTest('idle');
          return;
        }

        setResult({ ok: false, latencyMs: Math.round(performance.now() - startedAt), detail: message });
        setTest('failed');
        push(message, { kind: 'err' });
      });
  };

  /* The models this key can actually see, in the same dialect the chat uses.
     `listModels` reuses `isAiConfigured`'s gate, which also asks for a chosen
     model — right for a connection test, which has to send one, but wrong for
     "show me what's available" before anything is chosen. `listModels` never
     reads `.model` for anything else, so a placeholder here only clears the
     gate: it is never put on the wire and never saved. */
  const loadModels = (): void => {
    if (!canListModels(ai)) return;

    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;

    const activeProvider = ai.provider;
    setLoadState((state) => ({
      ...state,
      [activeProvider]: { models: state[activeProvider]?.models ?? [], loading: true, error: null },
    }));

    const probe: AiSettingsModel = ai.model.trim() === '' ? { ...ai, model: '*' } : ai;

    listModels(probe, controller.signal)
      .then((models) => {
        setLoadState((state) => ({ ...state, [activeProvider]: { models, loading: false, error: null } }));
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? describeAiError(error, activeProvider, t) : t('aiErrUnknown');
        setLoadState((state) => ({
          ...state,
          [activeProvider]: { models: state[activeProvider]?.models ?? [], loading: false, error: message },
        }));
      });
  };

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sAi')}</h1>
        <p className="m-0 max-w-760 text-xs-plus leading-[1.6] text-dim">{t('aiSub')}</p>
      </header>

      <AiProviderGrid ai={ai} onSelect={selectProvider} />

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-12 max-[980px]:grid-cols-1">
        {/* active adapter configuration */}
        <div className="overflow-hidden rounded-11 border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-x-9 gap-y-7 border-b border-line px-11 py-11 sm:px-14">
            <Icon name={provider.icon} className="size-15 shrink-0 text-acc-dim" />
            <span className="text-base font-medium">
              {t('providerConfig', { name: provider.label })}
            </span>
            <div className="hidden flex-1 sm:block" />
            <button
              type="button"
              onClick={runTest}
              disabled={test === 'testing' || !isAiConfigured(ai)}
              title={!isAiConfigured(ai) ? t('aiFinishSetup') : undefined}
              className={cn(
                'tap flex h-36 shrink-0 cursor-pointer items-center gap-6 rounded-7 border border-line-2 md:h-26',
                'bg-transparent px-10 text-xs-plus text-dim transition-colors',
                'hover:border-acc-line hover:text-acc-dim disabled:cursor-not-allowed disabled:opacity-55',
              )}
            >
              <PlugZap aria-hidden className="size-12" />
              {test === 'testing' ? t('testing') : test === 'ok' ? t('testOk', { ms: result?.latencyMs ?? 0 }) : t('testConn')}
            </button>
          </div>

          <div className="flex flex-col gap-11 px-11 py-12 sm:px-14">
            <div className="grid grid-cols-2 gap-10 max-[720px]:grid-cols-1">
              <div className="col-span-2 flex flex-col gap-6 max-[720px]:col-span-1">
                <CredentialField
                  label={requiresApiKey(ai.provider) ? t('apiKey') : `${t('apiKey')} · ${t('optional')}`}
                  value={ai.apiKey}
                  placeholder={provider.keyPlaceholder === '' ? t('keyNoFormat') : provider.keyPlaceholder}
                  emptyLabel={t('notSet')}
                  masked={features.maskSecrets}
                  onCommit={(apiKey) => {
                    patch({ ai: { apiKey } });
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

              <BaseUrlControl
                key={provider.id}
                provider={provider}
                value={ai.baseUrl}
                onCommit={(baseUrl) => patch({ ai: { baseUrl } })}
              />

              {provider.orgId && (
                <CommitField
                  label={t('orgId')}
                  value={ai.orgId}
                  optional
                  placeholder={t('notSet')}
                  onCommit={(orgId) => patch({ ai: { orgId } })}
                />
              )}

              <AiModelField
                key={provider.id}
                label={t('model')}
                provider={provider}
                value={ai.model}
                onChange={(model) => patch({ ai: { model } })}
                loaded={currentLoad.models}
                loading={currentLoad.loading}
                loadDisabledReason={loadDisabledReason}
                loadError={currentLoad.error}
                onLoad={loadModels}
              />

              <SelectField
                label={t('timeout')}
                value={String(ai.timeoutMs)}
                onChange={(event) => patch({ ai: { timeoutMs: Number(event.target.value) } })}
                options={AI_TIMEOUT_OPTIONS.map((ms) => ({
                  value: String(ms),
                  label: `${ms / 1000} s`,
                }))}
              />
            </div>

            {ai.provider === 'ollama' && (
              <p className="m-0 rounded-8 border border-line-2 bg-grid px-10 py-8 text-xs leading-[1.55] text-dim">
                {t('ollamaHint', { origin: window.location.origin })}
              </p>
            )}
            {ai.provider === 'custom' && (
              <p className="m-0 rounded-8 border border-line-2 bg-grid px-10 py-8 text-xs leading-[1.55] text-dim">
                {t('customHint')}
              </p>
            )}

            <div className="grid grid-cols-2 gap-10 max-[720px]:grid-cols-1">
              <div className="flex flex-col gap-5">
                {samplingSupported(ai) ? (
                  <>
                    <label
                      htmlFor="ai-temperature"
                      className="flex items-center gap-6 text-xs text-dim"
                    >
                      {t('temp')}
                      <span data-numeric className="ml-auto text-text">
                        {ai.temperature.toFixed(2)}
                      </span>
                    </label>
                    <input
                      id="ai-temperature"
                      type="range"
                      min={TEMPERATURE_BOUNDS.min}
                      max={TEMPERATURE_BOUNDS.max}
                      step={TEMPERATURE_STEP}
                      value={ai.temperature}
                      onChange={(event) =>
                        patch({ ai: { temperature: Number(event.target.value) } })
                      }
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
                <label htmlFor="ai-max-tokens" className="flex items-center gap-6 text-xs text-dim">
                  {t('maxTok')}
                  <span data-numeric className="ml-auto text-text">
                    {formatNumber(ai.maxTokens)}
                  </span>
                </label>
                <input
                  id="ai-max-tokens"
                  type="range"
                  min={MAX_TOKENS_BOUNDS.min}
                  max={MAX_TOKENS_BOUNDS.max}
                  step={MAX_TOKENS_STEP}
                  value={ai.maxTokens}
                  onChange={(event) => patch({ ai: { maxTokens: Number(event.target.value) } })}
                  className="w-full cursor-pointer bg-transparent"
                />
                <span className="text-tiny text-faint">{t('tokHint')}</span>
              </div>
            </div>

            <p className="m-0 text-xs leading-[1.55] text-dim">{t('storedLocal')}</p>
          </div>
        </div>

        {/* connection test */}
        <div className="flex flex-col gap-12">
          <ModelQuotaPanel provider={ai.provider} model={ai.model} />

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
                  {test === 'testing'
                    ? t('testing')
                    : test === 'ok'
                      ? t('testOk', { ms: result?.latencyMs ?? 0 })
                      : t('testFailed')}
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
                  <span className="shrink-0 text-faint">
                    {result.ok ? t('responseLabel') : t('errorLabel')}
                  </span>
                  <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
                  <span
                    className={cn('min-w-0 truncate text-right', result.ok ? 'text-dim' : 'text-neg')}
                  >
                    {result.detail}
                  </span>
                </div>
              </div>
            )}

            {requiresApiKey(ai.provider) && ai.apiKey.trim() === '' && (
              <p className="m-0 rounded-8 border border-warn-line bg-warn-soft px-10 py-8 text-xs text-warn">
                {t('aiNoKey')}
              </p>
            )}
          </div>
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
        aria-controls="ai-base-url-advanced"
        onClick={() => setOpen((current) => !current)}
        className="tap flex w-fit cursor-pointer items-center gap-5 border-0 bg-transparent p-0 text-xs text-dim hover:text-acc-dim"
      >
        <ChevronRight
          aria-hidden
          className={cn('size-11 shrink-0 transition-transform', open && 'rotate-90')}
        />
        {t('advanced')}
      </button>

      {open && (
        <div id="ai-base-url-advanced" className="flex flex-col gap-6">
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
