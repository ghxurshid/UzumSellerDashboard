import type { ReactNode } from 'react';

import { SelectField, type SelectOption } from '@core/ui/kit/Field';
import type { TranslationKey } from '@core/i18n/dictionary';
import { useTranslation } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import {
  ANTHROPIC_VERSION,
  isHeaderSafe,
  reasoningEffortOptions,
  thinkingLevelOptions,
} from '@core/ai/modelRules';
import type { AiConnection, AiParam, AiProvider, ReasoningEffort, ThinkingLevel } from '@core/types/settings';

import { CommitField } from './CommitField';

/**
 * The provider-specific parameters a card offers, in the catalogue's own
 * `params` order.
 *
 * Every control here writes through the one `onCommit` a card already uses
 * for every other field — `AiSettings.tsx` still owns the single call to
 * `updateAiConnection`, this file only decides which control a given
 * parameter needs and what it writes. A parameter whose model no longer
 * accepts it (`reasoningEffort`, `thinkingLevel`) hides its control rather
 * than offering a value the transport would only have to drop — see
 * `reasoningEffortOptions`/`thinkingLevelOptions` in `services/ai/modelRules`,
 * the same tables the transport itself reads before putting a value on the
 * wire, so the card's menu and the request can never disagree about what a
 * model accepts.
 */

/** The header or body field each parameter actually becomes, named for the hint under its control — never translated, these are wire identifiers, not prose. */
const WIRE_FIELD: Readonly<Partial<Record<AiParam, string>>> = {
  orgId: 'OpenAI-Organization',
  projectId: 'OpenAI-Project',
  anthropicVersion: 'anthropic-version',
  appUrl: 'HTTP-Referer',
  appTitle: 'X-OpenRouter-Title',
  thinkingLevel: 'thinkingConfig.thinkingLevel',
  thinking: 'thinking.type',
};

/** `reasoningEffort`'s own wire field differs by dialect — see `modelRules.ts`'s per-provider sampling builders. */
function reasoningWireField(provider: AiProvider): string {
  if (provider === 'claude') return 'output_config.effort';
  if (provider === 'grok') return 'reasoning_effort';
  return 'reasoning.effort'; // openai, openrouter
}

/** One word per level, shared by `reasoningEffort` and `thinkingLevel` — the two scales name the same depths in different words per vendor, but the seller-facing label is one vocabulary. */
const LEVEL_LABEL: Readonly<Record<ReasoningEffort, TranslationKey>> = {
  none: 'effortNone',
  minimal: 'effortMinimal',
  low: 'effortLow',
  medium: 'effortMedium',
  high: 'effortHigh',
  xhigh: 'effortXhigh',
  max: 'effortMax',
};

interface FieldProps {
  readonly param: AiParam;
  readonly provider: AiProvider;
  readonly connection: AiConnection;
  readonly onCommit: (patch: Partial<AiConnection>) => void;
}

/** Label + control + a one-line "sent as …" hint — the shape every param row shares. */
function ParamShell({ children, hint }: { readonly children: ReactNode; readonly hint: string }): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      {children}
      <span className="text-mini text-faint">{hint}</span>
    </div>
  );
}

function StaleWarning({ show }: { readonly show: boolean }): ReactNode {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <p role="alert" className="m-0 text-tiny leading-[1.4] text-warn">
      {t('aiParamStaleWarn')}
    </p>
  );
}

/**
 * A plain text parameter — `orgId`, `projectId`, `anthropicVersion`, `appUrl`,
 * `appTitle`. Each call site below supplies its own `value`/`onCommit` rather
 * than this reading `connection[param]` generically, so the field this writes
 * is always the one literal key the switch below named, never a computed
 * property a future rename could silently point at the wrong one.
 *
 * Every one of these five becomes an HTTP header (`WIRE_FIELD` above names
 * which one), and `fetch` throws on a header value outside printable ASCII —
 * so `isHeaderSafe` gates the commit here, the one place all five are written
 * from, rather than in five call sites that could drift.
 */
function TextParam({
  wireField,
  label,
  value,
  placeholder,
  onCommit,
}: {
  readonly wireField: string;
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onCommit: (value: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const validate = (next: string): string | null => (isHeaderSafe(next) ? null : t('aiParamHeaderUnsafe'));

  return (
    <ParamShell hint={t('aiParamWireField', { field: wireField })}>
      <CommitField
        label={label}
        value={value}
        optional
        placeholder={placeholder}
        validate={validate}
        onCommit={onCommit}
      />
    </ParamShell>
  );
}

function ReasoningEffortParam({ provider, connection, onCommit }: FieldProps): ReactNode {
  const { t } = useTranslation();
  const options = reasoningEffortOptions(provider, connection.model);
  if (options.length === 0) return null;

  const stale = connection.reasoningEffort !== '' && !options.includes(connection.reasoningEffort);
  const selectOptions: readonly SelectOption[] = [
    { value: '', label: t('reasoningEffortProviderDefault') },
    ...options.map((value) => ({ value, label: t(LEVEL_LABEL[value]) })),
  ];

  return (
    <ParamShell hint={t('aiParamWireField', { field: reasoningWireField(provider) })}>
      <SelectField
        label={t('reasoningEffort')}
        value={connection.reasoningEffort}
        onChange={(event) => onCommit({ reasoningEffort: event.target.value as ReasoningEffort | '' })}
        options={selectOptions}
      />
      <StaleWarning show={stale} />
    </ParamShell>
  );
}

function ThinkingLevelParam({ connection, onCommit }: FieldProps): ReactNode {
  const { t } = useTranslation();
  const options = thinkingLevelOptions(connection.model);
  if (options.length === 0) return null;

  const stale = connection.thinkingLevel !== '' && !options.includes(connection.thinkingLevel);
  const selectOptions: readonly SelectOption[] = [
    { value: '', label: t('thinkingLevelModelDefault') },
    ...options.map((value) => ({ value, label: t(LEVEL_LABEL[value]) })),
  ];

  return (
    <ParamShell hint={t('aiParamWireField', { field: WIRE_FIELD.thinkingLevel ?? '' })}>
      <SelectField
        label={t('thinkingLevel')}
        value={connection.thinkingLevel}
        onChange={(event) => onCommit({ thinkingLevel: event.target.value as ThinkingLevel | '' })}
        options={selectOptions}
      />
      <StaleWarning show={stale} />
    </ParamShell>
  );
}

/**
 * DeepSeek's `thinking.type` toggle — a hand-rolled `role="switch"`, the same
 * shape `features/settings/ApiSettings.tsx`'s `FlagRow` already draws for the
 * integration flags, kept local here since that one is private to its own
 * file and this pane has no third caller to justify pulling it into
 * `components/ui/`.
 */
function ThinkingToggle({ connection, onCommit }: FieldProps): ReactNode {
  const { t } = useTranslation();
  const value = connection.thinking;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-10">
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label={t('thinkingToggle')}
          onClick={() => onCommit({ thinking: !value })}
          className={cn(
            'tap flex h-24 w-42 shrink-0 cursor-pointer items-center rounded-full border p-0 transition-colors',
            'md:h-20 md:w-36',
            value ? 'justify-end border-acc bg-acc-soft' : 'justify-start border-line-2 bg-grid',
          )}
        >
          <span
            className={cn(
              'mx-3 size-16 rounded-full transition-colors md:mx-2 md:size-14',
              value ? 'bg-acc-dim' : 'bg-faint',
            )}
          />
        </button>
        <div className="min-w-0">
          <div className="text-xs-plus">{t('thinkingToggle')}</div>
          <div className="text-tiny text-faint">{t('thinkingHint')}</div>
        </div>
      </div>
      <span className="text-mini text-faint">{t('aiParamWireField', { field: WIRE_FIELD.thinking ?? '' })}</span>
    </div>
  );
}

function AiParamField({ param, provider, connection, onCommit }: FieldProps): ReactNode {
  const { t } = useTranslation();

  switch (param) {
    case 'orgId':
      return (
        <TextParam
          wireField={WIRE_FIELD.orgId ?? ''}
          label={t('orgId')}
          value={connection.orgId}
          placeholder={t('notSet')}
          onCommit={(orgId) => onCommit({ orgId })}
        />
      );
    case 'projectId':
      return (
        <TextParam
          wireField={WIRE_FIELD.projectId ?? ''}
          label={t('projectId')}
          value={connection.projectId}
          placeholder={t('notSet')}
          onCommit={(projectId) => onCommit({ projectId })}
        />
      );
    case 'anthropicVersion':
      return (
        <TextParam
          wireField={WIRE_FIELD.anthropicVersion ?? ''}
          label={t('anthropicVersion')}
          value={connection.anthropicVersion}
          placeholder={ANTHROPIC_VERSION}
          onCommit={(anthropicVersion) => onCommit({ anthropicVersion })}
        />
      );
    case 'appUrl':
      return (
        <TextParam
          wireField={WIRE_FIELD.appUrl ?? ''}
          label={t('appUrl')}
          value={connection.appUrl}
          placeholder={t('notSet')}
          onCommit={(appUrl) => onCommit({ appUrl })}
        />
      );
    case 'appTitle':
      return (
        <TextParam
          wireField={WIRE_FIELD.appTitle ?? ''}
          label={t('appTitle')}
          value={connection.appTitle}
          placeholder={t('notSet')}
          onCommit={(appTitle) => onCommit({ appTitle })}
        />
      );
    case 'reasoningEffort':
      return <ReasoningEffortParam param={param} provider={provider} connection={connection} onCommit={onCommit} />;
    case 'thinkingLevel':
      return <ThinkingLevelParam param={param} provider={provider} connection={connection} onCommit={onCommit} />;
    case 'thinking':
      return <ThinkingToggle param={param} provider={provider} connection={connection} onCommit={onCommit} />;
    default:
      return null;
  }
}

interface AiParamFieldsProps {
  readonly provider: AiProvider;
  readonly params: readonly AiParam[];
  readonly connection: AiConnection;
  readonly onCommit: (patch: Partial<AiConnection>) => void;
}

/** Every parameter this provider's card offers, in the catalogue's own order — nothing when it offers none. */
export function AiParamFields({ provider, params, connection, onCommit }: AiParamFieldsProps): ReactNode {
  return (
    <>
      {params.map((param) => (
        <AiParamField key={param} param={param} provider={provider} connection={connection} onCommit={onCommit} />
      ))}
    </>
  );
}
