import { useMemo } from 'react';

import { useFiltersStore } from '@/store/filters.store';
import type { Product, ProductFilter, ProductSortKey, SortDirection } from '@/types/domain';

/** Which product field each sort key reads. */
const SORT_VALUE: Record<ProductSortKey, (product: Product) => number | string> = {
  DEFAULT: (product) => product.turnover,
  ORDERS: (product) => product.sold,
  PRICE: (product) => product.price,
  ID: (product) => product.productId,
  ROI: (product) =>
    product.purchasePrice === 0 ? 0 : (product.price - product.purchasePrice) / product.purchasePrice,
  CONVERSION: (product) => product.returnedPct,
  LEFTOVERS: (product) => product.quantityAvailable,
  CREATED_AND_TITLE: (product) => product.name,
};

/**
 * Which products each filter chip admits; `ALL` short-circuits.
 *
 * The values mirror the `filter` enum of `GET /v1/product/shop/{shopId}`, so a
 * chip here means the same thing it would mean to the API.
 */
const FILTER_PREDICATE: Record<ProductFilter, (product: Product) => boolean> = {
  ALL: () => true,
  ACTIVE: (product) => product.status === 'ACTIVE',
  INACTIVE: (product) => product.status === 'INACTIVE',
  WARNING: (product) => product.status === 'WARNING',
  WITH_SKU: (product) => product.skus.length > 0,
  ARCHIVE: (product) => product.status === 'ARCHIVED',
  DEFECTED: (product) => product.status === 'DEFECTED',
  /* No rank was scored for the product — `rankInfo.rank` came back empty. */
  WITHOUT_REQUIRED_FILTERS: (product) => product.rank === '—',
};

function compare(a: Product, b: Product, key: ProductSortKey, direction: SortDirection): number {
  const left = SORT_VALUE[key](a);
  const right = SORT_VALUE[key](b);

  const result =
    typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right)
      : Number(left) - Number(right);

  return direction === 'asc' ? result : -result;
}

export interface ProductTableResult {
  readonly rows: readonly Product[];
  readonly page: readonly Product[];
  readonly totalCount: number;
  readonly pageCount: number;
  readonly rangeLabel: string;
  readonly isFiltered: boolean;
}

/**
 * Filter → search → sort → paginate, in that order.
 *
 * Derived state, not stored state: keeping the visible page in a store would
 * mean invalidating it on every filter change, and the two would drift the
 * first time one path forgot to.
 */
export function useProductTable(products: readonly Product[]): ProductTableResult {
  const search = useFiltersStore((state) => state.search);
  const statusFilter = useFiltersStore((state) => state.statusFilter);
  const rankFilter = useFiltersStore((state) => state.rankFilter);
  const sortBy = useFiltersStore((state) => state.sortBy);
  const sortDirection = useFiltersStore((state) => state.sortDirection);
  const page = useFiltersStore((state) => state.page);
  const pageSize = useFiltersStore((state) => state.pageSize);

  return useMemo<ProductTableResult>(() => {
    const query = search.trim().toLowerCase();

    const rows = products
      .filter(FILTER_PREDICATE[statusFilter])
      /* The portfolio card on the overview groups by status.value, so the
         chip it hands over is a status, not a rank. */
      .filter((product) => rankFilter === null || product.status === rankFilter)
      .filter(
        (product) =>
          query === '' ||
          product.name.toLowerCase().includes(query) ||
          product.sku.includes(query),
      )
      .toSorted((a, b) => compare(a, b, sortBy, sortDirection));

    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(page, pageCount - 1);
    const start = safePage * pageSize;
    const slice = rows.slice(start, start + pageSize);

    return {
      rows,
      page: slice,
      totalCount: rows.length,
      pageCount,
      rangeLabel:
        rows.length === 0 ? '0–0' : `${start + 1}–${Math.min(start + pageSize, rows.length)}`,
      isFiltered: query !== '' || statusFilter !== 'ALL' || rankFilter !== null,
    };
  }, [products, search, statusFilter, rankFilter, sortBy, sortDirection, page, pageSize]);
}
