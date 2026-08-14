import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { buildOverview, type OverviewSummary } from '@/services/derive/overview';
import { toProducts } from '@/services/derive/products';
import { usePreferencesStore } from '@/store/preferences.store';

import { comparisonQuery, expensesQuery, financeQuery, productsQuery } from './sources';
import { useScope, useScopeReady } from './useScope';

/**
 * The overview screen's data.
 *
 * Three sources feed it and all three are returned alongside the derived
 * summary, because the screen has to know *which* of them failed to render the
 * right state — a finance outage and a catalogue outage are not the same
 * screen.
 */
export interface OverviewData {
  readonly summary: OverviewSummary | null;
  readonly queries: readonly UseQueryResult<unknown>[];
  readonly refetch: () => void;
}

export function useOverviewQuery(): OverviewData {
  const scope = useScope();
  const ready = useScopeReady(scope);
  const language = usePreferencesStore((state) => state.language);

  const finance = useQuery(financeQuery(scope, ready));
  const expenses = useQuery(expensesQuery(scope, ready));
  const products = useQuery(productsQuery(scope, ready));

  /* Read the previous period only once this one has landed: there is nothing
     to compare against until then, and the two reads together are the most
     expensive thing the app does. */
  const comparison = useQuery(comparisonQuery(scope, ready && finance.data !== undefined));

  const summary = useMemo<OverviewSummary | null>(() => {
    if (finance.data === undefined) return null;

    return buildOverview({
      items: finance.data.items,
      reportedTotal: finance.data.total,
      cancelledTotal: finance.data.cancelledTotal,
      truncated: finance.data.truncated,
      payments: expenses.data?.payments ?? [],
      products: toProducts(products.data?.products ?? []),
      window: { fromMs: scope.fromMs, toMs: scope.toMs },
      language,
      /* Undefined until it arrives — a tile with no comparison shows no delta
         rather than a made-up one. */
      previous:
        comparison.data === undefined
          ? undefined
          : { items: comparison.data.items, payments: comparison.data.payments },
    });
  }, [comparison.data, expenses.data, finance.data, language, products.data, scope.fromMs, scope.toMs]);

  return useMemo<OverviewData>(
    () => ({
      summary,
      queries: [finance, expenses, products],
      refetch: () => {
        void finance.refetch();
        void expenses.refetch();
        void products.refetch();
      },
    }),
    [expenses, finance, products, summary],
  );
}
