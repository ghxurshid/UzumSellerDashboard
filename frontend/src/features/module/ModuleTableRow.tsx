import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { Checkbox } from '@/components/ui/Checkbox';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { RowContextMenu, type RowMenuAction } from '@/components/ui/RowContextMenu';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { ModuleColumn, ModuleRow, ModuleRowAction, Tone } from '@/types/domain';

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

interface ModuleTableRowProps {
  readonly row: ModuleRow;
  /**
   * The header labels, needed by the card layout.
   *
   * A cell knows its value but not what the value *is* — on the grid that is
   * the column header's job, and the card has no header row to inherit it
   * from. Passing the definition's columns down is what lets each card name
   * its own figures rather than showing a stack of unlabelled numbers.
   */
  readonly columns: readonly ModuleColumn[];
  readonly gridTemplate: string;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly actions: readonly RowMenuAction[];
  readonly onToggleExpand: () => void;
  readonly onToggleSelect: () => void;
  readonly onRunAction: (action: ModuleRowAction) => void;
}

/**
 * One table row plus its expandable detail.
 *
 * Memoised because a module page renders up to 50 of these and a selection
 * change would otherwise re-render every row to repaint one checkbox.
 */
export const ModuleTableRow = memo(function ModuleTableRow({
  row,
  columns,
  gridTemplate,
  expanded,
  selected,
  actions,
  onToggleExpand,
  onToggleSelect,
  onRunAction,
}: ModuleTableRowProps): ReactNode {
  const { t } = useTranslation();

  /* The first cell identifies the row — an order number, an SKU title — so on
     a card it becomes the heading and the rest become labelled facts beneath
     it. On the grid it is simply the first column. */
  const [lead, ...rest] = row.cells;

  return (
    <div className={cn('border-b border-line', selected && 'bg-acc-soft/40')}>
      <RowContextMenu actions={actions}>
        <div
          role="row"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={onToggleExpand}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onToggleExpand();
            }
          }}
          data-numeric
          className="cursor-pointer text-sm outline-offset-[-2px] hover:bg-acc-soft"
        >
          {/* — card, below `lg` — */}
          <div className="flex flex-col gap-9 px-11 py-11 sm:px-14 lg:hidden">
            <div className="flex items-start gap-10">
              <span className="flex h-24 shrink-0 items-center">
                <Checkbox
                  state={selected ? 'all' : 'none'}
                  label={`${t('selectedL')} ${row.id}`}
                  onToggle={onToggleSelect}
                  stopPropagation
                />
              </span>

              {lead?.icon !== undefined && (
                <span className="flex size-30 shrink-0 items-center justify-center rounded-7 bg-grid text-faint">
                  <Icon name={lead.icon} className="size-14" />
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col gap-2 leading-[1.3]">
                {lead?.kind === 'pill' ? (
                  <Pill tone={lead.tone ?? 'neutral'} size="sm">
                    {lead.value}
                  </Pill>
                ) : (
                  <span
                    className={cn(
                      'line-clamp-2 font-medium',
                      lead?.tone !== undefined ? TONE_TEXT[lead.tone] : undefined,
                    )}
                  >
                    {lead?.value}
                  </span>
                )}
                {lead?.sub !== undefined && (
                  <span className="truncate font-mono text-tiny text-faint">{lead.sub}</span>
                )}
              </span>

              {expanded ? (
                <ChevronDown aria-hidden className="mt-4 size-14 shrink-0 text-faint" />
              ) : (
                <ChevronRight aria-hidden className="mt-4 size-14 shrink-0 text-faint" />
              )}

              <RowActionsMenu actions={actions} label={t('gAct')} />
            </div>

            {rest.length > 0 && (
              <dl className="m-0 grid grid-cols-2 gap-x-12 gap-y-8 border-t border-line pt-9 sm:grid-cols-3">
                {rest.map((cell, index) => (
                  <div key={`${row.id}-card-${index}`} className="flex min-w-0 flex-col gap-2">
                    <dt className="truncate text-meta uppercase tracking-[0.08em] text-faint">
                      {columns[index + 1]?.label ?? ''}
                    </dt>
                    <dd className="m-0 flex min-w-0 items-center gap-6">
                      {cell.kind === 'pill' ? (
                        <Pill tone={cell.tone ?? 'neutral'} size="sm">
                          {cell.value}
                        </Pill>
                      ) : (
                        <span
                          className={cn(
                            'truncate text-sm-plus',
                            cell.tone !== undefined ? TONE_TEXT[cell.tone] : 'text-text',
                          )}
                        >
                          {cell.value}
                          {cell.sub !== undefined && (
                            <span className="ml-5 text-tiny text-faint">{cell.sub}</span>
                          )}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* — the dense grid, `lg` and up — */}
          <div
            style={{ gridTemplateColumns: gridTemplate }}
            className="hidden items-center gap-0 px-14 py-7 lg:grid"
          >
            <Checkbox
              state={selected ? 'all' : 'none'}
              label={`${t('selectedL')} ${row.id}`}
              onToggle={onToggleSelect}
              stopPropagation
            />

            {row.cells.map((cell, index) => (
              <span
                key={`${row.id}-${index}`}
                className={cn(
                  'flex min-w-0 items-center gap-8 pr-10',
                  cell.align === 'end' ? 'justify-end' : 'justify-start',
                  cell.tone !== undefined ? TONE_TEXT[cell.tone] : undefined,
                )}
              >
                {cell.icon !== undefined && (
                  <span className="flex size-24 shrink-0 items-center justify-center rounded-6 bg-grid text-faint">
                    <Icon name={cell.icon} className="size-11" />
                  </span>
                )}

                {cell.kind === 'pill' ? (
                  <Pill tone={cell.tone ?? 'neutral'} size="sm">
                    {cell.value}
                  </Pill>
                ) : (
                  <span className="flex min-w-0 flex-col leading-[1.25]">
                    <span className="truncate">{cell.value}</span>
                    {cell.sub !== undefined && (
                      <span className="truncate text-tiny text-faint">{cell.sub}</span>
                    )}
                  </span>
                )}
              </span>
            ))}

            <span className="flex justify-end text-faint">
              {expanded ? (
                <ChevronDown aria-hidden className="size-11" />
              ) : (
                <ChevronRight aria-hidden className="size-11" />
              )}
            </span>

            <RowActionsMenu actions={actions} label={t('gAct')} />
          </div>
        </div>
      </RowContextMenu>

      {expanded && (
        <div className="flex animate-[rise_0.16s_ease] flex-col gap-11 border-t border-line bg-ground px-11 py-12 sm:px-14 lg:pl-59 lg:pr-14">
          <p className="m-0 max-w-760 text-xs-plus leading-[1.6] text-dim">{row.detail.note}</p>

          <dl className="grid grid-cols-2 gap-x-16 gap-y-10 sm:grid-cols-3 lg:flex lg:flex-wrap lg:gap-24">
            {row.detail.facts.map((fact) => (
              <div key={fact.label} className="flex min-w-0 flex-col gap-px">
                <dt className="truncate font-mono text-meta uppercase tracking-[0.09em] text-faint">
                  {fact.label}
                </dt>
                <dd data-numeric className="m-0 truncate text-base">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex max-w-520 flex-col gap-5">
            {row.detail.list.map((item, index) => (
              <span
                key={`${row.id}-list-${index}`}
                className="flex flex-wrap items-center gap-x-9 gap-y-2 rounded-8 border border-line px-9 py-7 text-xs-plus"
              >
                <Icon name={item.icon} className={cn('size-12 shrink-0', TONE_TEXT[item.tone])} />
                <span className="min-w-0 truncate font-mono text-dim">{item.text}</span>
                <span className="flex-1" />
                <span data-numeric>{item.value}</span>
                <span className="min-w-52 text-right text-tiny text-faint">{item.time}</span>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-7">
            {row.detail.actions.map((action) => (
              <button
                key={action.act}
                type="button"
                disabled={action.disabled === true}
                onClick={(event) => {
                  event.stopPropagation();
                  onRunAction(action);
                }}
                className={cn(
                  'tap flex h-36 cursor-pointer items-center gap-6 rounded-7 border px-12 text-xs transition-colors',
                  'lg:h-26 lg:rounded-6 lg:px-10',
                  'disabled:cursor-not-allowed disabled:opacity-45',
                  action.primary === true
                    ? 'border-acc bg-acc-soft text-acc-dim hover:bg-acc-strong'
                    : 'border-line-2 bg-transparent text-dim hover:border-acc-line hover:text-acc-dim',
                )}
              >
                <Icon name={action.icon} className="size-12" />
                {t(action.labelKey as TranslationKey)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
