import type { OwnedProduct } from '@/services/queries/sources';
import type { ProductSku } from '@/services/uzum/types';
import type { Product, ProductStatus, RankBucket, Sku } from '@/types/domain';

/**
 * Catalogue rows, from `GET /v1/product/shop/{shopId}`.
 *
 * A product carries lifetime counters (`quantitySold`, `quantityReturned`) and
 * a per-SKU price list. Nothing here is invented: where the API returns null —
 * `purchasePrice` is optional and frequently unset — the derived figure is 0
 * and the column shows a dash rather than a plausible-looking number.
 */

const KNOWN_STATUSES: readonly ProductStatus[] = [
  'ACTIVE',
  'INACTIVE',
  'RUN_OUT',
  'ARCHIVED',
  'DEFECTED',
  'WARNING',
];

function narrowStatus(value: string | undefined): ProductStatus {
  const upper = (value ?? '').toUpperCase();
  return KNOWN_STATUSES.find((status) => status === upper) ?? 'INACTIVE';
}

function toSku(sku: ProductSku): Sku {
  return {
    skuId: sku.skuId,
    skuTitle: sku.skuFullTitle ?? sku.skuTitle ?? String(sku.skuId),
    barcode: sku.barcode === null ? '' : String(sku.barcode),
    characteristics: sku.characteristics ?? '',
    price: sku.price ?? 0,
    purchasePrice: sku.purchasePrice ?? 0,
    quantityAvailable: sku.quantityAvailable ?? 0,
    quantityActive: sku.quantityActive ?? 0,
    quantityFbs: sku.quantityFbs ?? 0,
    quantitySold: sku.quantitySold ?? 0,
    quantityReturned: sku.quantityReturned ?? 0,
  };
}

/** The cheapest live price across a product's SKUs — what the card sells at. */
function representativePrice(skus: readonly Sku[], fallback: number): number {
  const prices = skus.map((sku) => sku.price).filter((price) => price > 0);
  return prices.length === 0 ? fallback : Math.min(...prices);
}

function averagePurchasePrice(skus: readonly Sku[]): number {
  const set = skus.map((sku) => sku.purchasePrice).filter((price) => price > 0);
  if (set.length === 0) return 0;
  return set.reduce((sum, price) => sum + price, 0) / set.length;
}

export function toProduct(source: OwnedProduct): Product {
  const skus = (source.skuList ?? []).map(toSku);
  const price = representativePrice(skus, source.price ?? 0);
  const purchasePrice = averagePurchasePrice(skus);
  const sold = source.quantitySold ?? 0;

  return {
    productId: source.productId,
    shopId: source.shopId,
    sku: String(source.productId),
    name: source.title,
    price,
    purchasePrice,
    turnover: price * sold,
    sold,
    returnedPct: Math.round((source.returnedPercentage ?? 0) * 10) / 10,
    quantityAvailable: source.quantityAvailable ?? 0,
    quantityActive: source.quantityActive ?? 0,
    quantityFbs: source.quantityFbs ?? 0,
    rank: source.rankInfo?.rank ?? '—',
    status: narrowStatus(source.status?.value),
    statusTitle: source.status?.title ?? source.status?.value ?? '',
    skus,
  };
}

export function toProducts(sources: readonly OwnedProduct[]): readonly Product[] {
  return sources.map(toProduct);
}

/**
 * Portfolio buckets by product status.
 *
 * Ordered by size so the biggest bucket is not buried under a fixed status
 * list, and labelled with the API's own title.
 */
export function buildStatusBuckets(products: readonly Product[]): readonly RankBucket[] {
  const counts = new Map<string, { label: string; count: number }>();

  for (const product of products) {
    const existing = counts.get(product.status);
    if (existing === undefined) {
      counts.set(product.status, {
        label: product.statusTitle === '' ? product.status : product.statusTitle,
        count: 1,
      });
    } else {
      existing.count += 1;
    }
  }

  return [...counts.entries()]
    .map(([code, entry]) => ({ key: code, code, label: entry.label, count: entry.count }))
    .sort((a, b) => b.count - a.count);
}

/** SKU rows across every product — the unit the stocks screen works in. */
export interface CatalogueSku extends Sku {
  readonly productId: number;
  readonly shopId: number;
  readonly productTitle: string;
  readonly status: ProductStatus;
}

export function flattenSkus(products: readonly Product[]): readonly CatalogueSku[] {
  return products.flatMap((product) =>
    product.skus.map((sku) => ({
      ...sku,
      productId: product.productId,
      shopId: product.shopId,
      productTitle: product.name,
      status: product.status,
    })),
  );
}
