import * as Tooltip from '@radix-ui/react-tooltip';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { Kpi, Trend } from '@/types/domain';

const TREND_STYLE: Record<Trend, string> = {
  up: 'text-pos bg-pos-soft',
  down: 'text-neg bg-neg-soft',
  flat: 'text-faint bg-grid',
};

/**
 * Module KPI tiles with an explanatory tooltip.
 *
 * Radix Tooltip binds on focus as well as hover, so the definition behind each
 * metric is reachable from the keyboard — the design shows it on hover only,
 * which would strand it for anyone not using a mouse.
 */
export function ModuleKpiStrip({ kpis }: { readonly kpis: readonly Kpi[] }): ReactNode {
  const { t } = useTranslation();

  return (
    <Tooltip.Provider delayDuration={120}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px overflow-hidden rounded-10 border border-line bg-line">
        {kpis.map((kpi) => (
          <div key={kpi.key} className="flex flex-col gap-5 bg-panel px-11 pb-9 pt-10 hover:bg-raise">
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  className="flex cursor-help items-center gap-5 self-start border-0 bg-transparent p-0 text-meta uppercase tracking-[0.09em] text-faint"
                >
                  <span className="truncate font-mono normal-case tracking-normal">{kpi.labelKey}</span>
                  <Info aria-hidden className="size-10 opacity-70" />
                </button>
              </Tooltip.Trigger>

              <Tooltip.Portal>
                <Tooltip.Content
                  side="top"
                  sideOffset={6}
                  className="z-50 max-w-260 rounded-8 border border-line-2 bg-raise px-9 py-7 text-mini leading-[1.5] text-dim shadow-[var(--shadow-tip)] data-[state=delayed-open]:animate-[pop_0.12s_ease]"
                >
                  {kpi.source ?? t('econNote')}
                  <Tooltip.Arrow className="fill-[var(--s-line-2)]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>

            <span className="flex items-baseline gap-4">
              <span data-numeric className="text-2xl font-medium tracking-[-0.025em]">
                {kpi.value}
              </span>
              <span className="text-tiny text-faint">{kpi.unit}</span>
              <span
                data-numeric
                className={cn('ml-auto rounded-4 px-5 py-px text-mini', TREND_STYLE[kpi.trend])}
              >
                {kpi.delta}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Tooltip.Provider>
  );
}
