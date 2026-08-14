import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { summariseFinance } from '@/services/derive/finance';
import { buildInsights } from '@/services/derive/insights';
import { toProducts } from '@/services/derive/products';
import type { Insight } from '@/types/domain';

import { expensesQuery, financeQuery, invoicesQuery, productsQuery, stocksQuery } from './sources';
import { useScope, useScopeReady } from './useScope';

/**
 * Insights over whatever is already in cache.
 *
 * This adds no requests of its own beyond the sources the screens already read
 * — the rail is a view of the same data, not a second opinion fetched from
 * somewhere else. Until those sources land it has nothing to say, and says so.
 */
export interface InsightsData {
  readonly insights: readonly Insight[];
  readonly queries: readonly UseQueryResult<unknown>[];
  readonly pending: boolean;
}

export function useInsightsQuery(): InsightsData {
  const scope = useScope();
  const ready = useScopeReady(scope);

  const finance = useQuery(financeQuery(scope, ready));
  const expenses = useQuery(expensesQuery(scope, ready));
  const products = useQuery(productsQuery(scope, ready));
  /* Stocks and invoices are read only if a screen has already asked for them;
     the rail refines its findings when they arrive rather than forcing a read. */
  const stocks = useQuery(stocksQuery(false, scope));
  const invoices = useQuery(invoicesQuery(false, scope));

  const insights = useMemo<readonly Insight[]>(() => {
    if (finance.data === undefined) return [];

    const totals = summariseFinance(finance.data.items, expenses.data?.payments ?? [], {
      cancelledTotal: finance.data.cancelledTotal,
      reportedTotal: finance.data.total,
    });

    return buildInsights({
      totals,
      products: toProducts(products.data?.products ?? []),
      stocks: stocks.data,
      invoices: invoices.data,
    });
  }, [expenses.data, finance.data, invoices.data, products.data, stocks.data]);

  return useMemo<InsightsData>(
    () => ({
      insights,
      queries: [finance, expenses, products],
      pending: ready && finance.isPending,
    }),
    [expenses, finance, insights, products, ready],
  );
}
