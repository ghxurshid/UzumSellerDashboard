import { Plug, PlugZap, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { SelectField, TextField } from '@/components/ui/Field';
import {
  AI_PROVIDERS,
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
import { complete } from '@/services/ai/client';
import { useAiSettings, useFeatureFlags, useSettingsStore } from '@/store/settings.store';
import { useToastStore } from '@/store/toast.store';
import type { AiProvider, ProviderStatus } from '@/types/settings';

import { CredentialField } from './CredentialField';

type TestState = 'idle' | 'testing' | 'ok' | 'failed';

interface TestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

const STATUS_COLOR: Readonly<Record<ProviderStatus, string>> = {
  operational: 'text-pos',
  degraded: 'text-warn',
  'not running': 'text-faint',
  configure: 'text-faint',
};

/**
 * AI provider configuration.
 *
 * Laid out as the design draws it: the adapter registry on top, the active
 * adapter's configuration on the left, and its health and cost on the right.
 * Selecting an adapter or moving a control writes straight through to the
 * persisted settings — there is no save step, so what is on screen is what is
 * stored.
 */
export function AiSettings(): ReactNode {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const ai = useAiSettings();
  const features = useFeatureFlags();
  const patch = useSettingsStore((state) => state.patch);

  const [test, setTest] = useState<TestState>('idle');
  const [result, setResult] = useState<TestResult | null>(null);

  const provider = findProvider(ai.provider);

  /* Switching adapters carries its endpoint and default model across, so the
     pane never shows one vendor's model against another's base URL. */
  const selectProvider = (next: AiProvider): void => {
    const definition = findProvider(next);
    patch({
      ai: { provider: next, baseUrl: definition.baseUrl, model: definition.defaultModel },
    });
  };

  /* A real round trip to the configured endpoint with the stored key. The
     answer is discarded — what is being checked is that it arrives at all. */
  const runTest = (): void => {
    setTest('testing');
    const startedAt = performance.now();

    void complete(ai, {
      system: 'Reply with the single word: ok.',
      messages: [{ role: 'user', content: 'ping' }],
    })
      .then((answer) => {
        setResult({
          ok: true,
          latencyMs: Math.round(performance.now() - startedAt),
          detail: answer.trim().slice(0, 80),
        });
        setTest('ok');
        push(t('testOk'), { kind: 'ok' });
      })
      .catch((error: unknown) => {
        const detail = error instanceof ApiError ? error.message : t('tFail');
        setResult({ ok: false, latencyMs: Math.round(performance.now() - startedAt), detail });
        setTest('failed');
        push(detail, { kind: 'err' });
      });
  };

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-wrap items-end gap-x-12 gap-y-7">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h1 className="m-0 text-xl font-medium tracking-[-0.02em]">{t('sAi')}</h1>
          <p className="m-0 max-w-760 text-xs-plus leading-[1.6] text-dim">{t('aiSub')}</p>
        </div>
        <span className="flex shrink-0 items-center gap-6 whitespace-nowrap rounded-6 border border-acc-line bg-acc-soft px-9 py-3 text-mini text-acc-dim">
          <Plug aria-hidden className="size-12" />
          {t('adapters', { count: AI_PROVIDERS.length })}
        </span>
      </header>

      {/* adapter registry */}
      <div className="grid grid-cols-5 gap-8 max-[860px]:grid-cols-3 max-[560px]:grid-cols-2">
        {AI_PROVIDERS.map((entry) => {
          const active = entry.id === ai.provider;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => selectProvider(entry.id)}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-5 rounded-10 border px-10 py-9 text-left',
                'transition-colors hover:border-acc-line',
                active ? 'border-acc bg-acc-soft' : 'border-line bg-panel',
              )}
            >
              <div className="flex w-full items-center gap-7">
                <Icon
                  name={entry.icon}
                  className={cn('size-14 shrink-0', active ? 'text-acc-dim' : 'text-faint')}
                />
                <span className="truncate text-sm font-medium">{entry.label}</span>
                {active && (
                  <Icon name="circle-check" className="ml-auto size-13 shrink-0 text-acc-dim" />
                )}
              </div>
              <span className="text-tiny leading-[1.35] text-faint">{entry.meta}</span>
              <span className={cn('flex items-center gap-4 text-meta', STATUS_COLOR[entry.status])}>
                <span className="size-5 rounded-full bg-current" />
                {entry.status}
              </span>
            </button>
          );
        })}

        {/* The registry's own "add" affordance — a design element, not a provider. */}
        <div className="flex cursor-default flex-col items-start gap-5 rounded-10 border border-line bg-panel px-10 py-9">
          <div className="flex w-full items-center gap-7">
            <Plus aria-hidden className="size-14 shrink-0 text-faint" />
            <span className="truncate text-sm font-medium">{t('addAdapter')}</span>
          </div>
          <span className="text-tiny leading-[1.35] text-faint">{t('addAdapterMeta')}</span>
          <span className="flex items-center gap-4 text-meta text-faint">
            <span className="size-5 rounded-full bg-current" />
            registry
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-12 max-[980px]:grid-cols-1">
        {/* active adapter configuration */}
        <div className="overflow-hidden rounded-11 border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-x-9 gap-y-7 border-b border-line px-11 py-11 sm:px-14">
            <Icon name={provider.icon} className="size-15 shrink-0 text-acc-dim" />
            <span className="text-base font-medium">
              {t('providerConfig', { name: provider.label })}
            </span>
            <span className="min-w-0 truncate text-mini text-faint">{t('adapterRegistry')}</span>
            <div className="hidden flex-1 sm:block" />
            <button
              type="button"
              onClick={runTest}
              disabled={test === 'testing'}
              className={cn(
                'tap flex h-36 shrink-0 cursor-pointer items-center gap-6 rounded-7 border border-line-2 md:h-26',
                'bg-transparent px-10 text-xs-plus text-dim transition-colors',
                'hover:border-acc-line hover:text-acc-dim disabled:cursor-not-allowed',
              )}
            >
              <PlugZap aria-hidden className="size-12" />
              {test === 'testing' ? t('testing') : test === 'ok' ? t('testOk') : t('testConn')}
            </button>
          </div>

          <div className="flex flex-col gap-11 px-11 py-12 sm:px-14">
            <div className="grid grid-cols-2 gap-10 max-[720px]:grid-cols-1">
              <div className="col-span-2 max-[720px]:col-span-1">
                <CredentialField
                  label={t('apiKey')}
                  value={ai.apiKey}
                  placeholder="sk-…"
                  emptyLabel={t('notSet')}
                  masked={features.maskSecrets}
                  onCommit={(apiKey) => {
                    patch({ ai: { apiKey } });
                    push(t('savedT'), { kind: 'ok' });
                  }}
                />
              </div>

              <CommitField
                label={t('baseUrl')}
                value={ai.baseUrl}
                mono
                onCommit={(baseUrl) => patch({ ai: { baseUrl } })}
              />

              <CommitField
                label={t('orgId')}
                value={ai.orgId}
                optional
                placeholder={t('notSet')}
                onCommit={(orgId) => patch({ ai: { orgId } })}
              />

              {provider.models.length > 0 ? (
                <SelectField
                  label={t('model')}
                  value={ai.model}
                  onChange={(event) => patch({ ai: { model: event.target.value } })}
                  options={provider.models.map((entry) => ({
                    value: entry.id,
                    label: entry.label,
                  }))}
                />
              ) : (
                <CommitField
                  label={t('model')}
                  value={ai.model}
                  mono
                  placeholder={t('modelHint')}
                  onCommit={(model) => patch({ ai: { model } })}
                />
              )}

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

            <div className="grid grid-cols-2 gap-10 max-[720px]:grid-cols-1">
              <div className="flex flex-col gap-5">
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

            <div className="flex flex-wrap items-center gap-7 border-t border-line pt-11 text-xs text-faint">
              <Icon name={provider.icon} className="size-12" />
              <span className="font-mono">{provider.meta}</span>
            </div>

            <p className="m-0 text-xs leading-[1.55] text-dim">{t('storedLocal')}</p>
          </div>
        </div>

        {/* connection test */}
        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-10 rounded-11 border border-line bg-panel px-11 py-13 sm:px-14">
            <div className="flex items-center gap-8">
              <span className="text-sm-plus font-medium">{t('testConn')}</span>
              <div className="flex-1" />
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
                {STATUS_COLOR[provider.status] !== undefined && provider.status}
              </span>
            </div>

            <p className="m-0 text-xs leading-[1.55] text-dim">{t('storedLocal')}</p>

            {result !== null && test !== 'testing' && (
              <div className="flex flex-col gap-6 border-t border-line pt-10">
                <div className="flex items-center gap-8 text-xs-plus">
                  <span className="text-faint">latency</span>
                  <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
                  <span data-numeric className="text-dim">
                    {result.latencyMs} ms
                  </span>
                </div>
                <div className="flex items-center gap-8 text-xs-plus">
                  <span className="shrink-0 text-faint">{result.ok ? 'response' : 'error'}</span>
                  <div className="mb-3 flex-1 border-b border-dotted border-line-2" />
                  <span
                    className={cn('min-w-0 truncate text-right', result.ok ? 'text-dim' : 'text-neg')}
                  >
                    {result.detail}
                  </span>
                </div>
              </div>
            )}

            {ai.apiKey.trim() === '' && (
              <p className="m-0 rounded-8 border border-warn-line bg-warn-soft px-10 py-8 text-xs text-warn">
                {t('connNone')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A text field that keeps its edit in local state and commits on blur.
 *
 * Writing through on every keystroke would let a half-typed URL reach the
 * sanitiser, which restores the default the moment the field goes empty —
 * the value would fight the person typing it.
 */
function CommitField({
  label,
  value,
  placeholder,
  optional = false,
  mono = false,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly optional?: boolean;
  readonly mono?: boolean;
  readonly onCommit: (value: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  /* While the field is focused the draft owns the value; otherwise the store
     does, so a reset or an adapter switch is reflected immediately. */
  const shown = focused ? draft : value;

  return (
    <TextField
      label={optional ? `${label} · ${t('optional')}` : label}
      value={shown}
      {...(placeholder !== undefined ? { placeholder } : {})}
      spellCheck={false}
      autoComplete="off"
      className={mono ? 'font-mono' : undefined}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          setFocused(false);
        }
      }}
    />
  );
}
