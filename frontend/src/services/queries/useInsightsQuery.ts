import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { summariseFinance } from '@/services/derive/finance';
import { buildInsights } from '@/services/derive/insights';
import { toProducts } from '@/services/derive/products';
import { generateInsightCards } from '@/services/insights/ai';
import { SEVERITY_ORDER, type InsightCard } from '@/services/insights/blocks';
import { buildDigest, digestKey } from '@/services/insights/digest';
import { useAiSettings } from '@/store/settings.store';

import { expensesQuery, financeQuery, invoicesQuery, productsQuery, stocksQuery } from './sources';
import { useScope, useScopeReady } from './useScope';

/**
 * Insights over whatever is already in cache.
 *
 * This adds no requests of its own beyond the sources the screens already read
 * — the rail is a view of the same data, not a second opinion fetched from
 * somewhere else. Until those sources land it has nothing to say, and says so.
 *
 * ## Two authors, one list
 *
 * The rules run synchronously off the cached sources and are always present.
 * The model runs over the network, costs the user's own credits, and is
 * therefore treated as an enrichment: its cards arrive later, or never, and the
 * rail is complete without them. That ordering is deliberate — an analysis
 * panel whose contents depend on a third-party API being reachable is a panel
 * that is blank exactly when the seller most wants it.
 *
 * The model is asked once per *window of data*, not once per render. The query
 * key carries a fingerprint of the digest, so switching period or syncing new
 * rows asks again while re-rendering, re-opening the rail or toggling a filter
 * does not.
 */
export interface InsightsData {
  readonly cards: readonly InsightCard[];
  readonly queries: readonly UseQueryResult<unknown>[];
  readonly pending: boolean;
  /** True while the model is composing — the rail shows its rule cards meanwhile. */
  readonly aiPending: boolean;
}

export function useInsightsQuery(): InsightsData {
  const scope = useScope();
  const ready = useScopeReady(scope);
  const { language } = useTranslation();
  const ai = useAiSettings();

  /**
   * The three the rail cannot do without, synced.
   *
   * `sync` is not part of the query key, so one query exists per source and
   * scope and whichever caller mounts first decides whether it ever fetches. A
   * rail that mounted with `sync` off would therefore not merely go without —
   * it would answer the screen behind it out of an empty archive, and
   * `staleTime: Infinity` would keep that answer. Asking for the same sync the
   * screens ask for makes the mount order stop mattering.
   */
  const finance = useQuery(financeQuery(scope, { enabled: ready, sync: true }));
  const expenses = useQuery(expensesQuery(scope, { enabled: ready, sync: true }));
  const products = useQuery(productsQuery(scope, { enabled: ready, sync: true }));
  /* Stocks and invoices are read only if a screen has already asked for them;
     the rail refines its findings when they arrive rather than forcing a read.
     Safe where the three above are not: `enabled: false` creates no query, so
     no mount order can be decided by it. */
  const stocks = useQuery(stocksQuery(scope, { enabled: false }));
  const invoices = useQuery(invoicesQuery(scope, { enabled: false }));

  const derived = useMemo(() => {
    if (finance.data === undefined) return null;

    const totals = summariseFinance(finance.data.items, expenses.data?.payments ?? [], {
      cancelledTotal: finance.data.cancelledTotal,
      reportedTotal: finance.data.total,
    });

    const catalogue = toProducts(products.data?.products ?? []);
    const input = { totals, products: catalogue, invoices: invoices.data };

    return {
      digest: buildDigest(input),
      key: digestKey(input),
      rules: buildInsights({
        totals,
        products: catalogue,
        stocks: stocks.data,
        invoices: invoices.data,
      }),
    };
  }, [expenses.data, finance.data, invoices.data, products.data, stocks.data]);

  const rules = derived?.rules ?? EMPTY_CARDS;
  const configured = ai.apiKey.trim() !== '';

  const generated = useQuery({
    queryKey: ['insights', 'ai', derived?.key ?? '', language, ai.model, ai.provider],
    enabled: configured && derived !== null,
    /* One window of data is one answer. Re-asking on a remount, or every time
       the tab regains focus, would spend the seller's credits to be told the
       same thing — so an answer never goes stale and only new figures ask
       again. A failed call is retried once and then left alone. */
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: ({ signal }) =>
      generateInsightCards({
        ai,
        digest: derived?.digest ?? '',
        language,
        covered: rules.map((card) => card.id),
        signal,
      }),
  });

  const cards = useMemo<readonly InsightCard[]>(() => {
    const merged = [...rules, ...(generated.data ?? [])];
    return merged.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [generated.data, rules]);

  return useMemo<InsightsData>(
    () => ({
      cards,
      queries: [finance, expenses, products],
      pending: ready && finance.isPending,
      aiPending: configured && generated.isFetching,
    }),
    [cards, configured, expenses, finance, generated.isFetching, products, ready],
  );
}

const EMPTY_CARDS: readonly InsightCard[] = [];
