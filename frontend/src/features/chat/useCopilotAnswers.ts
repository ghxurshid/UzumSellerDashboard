import { useCallback, useMemo, useRef } from 'react';

import { formatDay, formatNumber } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ApiError } from '@/services/api/client';
import { complete } from '@/services/ai/client';
import { useArchiveSeries } from '@/services/queries/useArchiveSeries';
import { useOverviewQuery } from '@/services/queries/useOverviewQuery';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useScope, useScopeReady } from '@/services/queries/useScope';
import type { SeriesResult } from '@/services/storage/idb/aggregation';
import { useChatStore } from '@/store/chat.store';
import { useAiSettings } from '@/store/settings.store';

export interface SuggestedQuestion {
  readonly id: string;
  readonly text: string;
}

interface UseCopilotAnswersResult {
  readonly ask: (question: string) => void;
  readonly cancel: () => void;
  readonly suggestions: readonly SuggestedQuestion[];
  /** True when no provider key is stored — the panel offers Settings instead. */
  readonly unconfigured: boolean;
}

/**
 * How many buckets of the period series the model is given.
 *
 * Enough for a trend to be visible and an outlier to be nameable, few enough
 * that the grounding context stays a page rather than a spreadsheet. The model
 * is asked about a period, not handed the period's rows.
 */
const SERIES_LINES = 30;

/**
 * The period series, written out for the model.
 *
 * This is the AI half of what the storage layer was rebuilt for. The buckets are
 * computed by the analytics worker from a bounded index range over the flat
 * records — never by loading the period's rows onto the main thread — so asking
 * about a year of history costs the same interface responsiveness as asking
 * about a week.
 *
 * Empty buckets are included rather than skipped. A day with no sales is a fact
 * about the business, and a series that silently omitted it would let the model
 * describe a gap as continuity.
 */
function describeSeries(series: SeriesResult): readonly string[] {
  const { at, revenue, units, profit } = series.series;
  if (at.length === 0) return [];

  const lines: string[] = [
    '',
    `Period series, one row per ${series.series.granularity} (date, revenue, units, sellerProfit):`,
  ];

  /* The tail rather than the head: a question about a period is nearly always
     about how it ended, and a truncated series should keep the part that
     answers it. */
  const start = Math.max(0, at.length - SERIES_LINES);
  for (let index = start; index < at.length; index += 1) {
    lines.push(
      `${formatDay(at[index] ?? 0)}  ${formatNumber(revenue[index] ?? 0)}  ${formatNumber(
        units[index] ?? 0,
      )}  ${formatNumber(profit[index] ?? 0)}`,
    );
  }

  if (start > 0) {
    lines.push(`(${start} earlier ${series.series.granularity} buckets omitted for brevity)`);
  }

  return lines;
}

/**
 * The Copilot.
 *
 * The model is asked over the network with the user's own key, and it is given
 * the figures already on screen as context — the totals this app summed from
 * the seller API, stated as facts, plus an instruction not to invent any
 * others. That is what keeps an answer checkable: every number it can quote is
 * one the user can find in the tables behind it.
 *
 * Two kinds of grounding go in, and they answer different questions. The
 * **totals** say what the window came to; the **series** says how it got there,
 * which is what a question like "why was last week worse" needs and what a
 * single sum can never support.
 */
export function useCopilotAnswers(): UseCopilotAnswersResult {
  const { t } = useTranslation();
  const ai = useAiSettings();

  const begin = useChatStore((state) => state.begin);
  const settle = useChatStore((state) => state.settle);
  const fail = useChatStore((state) => state.fail);

  const { summary } = useOverviewQuery();
  const { products, total: productTotal } = useProductsQuery();

  /* Read straight from IndexedDB through the analytics worker, and only when a
     provider is configured — there is no point aggregating a period for a panel
     that is going to offer the Settings link instead. */
  const scope = useScope();
  const scopeReady = useScopeReady(scope);
  const series = useArchiveSeries(scope, {
    enabled: scopeReady && ai.apiKey.trim() !== '',
  });

  const controllerRef = useRef<AbortController | null>(null);

  /** The grounding context: what this account's data actually says. */
  const system = useMemo(() => {
    const lines: string[] = [
      'You are the analysis layer of a dashboard for Uzum Market sellers.',
      'You may only reason about the figures listed below. They were summed client-side from the Uzum seller OpenAPI.',
      'The seller API has no forecast, scoring or aggregate endpoint — never present a prediction as data.',
      'If the answer is not derivable from these figures, say which endpoint would be needed instead of guessing.',
      'Answer in the language the question was asked in. Be concise and quote the field names.',
    ];

    if (summary === null) {
      lines.push('', 'No data has been synced yet for the selected shops and period.');
      return lines.join('\n');
    }

    const totals = summary.totals;
    lines.push(
      '',
      `Order items in the window: ${formatNumber(summary.reportedItems)} (cancelled ${formatNumber(totals.cancelledItems)})`,
      `Distinct orders read: ${formatNumber(totals.orders)}`,
      `Sum sellPrice: ${formatNumber(totals.sellPrice)}`,
      `Sum purchasePrice: ${formatNumber(totals.purchasePrice)}`,
      `Sum commission: ${formatNumber(totals.commission)}`,
      `Sum logisticDeliveryFee: ${formatNumber(totals.logisticDeliveryFee)}`,
      `Sum sellerProfit: ${formatNumber(totals.sellerProfit)}`,
      `Net profit (sellerProfit - purchasePrice - expenses): ${formatNumber(totals.netProfit)}`,
      `Net margin: ${totals.netMargin.toFixed(1)}%`,
      `Products in catalogue: ${formatNumber(productTotal)} (read ${formatNumber(products.length)})`,
    );

    for (const [source, value] of totals.expenseBySource) {
      lines.push(`Expense ledger, ${source}: ${formatNumber(value)}`);
    }

    if (summary.truncated) {
      lines.push(
        'Note: the finance read stopped at the page ceiling, so sums cover only the rows read.',
      );
    }

    if (series.data !== undefined) lines.push(...describeSeries(series.data));

    return lines.join('\n');
  }, [productTotal, products.length, series.data, summary]);

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (trimmed === '') return;

      const id = begin(trimmed);
      const history = useChatStore
        .getState()
        .messages.filter((message) => message.id !== id && message.text !== '')
        .slice(-8)
        .map((message) => ({ role: message.role, content: message.text }));

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      void complete(ai, { system, messages: history, signal: controller.signal })
        .then((text) => settle(id, text))
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.isCancelled) {
            fail(id, t('tCancelled'));
            return;
          }
          fail(id, error instanceof ApiError ? error.message : t('tFail'));
        });
    },
    [ai, begin, fail, settle, system, t],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const suggestions: readonly SuggestedQuestion[] = [
    { id: 'q-margin', text: t('explainQ') },
    { id: 'q-stock', text: t('qStock') },
    { id: 'q-ops', text: t('qOps') },
  ];

  return { ask, cancel, suggestions, unconfigured: ai.apiKey.trim() === '' };
}
