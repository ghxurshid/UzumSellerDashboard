import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { Scope } from '@/services/api/queryKeys';
import {
  loadExpenseTotals,
  loadProductTotals,
  loadSeries,
} from '@/services/storage/idb/analytics.client';
import type {
  ExpenseTotals,
  Granularity,
  ProductTotal,
  SeriesResult,
} from '@/services/storage/idb/aggregation';
import { ensureWindowAcross } from '@/services/sync/lazySync';

/**
 * Period analytics, off the main thread.
 *
 * This is the read path built for the two consumers the storage design exists
 * to serve — performance-critical charts, and AI analysis over time intervals —
 * and it composes the three mechanisms underneath into one call:
 *
 *   1. **Lazy sync.** `sync_metadata` is consulted first. If the window is held
 *      in full, nothing is fetched; if part of it is missing, only that part is
 *      requested and written before the read happens.
 *   2. **A bounded index range.** The rows are found through
 *      `['store_id', 'entity_type', 'timestamp']`, so the cursor opens on the
 *      first row of the window and stops at the last.
 *   3. **A worker.** The folding happens off the thread that draws, and only the
 *      finished summary crosses back.
 *
 * The result is that asking for a year of history does not allocate a year of
 * rows on the main thread, and does not block a frame while it sums them.
 *
 * ## Why this is a query rather than a hook with an effect
 *
 * Deduplication and cancellation. Two panels asking for the same window share
 * one job, and a range change aborts the one it replaces through the query's own
 * signal — which the analytics client honours by discarding the reply rather
 * than pretending it can interrupt a cursor mid-walk.
 *
 * `staleTime: Infinity` for the same reason the source queries use it: freshness
 * is decided by coverage, not by a timer. A window whose rows are already held
 * does not become wrong with age — the settlement lag re-opens the recent tail
 * on the next lazy sync, and that is the only thing that can change it.
 */

const base = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: 30 * 60 * 1_000,
  retry: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
} as const;

const key = (kind: string, scope: Scope, extra: unknown = null) =>
  [
    'archive',
    kind,
    [...scope.shopIds].sort((a, b) => a - b).join(','),
    scope.fromMs,
    scope.toMs,
    extra,
  ] as const;

/**
 * Fill the window if it is not held, then read it.
 *
 * Every hook below opens with this. The fill is a no-op on the common path — one
 * keyed read of `sync_metadata` and no request at all — which is what makes it
 * safe to put in front of every analytics read rather than only the first.
 */
async function ready(scope: Scope, signal: AbortSignal | undefined): Promise<void> {
  await ensureWindowAcross({
    shopIds: scope.shopIds,
    window: { fromMs: scope.fromMs, toMs: scope.toMs },
    signal,
  });
}

/**
 * The revenue/units/profit series for the current scope.
 *
 * Buckets are gap-free and sized to the window, so a day with no sales is a zero
 * rather than a missing point — which is what lets a chart draw a flat stretch
 * instead of interpolating across it. The granularity is chosen from the window
 * unless one is named.
 */
export function useArchiveSeries(
  scope: Scope,
  options: { readonly enabled?: boolean; readonly granularity?: Granularity } = {},
): UseQueryResult<SeriesResult> {
  return useQuery({
    queryKey: key('series', scope, options.granularity ?? 'auto'),
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }): Promise<SeriesResult> => {
      await ready(scope, signal);
      return loadSeries(scope.shopIds, scope.fromMs, scope.toMs, {
        ...(options.granularity !== undefined ? { granularity: options.granularity } : {}),
        signal,
      });
    },
    ...base,
  });
}

/** Products ranked by revenue over the window, biggest first. */
export function useArchiveProducts(
  scope: Scope,
  options: { readonly enabled?: boolean; readonly limit?: number } = {},
): UseQueryResult<readonly ProductTotal[]> {
  const limit = options.limit ?? 20;

  return useQuery({
    queryKey: key('products', scope, limit),
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }): Promise<readonly ProductTotal[]> => {
      await ready(scope, signal);
      return loadProductTotals(scope.shopIds, scope.fromMs, scope.toMs, { limit, signal });
    },
    ...base,
  });
}

/** Net cash movement and the biggest outgoings over the window. */
export function useArchiveExpenses(
  scope: Scope,
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<ExpenseTotals> {
  return useQuery({
    queryKey: key('expenses', scope),
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }): Promise<ExpenseTotals> => {
      await ready(scope, signal);
      return loadExpenseTotals(scope.shopIds, scope.fromMs, scope.toMs, { signal });
    },
    ...base,
  });
}

export type { ExpenseTotals, Granularity, ProductTotal, SeriesResult };
