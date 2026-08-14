import { useCallback, useMemo, useState } from 'react';

import { DEFAULT_MODULE_PAGE_SIZE } from '@/constants/app';
import type { ModuleDefinition, ModuleRow, SortDirection } from '@/types/domain';

interface ModuleTableState {
  readonly activeTab: string;
  readonly search: string;
  readonly sortKey: string | null;
  readonly sortDirection: SortDirection;
  readonly page: number;
  readonly pageSize: number;
  readonly expandedIds: ReadonlySet<string>;
  readonly hiddenIds: ReadonlySet<string>;

  readonly rows: readonly ModuleRow[];
  readonly pageCount: number;
  readonly visibleIds: readonly string[];
  /** Rows the module returned in total, before tab or search narrowing. */
  readonly totalRows: number;
  /** Rows in the active tab, before the search box narrows them. */
  readonly tabRows: number;
  readonly isSearching: boolean;
  readonly isFiltered: boolean;

  setActiveTab: (tab: string) => void;
  setSearch: (search: string) => void;
  sortBy: (key: string) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  toggleExpand: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  hideRow: (id: string) => void;
  clearSearch: () => void;
  reset: () => void;
}

/**
 * Tab → search → sort → paginate for a data module.
 *
 * Search and sort read the row's own `search` string and `sortValues` rather
 * than the rendered cells, so a formatted figure ("1 240 946", "−25%") still
 * orders by its underlying number instead of by its first character.
 *
 * `tabRows` and `totalRows` are exposed because the screen has to tell three
 * different nothings apart: the account has no rows, the tab has none, or the
 * search matched none.
 */
export function useModuleTableState(definition: ModuleDefinition | null): ModuleTableState {
  const firstTab = definition?.tabs[0]?.key ?? 'all';

  const [activeTab, setActiveTabState] = useState<string | null>(null);
  const [search, setSearchState] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_MODULE_PAGE_SIZE);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());

  /* The tab is only pinned once the user picks one; until then it follows the
     definition, which may not have loaded when this hook first runs. */
  const tab = activeTab ?? firstTab;

  const allRows = useMemo(() => definition?.rows ?? [], [definition]);

  const inTab = useMemo(
    () => allRows.filter((row) => !hiddenIds.has(row.id)).filter((row) => row.tab === tab),
    [allRows, hiddenIds, tab],
  );

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query === '' ? inTab : inTab.filter((row) => row.search.includes(query));

    const columnIndex =
      sortKey === null ? -1 : (definition?.columns.findIndex((c) => c.key === sortKey) ?? -1);
    if (columnIndex < 0) return matched;

    return matched.toSorted((a, b) => {
      const left = a.sortValues[columnIndex];
      const right = b.sortValues[columnIndex];

      const result =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left ?? '').localeCompare(String(right ?? ''));

      return sortDirection === 'asc' ? result : -result;
    });
  }, [definition, inTab, search, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleIds = useMemo(
    () => rows.slice(safePage * pageSize, safePage * pageSize + pageSize).map((row) => row.id),
    [pageSize, rows, safePage],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sortBy = useCallback((key: string) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
        return currentKey;
      }
      setSortDirection('desc');
      return key;
    });
    setPage(0);
  }, []);

  return {
    activeTab: tab,
    search,
    sortKey,
    sortDirection,
    page: safePage,
    pageSize,
    expandedIds,
    hiddenIds,
    rows,
    pageCount,
    visibleIds,
    totalRows: allRows.length,
    tabRows: inTab.length,
    isSearching: search.trim() !== '',
    isFiltered: tab !== firstTab || hiddenIds.size > 0,

    setActiveTab: (next) => {
      setActiveTabState(next);
      setPage(0);
    },
    setSearch: (value) => {
      setSearchState(value);
      setPage(0);
    },
    sortBy,
    setPage,
    setPageSize: (size) => {
      setPageSizeState(size);
      setPage(0);
    },
    toggleExpand,
    expandAll: () => setExpandedIds(new Set(visibleIds)),
    collapseAll: () => setExpandedIds(new Set()),
    hideRow: (id) => setHiddenIds((current) => new Set(current).add(id)),
    clearSearch: () => {
      setSearchState('');
      setPage(0);
    },
    reset: () => {
      setActiveTabState(null);
      setSearchState('');
      setSortKey(null);
      setHiddenIds(new Set());
      setPage(0);
    },
  };
}
