import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { summariseFinance } from '@/services/derive/finance';
import { buildInsights } from '@/services/derive/insights';
import { toProducts } from '@/services/derive/products';
import { generateInsightCards } from '@/services/insights/ai';
import { SEVERITY_ORDER, type InsightCard } from '@/services/insights/blocks';
import { buildFacts, type FactTable } from '@/services/insights/facts';
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
 * key carries a digest of the fact table, so switching period or syncing new
 * rows asks again while re-rendering, re-opening the rail or toggling a filter
 * does not.
 */
export interface InsightsData {
  readonly cards: readonly InsightCard[];
  readonly facts: FactTable;
  readonly queries: readonly UseQueryResult<unknown>[];
  readonly pending: boolean;
  /** True while the model is composing — the rail shows its rule cards meanwhile. */
  readonly aiPending: boolean;
}

/**
 * A cheap fingerprint of the numbers.
 *
 * Not a hash of the whole table: the point is to change when the account's
 * figures change and to stay put when they do not, and a handful of totals plus
 * the table's size does that at a fraction of the cost. A collision costs one
 * stale set of AI cards until the next sync, which is a fair trade against
 * hashing several hundred entries on every render.
 */
function digestOf(facts: FactTable): string {
  const parts = [
    facts.size,
    facts.get('totals.sellPrice')?.value ?? 0,
    facts.get('totals.netProfit')?.value ?? 0,
    facts.get('totals.cancelledItems')?.value ?? 0,
    facts.get('catalogue.skus')?.value ?? 0,
  ];
  return parts.map((part) => Math.round(part)).join(':');
}

export function useInsightsQuery(): InsightsData {
  const scope = useScope();
  const ready = useScopeReady(scope);
  const { language } = useTranslation();
  const ai = useAiSettings();

  const finance = useQuery(financeQuery(scope, ready));
  const expenses = useQuery(expensesQuery(scope, ready));
  const products = useQuery(productsQuery(scope, ready));
  /* Stocks and invoices are read only if a screen has already asked for them;
     the rail refines its findings when they arrive rather than forcing a read. */
  const stocks = useQuery(stocksQuery(false, scope));
  const invoices = useQuery(invoicesQuery(false, scope));

  const derived = useMemo(() => {
    if (finance.data === undefined) return null;

    const totals = summariseFinance(finance.data.items, expenses.data?.payments ?? [], {
      cancelledTotal: finance.data.cancelledTotal,
      reportedTotal: finance.data.total,
    });

    const catalogue = toProducts(products.data?.products ?? []);

    return {
      facts: buildFacts({ totals, products: catalogue, invoices: invoices.data }),
      rules: buildInsights({
        totals,
        products: catalogue,
        stocks: stocks.data,
        invoices: invoices.data,
      }),
    };
  }, [expenses.data, finance.data, invoices.data, products.data, stocks.data]);

  const facts = derived?.facts ?? EMPTY_FACTS;
  const rules = derived?.rules ?? EMPTY_CARDS;
  const digest = useMemo(() => digestOf(facts), [facts]);
  const configured = ai.apiKey.trim() !== '';

  const generated = useQuery({
    queryKey: ['insights', 'ai', digest, language, ai.model, ai.provider],
    enabled: configured && facts.size > 0,
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
        facts,
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
      facts,
      queries: [finance, expenses, products],
      pending: ready && finance.isPending,
      aiPending: configured && generated.isFetching,
    }),
    [cards, configured, expenses, facts, finance, generated.isFetching, products, ready],
  );
}

const EMPTY_FACTS: FactTable = new Map();
const EMPTY_CARDS: readonly InsightCard[] = [];
