import { Database, Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { Panel, PanelKicker } from '@/components/ui/Panel';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { EconomicsRow, Tone } from '@/types/domain';

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

const TONE_BAR: Record<Tone, string> = {
  positive: 'bg-pos',
  negative: 'bg-neg',
  warning: 'bg-warn',
  accent: 'bg-acc',
  neutral: 'bg-dim',
};

interface UnitEconomicsProps {
  readonly rows: readonly EconomicsRow[];
  readonly onOpenMethod: () => void;
}

/**
 * The unit-economics breakdown: each line names the API field it is summed
 * from, because the design's premise is that nothing here is modelled.
 */
export function UnitEconomics({ rows, onOpenMethod }: UnitEconomicsProps): ReactNode {
  const { t } = useTranslation();

  return (
    <Panel className="flex min-w-0 flex-col gap-11 px-11 py-13 sm:px-14">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <PanelKicker>{t('unitEcon')}</PanelKicker>
        <span className="flex min-w-0 items-center gap-4 text-tiny text-faint">
          <Database aria-hidden className="size-10 shrink-0 text-acc-dim" />
          <span className="truncate">{t('srcFinOrders')}</span>
        </span>
      </div>

      <div className="flex flex-col gap-9">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-4">
            <div className="flex items-baseline gap-8">
              <span className="shrink-0 text-xs text-dim">{t(row.labelKey as TranslationKey)}</span>
              {/* The API field name is evidence, not a label — it is the first
                  thing to give up its space when the row is narrow. */}
              <span className="min-w-0 truncate font-mono text-meta text-faint">{row.field}</span>
              <div className="flex-1" />
              <span data-numeric className={`shrink-0 text-sm-plus ${TONE_TEXT[row.tone]}`}>
                {row.value}
              </span>
            </div>

            <div
              role="meter"
              aria-valuenow={row.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t(row.labelKey as TranslationKey)}
              className="h-5 overflow-hidden rounded-3 bg-grid"
            >
              <div
                className={`h-full rounded-3 ${TONE_BAR[row.tone]}`}
                style={{ width: `${row.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="flex items-start gap-7 border-t border-line pt-9 text-xs leading-[1.5] text-dim">
        <Info aria-hidden className="mt-2 size-12 shrink-0 text-acc-dim" />
        <span>
          {t('econNote')}{' '}
          <button
            type="button"
            onClick={onOpenMethod}
            className="tap cursor-pointer border-0 bg-transparent p-0 text-xs text-acc-dim underline underline-offset-2"
          >
            {t('method')}
          </button>
        </span>
      </p>
    </Panel>
  );
}
