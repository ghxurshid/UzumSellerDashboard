import { Barcode, ChevronLeft, ChevronRight, ImageIcon, Layers, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ScreenFrame } from '@/components/common/ScreenFrame';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';
import { SkeletonTable } from '@/components/ui/Skeleton';
import {
  ProductFormDrawer,
  type ProductFormKind,
} from '@/features/products/ProductFormDrawer';
import { useScreenStatus } from '@/hooks/useScreenStatus';
import { formatNumber } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useProduct, useProductsQuery } from '@/services/queries/useProductsQuery';
import type { Product, Sku } from '@/types/domain';

/** A single product: card facts, its SKU rows, and the three write actions. */
export default function ProductDetailPage(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ productId: string }>();

  const productId = Number(params.productId ?? '');
  const { product, queries, refetch } = useProduct(productId);
  const { products } = useProductsQuery();

  /* The detail is a view of the catalogue that is already in cache — an id
     that is not in it is an empty result, not a failed request. */
  const status = useScreenStatus({
    queries,
    total: products.length,
    visible: product === null ? 0 : 1,
    searchActive: false,
    filterActive: products.length > 0,
  });

  const [formKind, setFormKind] = useState<ProductFormKind>(null);
  const [activeSku, setActiveSku] = useState<Sku | undefined>(undefined);

  /* Follow the loaded product: navigating prev/next must not leave the drawer
     bound to the SKU of the product the user just left. */
  useEffect(() => {
    setActiveSku(product?.skus[0] ?? undefined);
    setFormKind(null);
  }, [product]);

  const index = products.findIndex((item) => item.productId === productId);
  const step = (delta: number): void => {
    if (products.length === 0) return;
    const next = products[(index + delta + products.length) % products.length];
    if (next !== undefined) void navigate(`/products/${next.productId}`);
  };

  const firstSku = product?.skus[0];

  return (
    <ScreenFrame
      status={status}
      onRetry={refetch}
      onClearFilters={() => void navigate('/products')}
      skeleton={
        <div className="px-10 pb-22 pt-12 sm:px-14">
          <SkeletonTable rows={5} />
        </div>
      }
    >
    {product !== null && (
    <div className="flex flex-col gap-12 px-10 pb-22 pt-12 sm:px-14">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-col gap-9 text-xs-plus text-faint lg:flex-row lg:items-center"
      >
        <div className="flex min-w-0 items-center gap-8">
          <button
            type="button"
            onClick={() => void navigate('/overview')}
            className="tap hidden cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-acc-dim xs:block"
          >
            {t('nOverview')}
          </button>
          <ChevronRight aria-hidden className="hidden size-9 shrink-0 xs:block" />
          <button
            type="button"
            onClick={() => void navigate('/products')}
            className="tap cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-acc-dim"
          >
            {t('nProducts')}
          </button>
          <ChevronRight aria-hidden className="size-9 shrink-0" />
          <span aria-current="page" className="min-w-0 truncate text-text">
            {product.sku}
          </span>
        </div>

        <div className="hidden flex-1 lg:block" />

        <div className="flex flex-wrap items-center gap-8">
          <Button
            variant="primary"
            size="sm"
            icon={<ChevronLeft aria-hidden className="size-11" />}
            onClick={() => void navigate('/products')}
          >
            {t('backList')}
          </Button>
          <Button size="sm" onClick={() => step(-1)}>
            {t('prev')}
          </Button>
          <Button size="sm" onClick={() => step(1)}>
            {t('next')}
          </Button>
        </div>
      </nav>

      {/* Three columns at `lg` — thumbnail, facts, actions — collapsing to a
          single stack below it. The action column in particular has to move:
          three full-width buttons at the bottom of the card are reachable,
          three narrow ones squeezed beside the facts are not. */}
      <Panel className="flex flex-col gap-12 p-11 sm:p-14 lg:flex-row lg:gap-14">
        <div className="flex items-start gap-12 lg:contents">
          <div className="flex size-64 shrink-0 items-center justify-center rounded-9 border border-dashed border-line-2 bg-grid text-faint sm:size-82">
            <ImageIcon aria-hidden className="size-20 sm:size-24" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-8">
            <div className="flex flex-wrap items-center gap-8">
              <h1 className="m-0 text-lg font-medium tracking-[-0.02em] sm:text-xl">
                {product.name}
              </h1>
              <span className="rounded-5 border border-line-2 px-6 py-px text-mini text-faint">
                {product.sku}
              </span>
              <Pill tone="accent">{product.rank}</Pill>
              <Pill tone={product.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {product.status}
              </Pill>
            </div>

            <dl className="m-0 grid grid-cols-2 gap-x-16 gap-y-9 sm:grid-cols-3 lg:flex lg:flex-wrap lg:gap-20">
              <Fact label={t('cPrice')} value={formatNumber(product.price)} />
              <Fact label={t('cPurchase')} value={formatNumber(product.purchasePrice)} />
              <Fact label={t('cTurnover')} value={formatNumber(product.turnover)} />
              <Fact label={t('cSold')} value={String(product.sold)} />
              <Fact label={t('cReturns')} value={`${product.returnedPct}%`} />
              <Fact label={t('cActive')} value={String(product.quantityActive)} />
            </dl>
          </div>
        </div>

        <div className="flex flex-col gap-7 border-t border-line pt-11 sm:flex-row sm:flex-wrap lg:shrink-0 lg:flex-col lg:flex-nowrap lg:justify-center lg:gap-6 lg:border-t-0 lg:pt-0">
          <Button
            variant="primary"
            size="lg"
            className="w-full sm:w-auto sm:flex-1 lg:w-full lg:flex-none"
            disabled={firstSku === undefined}
            icon={<Zap aria-hidden className="size-12" />}
            onClick={() => setFormKind('price')}
          >
            {t('priceFix')}
          </Button>

          <Button
            size="lg"
            className="w-full sm:w-auto sm:flex-1 lg:w-full lg:flex-none"
            disabled={firstSku === undefined}
            icon={<Layers aria-hidden className="size-12" />}
            onClick={() => setFormKind('stock')}
          >
            {t('updStock')}
          </Button>

          <Button
            size="lg"
            className="w-full sm:w-auto sm:flex-1 lg:w-full lg:flex-none"
            disabled={firstSku === undefined}
            icon={<Barcode aria-hidden className="size-12" />}
            onClick={() => setFormKind('labels')}
          >
            {t('printLabels')}
          </Button>
        </div>
      </Panel>

      <SkuTable product={product} onEditSku={(sku) => {
        setActiveSku(sku);
        setFormKind('price');
      }} />

      {activeSku !== undefined && (
        <ProductFormDrawer
          kind={formKind}
          product={product}
          sku={activeSku}
          onClose={() => setFormKind(null)}
        />
      )}
    </div>
    )}
    </ScreenFrame>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-px">
      <dt className="truncate text-meta uppercase tracking-[0.09em] text-faint">{label}</dt>
      <dd data-numeric className="m-0 truncate text-md sm:text-lg">
        {value}
      </dd>
    </div>
  );
}

/**
 * The SKU rows.
 *
 * Six columns, five of them numeric and one an untruncatable barcode. Below
 * `lg` each row becomes a card: the SKU title and its identifiers head it, and
 * the five figures sit underneath as a labelled grid. Either way the row is
 * the same button and opens the same price form.
 */
function SkuTable({
  product,
  onEditSku,
}: {
  readonly product: Product;
  readonly onEditSku: (sku: Sku) => void;
}): ReactNode {
  const { t } = useTranslation();
  const columns = 'grid grid-cols-[minmax(0,1.7fr)_repeat(5,minmax(0,1fr))] gap-x-8';

  return (
    <Panel className="flex flex-col gap-9 px-11 py-13 sm:px-14">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <h2 className="m-0 text-base font-medium">{t('skuList')}</h2>
        <span className="min-w-0 truncate font-mono text-tiny text-faint">{t('skuListSub')}</span>
        <div className="hidden flex-1 sm:block" />
        <span className="ml-auto text-mini text-faint sm:ml-0">{product.skus.length} SKU</span>
      </div>

      <div
        className={`${columns} hidden border-b border-line pb-6 text-meta uppercase tracking-[0.08em] text-faint lg:grid`}
      >
        <span>{t('cSkuTitle')}</span>
        <span className="text-right">{t('cPrice')}</span>
        <span className="text-right">{t('cPurchase')}</span>
        <span className="text-right">{t('cActive')}</span>
        <span className="text-right">{t('cFbs')}</span>
        <span className="text-right">{t('cSold')}</span>
      </div>

      {product.skus.map((sku) => {
        const facts: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
          { label: t('cPrice'), value: formatNumber(sku.price) },
          { label: t('cPurchase'), value: formatNumber(sku.purchasePrice) },
          { label: t('cActive'), value: String(sku.quantityActive) },
          { label: t('cFbs'), value: String(sku.quantityFbs) },
          { label: t('cSold'), value: String(sku.quantitySold) },
        ];

        return (
          <button
            key={sku.skuId}
            type="button"
            onClick={() => onEditSku(sku)}
            data-numeric
            className="cursor-pointer rounded-8 border-0 border-b border-line bg-transparent text-left text-xs-plus hover:bg-acc-soft"
          >
            {/* — card, below `lg` — */}
            <span className="flex flex-col gap-8 py-10 lg:hidden">
              <span className="flex min-w-0 flex-col leading-[1.3]">
                <span className="truncate text-sm-plus">{sku.skuTitle}</span>
                <span className="truncate font-mono text-tiny text-faint">
                  skuId {sku.skuId} · {sku.barcode}
                </span>
              </span>

              <span className="grid grid-cols-3 gap-x-12 gap-y-7 sm:grid-cols-5">
                {facts.map((fact) => (
                  <span key={fact.label} className="flex min-w-0 flex-col gap-px">
                    <span className="truncate text-meta uppercase tracking-[0.08em] text-faint">
                      {fact.label}
                    </span>
                    <span className="truncate text-sm">{fact.value}</span>
                  </span>
                ))}
              </span>
            </span>

            {/* — the dense grid, `lg` and up — */}
            <span className={`${columns} hidden items-center py-7 lg:grid`}>
              <span className="flex min-w-0 flex-col leading-[1.3]">
                <span className="truncate">{sku.skuTitle}</span>
                <span className="truncate font-mono text-tiny text-faint">
                  skuId {sku.skuId} · {sku.barcode}
                </span>
              </span>
              {facts.map((fact, index) => (
                <span
                  key={fact.label}
                  className={index === 0 ? 'truncate text-right' : 'truncate text-right text-dim'}
                >
                  {fact.value}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </Panel>
  );
}
