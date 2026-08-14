import { create } from 'zustand';

import { DEFAULT_PRODUCT_PAGE_SIZE } from '@/constants/app';
import { resolveWindow } from '@/lib/dateRange';
import type { ProductFilter, ProductSortKey, RangeKey, SortDirection } from '@/types/domain';

/**
 * Query-shaping state: which shop, which window, and how the product table is
 * sliced.
 *
 * The window is *materialised* here — `windowFromMs`/`windowToMs` are real
 * instants, resolved when the range changes and re-resolved when a sync starts.
 * Deriving them from `Date.now()` at read time would make every query key
 * unstable and turn each render into a refetch.
 */
interface FiltersState {
  readonly storeKey: string;
  readonly rangeKey: RangeKey;
  readonly windowFromMs: number;
  readonly windowToMs: number;

  readonly search: string;
  readonly statusFilter: ProductFilter;
  /** Product status picked from the portfolio card, e.g. `ACTIVE`. */
  readonly rankFilter: string | null;
  readonly sortBy: ProductSortKey;
  readonly sortDirection: SortDirection;
  readonly page: number;
  readonly pageSize: number;

  setStore: (storeKey: string) => void;
  setRange: (rangeKey: RangeKey) => void;
  /** Re-resolve the current range against the clock — called when a sync runs. */
  refreshWindow: () => void;
  setSearch: (search: string) => void;
  setStatusFilter: (statusFilter: ProductFilter) => void;
  setRankFilter: (rankFilter: string | null) => void;
  setSortBy: (sortBy: ProductSortKey) => void;
  toggleSortDirection: () => void;
  setSort: (sortBy: ProductSortKey) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  clearFilters: () => void;
}

export const ALL_STORES = 'all';

const DEFAULT_RANGE: RangeKey = 'r30';

/**
 * Where the session starts: on the default range, resolved against the clock.
 *
 * Nothing has to be adopted from storage any more. The buffer answers by scope
 * rather than by one stored window, so *any* range the user picks is either
 * already held or lazily filled — including the one they had open yesterday.
 * An earlier design had to restore the exact instants a snapshot was keyed to,
 * which meant a returning user's range chip silently showed yesterday's period.
 */
const initialWindow = resolveWindow(DEFAULT_RANGE);

export const useFiltersStore = create<FiltersState>()((set, get) => ({
  storeKey: ALL_STORES,
  rangeKey: DEFAULT_RANGE,
  windowFromMs: initialWindow.fromMs,
  windowToMs: initialWindow.toMs,

  search: '',
  statusFilter: 'ALL',
  rankFilter: null,
  sortBy: 'DEFAULT',
  sortDirection: 'desc',
  page: 0,
  pageSize: DEFAULT_PRODUCT_PAGE_SIZE,

  setStore: (storeKey) => set({ storeKey, page: 0 }),

  setRange: (rangeKey) => {
    const window = resolveWindow(rangeKey);
    set({ rangeKey, windowFromMs: window.fromMs, windowToMs: window.toMs, page: 0 });
  },

  refreshWindow: () => {
    const window = resolveWindow(get().rangeKey);
    set({ windowFromMs: window.fromMs, windowToMs: window.toMs });
  },

  /* Any narrowing resets pagination — page 4 of a 2-page result is a dead end. */
  setSearch: (search) => set({ search, page: 0 }),
  setStatusFilter: (statusFilter) => set({ statusFilter, page: 0 }),
  setRankFilter: (rankFilter) => set({ rankFilter, page: 0 }),
  setSortBy: (sortBy) => set({ sortBy, page: 0 }),

  toggleSortDirection: () =>
    set((state) => ({ sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' })),

  /** Clicking the active column flips direction; a new column starts descending. */
  setSort: (sortBy) =>
    set((state) =>
      state.sortBy === sortBy
        ? { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' }
        : { sortBy, sortDirection: 'desc', page: 0 },
    ),

  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 0 }),

  clearFilters: () => set({ search: '', statusFilter: 'ALL', rankFilter: null, page: 0 }),
}));
