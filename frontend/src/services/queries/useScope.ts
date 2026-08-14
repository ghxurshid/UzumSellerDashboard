import { useMemo } from 'react';

import type { Scope } from '@/services/api/queryKeys';
import { ALL_STORES, useFiltersStore } from '@/store/filters.store';

import { useShops } from './useConnection';

/**
 * The scope every data query is keyed by: which shops, over which window.
 *
 * Shop ids come from the account, not from a hardcoded list — until
 * `GET /v1/shops` has answered, the scope is empty and every dependent query
 * stays disabled rather than asking Uzum about shops that may not exist.
 */
export function useScope(): Scope {
  const storeKey = useFiltersStore((state) => state.storeKey);
  const rangeKey = useFiltersStore((state) => state.rangeKey);
  const fromMs = useFiltersStore((state) => state.windowFromMs);
  const toMs = useFiltersStore((state) => state.windowToMs);
  const shops = useShops();

  const shopIds = useMemo<readonly number[]>(() => {
    if (storeKey === ALL_STORES) return shops.map((shop) => shop.id);
    const selected = Number(storeKey);
    /* A stored selection can outlive the shop it names — fall back to the
       whole account rather than querying an id this token cannot see. */
    if (!Number.isFinite(selected)) return shops.map((shop) => shop.id);
    return shops.some((shop) => shop.id === selected)
      ? [selected]
      : shops.map((shop) => shop.id);
  }, [shops, storeKey]);

  return useMemo<Scope>(
    () => ({ storeKey, shopIds, rangeKey, fromMs, toMs }),
    [fromMs, rangeKey, shopIds, storeKey, toMs],
  );
}

/** True once the scope names at least one shop — the gate every source query uses. */
export function useScopeReady(scope: Scope): boolean {
  return scope.shopIds.length > 0;
}
