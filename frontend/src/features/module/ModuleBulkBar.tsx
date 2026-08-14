import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

export interface BulkAction {
  readonly key: string;
  readonly labelKey: TranslationKey;
  readonly icon: string;
  readonly primary?: boolean;
  readonly run: () => void;
}

interface ModuleBulkBarProps {
  readonly count: number;
  readonly actions: readonly BulkAction[];
  readonly disabled: boolean;
  readonly onClear: () => void;
}

/**
 * The selection bar above the table.
 *
 * `role="status"` so the count is announced when it changes — a bulk action
 * that reports "12 selected" only visually is a hazard for anyone who cannot
 * see the highlighted rows.
 */
export function ModuleBulkBar({
  count,
  actions,
  disabled,
  onClear,
}: ModuleBulkBarProps): ReactNode {
  const { t } = useTranslation();

  if (count === 0) return null;

  return (
    <div
      role="status"
      className="flex animate-[rise_0.14s_ease] items-center gap-8 border-b border-line bg-acc-soft px-14 py-8"
    >
      <span data-numeric className="text-xs-plus font-medium text-acc-dim">
        {count} {t('selectedL')}
      </span>

      <button
        type="button"
        onClick={onClear}
        className="cursor-pointer border-0 bg-transparent p-0 text-xs text-faint underline underline-offset-2"
      >
        {t('clearAll')}
      </button>

      <div className="flex-1" />

      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={disabled}
          onClick={action.run}
          className={cn(
            'flex h-24 cursor-pointer items-center gap-5 rounded-6 border px-9 text-xs transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-45',
            action.primary === true
              ? 'border-acc bg-acc-soft text-acc-dim hover:bg-acc-strong'
              : 'border-line-2 bg-transparent text-dim hover:border-acc-line hover:text-acc-dim',
          )}
        >
          <Icon name={action.icon} className="size-12" />
          {t(action.labelKey)}
        </button>
      ))}
    </div>
  );
}
