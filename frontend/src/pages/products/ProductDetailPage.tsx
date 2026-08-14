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
        <div className="px-14 pb-22 pt-12">
          <SkeletonTable rows={5} />
        </div>
      }
    >
    {product !== null && (
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
        <button
          type="button"
          onClick={() => void navigate('/products')}
          className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-acc-dim"
        >
          {t('nProducts')}
        </button>
        <ChevronRight aria-hidden className="size-9" />
        <span aria-current="page" className="text-text">
          {product.sku}
        </span>

        <div className="flex-1" />

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
      </nav>

      <Panel className="flex gap-14 p-14">
        <div className="flex size-82 shrink-0 items-center justify-center rounded-9 border border-dashed border-line-2 bg-grid text-faint">
          <ImageIcon aria-hidden className="size-24" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <div className="flex flex-wrap items-center gap-9">
            <h1 className="text-xl font-medium tracking-[-0.02em]">{product.name}</h1>
            <span className="rounded-5 border border-line-2 px-6 py-px text-mini text-faint">
              {product.sku}
            </span>
            <Pill tone="accent">{product.rank}</Pill>
            <Pill tone={product.status === 'ACTIVE' ? 'positive' : 'neutral'}>{product.status}</Pill>
          </div>

          <dl className="flex flex-wrap gap-20">
            <Fact label={t('cPrice')} value={formatNumber(product.price)} />
            <Fact label={t('cPurchase')} value={formatNumber(product.purchasePrice)} />
            <Fact label={t('cTurnover')} value={formatNumber(product.turnover)} />
            <Fact label={t('cSold')} value={String(product.sold)} />
            <Fact label={t('cReturns')} value={`${product.returnedPct}%`} />
            <Fact label={t('cActive')} value={String(product.quantityActive)} />
          </dl>
        </div>

        <div className="flex shrink-0 flex-col justify-center gap-6">
          <Button
            variant="primary"
            size="lg"
            disabled={firstSku === undefined}
            icon={<Zap aria-hidden className="size-12" />}
            onClick={() => setFormKind('price')}
          >
            {t('priceFix')}
          </Button>

          <Button
            size="lg"
            disabled={firstSku === undefined}
            icon={<Layers aria-hidden className="size-12" />}
            onClick={() => setFormKind('stock')}
          >
            {t('updStock')}
          </Button>

          <Button
            size="lg"
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
    <div className="flex flex-col gap-px">
      <dt className="text-meta uppercase tracking-[0.09em] text-faint">{label}</dt>
      <dd data-numeric className="m-0 text-lg">
        {value}
      </dd>
    </div>
  );
}

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
    <Panel className="flex flex-col gap-9 px-14 py-13">
      <div className="flex items-center gap-8">
        <h2 className="text-base font-medium">{t('skuList')}</h2>
        <span className="font-mono text-tiny text-faint">{t('skuListSub')}</span>
        <div className="flex-1" />
        <span className="text-mini text-faint">{product.skus.length} SKU</span>
      </div>

      <div
        className={`${columns} border-b border-line pb-6 text-meta uppercase tracking-[0.08em] text-faint`}
      >
        <span>{t('cSkuTitle')}</span>
        <span className="text-right">{t('cPrice')}</span>
        <span className="text-right">{t('cPurchase')}</span>
        <span className="text-right">{t('cActive')}</span>
        <span className="text-right">{t('cFbs')}</span>
        <span className="text-right">{t('cSold')}</span>
      </div>

      {product.skus.map((sku) => (
        <button
          key={sku.skuId}
          type="button"
          onClick={() => onEditSku(sku)}
          data-numeric
          className={`${columns} cursor-pointer items-center rounded-6 border-0 border-b border-line bg-transparent py-7 text-left text-xs-plus hover:bg-acc-soft`}
        >
          <span className="flex min-w-0 flex-col leading-[1.3]">
            <span className="truncate">{sku.skuTitle}</span>
            <span className="font-mono text-tiny text-faint">
              skuId {sku.skuId} · {sku.barcode}
            </span>
          </span>
          <span className="text-right">{formatNumber(sku.price)}</span>
          <span className="text-right text-dim">{formatNumber(sku.purchasePrice)}</span>
          <span className="text-right text-dim">{sku.quantityActive}</span>
          <span className="text-right text-dim">{sku.quantityFbs}</span>
          <span className="text-right text-dim">{sku.quantitySold}</span>
        </button>
      ))}
    </Panel>
  );
}
