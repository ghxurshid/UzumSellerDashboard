import { RowsIcon, Search, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { ModuleTab } from '@/types/domain';

interface ModuleToolbarProps {
  readonly tabs: readonly ModuleTab[];
  readonly activeTab: string;
  readonly search: string;
  readonly searchable: boolean;
  readonly searchPlaceholder: string;
  readonly onTabChange: (tab: string) => void;
  readonly onSearchChange: (search: string) => void;
  readonly onExpandAll: () => void;
  readonly onCollapseAll: () => void;
}

/** Tab row, search field and the expand/collapse pair. */
export function ModuleToolbar({
  tabs,
  activeTab,
  search,
  searchable,
  searchPlaceholder,
  onTabChange,
  onSearchChange,
  onExpandAll,
  onCollapseAll,
}: ModuleToolbarProps): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:flex-wrap lg:items-center lg:gap-6">
      {/* Tabs run off the edge and scroll rather than wrapping into three
          stacked lines that push the table below the fold. The full-width
          bleed keeps the first tab flush with the page gutter while the last
          one can still scroll clear of the right edge. */}
      <div
        role="tablist"
        aria-label={t('cLine')}
        className="scroll-x snap-x-start -mx-10 flex gap-7 px-10 sm:-mx-14 sm:px-14 lg:mx-0 lg:flex-wrap lg:gap-6 lg:overflow-visible lg:px-0"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'flex h-36 shrink-0 cursor-pointer items-center gap-6 rounded-full border px-13 text-xs-plus transition-colors hover:border-acc-line hover:text-acc-dim',
                'lg:h-26 lg:px-10',
                active
                  ? 'border-acc bg-acc-soft text-acc-dim'
                  : 'border-line-2 bg-transparent text-dim',
              )}
            >
              {tab.label}
              <span data-numeric className="text-meta text-faint">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="hidden flex-1 lg:block" />

      <div className="flex items-center gap-7">
        {searchable && (
          <div className="flex h-40 min-w-0 flex-1 items-center gap-8 rounded-8 border border-line-2 bg-panel px-11 focus-within:border-acc-line lg:h-26 lg:min-w-200 lg:flex-none lg:gap-7 lg:rounded-7 lg:px-9">
            <Search aria-hidden className="size-14 shrink-0 text-faint lg:size-12" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text outline-none lg:text-xs-plus"
            />
            {search !== '' && (
              <button
                type="button"
                aria-label={t('blSearchC')}
                onClick={() => onSearchChange('')}
                className="tap shrink-0 cursor-pointer border-0 bg-transparent p-0 text-faint hover:text-text"
              >
                <XCircle aria-hidden className="size-14 lg:size-11" />
              </button>
            )}
          </div>
        )}

        <IconButton
          label={t('expandAll')}
          variant="outline"
          size="lg"
          className="lg:size-26"
          onClick={onExpandAll}
        >
          <RowsIcon aria-hidden className="size-13 lg:size-12" />
        </IconButton>
        <IconButton
          label={t('collapseAll')}
          variant="outline"
          size="lg"
          className="lg:size-26"
          onClick={onCollapseAll}
        >
          <RowsIcon aria-hidden className="size-13 rotate-90 lg:size-12" />
        </IconButton>
      </div>
    </div>
  );
}
