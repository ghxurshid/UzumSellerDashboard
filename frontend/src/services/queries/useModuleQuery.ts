import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { toProducts } from '@/services/derive/products';
import {
  buildFinanceModule,
  buildInventoryModule,
  buildInvoicesModule,
  buildOpsModule,
} from '@/services/derive/modules';
import { usePreferencesStore } from '@/store/preferences.store';
import type { ModuleDefinition, ModuleKey } from '@/types/domain';

import {
  expensesQuery,
  financeQuery,
  invoicesQuery,
  ordersQuery,
  productsQuery,
  stocksQuery,
} from './sources';
import { useConnection } from './useConnection';
import { useScope, useScopeReady } from './useScope';

/**
 * Data for one of the four table screens.
 *
 * Only the sources a screen actually needs are enabled. That is not an
 * optimisation for its own sake: the seller API is rate-limited per hour, and
 * opening the finance tab should not spend budget reading warehouse returns.
 */
export interface ModuleData {
  readonly definition: ModuleDefinition | null;
  readonly queries: readonly UseQueryResult<unknown>[];
  readonly refetch: () => void;
}

export function useModuleQuery(key: ModuleKey): ModuleData {
  const scope = useScope();
  const ready = useScopeReady(scope);
  const language = usePreferencesStore((state) => state.language);
  const { shops } = useConnection();

  const needsCatalogue = key === 'inventory';
  const needsFinance = key === 'ops' || key === 'finance';
  const needsExpenses = key === 'finance';
  const needsOrders = key === 'ops';
  const needsInvoices = key === 'invoices';

  const products = useQuery(productsQuery(scope, ready && needsCatalogue));
  const stocks = useQuery(stocksQuery(ready && needsCatalogue, scope));
  const finance = useQuery(financeQuery(scope, ready && needsFinance));
  const expenses = useQuery(expensesQuery(scope, ready && needsExpenses));
  const orders = useQuery(ordersQuery(scope, ready && needsOrders));
  const invoices = useQuery(invoicesQuery(ready && needsInvoices, scope));

  const shopNames = useMemo(
    () => new Map(shops.map((shop) => [shop.id, shop.name])),
    [shops],
  );

  const active = useMemo<readonly UseQueryResult<unknown>[]>(() => {
    switch (key) {
      case 'inventory':
        return [products, stocks];
      case 'ops':
        return [finance, orders];
      case 'invoices':
        return [invoices];
      case 'finance':
        return [finance, expenses];
    }
  }, [expenses, finance, invoices, key, orders, products, stocks]);

  const definition = useMemo<ModuleDefinition | null>(() => {
    switch (key) {
      case 'inventory':
        if (products.data === undefined) return null;
        return buildInventoryModule({
          products: toProducts(products.data.products),
          stocks: stocks.data,
          language,
        });

      case 'ops':
        if (finance.data === undefined) return null;
        return buildOpsModule({ finance: finance.data, orders: orders.data, shopNames, language });

      case 'invoices':
        if (invoices.data === undefined) return null;
        return buildInvoicesModule({ invoices: invoices.data, language });

      case 'finance':
        if (finance.data === undefined) return null;
        return buildFinanceModule({ finance: finance.data, expenses: expenses.data, language });
    }
  }, [expenses.data, finance.data, invoices.data, key, language, orders.data, products.data, shopNames, stocks.data]);

  return useMemo<ModuleData>(
    () => ({
      definition,
      queries: active,
      refetch: () => {
        for (const query of active) void query.refetch();
      },
    }),
    [active, definition],
  );
}
