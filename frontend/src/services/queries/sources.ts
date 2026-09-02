import { queryOptions } from '@tanstack/react-query';

import { queryKeys, type Scope } from '@/services/api/queryKeys';
import {
  readExpenses,
  readFinance,
  readInvoices,
  readOrders,
  readProducts,
  readStocks,
  type ExpensesSource,
  type FinanceSource,
  type InvoicesSource,
  type OrdersSource,
  type OwnedProduct,
  type ProductsSource,
  type StocksSource,
} from '@/services/data/collections';
import type { SourceProgressReporter } from '@/services/queries/progress';
import { fetchShops } from '@/services/uzum/endpoints';
import type { SellerPayment, UzumShop } from '@/services/uzum/types';

/**
 * The six sources, as React Query descriptions of a read.
 *
 * Everything about *where the data comes from* now lives in
 * `services/data/collections.ts`: one door, normalised tables underneath, and a
 * `sync` flag that says whether this particular read may go to the network.
 * What is left here is the query layer's own concern — keys, enablement and
 * deduplication — which is why these functions are short.
 *
 * `staleTime: Infinity` says the same thing it always did, and now means it
 * literally: React Query never decides on its own that something needs
 * refetching, because the only thing that fetches is a call that passed
 * `sync: true`. What it still provides is deduplication of concurrent readers,
 * loading and error states, and per-scope keying.
 */

/**
 * The ids live in their own leaf module — see `sourceIds.ts` — because the sync
 * store needs them too, and the collections layer needs the sync store.
 * Re-exported here so every existing import keeps working.
 */
export { SOURCE_IDS, type SourceId } from './sourceIds';

export { archivedFrom } from '@/services/data/collections';
export type {
  ExpensesSource,
  FinanceSource,
  InvoicesSource,
  OrdersSource,
  OwnedProduct,
  ProductsSource,
  StocksSource,
  UzumShop,
};

/**
 * What a screen decides about one read.
 *
 * `sync` is the flag this whole layer exists to expose. It is off by default,
 * so a query that does not name it is a pure read of IndexedDB — no request, no
 * rate-limit budget, no failure mode beyond storage itself. A screen that wants
 * the missing part of a period fetched asks for it here, in one word, where the
 * next reader of the code will see it.
 *
 * **`sync` is not part of the query key, deliberately.** Two callers asking for
 * the same source and scope are asking the same question, and giving them
 * separate cache entries would fetch the same rows twice and then let them
 * disagree. So one query is created and whichever caller mounts first decides
 * whether it fetches. That is the intended arrangement: the screen owns the
 * sync decision for its scope, and a secondary reader — the insights rail, say
 * — takes the default and is served the same result.
 */
export interface SourceQueryOptions {
  readonly enabled?: boolean;
  /** Fetch what the archive is missing before answering. Defaults to `false`. */
  readonly sync?: boolean;
  /** Re-read even what looks current — the sync button, never a screen. */
  readonly force?: boolean;
  readonly onProgress?: SourceProgressReporter;
}

const base = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: 30 * 60 * 1_000,
  retry: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
} as const;

/** Turn a screen's options into the collection layer's, adding the signal. */
const read = (options: SourceQueryOptions, signal: AbortSignal | undefined) => ({
  sync: options.sync ?? false,
  force: options.force,
  onProgress: options.onProgress,
  signal,
});

/* ── shops ──────────────────────────────────────────────────────────────── */

export const shopsQuery = () =>
  queryOptions({
    queryKey: queryKeys.shops,
    queryFn: ({ signal }) => fetchShops({ signal }),
    ...base,
    staleTime: 60 * 60 * 1_000,
    /* The one query that still goes straight to the API on mount: it is the
       connection probe, and a stored answer would let a revoked token look
       connected. One cheap call an hour buys that. */
    refetchOnMount: true,
  });

/* ── catalogue and stock ────────────────────────────────────────────────── */

export const productsQuery = (scope: Scope, options: SourceQueryOptions = {}) =>
  queryOptions({
    queryKey: queryKeys.source.products(scope),
    enabled: options.enabled ?? true,
    queryFn: ({ signal }): Promise<ProductsSource> =>
      readProducts(scope, read(options, signal)),
    ...base,
  });

/**
 * FBS amounts, which belong to the account rather than to a shop.
 *
 * Keyed per account for that reason: `/v3/fbs/sku/stocks` takes no shop id and
 * answers the same rows whichever chip is selected.
 */
export const stocksQuery = (scope: Scope, options: SourceQueryOptions = {}) =>
  queryOptions({
    queryKey: queryKeys.source.stocks(),
    enabled: options.enabled ?? true,
    queryFn: ({ signal }): Promise<StocksSource> => readStocks(scope, read(options, signal)),
    ...base,
  });

/* ── settled history ────────────────────────────────────────────────────── */

export const financeQuery = (scope: Scope, options: SourceQueryOptions = {}) =>
  queryOptions({
    queryKey: queryKeys.source.finance(scope),
    enabled: options.enabled ?? true,
    queryFn: ({ signal }): Promise<FinanceSource> => readFinance(scope, read(options, signal)),
    ...base,
  });

export const expensesQuery = (scope: Scope, options: SourceQueryOptions = {}) =>
  queryOptions({
    queryKey: queryKeys.source.expenses(scope),
    enabled: options.enabled ?? true,
    queryFn: ({ signal }): Promise<ExpensesSource> => readExpenses(scope, read(options, signal)),
    ...base,
  });

/**
 * The window immediately before the selected one.
 *
 * Synced, because a comparison against a period nobody has looked at would
 * otherwise read as a fall to zero — but silently, since the user asked for the
 * current period and a log row for the previous one would be work they did not
 * request. Expenses come back for free: the plan covers all four windowed
 * entities, so the ledger's fetch has already filled them.
 */
export const comparisonQuery = (scope: Scope, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.source.comparison(scope),
    enabled,
    queryFn: async ({
      signal,
    }): Promise<FinanceSource & { payments: readonly SellerPayment[] }> => {
      const span = scope.toMs - scope.fromMs;
      const previous: Scope = { ...scope, fromMs: scope.fromMs - span, toMs: scope.fromMs };

      const finance = await readFinance(previous, { sync: true, silent: true, signal });
      const expenses = await readExpenses(previous, { silent: true, signal });

      return { ...finance, payments: expenses.payments };
    },
    ...base,
  });

/* ── orders and invoices ────────────────────────────────────────────────── */

export const ordersQuery = (scope: Scope, options: SourceQueryOptions = {}) =>
  queryOptions({
    queryKey: queryKeys.source.orders(scope),
    enabled: options.enabled ?? true,
    queryFn: ({ signal }): Promise<OrdersSource> => readOrders(scope, read(options, signal)),
    ...base,
  });

/** Supply invoices, warehouse returns and FBS shipments — three tables, one read. */
export const invoicesQuery = (scope: Scope, options: SourceQueryOptions = {}) =>
  queryOptions({
    queryKey: queryKeys.source.invoices(),
    enabled: options.enabled ?? true,
    queryFn: ({ signal }): Promise<InvoicesSource> => readInvoices(scope, read(options, signal)),
    ...base,
  });
