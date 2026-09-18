import { useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';

import type { Translator } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { ChartBlock as ChartBlockType } from '@/services/insights/blocks';
import { formatFigure, type FigureFormat } from '@/services/insights/figures';
import { phrase } from '@/services/insights/phrase';
import type { Language, Tone } from '@/types/domain';

import {
  barLayout,
  catAt,
  CAT_BG,
  CAT_FILL,
  CAT_NEUTRAL_BG,
  CAT_NEUTRAL_FILL,
  CAT_NEUTRAL_STROKE,
  CAT_STROKE,
  donutLayout,
  resolveChartTone,
  seriesSummary,
} from './chartGeometry';

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
 *
 * A `donut` and a `line` colour by *position* rather than by meaning — slot 1
 * is always slot 1 — from the categorical palette in `globals.css`, because
 * that is what a colour-vision simulator was run against. `bar` and
 * `waterfall` keep the house semantic tones (accent, positive, negative,
 * warning), because their columns stand for a sign or a status, not for one
 * of several parallel series that all need telling apart at once.
 *
 * The one guarantee every shape here owes the rest of the app: a block that
 * passed `blockLineSchema` never draws as nothing. Where the geometry cannot
 * be built — a donut whose slices are all zero, a line an old pin no longer
 * carries matching labels and values for — `ChartFallback` prints the same
 * figures as a plain list instead of the shape that could not be made from
 * them.
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

/** The horizontal `bar` chart's track fill — the HTML counterpart of `TONE_FILL`. */
const TONE_BG: Record<Tone, string> = {
  positive: 'bg-pos',
  negative: 'bg-neg',
  warning: 'bg-warn',
  accent: 'bg-acc',
  neutral: 'bg-dim',
};

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
  if (block.chart === 'line') {
    return <LineChartFigure block={block} t={t} language={language} />;
  }

  /* A `const` alias rather than repeated `block.chart` reads — TypeScript
     narrows the type of a stable local binding across a closure (the `.map`
     below) in a way it does not for a property read from an object each time,
     so this is what lets the callback see `'waterfall' | 'bar' | 'donut'`
     rather than the full four-member union the `line` branch above already
     excluded. */
  const chart = block.chart;
  const items = block.items ?? [];
  const titleText = block.title === undefined ? undefined : phrase(t, block.title);
  const steps: readonly Step[] = items.map((item, index) => ({
    label: phrase(t, item.label),
    value: item.value,
    display: formatFigure(item.value, block.format, language),
    tone: resolveChartTone(chart, item, index, items.length),
  }));

  /* The schema already refuses fewer than two items; an old pin is read back
     through this same path, and two is still the fewest a shape needs to say
     anything at all. */
  if (steps.length < 2) return <ChartFallback title={titleText} rows={steps} />;

  if (chart === 'donut') return <DonutFigure title={titleText} steps={steps} language={language} />;
  if (chart === 'bar') return <BarFigure title={titleText} steps={steps} />;
  return <WaterfallFigure title={titleText} steps={steps} />;
}

/** The border, padding and (optional) caption every chart shape shares. */
function ChartFrame({
  title,
  children,
}: {
  readonly title?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <figure className="m-0 flex flex-col gap-6 rounded-8 border border-line bg-grid/30 px-9 py-8">
      {title !== undefined && (
        <figcaption className="text-tiny uppercase tracking-[0.08em] text-faint">{title}</figcaption>
      )}
      {children}
    </figure>
  );
}

/**
 * Data that cannot become a shape, drawn as a list instead.
 *
 * A validated block always carries real figures — what can fail is only the
 * *geometry* built from them (every donut slice at zero, a line series an old
 * pin no longer lines up with its labels). A card is never allowed to draw as
 * an empty frame over a claim that had nothing behind it, so this is what a
 * chart falls back to instead: the same title, the same label/value pairs,
 * as plain rows.
 */
function ChartFallback({
  title,
  rows,
}: {
  readonly title?: string;
  readonly rows: ReadonlyArray<{ readonly label: string; readonly display: string }>;
}): ReactNode {
  return (
    <ChartFrame title={title}>
      <div className="flex flex-col gap-4">
        {rows.map((row, index) => (
          <span key={index} className="flex items-baseline gap-8 text-xs text-dim">
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span data-numeric className="shrink-0 text-text">
              {row.display}
            </span>
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}

/**
 * Shares of a whole, as arcs on a ring — coloured by position, not by tone.
 *
 * A slice's `tone` is part of the wire shape but plays no part here: with up
 * to twelve slices possible from an old pin and only five tones to go around,
 * tone could never tell two slices apart the way the categorical palette does.
 */
function DonutFigure({
  title,
  steps,
  language,
}: {
  readonly title?: string;
  readonly steps: readonly Step[];
  readonly language: Language;
}): ReactNode {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const { total, slices } = donutLayout(
    steps.map((step) => step.value),
    circumference,
  );

  if (total <= 0) return <ChartFallback title={title} rows={steps} />;

  return (
    <ChartFrame title={title}>
      <svg viewBox="0 0 120 100" className="h-auto w-full max-w-[220px] self-center" role="img">
        <g transform="translate(60 50) rotate(-90)">
          {slices.map((slice) => {
            const step = steps[slice.sourceIndex];
            if (step === undefined) return null;
            return (
              <circle
                key={slice.sourceIndex}
                r={radius}
                fill="none"
                strokeWidth={14}
                strokeDasharray={`${slice.dash} ${circumference - slice.dash}`}
                strokeDashoffset={-slice.offset}
                className={catAt(CAT_STROKE, CAT_NEUTRAL_STROKE, slice.colorIndex)}
              >
                <title>
                  {`${step.label} — ${step.display} (${formatFigure(slice.share, 'percent', language)})`}
                </title>
              </circle>
            );
          })}
        </g>
      </svg>

      <div className="flex flex-col gap-4">
        {slices.map((slice) => {
          const step = steps[slice.sourceIndex];
          if (step === undefined) return null;
          return (
            <span key={slice.sourceIndex} className="flex items-baseline gap-6 text-tiny">
              <span
                aria-hidden
                className={cn('size-8 shrink-0 rounded-2', catAt(CAT_BG, CAT_NEUTRAL_BG, slice.colorIndex))}
              />
              <span className="min-w-0 flex-1 truncate text-dim">{step.label}</span>
              <span data-numeric className="shrink-0 text-faint">
                {formatFigure(slice.share, 'percent', language)}
              </span>
              <span data-numeric className="shrink-0 text-text">
                {step.display}
              </span>
            </span>
          );
        })}
      </div>
    </ChartFrame>
  );
}

/**
 * One horizontal row per item — name and figure printed directly on it,
 * rather than behind a number that has to be looked up in a legend below.
 *
 * A product ranking's names rarely fit a 320px rail next to a value, which is
 * exactly why a vertical column chart reads badly here: a row can wrap or
 * truncate its own label without disturbing its neighbours, and a diverging
 * track (a shared zero line, positive to the right, negative to the left)
 * shows a loss on the other side of that line instead of recolouring the same
 * upward bar.
 */
function BarFigure({
  title,
  steps,
}: {
  readonly title?: string;
  readonly steps: readonly Step[];
}): ReactNode {
  const { zeroFrac, segments } = barLayout(steps.map((step) => step.value));

  return (
    <ChartFrame title={title}>
      <div className="flex flex-col gap-8">
        {steps.map((step, index) => {
          const segment = segments[index];
          if (segment === undefined) return null;
          return (
            <div key={index} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-8 text-tiny">
                <span className="min-w-0 flex-1 truncate text-dim">{step.label}</span>
                <span data-numeric className="shrink-0 text-text">
                  {step.display}
                </span>
              </div>
              <div className="relative h-9 w-full overflow-hidden rounded-3 bg-grid">
                {zeroFrac > 0 && zeroFrac < 1 && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-line-2"
                    style={{ left: `${zeroFrac * 100}%` }}
                  />
                )}
                <span
                  aria-hidden
                  title={`${step.label} — ${step.display}`}
                  className={cn('absolute inset-y-0 rounded-3 opacity-80', TONE_BG[step.tone])}
                  style={{
                    left: `${segment.startFrac * 100}%`,
                    width: `${segment.widthFrac * 100}%`,
                    minWidth: segment.widthFrac > 0 ? '3px' : undefined,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

/**
 * A running balance, optionally stacked column by column.
 *
 * Each column is drawn from where the previous one left off, with the first
 * and last pinned to the baseline — the convention that makes the opening
 * total and the closing total readable as totals rather than as two more
 * deductions. Unchanged from before this pass: the sign convention here is
 * the one place the app's usual reading of a negative figure is inverted (see
 * `resolveChartTone`), and rewriting it was out of scope for a pass about
 * legibility.
 */
function WaterfallFigure({
  title,
  steps,
}: {
  readonly title?: string;
  readonly steps: readonly Step[];
}): ReactNode {
  return (
    <ChartFrame title={title}>
      <WaterfallChart steps={steps} />
      <div className="flex flex-wrap gap-x-9 gap-y-3">
        {steps.map((step, index) => (
          <span key={index} className="flex items-baseline gap-4 text-tiny text-faint">
            {/* A waterfall gives most of its columns the same tone, which
                leaves colour saying nothing about which entry belongs to
                which column — the position in the row is what distinguishes
                them, so the coloured number standing in for a swatch is the
                key, not a decoration on a neutral one. */}
            <span data-numeric className={cn('shrink-0 tabular-nums', TONE_TEXT[step.tone])} aria-hidden>
              {index + 1}
            </span>
            {step.label}
            <span data-numeric className="text-dim">
              {step.display}
            </span>
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}

function WaterfallChart({ steps }: { readonly steps: readonly Step[] }): ReactNode {
  const magnitudes = steps.map((step) => Math.abs(step.value));
  const ceiling = Math.max(...magnitudes, 1);
  const width = VIEW_WIDTH / steps.length;
  const height = PLOT_BOTTOM - PLOT_TOP;

  let running = 0;

  const columns = steps.map((step, index) => {
    const span = (Math.abs(step.value) / ceiling) * height;
    const isTotal = index === 0 || index === steps.length - 1;

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
   * These stay dashed — they are connectors, not a gridline, and the mark rules
   * only forbid the latter.
   */
  const treads = columns.slice(0, -1).map((column, index) => ({
    x1: column.x + column.w,
    x2: columns[index + 1]?.x ?? column.x + column.w,
    y: PLOT_BOTTOM - column.balance,
  }));

  return (
    /* A fixed aspect ratio, not `preserveAspectRatio="none"`, is what keeps a
       column's number and the axis hairline from stretching when the panel is
       wider than the 320 viewBox — the box is always scaled by the same factor
       in x and y, so nothing inside it is scaled by a different one. */
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="aspect-[320/120] h-auto w-full" role="img">
      <line
        x1={0}
        y1={PLOT_BOTTOM}
        x2={VIEW_WIDTH}
        y2={PLOT_BOTTOM}
        className="stroke-line"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
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

/**
 * One polyline per series over a shared scale, the first with a wash beneath it.
 *
 * The scale runs from the lowest value to the highest across every series, so a
 * product's line and the shop's can be read against each other — and a series
 * that dips below zero, a loss-making day of sellerProfit, is drawn below the
 * others rather than clipped at the axis. Series are coloured by position from
 * the same categorical palette a donut uses; the fourth is dashed as well as
 * recoloured, because it is the one adjacent pair the palette's own
 * colour-vision check did not clear (see `globals.css`).
 */
function LineChartFigure({ block, t, language }: ChartBlockProps): ReactNode {
  const gradientId = useId();
  const titleText = block.title === undefined ? undefined : phrase(t, block.title);
  const labels = block.labels ?? [];
  const rawSeries = block.series ?? [];
  const series = rawSeries.filter((entry) => entry.values.length === labels.length);

  /* A line needs two buckets and at least one series whose length actually
     matches them to become a shape; the schema enforces both for anything
     written today, but a pin written before it did still carries real sums —
     so those are what get printed instead of nothing. */
  if (labels.length < 2 || series.length === 0) {
    const rows = rawSeries.map((entry) => ({
      label: phrase(t, entry.name),
      display: seriesSummary(entry.values, block.format, language),
    }));
    return <ChartFallback title={titleText} rows={rows} />;
  }

  const values = series.map((entry) => entry.values);
  const names = series.map((entry) => phrase(t, entry.name));
  const all = values.flat();
  const high = Math.max(...all, 0);
  const low = Math.min(...all, 0);

  return (
    <ChartFrame title={titleText}>
      <div className="flex gap-8">
        {/* The plot's own ceiling and floor — a line used to show only the
            first and last date, with no sense of how tall the shape actually
            is. Stacked against the chart's own height via flex stretch, so no
            measurement has to track the SVG's responsive size by hand. */}
        <div className="flex shrink-0 flex-col justify-between text-right text-tiny text-faint">
          <span data-numeric>{formatFigure(high, block.format, language)}</span>
          <span data-numeric>{formatFigure(low, block.format, language)}</span>
        </div>
        <LineChart
          series={values}
          labels={labels}
          names={names}
          format={block.format}
          language={language}
          high={high}
          low={low}
          gradientId={gradientId}
          ariaLabel={t('chartValues')}
        />
      </div>

      <div className="flex justify-between gap-6 text-tiny text-faint">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>

      <div className="flex flex-wrap gap-x-9 gap-y-3">
        {series.map((entry, index) => (
          <span key={index} className="flex items-baseline gap-5 text-tiny text-faint">
            <LineSwatch index={index} />
            {phrase(t, entry.name)}
            <span data-numeric className="text-dim">
              {seriesSummary(entry.values, block.format, language)}
            </span>
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}

/** A solid dot for slots 1–3; a dashed stroke for slot 4, matching its line. */
function LineSwatch({ index }: { readonly index: number }): ReactNode {
  if (index === 3) {
    return (
      <svg aria-hidden width="14" height="8" viewBox="0 0 14 8" className="shrink-0">
        <line
          x1="1"
          y1="4"
          x2="13"
          y2="4"
          strokeWidth="2"
          strokeDasharray="3 2"
          className={catAt(CAT_STROKE, CAT_NEUTRAL_STROKE, index)}
        />
      </svg>
    );
  }
  return (
    <span aria-hidden className={cn('size-6 shrink-0 rounded-2', catAt(CAT_BG, CAT_NEUTRAL_BG, index))} />
  );
}

interface LineChartProps {
  readonly series: ReadonlyArray<readonly number[]>;
  readonly labels: readonly string[];
  readonly names: readonly string[];
  readonly format: FigureFormat | undefined;
  readonly language: Language;
  readonly high: number;
  readonly low: number;
  readonly gradientId: string;
  readonly ariaLabel: string;
}

/**
 * The line itself, plus one control that reads any point on it out loud.
 *
 * A single transparent overlay rather than a hit target per point: a pointer
 * drags across it and the nearest bucket lights up, arrow keys do the same
 * for a keyboard, and a native `<title>` never enters into it — the read-out
 * is an HTML tooltip so it can show every series at once, which is the whole
 * reason a value that is not an endpoint needs a hover state to begin with.
 */
function LineChart({
  series,
  labels,
  names,
  format,
  language,
  high,
  low,
  gradientId,
  ariaLabel,
}: LineChartProps): ReactNode {
  const [active, setActive] = useState<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const range = high - low === 0 ? 1 : high - low;
  const count = labels.length;
  const xAt = (index: number): number => (count <= 1 ? 0 : (index / (count - 1)) * VIEW_WIDTH);
  const yAt = (value: number): number => PLOT_BOTTOM - ((value - low) / range) * (PLOT_BOTTOM - PLOT_TOP);
  const baseline = yAt(0);
  const pathOf = (points: readonly number[]): string =>
    points.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' L ');

  const first = series[0];

  const moveTo = (clientX: number): void => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || count <= 1) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (count - 1)));
  };

  const step = (delta: number): void => {
    setActive((current) => {
      const base = current ?? (delta > 0 ? -1 : count);
      return Math.min(count - 1, Math.max(0, base + delta));
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => moveTo(event.clientX);

  const activeLabel = active === null ? undefined : labels[active];
  const pct = active === null || count <= 1 ? 0 : (active / (count - 1)) * 100;
  const align = pct < 15 ? 'left' : pct > 85 ? 'right' : 'center';

  return (
    <div className="relative min-w-0 flex-1">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="aspect-[320/120] h-auto w-full"
        role="img"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="text-acc" stopColor="currentColor" stopOpacity={0.24} />
            <stop offset="100%" className="text-acc" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <line
          x1={0}
          y1={baseline}
          x2={VIEW_WIDTH}
          y2={baseline}
          className="stroke-line"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {first !== undefined && (
          <path
            d={`M 0,${baseline} L ${pathOf(first)} L ${VIEW_WIDTH},${baseline} Z`}
            fill={`url(#${gradientId})`}
          />
        )}
        {series.map((points, index) => (
          <path
            key={index}
            d={`M ${pathOf(points)}`}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={index === 3 ? '5 3' : undefined}
            className={catAt(CAT_STROKE, CAT_NEUTRAL_STROKE, index)}
          />
        ))}
        {active !== null && (
          <line
            x1={xAt(active)}
            y1={PLOT_TOP}
            x2={xAt(active)}
            y2={PLOT_BOTTOM}
            className="stroke-line-2"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {active !== null &&
          series.map((points, index) => {
            const value = points[active];
            if (value === undefined) return null;
            return (
              <circle
                key={index}
                cx={xAt(active)}
                cy={yAt(value)}
                r={2.5}
                className={catAt(CAT_FILL, CAT_NEUTRAL_FILL, index)}
              />
            );
          })}
      </svg>

      <div
        ref={overlayRef}
        role="slider"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={Math.max(count - 1, 0)}
        aria-valuenow={active ?? count - 1}
        aria-valuetext={readout(active ?? count - 1, labels, names, series, format, language)}
        className="absolute inset-0 cursor-crosshair touch-none outline-none"
        onPointerDown={(event) => moveTo(event.clientX)}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((current) => current ?? count - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            step(-1);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            step(1);
          }
        }}
      />

      {active !== null && activeLabel !== undefined && (
        <div
          className={cn(
            'pointer-events-none absolute top-2 z-10 flex flex-col gap-2 rounded-6 border',
            'border-line-2 bg-panel px-7 py-5 text-tiny shadow-tip',
            align === 'left' && 'left-0',
            align === 'right' && 'right-0',
            align === 'center' && 'left-1/2 -translate-x-1/2',
          )}
        >
          <span className="text-faint">{activeLabel}</span>
          {series.map((points, index) => {
            const value = points[active];
            if (value === undefined) return null;
            const name = names[index];
            return (
              <span key={index} className="flex items-center gap-5">
                <span
                  aria-hidden
                  className={cn('size-6 shrink-0 rounded-1', catAt(CAT_BG, CAT_NEUTRAL_BG, index))}
                />
                {name !== undefined && <span className="text-dim">{name}</span>}
                <span data-numeric className="text-text">
                  {formatFigure(value, format, language)}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The keyboard/screen-reader equivalent of the tooltip, for one x-position. */
function readout(
  index: number,
  labels: readonly string[],
  names: readonly string[],
  series: ReadonlyArray<readonly number[]>,
  format: FigureFormat | undefined,
  language: Language,
): string {
  const label = labels[index] ?? '';
  const parts = series
    .map((points, seriesIndex) => {
      const value = points[index];
      if (value === undefined) return null;
      return `${names[seriesIndex] ?? ''} ${formatFigure(value, format, language)}`;
    })
    .filter((part): part is string => part !== null);
  return [label, ...parts].join(', ');
}
