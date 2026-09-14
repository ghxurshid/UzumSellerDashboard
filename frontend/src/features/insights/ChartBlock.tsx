import { useId, type ReactNode } from 'react';

import type { Translator } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { ChartBlock as ChartBlockType } from '@/services/insights/blocks';
import { formatFigure } from '@/services/insights/figures';
import { phrase } from '@/services/insights/phrase';
import type { Language, Tone } from '@/types/domain';

/**
 * Four shapes, drawn by hand.
 *
 * `RevenueChart` settled the house position on charting libraries: ninety
 * kilobytes and a second theming layer, for geometry that is a dozen lines of
 * arithmetic. Nothing about a model composing the chart changes that — it
 * supplies the figures, and the drawing is still four polygons.
 *
 * The waterfall is the one worth the trouble. "Where is my profit going" is a
 * question about a sequence of deductions, and a waterfall is the only common
 * chart that shows a running balance being eaten: each column starts where the
 * last one ended, so the gap between revenue and net profit is a shape rather
 * than a subtraction the reader has to perform.
 */

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 120;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 92;

const TONE_FILL: Record<Tone, string> = {
  positive: 'fill-pos',
  negative: 'fill-neg',
  warning: 'fill-warn',
  accent: 'fill-acc',
  neutral: 'fill-dim',
};

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

/** Line colours in series order; the first is the house accent. */
const SERIES_STROKE = ['stroke-acc', 'stroke-warn', 'stroke-pos', 'stroke-neg'] as const;
const SERIES_SWATCH = ['bg-acc', 'bg-warn', 'bg-pos', 'bg-neg'] as const;

export interface ChartBlockProps {
  readonly block: ChartBlockType;
  readonly t: Translator;
  readonly language: Language;
}

interface Step {
  readonly label: string;
  readonly value: number;
  readonly display: string;
  readonly tone: Tone;
}

export function ChartBlockView({ block, t, language }: ChartBlockProps): ReactNode {
  const gradientId = useId();

  if (block.chart === 'line') {
    const labels = block.labels ?? [];
    const series = (block.series ?? []).filter((entry) => entry.values.length === labels.length);
    /* A line with nothing to draw is not drawn: an empty axis with a title
       claims there was nothing to show, which is a different statement. */
    if (labels.length < 2 || series.length === 0) return null;

    return (
      <figure className="m-0 flex flex-col gap-6 rounded-8 border border-line bg-grid/30 px-9 py-8">
        {block.title !== undefined && (
          <figcaption className="text-tiny uppercase tracking-[0.08em] text-faint">
            {phrase(t, block.title)}
          </figcaption>
        )}

        <LineChart
          series={series.map((entry) => entry.values)}
          gradientId={gradientId}
        />

        <div className="flex justify-between gap-6 text-tiny text-faint">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>

        <div className="flex flex-wrap gap-x-9 gap-y-3">
          {series.map((entry, index) => {
            /* A total of daily units or so'm is a figure worth printing; a total
               of daily percentages is not, so a rate shows where it ended. */
            const summary =
              block.format === 'percent'
                ? `→ ${formatFigure(entry.values[entry.values.length - 1] ?? 0, block.format, language)}`
                : `Σ ${formatFigure(entry.values.reduce((sum, value) => sum + value, 0), block.format, language)}`;

            return (
              <span key={index} className="flex items-baseline gap-4 text-tiny text-faint">
                <span
                  aria-hidden
                  className={cn('size-6 shrink-0 rounded-2', SERIES_SWATCH[index % SERIES_SWATCH.length])}
                />
                {phrase(t, entry.name)}
                <span data-numeric className="text-dim">
                  {summary}
                </span>
              </span>
            );
          })}
        </div>
      </figure>
    );
  }

  const items = block.items ?? [];
  const steps: readonly Step[] = items.map((item, index) => {
    /* Red for a negative figure is right everywhere except mid-waterfall, where
       a negative deduction is the balance going back up — the one place the
       app's usual reading of the sign is inverted. */
    const isBridgeStep = block.chart === 'waterfall' && index > 0 && index < items.length - 1;

    return {
      label: phrase(t, item.label),
      value: item.value,
      display: formatFigure(item.value, block.format, language),
      tone: item.tone ?? (item.value >= 0 ? 'accent' : isBridgeStep ? 'positive' : 'negative'),
    };
  });

  if (steps.length < 2) return null;

  const isColumn = block.chart === 'waterfall' || block.chart === 'bar';

  return (
    <figure className="m-0 flex flex-col gap-6 rounded-8 border border-line bg-grid/30 px-9 py-8">
      {block.title !== undefined && (
        <figcaption className="text-tiny uppercase tracking-[0.08em] text-faint">
          {phrase(t, block.title)}
        </figcaption>
      )}

      {block.chart === 'donut' ? (
        <DonutChart steps={steps} />
      ) : (
        <ColumnChart steps={steps} waterfall={block.chart === 'waterfall'} />
      )}

      <div className="flex flex-wrap gap-x-9 gap-y-3">
        {steps.map((step, index) => (
          <span key={index} className="flex items-baseline gap-4 text-tiny text-faint">
            {/* A donut is read by colour, so its swatch is the key. Columns stand
                in a row and a waterfall gives most of them the same tone, which
                leaves colour saying nothing about which entry belongs to which
                column — the position in the row is the only thing that
                distinguishes them, so the key is the number printed under it. */}
            {isColumn ? (
              <span
                data-numeric
                className={cn('shrink-0 tabular-nums', TONE_TEXT[step.tone])}
                aria-hidden
              >
                {index + 1}
              </span>
            ) : (
              <span className={cn('size-6 shrink-0 rounded-2', TONE_FILL[step.tone])} aria-hidden />
            )}
            {step.label}
            <span data-numeric className="text-dim">
              {step.display}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}

/**
 * Columns, optionally stacked as a running balance.
 *
 * In waterfall mode each column is drawn from where the previous one left off,
 * with the first and last pinned to the baseline — the convention that makes
 * the opening total and the closing total readable as totals rather than as two
 * more deductions.
 */
function ColumnChart({
  steps,
  waterfall,
}: {
  readonly steps: readonly Step[];
  readonly waterfall: boolean;
}): ReactNode {
  const magnitudes = steps.map((step) => Math.abs(step.value));
  const ceiling = Math.max(...magnitudes, 1);
  const width = VIEW_WIDTH / steps.length;
  const height = PLOT_BOTTOM - PLOT_TOP;

  let running = 0;

  const columns = steps.map((step, index) => {
    const span = (Math.abs(step.value) / ceiling) * height;
    const isTotal = !waterfall || index === 0 || index === steps.length - 1;

    /**
     * A column covers the stretch of the balance it accounts for.
     *
     * A total runs from the baseline up to its own height. A deduction runs
     * from the balance before it *down* to the balance after — so the balance
     * is the column's top edge, not something to be measured up from.
     */
    const from = isTotal ? 0 : running;
    /* Signed, so a deduction of a negative amount — a refund, a credit, a payout
       larger than the lines above it explain — puts the balance back up instead
       of taking the same bite twice. Totals are measured from the baseline and
       so take the magnitude. */
    const to = isTotal ? span : running - (step.value / ceiling) * height;
    running = isTotal ? (step.value < 0 ? 0 : span) : to;

    /* Clamped to the plot so a run of deductions deeper than the opening total
       stops at the baseline rather than being drawn under the axis. */
    const upper = Math.min(Math.max(from, to), height);
    const lower = Math.max(Math.min(from, to), 0);

    /* A column too thin to see is still drawn, at a floor of two pixels — held
       up to rest on the line rather than hanging below it. */
    const h = Math.max(2, upper - lower);

    return {
      x: index * width + width * 0.18,
      y: Math.min(PLOT_BOTTOM - upper, PLOT_BOTTOM - h),
      w: width * 0.64,
      h,
      tone: step.tone,
      /* Where this column leaves the balance, for the tread drawn to the next. */
      balance: Math.min(Math.max(running, 0), height),
      /* Read out on hover, and by a screen reader that reaches the column. */
      caption: `${index + 1}. ${step.label} — ${step.display}`,
    };
  });

  /**
   * The treads between the columns.
   *
   * Only the opening and closing totals stand on the baseline; every deduction
   * hangs in the air by construction. A line from each column's exit to the next
   * one's entry lets the eye follow one staircase down from revenue to profit —
   * and it is the honest place for a set of steps that does not add up: a tread
   * arriving above or below the closing column draws the shortfall to scale.
   */
  const treads = !waterfall
    ? []
    : columns.slice(0, -1).map((column, index) => ({
        x1: column.x + column.w,
        x2: columns[index + 1]?.x ?? column.x + column.w,
        y: PLOT_BOTTOM - column.balance,
      }));

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className="h-auto w-full"
      role="img"
      preserveAspectRatio="none"
    >
      <line x1={0} y1={PLOT_BOTTOM} x2={VIEW_WIDTH} y2={PLOT_BOTTOM} className="stroke-line" strokeWidth={1} />
      {treads.map((tread, index) => (
        <line
          key={`tread-${index}`}
          x1={tread.x1}
          y1={tread.y}
          x2={tread.x2}
          y2={tread.y}
          className="stroke-line-2"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ))}
      {columns.map((column, index) => (
        <g key={index}>
          <title>{column.caption}</title>
          <rect
            x={column.x}
            y={column.y}
            width={column.w}
            height={column.h}
            rx={2}
            className={cn(TONE_FILL[column.tone], 'opacity-80')}
          />
          {/* The column's number, under the axis — the legend carries the same
              number against the full name and figure, which stays legible at
              every width and in all three languages. */}
          <text
            x={column.x + column.w / 2}
            y={PLOT_BOTTOM + 10}
            textAnchor="middle"
            fontSize={8}
            className="fill-faint"
          >
            {index + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Shares of a whole, as arc lengths on a single stroked circle. */
function DonutChart({ steps }: { readonly steps: readonly Step[] }): ReactNode {
  /* The schema refuses a negative slice; one that got here anyway is left out
     rather than drawn by its magnitude as a share it is not. */
  const parts = steps.filter((step) => step.value > 0);
  const total = parts.reduce((sum, step) => sum + step.value, 0);
  if (total === 0) return null;

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 120 100" className="h-auto w-full max-w-[220px] self-center" role="img">
      <g transform="translate(60 50) rotate(-90)">
        {parts.map((step, index) => {
          const dash = (step.value / total) * circumference;
          const element = (
            <circle
              key={index}
              r={radius}
              fill="none"
              strokeWidth={14}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              className={cn(TONE_FILL[step.tone], 'opacity-80')}
              stroke="currentColor"
            />
          );
          offset += dash;
          return element;
        })}
      </g>
    </svg>
  );
}

/**
 * One polyline per series over a shared scale, the first with a wash beneath it.
 *
 * The scale runs from the lowest value to the highest across every series, so a
 * product's line and the shop's can be read against each other — and a series
 * that dips below zero, a loss-making day of sellerProfit, is drawn below the
 * others rather than clipped at the axis.
 */
function LineChart({
  series,
  gradientId,
}: {
  readonly series: ReadonlyArray<readonly number[]>;
  readonly gradientId: string;
}): ReactNode {
  const all = series.flat();
  const high = Math.max(...all, 0);
  const low = Math.min(...all, 0);
  const range = high - low === 0 ? 1 : high - low;
  const count = series[0]?.length ?? 0;
  if (count < 2) return null;

  const step = VIEW_WIDTH / (count - 1);
  const y = (value: number): number => PLOT_BOTTOM - ((value - low) / range) * (PLOT_BOTTOM - PLOT_TOP);
  const baseline = y(0);
  const pathOf = (values: readonly number[]): string =>
    values.map((value, index) => `${index * step},${y(value)}`).join(' L ');

  const first = series[0];

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className="h-auto w-full"
      role="img"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="text-acc" stopColor="currentColor" stopOpacity={0.28} />
          <stop offset="100%" className="text-acc" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} y1={baseline} x2={VIEW_WIDTH} y2={baseline} className="stroke-line" strokeWidth={1} />
      {first !== undefined && (
        <path
          d={`M 0,${baseline} L ${pathOf(first)} L ${VIEW_WIDTH},${baseline} Z`}
          fill={`url(#${gradientId})`}
        />
      )}
      {series.map((values, index) => (
        <path
          key={index}
          d={`M ${pathOf(values)}`}
          fill="none"
          strokeWidth={1.5}
          className={SERIES_STROKE[index % SERIES_STROKE.length]}
        />
      ))}
    </svg>
  );
}
