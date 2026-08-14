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
    <div className="flex flex-wrap items-center gap-6">
      <div role="tablist" aria-label={t('cLine')} className="flex flex-wrap gap-6">
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
                'flex h-26 cursor-pointer items-center gap-6 rounded-full border px-10 text-xs-plus transition-colors hover:border-acc-line hover:text-acc-dim',
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

      <div className="flex-1" />

      {searchable && (
        <div className="flex h-26 min-w-200 items-center gap-7 rounded-7 border border-line-2 bg-panel px-9 focus-within:border-acc-line">
          <Search aria-hidden className="size-12 shrink-0 text-faint" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="min-w-0 flex-1 border-0 bg-transparent text-xs-plus text-text outline-none"
          />
          {search !== '' && (
            <button
              type="button"
              aria-label={t('blSearchC')}
              onClick={() => onSearchChange('')}
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-faint hover:text-text"
            >
              <XCircle aria-hidden className="size-11" />
            </button>
          )}
        </div>
      )}

      <IconButton label={t('expandAll')} variant="outline" onClick={onExpandAll}>
        <RowsIcon aria-hidden className="size-12" />
      </IconButton>
      <IconButton label={t('collapseAll')} variant="outline" onClick={onCollapseAll}>
        <RowsIcon aria-hidden className="size-12 rotate-90" />
      </IconButton>
    </div>
  );
}
