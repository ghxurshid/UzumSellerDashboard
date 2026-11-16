import { Fragment, type ReactNode } from 'react';

import type { Translator } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import type { CompareBlock, MetricsBlock, ProgressBlock, RankBlock } from '@core/agent/blocks';
import {
  changeFrom,
  compareRow,
  fillOf,
  formatChange,
  formatFigure,
  rankOrder,
  shareOf,
} from '@core/agent/figures';
import { phrase } from '@core/agent/phrase';
import type { Language } from '@core/types/common';

import { ChartFrame } from './ChartBlock';
import { barLayout } from './chartGeometry';
import { TONE_BG } from './tones';

/**
 * The blocks whose last figure the application works out.
 *
 * A row of tiles shows a change, a progress row shows a share, a ranking shows a
 * place, a comparison shows a gap — and in each the author wrote only the
 * figures it read. The derived figure comes from `figures.ts`, so what is drawn
 * here cannot disagree with the numbers printed beside it, and the export and
 * the summary sent with a follow-up question state the same result.
 *
 * Almost every word on these blocks is the author's and everything else is a
 * number; the one exception is the comparison's own column heading.
 */

interface ViewProps<B> {
  readonly block: B;
  readonly t: Translator;
  readonly language: Language;
}

/**
 * Tiles that sit side by side while they fit and drop to the next row when
 * they do not.
 *
 * Wrapping flex rather than a fixed grid, because the two hosts are different
 * widths and a figure must never be cut: four tiles are two rows of two on a
 * 320px rail and one row in a wide panel, and a tile carrying a nine-digit sum
 * takes the room it needs instead of losing its last digits to an ellipsis.
 *
 * The 120px is a flex *basis*, not a `min-width`. An explicit minimum would
 * replace the automatic one, which is what keeps a tile from being squeezed
 * narrower than its own unbreakable number; with a basis the line breaks are
 * decided on the larger of the two.
 */
export function MetricsBlockView({ block, t, language }: ViewProps<MetricsBlock>): ReactNode {
  return (
    <div className="flex flex-wrap gap-6">
      {block.items.map((item, index) => {
        const change = changeFrom(item.value, item.previous);

        return (
          <div
            key={index}
            className="flex grow basis-120 flex-col gap-3 rounded-8 border border-line bg-grid/30 px-9 py-7"
          >
            <span className="text-tiny uppercase tracking-[0.08em] text-faint">
              {phrase(t, item.label)}
            </span>
            <span
              data-numeric
              className="whitespace-nowrap text-md font-medium tracking-[-0.01em] text-text"
            >
              {formatFigure(item.value, item.format, language)}
            </span>
            {change !== null && (
              <span
                data-numeric
                className={cn(
                  'text-tiny',
                  change > 0 ? 'text-pos' : change < 0 ? 'text-neg' : 'text-faint',
                )}
              >
                {formatChange(change)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A part, its whole, and the share between them.
 *
 * The share is printed even past 100% — a plan beaten by a fifth is 120%, and
 * the bar stopping at full is how the row says the whole was reached. A row
 * with no share to state (only an authored block can carry a zero whole; the
 * wire refuses one) prints a dash rather than a zero.
 */
export function ProgressBlockView({ block, t, language }: ViewProps<ProgressBlock>): ReactNode {
  return (
    <div className="flex flex-col gap-8">
      {block.rows.map((row, index) => {
        const label = phrase(t, row.label);
        const share = shareOf(row.value, row.total);
        const fill = fillOf(share);
        const pair = `${formatFigure(row.value, row.format, language)} / ${formatFigure(row.total, row.format, language)}`;
        const percent = share === null ? '—' : formatFigure(share, 'percent', language);

        return (
          <div key={index} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-8 text-xs">
              <span className="min-w-0 flex-1 truncate text-dim" title={label}>
                {label}
              </span>
              <span data-numeric className="shrink-0 text-faint">
                {pair}
              </span>
              <span data-numeric className="shrink-0 text-text">
                {percent}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fill * 100)}
              aria-valuetext={`${label}: ${pair} (${percent})`}
              className="relative h-6 overflow-hidden rounded-3 bg-grid"
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-0 left-0 rounded-3 opacity-80',
                  TONE_BG[row.tone ?? 'accent'],
                )}
                style={{ width: `${fill * 100}%`, minWidth: fill > 0 ? '3px' : undefined }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A ranking, in the order the figures put it in.
 *
 * The rows are drawn in `rankOrder`'s order, not the author's, and the number
 * in front of each is its place — shared when two values are equal. The bars
 * use the `bar` chart's own layout, so a loss in a ranking sits on the other
 * side of the zero line here exactly as it does there.
 */
export function RankBlockView({ block, t, language }: ViewProps<RankBlock>): ReactNode {
  const places = rankOrder(
    block.items.map((item) => item.value),
    block.order,
  );
  const rows = places.flatMap(({ sourceIndex, place }) => {
    const item = block.items[sourceIndex];
    return item === undefined ? [] : [{ item, place }];
  });
  const { zeroFrac, segments } = barLayout(rows.map((row) => row.item.value));

  return (
    <ChartFrame title={block.title === undefined ? undefined : phrase(t, block.title)}>
      <ol className="m-0 flex list-none flex-col gap-8 p-0">
        {rows.map(({ item, place }, index) => {
          const segment = segments[index];
          const label = phrase(t, item.label);
          const display = formatFigure(item.value, block.format, language);

          return (
            <li key={index} className="flex items-baseline gap-7">
              <span data-numeric className="w-12 shrink-0 text-right text-tiny text-faint">
                {place}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex items-baseline gap-8 text-tiny">
                  <span className="min-w-0 flex-1 truncate text-dim" title={label}>
                    {label}
                  </span>
                  <span data-numeric className="shrink-0 text-text">
                    {display}
                  </span>
                </div>
                {item.note !== undefined && (
                  <span className="truncate text-tiny text-faint">{phrase(t, item.note)}</span>
                )}
                {segment !== undefined && (
                  <div className="relative h-6 w-full overflow-hidden rounded-3 bg-grid">
                    {zeroFrac > 0 && zeroFrac < 1 && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-line-2"
                        style={{ left: `${zeroFrac * 100}%` }}
                      />
                    )}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute inset-y-0 rounded-3 opacity-80',
                        TONE_BG[item.tone ?? 'accent'],
                      )}
                      style={{
                        left: `${segment.startFrac * 100}%`,
                        width: `${segment.widthFrac * 100}%`,
                        minWidth: segment.widthFrac > 0 ? '3px' : undefined,
                      }}
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}

/**
 * Two things, measure by measure, with the gap between them worked out.
 *
 * ## The form
 *
 * Each measure is its own small pair of bars, scaled to that measure alone.
 * Sales in units and revenue in so'm cannot share an axis — one scale for both
 * would be an invented relationship — so every row answers one question: which
 * of the two is longer, and by how much. The figures are printed at the head of
 * the bars, in a column the whole block shares, so they read down as a table
 * even where the bars are short.
 *
 * ## Emphasis, not two hues
 *
 * `a` is the subject and takes the accent; `b` is what it is held against and
 * takes the quiet grey. One hue and a neutral reads the same whether the two
 * sides are two products or this month and the last, and the pair was measured
 * rather than judged by eye: against each theme's chart surface the two fills
 * are 14.4 (dark) and 17.2 (light) apart under simulated colour-blindness and
 * 15.6 and 17.3 with full colour vision, all above the floor for adjacent marks.
 *
 * The grey is deliberately faint, and on the light surface it is 2.7:1 against
 * the background — under the 3:1 a mark needs to stand on its own. It does not
 * stand on its own: every figure is printed at the head of its bar, the two
 * sides are always in the same order, and the names sit in a legend beside the
 * mark that stands for each. A darker grey was tried and comes within reach of
 * the accent itself, which is the worse failure of the two.
 *
 * ## When a gap is good or bad
 *
 * Only when the row says so. A difference is drawn in plain ink until `better`
 * names the direction that counts as good; then the side that leads is set
 * heavier and the difference takes the positive or negative tone, read from
 * `a`'s point of view. Returns that fell are green. Sales that fell are not.
 */
export function CompareBlockView({ block, t, language }: ViewProps<CompareBlock>): ReactNode {
  const nameA = phrase(t, block.a);
  const nameB = phrase(t, block.b);

  return (
    <ChartFrame title={block.title === undefined ? undefined : phrase(t, block.title)}>
      <div className="flex flex-wrap items-baseline gap-x-12 gap-y-3 text-tiny text-dim">
        <CompareKey name={nameA} side="a" />
        <CompareKey name={nameB} side="b" />
        <span className="ml-auto shrink-0 text-faint">{t('compareDiff')}</span>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-8 gap-y-2">
        {block.rows.map((row, index) => {
          const { change, lead } = compareRow(row.a, row.b, row.better);
          const { zeroFrac, segments } = barLayout([row.a, row.b]);

          return (
            <Fragment key={index}>
              <div
                className={cn('col-span-2 flex items-baseline gap-8 pb-1', index > 0 && 'pt-9')}
              >
                <span className="min-w-0 flex-1 text-xs text-dim">{phrase(t, row.label)}</span>
                <span
                  data-numeric
                  className={cn(
                    'shrink-0 text-tiny',
                    lead === 'a' ? 'text-pos' : lead === 'b' ? 'text-neg' : 'text-dim',
                  )}
                >
                  {change === null ? '—' : formatChange(change)}
                </span>
              </div>

              {(['a', 'b'] as const).map((side, sideIndex) => {
                const value = side === 'a' ? row.a : row.b;
                const name = side === 'a' ? nameA : nameB;
                const display = formatFigure(value, row.format, language);
                const segment = segments[sideIndex];

                return (
                  <Fragment key={side}>
                    <span
                      data-numeric
                      className={cn(
                        'whitespace-nowrap text-right text-xs',
                        lead === null || lead === side ? 'text-text' : 'text-dim',
                        lead === side && 'font-medium',
                      )}
                    >
                      <span className="sr-only">{`${name}: `}</span>
                      {display}
                    </span>
                    <span aria-hidden title={`${name} — ${display}`} className="relative block h-4">
                      {zeroFrac > 0 && zeroFrac < 1 && (
                        <span
                          className="absolute -inset-y-1 w-px bg-line-2"
                          style={{ left: `${zeroFrac * 100}%` }}
                        />
                      )}
                      {segment !== undefined && (
                        <span
                          className={cn(
                            'absolute inset-y-0',
                            side === 'a' ? 'bg-acc' : 'bg-faint',
                            /* Rounded at the end that carries the value, square
                               where it stands on the zero line. */
                            value >= 0 ? 'rounded-r-2' : 'rounded-l-2',
                          )}
                          style={{
                            left: `${segment.startFrac * 100}%`,
                            width: `${segment.widthFrac * 100}%`,
                            minWidth: segment.widthFrac > 0 ? '2px' : undefined,
                          }}
                        />
                      )}
                    </span>
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </ChartFrame>
  );
}

/** One entry of the comparison's legend: the mark, and the name it stands for. */
function CompareKey({ name, side }: { readonly name: string; readonly side: 'a' | 'b' }): ReactNode {
  return (
    <span className="flex min-w-0 items-baseline gap-5">
      <span
        aria-hidden
        className={cn('size-8 shrink-0 translate-y-[1px] rounded-2', side === 'a' ? 'bg-acc' : 'bg-faint')}
      />
      <span className="min-w-0 break-words">{name}</span>
    </span>
  );
}
