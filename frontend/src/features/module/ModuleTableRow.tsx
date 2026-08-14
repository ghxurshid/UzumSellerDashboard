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
import type { ModuleRow, ModuleRowAction, Tone } from '@/types/domain';

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

interface ModuleTableRowProps {
  readonly row: ModuleRow;
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
  gridTemplate,
  expanded,
  selected,
  actions,
  onToggleExpand,
  onToggleSelect,
  onRunAction,
}: ModuleTableRowProps): ReactNode {
  const { t } = useTranslation();

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
          style={{ gridTemplateColumns: gridTemplate }}
          className="grid cursor-pointer items-center gap-0 px-14 py-7 text-sm outline-offset-[-2px] hover:bg-acc-soft"
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
      </RowContextMenu>

      {expanded && (
        <div className="flex animate-[rise_0.16s_ease] flex-col gap-11 border-t border-line bg-ground py-12 pl-59 pr-14">
          <p className="m-0 max-w-760 text-xs-plus leading-[1.6] text-dim">{row.detail.note}</p>

          <dl className="flex flex-wrap gap-24">
            {row.detail.facts.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-px">
                <dt className="font-mono text-meta uppercase tracking-[0.09em] text-faint">
                  {fact.label}
                </dt>
                <dd data-numeric className="m-0 text-base">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex max-w-520 flex-col gap-5">
            {row.detail.list.map((item, index) => (
              <span
                key={`${row.id}-list-${index}`}
                className="flex items-center gap-9 rounded-8 border border-line px-9 py-6 text-xs-plus"
              >
                <Icon name={item.icon} className={cn('size-12 shrink-0', TONE_TEXT[item.tone])} />
                <span className="font-mono text-dim">{item.text}</span>
                <span className="flex-1" />
                <span data-numeric>{item.value}</span>
                <span className="min-w-52 text-right text-tiny text-faint">{item.time}</span>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-6">
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
                  'flex h-26 cursor-pointer items-center gap-5 rounded-6 border px-10 text-xs transition-colors',
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
