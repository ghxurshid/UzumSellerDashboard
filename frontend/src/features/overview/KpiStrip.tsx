import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { Kpi, Trend } from '@/types/domain';
import type { TranslationKey } from '@/lib/i18n/dictionary';

const TREND_STYLE: Record<Trend, { readonly text: string; readonly bg: string }> = {
  up: { text: 'text-pos', bg: 'bg-pos-soft' },
  down: { text: 'text-neg', bg: 'bg-neg-soft' },
  flat: { text: 'text-faint', bg: 'bg-grid' },
};

const TREND_ICON = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

/** Maps the 8-point sparkline to the 88×24 viewBox the design draws. */
function sparkPoints(values: readonly number[]): string {
  const max = Math.max(...values, 1);
  const step = 88 / Math.max(values.length - 1, 1);
  return values
    .map((value, index) => `${(index * step).toFixed(1)},${(24 - (value / max) * 22).toFixed(1)}`)
    .join(' ');
}

interface KpiStripProps {
  readonly kpis: readonly Kpi[];
  readonly onSelect?: (kpi: Kpi) => void;
}

/**
 * The seven-tile metric strip.
 *
 * Tiles are buttons: the design makes each one a filter entry point, and a
 * clickable div would be invisible to keyboard and screen-reader users.
 */
export function KpiStrip({ kpis, onSelect }: KpiStripProps): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(124px,1fr))] gap-px overflow-hidden rounded-10 border border-line bg-line">
      {kpis.map((kpi) => {
        const style = TREND_STYLE[kpi.trend];
        const TrendIcon = TREND_ICON[kpi.trend];

        return (
          <button
            key={kpi.key}
            type="button"
            onClick={() => onSelect?.(kpi)}
            className="flex cursor-pointer flex-col gap-5 border-0 bg-panel px-11 pb-8 pt-10 text-left transition-colors hover:bg-raise"
          >
            <span className="truncate text-meta uppercase tracking-[0.09em] text-faint">
              {t(kpi.labelKey as TranslationKey)}
            </span>

            <span className="flex items-baseline gap-3">
              <span
                data-numeric
                className="text-2xl font-medium tracking-[-0.025em]"
              >
                {kpi.value}
              </span>
              <span className="text-tiny text-faint">{kpi.unit}</span>
            </span>

            <span className="flex items-center justify-between gap-5">
              <span
                data-numeric
                className={cn(
                  'inline-flex items-center gap-2 rounded-4 px-5 py-px text-mini',
                  style.text,
                  style.bg,
                )}
              >
                <TrendIcon aria-hidden className="size-8" />
                {kpi.delta}
              </span>

              <svg
                viewBox="0 0 88 24"
                preserveAspectRatio="none"
                aria-hidden
                className="h-18 w-46 opacity-80"
              >
                <polyline
                  points={sparkPoints(kpi.spark)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  className={style.text}
                />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}
