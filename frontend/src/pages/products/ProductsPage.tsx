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

/**
 * The eleven-column grid needs roughly 900px to stay readable.
 *
 * Below `lg` it is not narrowed, it is replaced: the header row and the row
 * grid are dropped entirely and each product becomes a card that names its own
 * figures. Squeezing eleven columns onto a phone would produce eleven
 * three-character ellipses, and wrapping the table in a horizontal scroller
 * would mean the product's name — the only column that identifies the row —
 * scrolls out of sight the moment the user reaches for a number.
 */
const DESKTOP_ONLY = 'hidden lg:grid';

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

/**
 * The sort control the card list uses instead of column headers.
 *
 * On the desktop grid the headers *are* the sort UI. Cards have no headers, so
 * the same `setSort` calls are offered as a select — one entry per distinct
 * sort key, since three of the columns above share `ID` and would otherwise
 * appear as three identical options.
 */
const SORT_OPTIONS: ReadonlyArray<{
  readonly key: ProductSortKey;
  readonly labelKey: 'cProduct' | 'cPrice' | 'cPurchase' | 'cTurnover' | 'cSold' | 'cReturns' | 'cAvailable' | 'cFbs';
}> = [
  { key: 'CREATED_AND_TITLE', labelKey: 'cProduct' },
  { key: 'PRICE', labelKey: 'cPrice' },
  { key: 'ROI', labelKey: 'cPurchase' },
  { key: 'DEFAULT', labelKey: 'cTurnover' },
  { key: 'ORDERS', labelKey: 'cSold' },
  { key: 'CONVERSION', labelKey: 'cReturns' },
  { key: 'LEFTOVERS', labelKey: 'cAvailable' },
  { key: 'ID', labelKey: 'cFbs' },
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
        <div className="px-10 pb-22 pt-12 sm:px-14">
          <SkeletonTable rows={9} />
        </div>
      }
    >
    <div className="flex flex-col gap-12 px-10 pb-22 pt-12 sm:px-14">
      <nav aria-label="Breadcrumb" className="flex items-center gap-9 text-xs-plus text-faint">
        <button
          type="button"
          onClick={() => void navigate('/overview')}
          className="tap cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-acc-dim"
        >
          {t('nOverview')}
        </button>
        <ChevronRight aria-hidden className="size-9 shrink-0" />
        <span aria-current="page" className="truncate text-text">
          {t('nProducts')}
        </span>
        <div className="flex-1" />
        {/* A "right-click a row" hint is meaningless without a right button. */}
        <span className="hidden items-center gap-5 lg:flex">
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
        <div className="flex flex-col gap-9 border-b border-line px-11 py-11 sm:px-14 lg:flex-row lg:flex-wrap lg:items-center lg:gap-10">
          <div className="flex min-w-0 flex-wrap items-center gap-8">
            <span className="text-base font-medium">{t('prodPerf')}</span>
            <span className="text-mini text-faint">
              {t('metaTpl', { n: table.totalCount, m: total })}
            </span>

            {rankFilter !== null && (
              <button
                type="button"
                onClick={() => setRankFilter(null)}
                className="tap flex h-24 cursor-pointer items-center gap-5 rounded-5 border border-acc-line bg-acc-soft px-8 text-mini text-acc-dim lg:h-20 lg:px-7"
              >
                status · {rankFilter}
                <X aria-hidden className="size-11 lg:size-9" />
              </button>
            )}
          </div>

          <div className="hidden flex-1 lg:block" />

          <div className="flex h-40 w-full items-center gap-7 rounded-8 border border-line-2 px-10 focus-within:border-acc-line lg:h-24 lg:w-186 lg:gap-6 lg:rounded-6 lg:px-8">
            <Search aria-hidden className="size-13 shrink-0 text-faint lg:size-11" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchProdPh')}
              aria-label={t('searchPh')}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text outline-none lg:text-xs"
            />
            {search !== '' && (
              <button
                type="button"
                aria-label={t('blSearchC')}
                onClick={() => setSearch('')}
                className="tap shrink-0 cursor-pointer border-0 bg-transparent p-0 text-faint hover:text-text"
              >
                <XCircle aria-hidden className="size-14 lg:size-11" />
              </button>
            )}
          </div>

          {/* The card list has no column headers to sort by, so the sort key
              becomes an explicit control. It writes to the same store the
              headers do — switching to a wide screen shows the same order. */}
          <label className="flex h-40 items-center gap-7 rounded-8 border border-line-2 px-10 text-xs text-faint focus-within:border-acc-line lg:hidden">
            <ArrowDownUp aria-hidden className="size-13 shrink-0" />
            <span className="sr-only">{t('sortL')}</span>
            {/* `self-stretch`, so the tap target is the full 40px row rather
                than the 17px the option text happens to occupy. */}
            <select
              value={sortBy}
              onChange={(event) => setSort(event.target.value as ProductSortKey)}
              className="min-w-0 flex-1 cursor-pointer self-stretch border-0 bg-transparent text-sm text-dim outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-8 lg:contents">
            <button
              type="button"
              onClick={toggleSortDirection}
              aria-label={t('sortL')}
              className="tap flex h-36 cursor-pointer items-center gap-5 rounded-7 border border-line-2 bg-transparent px-11 text-xs text-dim hover:border-acc-line hover:text-acc-dim lg:h-24 lg:rounded-6 lg:px-8"
            >
              <ArrowDownUp aria-hidden className="size-12 lg:size-11" />
              {sortDirection === 'asc' ? 'ASC' : 'DESC'}
            </button>

            <Button
              size="sm"
              icon={<Filter aria-hidden className="size-12" />}
              onClick={clearFilters}
            >
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
        </div>

        <div role="table" aria-label={t('prodPerf')}>
          <div role="row" className={cn(GRID, DESKTOP_ONLY, 'border-b border-line px-14')}>
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
          <div className="flex flex-col items-center gap-9 p-24 text-center sm:p-32">
            <FilterX aria-hidden className="size-22 text-faint" />
            <p className="text-sm-plus text-dim">{t('noMatch')}</p>
            <Button size="md" onClick={clearFilters}>
              {t('clearAll')}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-9 gap-y-8 border-t border-line px-11 py-9 text-xs text-faint sm:px-14">
          <span data-numeric>
            {table.rangeLabel} / {formatNumber(table.totalCount)}
          </span>
          <span className="font-mono">
            {t('pageOf', { n: page + 1, total: table.pageCount })}
          </span>
          <div className="hidden flex-1 sm:block" />

          <label className="ml-auto flex items-center gap-6 sm:ml-0">
            <span className="font-mono">size</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="h-32 cursor-pointer rounded-6 border border-line-2 bg-panel px-6 text-xs text-dim outline-none lg:h-22 lg:px-4"
            >
              {PRODUCT_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <span className="flex items-center gap-6">
            <IconButton
              label={t('prev')}
              variant="outline"
              size="md"
              className="lg:size-22 lg:rounded-5"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft aria-hidden className="size-13 lg:size-10" />
            </IconButton>
            <IconButton
              label={t('next')}
              variant="outline"
              size="md"
              className="lg:size-22 lg:rounded-5"
              disabled={page >= table.pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight aria-hidden className="size-13 lg:size-10" />
            </IconButton>
          </span>
        </div>
      </div>
    </div>
    </ScreenFrame>
  );
}

/**
 * One product, in whichever of the two shapes the viewport can carry.
 *
 * Both are rendered from the same data and both are the same interactive row —
 * the outer element owns the click, the focus ring and the keyboard handler,
 * so the two layouts cannot drift apart in behaviour. Only the arrangement of
 * the cells differs, and CSS alone decides which one is painted.
 */
function ProductRow({
  product,
  onOpen,
}: {
  readonly product: Product;
  readonly onOpen: () => void;
}): ReactNode {
  const { t } = useTranslation();

  const facts: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly tone?: string;
  }> = [
    { label: t('cPrice'), value: formatNumber(product.price) },
    { label: t('cPurchase'), value: formatNumber(product.purchasePrice) },
    { label: t('cTurnover'), value: formatNumber(product.turnover) },
    { label: t('cSold'), value: String(product.sold) },
    {
      label: t('cReturns'),
      value: `${product.returnedPct}%`,
      ...(product.returnedPct > 10 ? { tone: 'text-neg' } : {}),
    },
    { label: t('cAvailable'), value: String(product.quantityAvailable) },
    { label: t('cFbs'), value: String(product.quantityFbs) },
  ];

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
      className="cursor-pointer border-b border-line text-sm outline-offset-[-2px] hover:bg-acc-soft"
    >
      {/* — card, below `lg` — */}
      <div className="flex flex-col gap-9 px-11 py-11 sm:px-14 lg:hidden">
        <div className="flex items-start gap-10">
          <span className="flex size-32 shrink-0 items-center justify-center rounded-7 bg-grid text-faint">
            <Package aria-hidden className="size-15" />
          </span>

          <span className="flex min-w-0 flex-1 flex-col gap-2 leading-[1.3]">
            <span className="line-clamp-2 font-medium">{product.name}</span>
            <span className="truncate font-mono text-tiny text-faint">{product.sku}</span>
          </span>

          <ChevronRight aria-hidden className="mt-4 size-14 shrink-0 text-faint" />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <Pill tone={STATUS_TONE[product.status]} size="sm">
            {product.status}
          </Pill>
          <span className="rounded-4 border border-line-2 px-6 py-px text-tiny tracking-[0.04em] text-dim">
            {product.rank}
          </span>
        </div>

        <dl className="m-0 grid grid-cols-2 gap-x-12 gap-y-8 border-t border-line pt-9 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 flex-col gap-px">
              <dt className="truncate text-meta uppercase tracking-[0.08em] text-faint">
                {fact.label}
              </dt>
              <dd className={cn('m-0 truncate text-sm-plus', fact.tone ?? 'text-text')}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* — the dense grid, `lg` and up — */}
      <div className={cn(GRID, DESKTOP_ONLY, 'items-center px-14 py-7')}>
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
    </div>
  );
}
