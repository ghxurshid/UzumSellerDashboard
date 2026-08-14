import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FilterX } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import { MODULE_PAGE_SIZES } from '@/constants/app';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { buildPageItems } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import type { ModuleColumn, ModuleRow, ModuleRowAction, SortDirection } from '@/types/domain';
import type { RowMenuAction } from '@/components/ui/RowContextMenu';

import { ModuleTableRow } from './ModuleTableRow';
import type { HeaderCheckboxState } from './useRowSelection';

interface ModuleTableProps {
  readonly columns: readonly ModuleColumn[];
  readonly rows: readonly ModuleRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly sortKey: string | null;
  readonly sortDirection: SortDirection;
  readonly expandedIds: ReadonlySet<string>;
  readonly headerState: HeaderCheckboxState;
  readonly isSelected: (id: string) => boolean;
  readonly buildActions: (row: ModuleRow) => readonly RowMenuAction[];
  readonly onSort: (key: string) => void;
  readonly onToggleExpand: (id: string) => void;
  readonly onToggleSelect: (id: string) => void;
  readonly onToggleAll: () => void;
  readonly onRunRowAction: (row: ModuleRow, action: ModuleRowAction) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: number) => void;
  readonly onClearFilters: () => void;
}

/**
 * The table shared by all four data modules.
 *
 * Column widths come from the module definition, so the grid template is built
 * once here rather than each screen hard-coding a `grid-cols-[…]` string that
 * has to be kept in sync with its header.
 */
export function ModuleTable({
  columns,
  rows,
  page,
  pageSize,
  pageCount,
  sortKey,
  sortDirection,
  expandedIds,
  headerState,
  isSelected,
  buildActions,
  onSort,
  onToggleExpand,
  onToggleSelect,
  onToggleAll,
  onRunRowAction,
  onPageChange,
  onPageSizeChange,
  onClearFilters,
}: ModuleTableProps): ReactNode {
  const { t } = useTranslation();

  /* checkbox + data columns + caret + kebab */
  const gridTemplate = useMemo(
    () => `15px ${columns.map((column) => column.width).join(' ')} 22px 22px`,
    [columns],
  );

  const pageItems = useMemo(() => buildPageItems(page, pageCount), [page, pageCount]);

  const start = page * pageSize;
  const visible = rows.slice(start, start + pageSize);
  const rangeLabel =
    rows.length === 0 ? '0–0' : `${start + 1}–${Math.min(start + pageSize, rows.length)}`;

  return (
    <>
      <div role="table" aria-label={t('cLine')}>
        <div
          role="row"
          style={{ gridTemplateColumns: gridTemplate }}
          className="grid items-center border-b border-line px-14"
        >
          <Checkbox state={headerState} label={t('selectedL')} onToggle={onToggleAll} />

          {columns.map((column) => {
            const active = sortKey === column.key;
            return (
              <span key={column.key} className="flex min-w-0 pr-10">
                <button
                  type="button"
                  role="columnheader"
                  aria-sort={
                    active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  disabled={!column.sortable}
                  onClick={() => onSort(column.key)}
                  className={cn(
                    'flex min-w-0 items-center gap-3 border-0 bg-transparent py-9 text-meta uppercase tracking-[0.08em]',
                    column.sortable ? 'cursor-pointer hover:text-acc-dim' : 'cursor-default',
                    column.align === 'end' ? 'ml-auto justify-end' : 'justify-start',
                    active ? 'text-acc-dim' : 'text-faint',
                  )}
                >
                  <span className="truncate">{column.label}</span>
                  {active &&
                    (sortDirection === 'asc' ? (
                      <ChevronUp aria-hidden className="size-9 shrink-0" />
                    ) : (
                      <ChevronDown aria-hidden className="size-9 shrink-0" />
                    ))}
                </button>
              </span>
            );
          })}

          <span />
          <span />
        </div>

        {visible.map((row) => (
          <ModuleTableRow
            key={row.id}
            row={row}
            gridTemplate={gridTemplate}
            expanded={expandedIds.has(row.id)}
            selected={isSelected(row.id)}
            actions={buildActions(row)}
            onToggleExpand={() => onToggleExpand(row.id)}
            onToggleSelect={() => onToggleSelect(row.id)}
            onRunAction={(action) => onRunRowAction(row, action)}
          />
        ))}
      </div>

      {rows.length === 0 && (
        <div className="flex flex-col items-center gap-9 p-32">
          <FilterX aria-hidden className="size-22 text-faint" />
          <p className="m-0 text-sm-plus text-dim">{t('blFilterT')}</p>
          <Button size="md" onClick={onClearFilters}>
            {t('blFilterC')}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-10 px-14 py-8 text-xs text-faint">
        <span data-numeric>
          {rangeLabel} / {rows.length}
        </span>

        <label className="flex items-center gap-6">
          {t('rowsPer')}
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-22 cursor-pointer rounded-6 border border-line-2 bg-panel px-6 text-xs text-dim outline-none"
          >
            {MODULE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex-1" />

        {pageCount > 1 && (
          <span className="flex items-center gap-4">
            <IconButton
              label={t('prev')}
              variant="outline"
              size="xs"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft aria-hidden className="size-11" />
            </IconButton>

            {pageItems.map((item, index) =>
              item === 'gap' ? (
                <span
                  key={`gap-${index}`}
                  aria-hidden
                  className="px-2 text-xs text-faint select-none"
                >
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  aria-current={item === page ? 'page' : undefined}
                  onClick={() => onPageChange(item)}
                  data-numeric
                  className={cn(
                    'h-24 min-w-24 cursor-pointer rounded-6 border text-xs transition-colors hover:border-acc-line',
                    item === page
                      ? 'border-acc bg-acc-soft text-acc-dim'
                      : 'border-line-2 bg-transparent text-dim',
                  )}
                >
                  {item + 1}
                </button>
              ),
            )}

            <IconButton
              label={t('next')}
              variant="outline"
              size="xs"
              disabled={page >= pageCount - 1}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight aria-hidden className="size-11" />
            </IconButton>
          </span>
        )}
      </div>
    </>
  );
}
