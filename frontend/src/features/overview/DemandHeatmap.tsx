import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { Panel } from '@/components/ui/Panel';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { HeatCell } from '@/types/domain';

const WEEKDAY_KEYS = ['wdMon', 'wdTue', 'wdWed', 'wdThu', 'wdFri', 'wdSat', 'wdSun'] as const;
const HOUR_LABELS = ['00', '04', '08', '12', '16', '20', '23'] as const;
const LEGEND_STEPS = [0.12, 0.3, 0.55, 0.82] as const;

const CELL_WIDTH = 17;
const CELL_HEIGHT = 13;
const CELL_GAP_X = 20;
const CELL_GAP_Y = 16;

/**
 * Order volume by weekday × hour of day.
 *
 * The geometry is the grid: 24 columns at `CELL_GAP_X` fill the viewBox width
 * exactly, and 7 rows at `CELL_GAP_Y` fill its height, so a cell's hour is its
 * column with no scaling in between. `HOUR_LABELS` names every fourth column;
 * the columns themselves are hourly.
 *
 * Rendered as one SVG rather than 168 DOM nodes, and described in the
 * accompanying note — a colour-only encoding cannot carry the meaning on its
 * own, so the caption states the finding the pattern shows.
 */
export function DemandHeatmap({
  cells,
  sampleCount,
}: {
  readonly cells: readonly HeatCell[];
  readonly sampleCount: number;
}): ReactNode {
  const { t } = useTranslation();

  return (
    <Panel className="flex min-w-0 flex-col gap-10 px-11 py-13 sm:px-14">
      <div className="flex flex-wrap items-baseline gap-x-10 gap-y-5">
        <span className="text-base font-medium">{t('demand')}</span>
        <span className="text-mini text-faint">{t('demandSub', { n: sampleCount })}</span>
        <div className="hidden flex-1 sm:block" />
        <span className="flex items-center gap-6 text-mini text-dim">
          {t('low')}
          <span className="flex gap-2">
            {LEGEND_STEPS.map((step) => (
              <span
                key={step}
                className="size-9 rounded-2 bg-acc"
                style={{ opacity: step }}
              />
            ))}
          </span>
          {t('high')}
        </span>
      </div>

      <div className="flex min-w-0 gap-7">
        <div className="flex w-22 shrink-0 flex-col justify-between py-px text-meta text-faint">
          {WEEKDAY_KEYS.map((key) => (
            <span key={key}>{t(key as TranslationKey)}</span>
          ))}
        </div>

        {/* The grid stretches to whatever width is left — `preserveAspectRatio`
            is already `none`, so a 300px phone gets the same 24×7 pattern in
            narrower cells rather than a scrollbar. Only the height steps down,
            keeping the rows tall enough to read apart. */}
        <svg
          viewBox="0 0 480 112"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${t('demand')} — ${t('demandSub', { n: sampleCount })}`}
          className="h-88 min-w-0 flex-1 sm:h-104"
        >
          <title>{`${t('demand')} — ${t('demandSub', { n: sampleCount })}`}</title>
          {cells.map((cell) => (
            <rect
              key={`${cell.weekday}-${cell.hour}`}
              x={cell.hour * CELL_GAP_X}
              y={cell.weekday * CELL_GAP_Y}
              width={CELL_WIDTH}
              height={CELL_HEIGHT}
              rx="2.5"
              fill="var(--s-acc)"
              opacity={cell.intensity}
            />
          ))}
        </svg>
      </div>

      <div className="flex justify-between pl-29 text-meta text-faint">
        {HOUR_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <p className="flex items-start gap-7 border-t border-line pt-9 text-xs leading-[1.5] text-dim">
        <Info aria-hidden className="mt-2 size-12 shrink-0 text-acc-dim" />
        {t('demandNote')}
      </p>
    </Panel>
  );
}
