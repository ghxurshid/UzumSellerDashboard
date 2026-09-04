import { Database } from 'lucide-react';
import type { ReactNode } from 'react';

import { Pill } from '@/components/ui/Pill';
import type { Translator } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { resolveAction, type ResolvedAction } from '@/services/insights/actions';
import type { Block } from '@/services/insights/blocks';
import { EMPTY_SERIES, formatFact, type FactTable, type SeriesTable } from '@/services/insights/facts';
import { phrase } from '@/services/insights/phrase';
import { resolveTemplate } from '@/services/insights/template';
import type { Language, Tone } from '@/types/domain';

import { ChartBlockView } from './ChartBlock';

/**
 * The one place a card body becomes pixels.
 *
 * Everything the rail can show is a `switch` arm below, which is the property
 * that makes a model-authored card safe to render: an author picks from this
 * vocabulary or it does not appear. There is no `dangerouslySetInnerHTML`, no
 * markdown pass, no class names from the document — a block carries data, and
 * the styling is this component's alone.
 *
 * Adding an expression to the language is a type in `blocks.ts` and an arm
 * here. That is the whole cost, and it is why the set can grow with what the
 * findings need rather than being guessed at up front.
 */

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

const TONE_BORDER: Record<Tone, string> = {
  positive: 'border-pos bg-pos-soft/30',
  negative: 'border-neg-line bg-neg-soft/30',
  warning: 'border-warn-line bg-warn-soft/30',
  accent: 'border-acc-line bg-acc-soft/40',
  neutral: 'border-line-2 bg-grid/40',
};

export interface BlockRendererProps {
  readonly blocks: readonly Block[];
  readonly facts: FactTable;
  /** Only the chat populates this; the rail has no time series to draw. */
  readonly series?: SeriesTable;
  readonly t: Translator;
  readonly language: Language;
  readonly onAction: (action: ResolvedAction) => void;
}

export function BlockRenderer({
  blocks,
  facts,
  series = EMPTY_SERIES,
  t,
  language,
  onAction,
}: BlockRendererProps): ReactNode {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView
          key={`${block.kind}-${index}`}
          block={block}
          facts={facts}
          series={series}
          t={t}
          language={language}
          onAction={onAction}
        />
      ))}
    </>
  );
}

/**
 * A sentence with figures in it, none of them written by the author.
 *
 * `{{totals.netProfit}}` is replaced with the formatted fact; an unresolved
 * placeholder is drawn as a marker rather than dropped, because a sentence that
 * quietly loses its number still reads like a complete sentence and is then
 * simply wrong.
 */
function Templated({
  text,
  facts,
  language,
}: {
  readonly text: string;
  readonly facts: FactTable;
  readonly language: Language;
}): ReactNode {
  return (
    <>
      {resolveTemplate(text, facts, language).map((segment, index) => {
        if (segment.kind === 'text') return <span key={index}>{segment.text}</span>;
        if (segment.kind === 'missing') {
          return (
            <span key={index} className="text-faint" title={segment.ref}>
              —
            </span>
          );
        }
        return (
          <span key={index} data-numeric className="text-text">
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

/**
 * The paragraph that has not finished arriving.
 *
 * Drawn here rather than in the panel so a sentence looks the same while it is
 * being written as it will the moment it becomes a block — same size, same
 * leading, same placeholder resolution. The only difference is the caret, and
 * the fact that this text is never a `Block`: it is not exported, not pinned,
 * not read back to the model, and it is replaced rather than appended to.
 */
export function DraftText({
  text,
  facts,
  language,
}: {
  readonly text: string;
  readonly facts: FactTable;
  readonly language: Language;
}): ReactNode {
  return (
    <p className="m-0 text-xs leading-[1.55] text-dim">
      <Templated text={text} facts={facts} language={language} />
      <span
        aria-hidden
        className="ml-3 inline-block h-11 w-2 translate-y-[1px] animate-caret rounded-[1px] bg-acc align-middle"
      />
    </p>
  );
}

interface BlockViewProps {
  readonly block: Block;
  readonly facts: FactTable;
  readonly series: SeriesTable;
  readonly t: Translator;
  readonly language: Language;
  readonly onAction: (action: ResolvedAction) => void;
}

function BlockView({ block, facts, series, t, language, onAction }: BlockViewProps): ReactNode {
  /** Every numeric block goes through here — nothing prints a raw value. */
  const value = (ref: string): string => {
    const fact = facts.get(ref);
    return fact === undefined ? '—' : formatFact(fact, language);
  };

  switch (block.kind) {
    case 'text':
      return (
        <p
          className={cn(
            'm-0 text-xs leading-[1.55]',
            block.tone === undefined ? 'text-dim' : TONE_TEXT[block.tone],
          )}
        >
          <Templated text={phrase(t, block.text)} facts={facts} language={language} />
        </p>
      );

    case 'metric':
      return block.emphasis === true ? (
        <div className="flex flex-col gap-2">
          {block.label !== undefined && (
            <span className="text-tiny uppercase tracking-[0.08em] text-faint">
              {phrase(t, block.label)}
            </span>
          )}
          <span data-numeric className="text-xl font-medium tracking-[-0.02em]">
            {value(block.ref)}
          </span>
        </div>
      ) : (
        <div className="flex items-baseline gap-8 text-xs">
          {block.label !== undefined && (
            <span className="text-faint">{phrase(t, block.label)}</span>
          )}
          <span data-numeric className="text-text">
            {value(block.ref)}
          </span>
        </div>
      );

    /* The `↳` gutter of the design: a derivation read top to bottom, each line
       a step and the figure it rests on. */
    case 'steps':
      return (
        <div className="flex flex-col gap-4">
          {block.items.map((item, index) => (
            <span key={index} className="flex items-baseline gap-6 text-xs text-dim">
              <span aria-hidden className="shrink-0 text-faint">
                ↳
              </span>
              <span className="min-w-0 flex-1">{phrase(t, item.text)}</span>
              {item.ref !== undefined && (
                <span data-numeric className="shrink-0 text-text">
                  {value(item.ref)}
                </span>
              )}
            </span>
          ))}
        </div>
      );

    case 'kv':
      return (
        <div className="flex flex-col gap-5">
          {block.rows.map((row, index) => (
            <span key={index} className="flex items-baseline gap-8 text-xs text-dim">
              {phrase(t, row.label)}
              <span className="flex-1 border-b border-dashed border-line" />
              <span data-numeric className="text-text">
                {value(row.ref)}
              </span>
            </span>
          ))}
        </div>
      );

    /* Scrolls inside itself rather than widening the rail — a product name is
       longer than 320px more often than not. */
    case 'table':
      return (
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full border-collapse text-tiny">
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th
                    key={index}
                    className={cn(
                      'border-b border-line py-4 pr-8 text-left font-normal uppercase',
                      'tracking-[0.08em] text-faint',
                      index === block.columns.length - 1 && 'pr-0 text-right',
                    )}
                  >
                    {phrase(t, column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn(
                        'border-b border-line/60 py-4 pr-8 text-dim',
                        cellIndex === row.length - 1 && 'pr-0 text-right text-text',
                      )}
                      {...(cellIndex === row.length - 1 ? { 'data-numeric': '' } : {})}
                    >
                      {phrase(t, cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'badges':
      return (
        <div className="flex flex-wrap gap-5">
          {block.items.map((item, index) => (
            <Pill key={index} size="sm" tone={item.tone ?? 'neutral'}>
              {phrase(t, item.text)}
            </Pill>
          ))}
        </div>
      );

    case 'chart':
      return (
        <ChartBlockView block={block} facts={facts} series={series} t={t} language={language} />
      );

    case 'callout':
      return (
        <div className={cn('flex flex-col gap-7 rounded-8 border px-9 py-8', TONE_BORDER[block.tone])}>
          <span className="text-tiny uppercase tracking-[0.08em] text-faint">
            {phrase(t, block.title)}
          </span>
          <BlockRenderer
            blocks={block.blocks}
            facts={facts}
            series={series}
            t={t}
            language={language}
            onAction={onAction}
          />
        </div>
      );

    case 'action':
      return <ActionButton block={block} t={t} onAction={onAction} />;

    /* The application's own working, not the answer's. Quiet on purpose: it is
       there to be checked, not read. */
    case 'trace':
      return (
        <span className="flex items-center gap-6 font-mono text-tiny text-faint">
          <Database aria-hidden className="size-11 shrink-0" />
          <span className="min-w-0 truncate">
            {block.tool}
            {block.detail === '' ? '' : ` · ${block.detail}`}
          </span>
        </span>
      );
  }
}

interface ActionButtonProps {
  readonly block: Extract<Block, { kind: 'action' }>;
  readonly t: Translator;
  readonly onAction: (action: ResolvedAction) => void;
}

/**
 * A button that can only be what the registry says it is.
 *
 * The action is resolved again at render time rather than trusted from the
 * document, so the label, the route printed under it and the risk pill all come
 * from the registry entry — not from anything the author wrote. An action that
 * no longer resolves renders nothing, and the card keeps its argument without
 * offering a remedy it cannot perform.
 */
function ActionButton({ block, t, onAction }: ActionButtonProps): ReactNode {
  const resolved = resolveAction(block.actionId, block.params);
  if (resolved === null) return null;

  const { definition } = resolved;

  return (
    <div className="flex flex-col gap-6">
      {block.note !== undefined && (
        <p className="m-0 text-xs leading-[1.5] text-dim">{phrase(t, block.note)}</p>
      )}

      {definition.endpoint !== null && (
        <span className="font-mono text-tiny text-faint">{definition.endpoint}</span>
      )}

      <div className="flex flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={() => onAction(resolved)}
          className={cn(
            'tap flex h-28 cursor-pointer items-center gap-5 rounded-6 px-9 text-xs',
            definition.risk === 'high'
              ? 'border border-warn-line bg-warn-soft text-warn hover:bg-warn-soft/70'
              : 'border border-acc bg-acc-soft text-acc-dim hover:bg-acc-strong',
          )}
        >
          {t(definition.labelKey)}
        </button>

        {/* A `low` action sends a request that only reads — a label, an act —
            so it needs a press but not a warning beside it. */}
        {(definition.risk === 'mid' || definition.risk === 'high') && (
          <Pill size="sm" tone={definition.risk === 'high' ? 'negative' : 'warning'}>
            {t(definition.risk === 'high' ? 'riskHigh' : 'riskMid')}
          </Pill>
        )}
      </div>
    </div>
  );
}
