import { useCallback, useMemo, useRef } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { ApiError } from '@/services/api/client';
import { estimateCost } from '@/services/ai/pricing';
import { supportsNativeTools } from '@/services/ai/messages';
import { runAgent, summariseAnswer } from '@/services/insights/agent';
import { buildFacts, type FactTable } from '@/services/insights/facts';
import { buildBaseSystem } from '@/services/insights/prompt';
import type { ToolContext } from '@/services/insights/toolkit';
import { useOverviewQuery } from '@/services/queries/useOverviewQuery';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useScope } from '@/services/queries/useScope';
import { useShops } from '@/services/queries/useConnection';
import { useChatStore } from '@/store/chat.store';
import { useAiSettings } from '@/store/settings.store';

import { useInsightActionRunner } from '@/features/insights/useInsightActionRunner';

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
 * The Copilot.
 *
 * What this file owns is small on purpose: the conversation itself lives in
 * `services/insights/agent.ts`, which knows nothing about React. Here is where
 * the pieces the agent needs are assembled — the scope the seller has selected,
 * the catalogue already in cache, the store writers that put blocks on screen,
 * and the action runner that performs the two actions a model is allowed to
 * perform itself.
 *
 * An answer is still composed the same way an insight card is: blocks citing
 * facts the application resolved. What changed underneath is that the model is
 * no longer handed a fact table and a vocabulary up front. It is handed a
 * question and a way to ask, and it goes and gets what the question needs —
 * which is why two different questions no longer produce two answers with the
 * same furniture.
 *
 * Cancellation cuts every round: one `AbortController` is threaded through the
 * model requests, the archive fetches and the worker jobs between them.
 */
export function useCopilotAnswers(): UseCopilotAnswersResult {
  const { t, language } = useTranslation();
  const ai = useAiSettings();

  const begin = useChatStore((state) => state.begin);
  const append = useChatStore((state) => state.append);
  const ground = useChatStore((state) => state.ground);
  const settle = useChatStore((state) => state.settle);
  const fail = useChatStore((state) => state.fail);

  const scope = useScope();
  const shops = useShops();
  const { summary } = useOverviewQuery();
  const { products } = useProductsQuery();
  const { run: runAction } = useInsightActionRunner();

  const controllerRef = useRef<AbortController | null>(null);

  /**
   * What already resolves before anyone asks anything.
   *
   * Not context for the model — it is never told these exist — but a table the
   * screen has already computed for the selected period. Seeding it means a
   * `window.totals` lookup over that same period lands on refs that were
   * already consistent with the tiles behind the panel, rather than creating a
   * second set that could disagree by a rounding.
   */
  const seed = useMemo<FactTable>(() => {
    if (summary === null) return new Map();
    return buildFacts({ totals: summary.totals, products, invoices: undefined });
  }, [products, summary]);

  const shopNames = useMemo(() => {
    const selected = new Set(scope.shopIds);
    return shops.filter((shop) => selected.has(shop.id)).map((shop) => shop.name);
  }, [scope.shopIds, shops]);

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (trimmed === '') return;

      const id = begin(trimmed);
      const { deep, grants } = useChatStore.getState();
      const startedAt = Date.now();

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      /* The previous turns, flattened to prose. The model does not need its own
         JSON read back to it — see `summariseAnswer`. */
      const history = useChatStore
        .getState()
        .messages.filter((message) => message.id !== id)
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content:
            message.role === 'user'
              ? message.text
              : summariseAnswer(message.blocks, message.facts, language),
        }))
        .filter((message) => message.content !== '');

      const now = Date.now();

      const context: ToolContext = {
        scope,
        products,
        shops: shops.map((shop) => ({ id: shop.id, name: shop.name })),
        language,
        now,
        signal: controller.signal,
      };

      void runAgent({
        settings: ai,
        system: buildBaseSystem({
          language,
          scope,
          shopNames,
          now,
          native: supportsNativeTools(ai.provider),
        }),
        question: trimmed,
        history,
        context,
        language,
        granted: grants,
        seed,
        signal: controller.signal,
        /* Off is a shorter leash rather than no data at all: a direct question
           still needs one lookup to answer honestly. */
        budget: deep ? { rounds: 5, calls: 12 } : { rounds: 2, calls: 4 },
        onBlocks: (blocks) => append(id, blocks),
        onGround: (facts, series) => ground(id, facts, series),
        onRun: runAction,
      })
        .then((outcome) => {
          settle(id, {
            routes: outcome.routes,
            elapsedMs: Date.now() - startedAt,
            costUsd: estimateCost(ai, {
              inputTokens: outcome.inputTokens,
              outputTokens: outcome.outputTokens,
              cachedInputTokens: outcome.cachedInputTokens,
            }),
            dropped: outcome.dropped,
            deep,
            rounds: outcome.rounds,
            calls: outcome.calls,
            cachedInputTokens: outcome.cachedInputTokens,
            plan: outcome.plan,
          });
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.isCancelled) {
            fail(id, t('tCancelled'));
            return;
          }
          fail(id, error instanceof ApiError ? error.message : t('tFail'));
        });
    },
    [
      ai,
      append,
      begin,
      fail,
      ground,
      language,
      products,
      runAction,
      scope,
      seed,
      settle,
      shopNames,
      shops,
      t,
    ],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const suggestions: readonly SuggestedQuestion[] = [
    { id: 'q-margin', text: t('explainQ') },
    { id: 'q-stock', text: t('qStock') },
    { id: 'q-ops', text: t('qOps') },
  ];

  return { ask, cancel, suggestions, unconfigured: ai.apiKey.trim() === '' };
}
