import { useId, type ReactNode } from 'react';

import type { Translator } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { ChartBlock as ChartBlockType } from '@/services/insights/blocks';
import { formatFact, type FactTable, type SeriesTable } from '@/services/insights/facts';
import { phrase } from '@/services/insights/phrase';
import type { Language, Tone } from '@/types/domain';

/**
 * Four shapes, drawn by hand.
 *
 * `RevenueChart` settled the house position on charting libraries: ninety
 * kilobytes and a second theming layer, for geometry that is a dozen lines of
 * arithmetic. Nothing about a model composing the chart changes that — it picks
 * *which* figures to draw, and the drawing is still four polygons.
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

export interface ChartBlockProps {
  readonly block: ChartBlockType;
  readonly facts: FactTable;
  readonly series: SeriesTable;
  readonly t: Translator;
  readonly language: Language;
}

interface Step {
  readonly label: string;
  readonly value: number;
  readonly display: string;
  readonly tone: Tone;
}

export function ChartBlockView({
  block,
  facts,
  series,
  t,
  language,
}: ChartBlockProps): ReactNode {
  const gradientId = useId();

  const steps: readonly Step[] = (block.steps ?? []).flatMap((step) => {
    const fact = facts.get(step.ref);
    if (fact === undefined) return [];
    return [
      {
        label: phrase(t, step.label),
        value: fact.value,
        display: formatFact(fact, language),
        tone: step.tone ?? (fact.value < 0 ? 'negative' : 'accent'),
      },
    ];
  });

  const line = block.seriesRef === undefined ? undefined : series.get(block.seriesRef);

  const isColumn = block.chart === 'waterfall' || block.chart === 'bar';

  /* A chart whose refs all failed to resolve is not drawn at all. An empty
     axis with a title is a claim that there was nothing to show, which is a
     different statement from "the figures behind this went missing". */
  if (block.chart === 'line' ? line === undefined : steps.length < 2) return null;

  return (
    <figure className="m-0 flex flex-col gap-6 rounded-8 border border-line bg-grid/30 px-9 py-8">
      {block.title !== undefined && (
        <figcaption className="text-tiny uppercase tracking-[0.08em] text-faint">
          {phrase(t, block.title)}
        </figcaption>
      )}

      {block.chart === 'line' && line !== undefined ? (
        <LineChart values={line.values} gradientId={gradientId} />
      ) : block.chart === 'donut' ? (
        <DonutChart steps={steps} />
      ) : (
        <ColumnChart steps={steps} waterfall={block.chart === 'waterfall'} />
      )}

      <div className="flex flex-wrap gap-x-9 gap-y-3">
        {block.chart === 'line' && line !== undefined
          ? null
          : steps.map((step, index) => (
              <span key={index} className="flex items-baseline gap-4 text-tiny text-faint">
                {/* A donut is read by colour, so its swatch is the key. Columns
                    stand in a row and a waterfall gives most of them the same
                    tone, which leaves colour saying nothing about which entry
                    belongs to which column — the position in the row is the
                    only thing that distinguishes them, so the key is the
                    number printed under it. */}
                {isColumn ? (
                  <span
                    data-numeric
                    className={cn('shrink-0 tabular-nums', TONE_TEXT[step.tone])}
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                ) : (
                  <span
                    className={cn('size-6 shrink-0 rounded-2', TONE_FILL[step.tone])}
                    aria-hidden
                  />
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
     * is the column's top edge, not something to be measured up from. Adding
     * the span to the offset instead of hanging below it lifts every deduction
     * by its own height, which puts the first one off the top of the plot and
     * leaves the rest overlapping at the wrong altitudes.
     */
    const from = isTotal ? 0 : running;
    const to = isTotal ? span : running - span;
    running = isTotal ? (step.value < 0 ? 0 : span) : to;

    /* Clamped to the plot so a run of deductions deeper than the opening total
       stops at the baseline rather than being drawn under the axis. */
    const upper = Math.min(Math.max(from, to), height);
    const lower = Math.max(Math.min(from, to), 0);

    return {
      x: index * width + width * 0.18,
      y: PLOT_BOTTOM - upper,
      w: width * 0.64,
      h: Math.max(2, upper - lower),
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
   * hangs in the air by construction, because what it measures is a stretch of
   * the balance rather than a quantity counted up from zero. Left unjoined,
   * that reads as scattered blocks and invites the question of what holds them
   * up. A line from each column's exit to the next one's entry answers it: the
   * eye follows one staircase down from revenue to profit, and the columns are
   * its risers.
   *
   * It is also the one honest place for a set of steps that does not add up. A
   * tread arriving above or below the closing column draws the shortfall to
   * scale instead of hiding it behind a bar that starts wherever it likes.
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
      <line
        x1={0}
        y1={PLOT_BOTTOM}
        x2={VIEW_WIDTH}
        y2={PLOT_BOTTOM}
        className="stroke-line"
        strokeWidth={1}
      />
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
          {/**
           * The column's number, under the axis.
           *
           * The panel is a few hundred pixels wide and a P&L has six columns in
           * it, which leaves about fifty for a caption — not enough for "Boshqa
           * xarajatlar" at any size a person would read. Spelling the labels out
           * here would mean rotating or truncating them, and a truncated label is
           * a worse key than a digit. So the column carries a number and the
           * legend below carries the same one against the full name and figure,
           * which stays legible at every width and in all three languages.
           */}
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
  const total = steps.reduce((sum, step) => sum + Math.abs(step.value), 0);
  if (total === 0) return null;

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 120 100" className="h-auto w-full max-w-[220px] self-center" role="img">
      <g transform="translate(60 50) rotate(-90)">
        {steps.map((step, index) => {
          const share = Math.abs(step.value) / total;
          const dash = share * circumference;
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

/** One polyline and a wash beneath it — the same geometry as `RevenueChart`. */
function LineChart({
  values,
  gradientId,
}: {
  readonly values: readonly number[];
  readonly gradientId: string;
}): ReactNode {
  if (values.length < 2) return null;

  const ceiling = Math.max(...values, 1);
  const step = VIEW_WIDTH / (values.length - 1);
  const y = (value: number): number =>
    PLOT_BOTTOM - (value / ceiling) * (PLOT_BOTTOM - PLOT_TOP);

  const points = values.map((value, index) => `${index * step},${y(value)}`).join(' L ');

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
      <path
        d={`M 0,${PLOT_BOTTOM} L ${points} L ${VIEW_WIDTH},${PLOT_BOTTOM} Z`}
        fill={`url(#${gradientId})`}
      />
      <path d={`M ${points}`} fill="none" strokeWidth={1.5} className="stroke-acc" />
    </svg>
  );
}
