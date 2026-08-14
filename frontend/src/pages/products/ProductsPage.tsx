import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Filter,
  FilterX,
  MousePointerClick,
  Package,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ScreenFrame } from '@/components/common/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Pill } from '@/components/ui/Pill';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { PRODUCT_PAGE_SIZES } from '@/constants/app';
import { useProductTable } from '@/features/products/useProductTable';
import { useProgressTask } from '@/hooks/useProgressTask';
import { useScreenStatus } from '@/hooks/useScreenStatus';
import { buildCsv, downloadBlob, timestampedName } from '@/lib/download';
import { formatNumber } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useFiltersStore } from '@/store/filters.store';
import { useToastStore } from '@/store/toast.store';
import type { Product, ProductSortKey, ProductStatus, Tone } from '@/types/domain';

/* `gap-x` keeps the numeric columns from touching, and every track has a `0`
   minimum so a long header ("Себестоимость") shrinks instead of spilling over
   its neighbour. */
const GRID =
  'grid grid-cols-[minmax(176px,2fr)_repeat(7,minmax(0,1fr))_58px_96px_20px] gap-x-8';

const COLUMNS: ReadonlyArray<{
  readonly key: ProductSortKey;
  readonly labelKey: 'cProduct' | 'cPrice' | 'cPurchase' | 'cTurnover' | 'cSold' | 'cReturns' | 'cAvailable' | 'cFbs' | 'cClass' | 'cStatus';
  readonly align: 'start' | 'end';
}> = [
  { key: 'CREATED_AND_TITLE', labelKey: 'cProduct', align: 'start' },
  { key: 'PRICE', labelKey: 'cPrice', align: 'end' },
  { key: 'ROI', labelKey: 'cPurchase', align: 'end' },
  { key: 'DEFAULT', labelKey: 'cTurnover', align: 'end' },
  { key: 'ORDERS', labelKey: 'cSold', align: 'end' },
  { key: 'CONVERSION', labelKey: 'cReturns', align: 'end' },
  { key: 'LEFTOVERS', labelKey: 'cAvailable', align: 'end' },
  { key: 'ID', labelKey: 'cFbs', align: 'end' },
  { key: 'ID', labelKey: 'cClass', align: 'end' },
  { key: 'ID', labelKey: 'cStatus', align: 'end' },
];

const STATUS_TONE: Record<ProductStatus, Tone> = {
  ACTIVE: 'positive',
  INACTIVE: 'neutral',
  RUN_OUT: 'warning',
  ARCHIVED: 'neutral',
  DEFECTED: 'negative',
  WARNING: 'warning',
};

/** Products — the sortable, filterable performance table. */
export default function ProductsPage(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pushToast = useToastStore((state) => state.push);

  const { products, total, truncated, queries, refetch } = useProductsQuery();
  const progress = useProgressTask();

  const search = useFiltersStore((state) => state.search);
  const setSearch = useFiltersStore((state) => state.setSearch);
  const rankFilter = useFiltersStore((state) => state.rankFilter);
  const setRankFilter = useFiltersStore((state) => state.setRankFilter);
  const sortBy = useFiltersStore((state) => state.sortBy);
  const sortDirection = useFiltersStore((state) => state.sortDirection);
  const setSort = useFiltersStore((state) => state.setSort);
  const toggleSortDirection = useFiltersStore((state) => state.toggleSortDirection);
  const page = useFiltersStore((state) => state.page);
  const setPage = useFiltersStore((state) => state.setPage);
  const pageSize = useFiltersStore((state) => state.pageSize);
  const setPageSize = useFiltersStore((state) => state.setPageSize);
  const clearFilters = useFiltersStore((state) => state.clearFilters);

  const table = useProductTable(products);

  /* The export is the rows the user is looking at, serialised here — there is
     no export endpoint in the seller API and nothing is fetched again. */
  const handleExport = useCallback(() => {
    if (table.rows.length === 0) return;

    void progress.run({
      label: t('prExport'),
      sub: `csv · ${table.rows.length} rows`,
      kind: 'down',
      task: ({ report, signal }) =>
        buildCsv({
          rows: [...table.rows],
          columns: [
            { header: 'productId', value: (row: Product) => row.productId },
            { header: 'title', value: (row: Product) => row.name },
            { header: 'shopId', value: (row: Product) => row.shopId },
            { header: 'price', value: (row: Product) => row.price },
            { header: 'purchasePrice', value: (row: Product) => row.purchasePrice },
            { header: 'quantitySold', value: (row: Product) => row.sold },
            { header: 'returnedPercentage', value: (row: Product) => row.returnedPct },
            { header: 'quantityAvailable', value: (row: Product) => row.quantityAvailable },
            { header: 'quantityActive', value: (row: Product) => row.quantityActive },
            { header: 'quantityFbs', value: (row: Product) => row.quantityFbs },
            { header: 'status', value: (row: Product) => row.status },
          ],
          report,
          signal,
        }),
      onDone: (blob) => {
        downloadBlob(blob, timestampedName('products', 'csv'));
        pushToast(t('tExport'), { kind: 'ok' });
      },
      onError: () => pushToast(t('tFail'), { kind: 'err' }),
    });
  }, [progress, pushToast, t, table.rows]);

  const status = useScreenStatus({
    queries,
    total: products.length,
    visible: table.totalCount,
    searchActive: search.trim() !== '',
    filterActive: table.isFiltered,
  });

  return (
    <ScreenFrame
      status={status}
      onRetry={refetch}
      onClearSearch={() => setSearch('')}
      onClearFilters={clearFilters}
      searchQuery={search}
      rowsRead={products.length}
      skeleton={
        <div className="px-14 pb-22 pt-12">
          <SkeletonTable rows={9} />
        </div>
      }
    >
    <div className="flex flex-col gap-12 px-14 pb-22 pt-12">
      <nav aria-label="Breadcrumb" className="flex items-center gap-9 text-xs-plus text-faint">
        <button
          type="button"
          onClick={() => void navigate('/overview')}
          className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-acc-dim"
        >
          {t('nOverview')}
        </button>
        <ChevronRight aria-hidden className="size-9" />
        <span aria-current="page" className="text-text">
          {t('nProducts')}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-5">
          <MousePointerClick aria-hidden className="size-12" />
          {t('pickHint')}
        </span>
      </nav>

      {truncated && (
        <p className="m-0 rounded-8 border border-warn-line bg-warn-soft px-11 py-8 text-xs text-warn">
          {t('bnTruncT', { n: products.length, total })}
        </p>
      )}

      <div className="overflow-hidden rounded-11 border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-10 border-b border-line px-14 py-11">
          <span className="text-base font-medium">{t('prodPerf')}</span>
          <span className="text-mini text-faint">
            {t('metaTpl', { n: table.totalCount, m: total })}
          </span>

          {rankFilter !== null && (
            <button
              type="button"
              onClick={() => setRankFilter(null)}
              className="flex h-20 cursor-pointer items-center gap-5 rounded-5 border border-acc-line bg-acc-soft px-7 text-mini text-acc-dim"
            >
              status · {rankFilter}
              <X aria-hidden className="size-9" />
            </button>
          )}

          <div className="flex-1" />

          <div className="flex h-24 w-186 items-center gap-6 rounded-6 border border-line-2 px-8 focus-within:border-acc-line">
            <Search aria-hidden className="size-11 shrink-0 text-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchProdPh')}
              aria-label={t('searchPh')}
              className="min-w-0 flex-1 border-0 bg-transparent text-xs text-text outline-none"
            />
            {search !== '' && (
              <button
                type="button"
                aria-label={t('blSearchC')}
                onClick={() => setSearch('')}
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-faint hover:text-text"
              >
                <XCircle aria-hidden className="size-11" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={toggleSortDirection}
            className="flex h-24 cursor-pointer items-center gap-5 rounded-6 border border-line-2 bg-transparent px-8 text-xs text-dim hover:border-acc-line hover:text-acc-dim"
          >
            <ArrowDownUp aria-hidden className="size-11" />
            {sortDirection === 'asc' ? 'ASC' : 'DESC'}
          </button>

          <Button size="sm" icon={<Filter aria-hidden className="size-12" />} onClick={clearFilters}>
            {t('clearAll')}
          </Button>

          <Button
            size="sm"
            icon={<FileSpreadsheet aria-hidden className="size-12" />}
            onClick={handleExport}
          >
            {t('exportCsv')}
          </Button>
        </div>

        <div role="table" aria-label={t('prodPerf')}>
          <div role="row" className={cn(GRID, 'border-b border-line px-14')}>
            {COLUMNS.map((column, index) => (
              <span
                key={`${column.labelKey}-${index}`}
                className={cn(
                  'flex min-w-0',
                  column.align === 'end' ? 'justify-end' : 'justify-start',
                )}
              >
                <button
                  type="button"
                  role="columnheader"
                  title={t(column.labelKey)}
                  aria-sort={
                    sortBy === column.key
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  onClick={() => setSort(column.key)}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-center gap-3 border-0 bg-transparent py-8 text-meta uppercase tracking-[0.08em] hover:text-acc-dim',
                    sortBy === column.key ? 'text-acc-dim' : 'text-faint',
                  )}
                >
                  <span className="truncate">{t(column.labelKey)}</span>
                </button>
              </span>
            ))}
            <span />
          </div>

          {table.page.map((product) => (
            <ProductRow
              key={product.productId}
              product={product}
              onOpen={() => void navigate(`/products/${product.productId}`)}
            />
          ))}
        </div>

        {table.totalCount === 0 && (
          <div className="flex flex-col items-center gap-9 p-32">
            <FilterX aria-hidden className="size-22 text-faint" />
            <p className="text-sm-plus text-dim">{t('noMatch')}</p>
            <Button size="md" onClick={clearFilters}>
              {t('clearAll')}
            </Button>
          </div>
        )}

        <div className="flex items-center gap-9 border-t border-line px-14 py-8 text-xs text-faint">
          <span data-numeric>
            {table.rangeLabel} / {formatNumber(table.totalCount)}
          </span>
          <span className="font-mono">
            page {page + 1} / {table.pageCount}
          </span>
          <div className="flex-1" />

          <label className="flex items-center gap-5">
            <span className="font-mono">size</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="h-22 cursor-pointer rounded-6 border border-line-2 bg-panel px-4 text-xs text-dim outline-none"
            >
              {PRODUCT_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <IconButton
            label={t('prev')}
            variant="outline"
            size="xs"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft aria-hidden className="size-10" />
          </IconButton>
          <IconButton
            label={t('next')}
            variant="outline"
            size="xs"
            disabled={page >= table.pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight aria-hidden className="size-10" />
          </IconButton>
        </div>
      </div>
    </div>
    </ScreenFrame>
  );
}

function ProductRow({
  product,
  onOpen,
}: {
  readonly product: Product;
  readonly onOpen: () => void;
}): ReactNode {
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      data-numeric
      className={cn(
        GRID,
        'cursor-pointer items-center border-b border-line px-14 py-7 text-sm outline-offset-[-2px] hover:bg-acc-soft',
      )}
    >
      <span className="flex min-w-0 items-center gap-9">
        <span className="flex size-26 shrink-0 items-center justify-center rounded-6 bg-grid text-faint">
          <Package aria-hidden className="size-12" />
        </span>
        <span className="flex min-w-0 flex-col leading-[1.25]">
          <span className="truncate">{product.name}</span>
          <span className="text-tiny text-faint">{product.sku}</span>
        </span>
      </span>

      <span className="truncate text-right">{formatNumber(product.price)}</span>
      <span className="truncate text-right text-dim">{formatNumber(product.purchasePrice)}</span>
      <span className="truncate text-right">{formatNumber(product.turnover)}</span>
      <span className="truncate text-right text-dim">{product.sold}</span>
      <span
        className={cn('truncate text-right', product.returnedPct > 10 ? 'text-neg' : 'text-dim')}
      >
        {product.returnedPct}%
      </span>
      <span className="truncate text-right text-dim">{product.quantityAvailable}</span>
      <span className="truncate text-right text-dim">{product.quantityFbs}</span>

      <span className="flex min-w-0 justify-end">
        <span className="truncate rounded-4 border border-line-2 px-5 py-px text-tiny tracking-[0.04em] text-dim">
          {product.rank}
        </span>
      </span>

      <span className="flex min-w-0 justify-end">
        <Pill tone={STATUS_TONE[product.status]} size="sm">
          {product.status}
        </Pill>
      </span>

      <span className="flex justify-end text-faint">
        <ChevronRight aria-hidden className="size-11" />
      </span>
    </div>
  );
}
