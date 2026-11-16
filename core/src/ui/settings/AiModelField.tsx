import { useState, type ReactNode } from 'react';

import { useTranslation } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import type { AiModelOption, AiProviderDefinition } from '@core/types/settings';

import { CommitField } from './CommitField';
import { ModelPicker } from './ModelPicker';

const LINK_BUTTON = cn(
  'tap cursor-pointer rounded-4 border-0 bg-transparent p-0 text-mini text-acc-dim',
  'underline-offset-2 hover:underline',
  'disabled:cursor-not-allowed disabled:text-faint disabled:no-underline',
);

/**
 * Suggested and loaded entries, catalogue-first — a model the catalogue
 * already lists keeps its published `limits` even if the same id also came
 * back from "Load models", which never reports any.
 */
function mergedOptions(
  suggested: readonly AiModelOption[],
  loaded: readonly AiModelOption[],
): readonly AiModelOption[] {
  const byId = new Map<string, AiModelOption>();
  for (const option of suggested) byId.set(option.id, option);
  for (const option of loaded) if (!byId.has(option.id)) byId.set(option.id, option);
  return [...byId.values()];
}

interface AiModelFieldProps {
  readonly label: string;
  readonly provider: AiProviderDefinition;
  readonly value: string;
  readonly onChange: (model: string) => void;
  /** This provider's models as `listModels` last returned them this session. */
  readonly loaded: readonly AiModelOption[];
  readonly loading: boolean;
  /** Why "Load models" cannot run right now — a base URL or key still missing. */
  readonly loadDisabledReason: string | null;
  readonly loadError: string | null;
  readonly onLoad: () => void;
}

/**
 * The model field for every provider, in one control.
 *
 * The catalogue's `models` is a starting suggestion, not a ceiling — this
 * merges it with whatever "Load models" actually found for the seller's own
 * key, and always leaves a way to type an id neither list has yet: a
 * brand-new release, a private fine-tune, or a self-hosted name the catalogue
 * cannot guess. A value the seller already has configured stays on screen even
 * when it matches nothing here — an id this pane does not recognise is still
 * the seller's own choice, never silently replaced.
 *
 * `AiSettings` mounts a whole fresh `AiProviderCard` — this field included —
 * with `key={selected}` for whichever provider is open, so the free-text/
 * picker toggle below always starts back at "picker" for a newly opened card
 * rather than carrying the previous one's choice.
 */
export function AiModelField({
  label,
  provider,
  value,
  onChange,
  loaded,
  loading,
  loadDisabledReason,
  loadError,
  onLoad,
}: AiModelFieldProps): ReactNode {
  const { t } = useTranslation();
  const [customMode, setCustomMode] = useState(false);

  const suggested = mergedOptions(provider.models, loaded);
  const known = suggested.some((option) => option.id === value);
  const pickerOptions: readonly AiModelOption[] =
    !known && value.trim() !== '' ? [...suggested, { id: value, label: value }] : suggested;

  const showPicker = suggested.length > 0 && !customMode;
  const loadDisabled = loading || loadDisabledReason !== null;

  return (
    <div className="flex flex-col gap-6">
      {showPicker ? (
        <ModelPicker
          label={label}
          provider={provider.id}
          options={pickerOptions}
          value={value}
          onChange={onChange}
          placeholder={t('notSet')}
        />
      ) : (
        <CommitField
          label={label}
          value={value}
          mono
          placeholder={t('modelHint')}
          onCommit={onChange}
        />
      )}

      <div className="flex flex-wrap items-center gap-10">
        <button
          type="button"
          onClick={onLoad}
          disabled={loadDisabled}
          title={loadDisabledReason ?? undefined}
          className={LINK_BUTTON}
        >
          {loading ? t('loadingModels') : t('loadModels')}
        </button>

        {suggested.length > 0 && (
          <button
            type="button"
            onClick={() => setCustomMode((current) => !current)}
            className={LINK_BUTTON}
          >
            {customMode ? t('modelChooseList') : t('modelTypeId')}
          </button>
        )}
      </div>

      {loadError !== null && (
        <p role="alert" className="m-0 text-tiny leading-[1.45] text-neg">
          {loadError}
        </p>
      )}
    </div>
  );
}
