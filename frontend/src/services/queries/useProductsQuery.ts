import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { toProducts } from '@/services/derive/products';
import type { Product } from '@/types/domain';

import { productsQuery } from './sources';
import { useScope, useScopeReady } from './useScope';

export interface ProductsData {
  readonly products: readonly Product[];
  /** What the catalogue endpoint says exists, which can exceed what was read. */
  readonly total: number;
  readonly truncated: boolean;
  readonly queries: readonly UseQueryResult<unknown>[];
  readonly refetch: () => void;
}

export function useProductsQuery(): ProductsData {
  const scope = useScope();
  const ready = useScopeReady(scope);
  const query = useQuery(productsQuery(scope, ready));

  const products = useMemo(
    () => toProducts(query.data?.products ?? []),
    [query.data],
  );

  return useMemo<ProductsData>(
    () => ({
      products,
      total: query.data?.total ?? 0,
      truncated: query.data?.truncated ?? false,
      queries: [query],
      refetch: () => void query.refetch(),
    }),
    [products, query],
  );
}

/** One product out of the catalogue already in cache — no extra request. */
export function useProduct(productId: number): {
  readonly product: Product | null;
  readonly queries: readonly UseQueryResult<unknown>[];
  readonly refetch: () => void;
} {
  const { products, queries, refetch } = useProductsQuery();

  return useMemo(
    () => ({
      product: products.find((entry) => entry.productId === productId) ?? null,
      queries,
      refetch,
    }),
    [productId, products, queries, refetch],
  );
}
