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
    /* Two tiles across a 320px screen, then as many as fit from `xs` up.
       `auto-fit` with a 124px floor would overflow a 320px viewport by the
       width of the grid rules, so the narrowest case is spelled out.

       The selector on the end handles an odd tile count: the last tile spans
       both columns rather than leaving a blank cell beside it, which reads as
       a metric that failed to load. It is reset at `xs`, where `auto-fit`
       already fills the row. */
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-10 border border-line bg-line [&>*:last-child:nth-child(odd)]:col-span-2 xs:grid-cols-[repeat(auto-fit,minmax(124px,1fr))] xs:[&>*:last-child:nth-child(odd)]:col-span-1">
      {kpis.map((kpi) => {
        const style = TREND_STYLE[kpi.trend];
        const TrendIcon = TREND_ICON[kpi.trend];

        return (
          <button
            key={kpi.key}
            type="button"
            onClick={() => onSelect?.(kpi)}
            className="flex min-w-0 cursor-pointer flex-col gap-5 border-0 bg-panel px-11 pb-8 pt-10 text-left transition-colors hover:bg-raise"
          >
            <span className="truncate text-meta uppercase tracking-[0.09em] text-faint">
              {t(kpi.labelKey as TranslationKey)}
            </span>

            <span className="flex items-baseline gap-3">
              <span
                data-numeric
                className="min-w-0 truncate text-xl font-medium tracking-[-0.025em] sm:text-2xl"
              >
                {kpi.value}
              </span>
              <span className="shrink-0 text-tiny text-faint">{kpi.unit}</span>
            </span>

            <span className="flex items-center justify-between gap-5">
              <span
                data-numeric
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-4 px-5 py-px text-mini',
                  style.text,
                  style.bg,
                )}
              >
                <TrendIcon aria-hidden className="size-8" />
                {kpi.delta}
              </span>

              {/* The sparkline is the first thing to go when the tile is
                  narrow: it is a garnish on a figure that is already stated,
                  and at 46px on a 150px tile it crowds the delta chip. */}
              <svg
                viewBox="0 0 88 24"
                preserveAspectRatio="none"
                aria-hidden
                className="hidden h-18 w-46 opacity-80 xs:block"
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
