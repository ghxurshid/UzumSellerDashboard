import { useCallback, useMemo, useRef } from 'react';

import { useTranslation, type Translator } from '@/lib/i18n/useTranslation';
import { ApiError } from '@/services/api/client';
import { estimateCost } from '@/services/ai/pricing';
import { supportsNativeTools } from '@/services/ai/messages';
import { createSession, runAgent, summariseAnswer, type AgentSession } from '@/services/insights/agent';
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

/**
 * A failure, as a sentence rather than as a provider's error envelope.
 *
 * The three retryable kinds are the ones that reach the seller with a button
 * beside them, and `{"error":{"code":503,"status":"UNAVAILABLE"}}` is not a
 * sentence to put next to a button. Everything else keeps the provider's own
 * words: a 401 or a rejected parameter is a message the seller has to act on,
 * and paraphrasing it would remove the only detail that helps.
 */
function describeFailure(error: ApiError, t: Translator): string {
  switch (error.kind) {
    case 'rateLimited':
    case 'server':
      return t('aiBusy');
    case 'network':
      return t('aiOffline');
    case 'timeout':
      return t('aiSlow');
    default:
      return error.message;
  }
}

export interface SuggestedQuestion {
  readonly id: string;
  readonly text: string;
}

interface UseCopilotAnswersResult {
  readonly ask: (question: string) => void;
  /**
   * Continue the answer that stopped, from the round it stopped in.
   *
   * Not a re-ask: the documents the model was handed, the lookups it ran and
   * the facts they produced are still in the session, so what runs again is the
   * one round that failed — and the lookups inside it are served from the
   * question's own cache rather than the archive.
   */
  readonly retry: (id: string) => void;
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
  const draft = useChatStore((state) => state.draft);
  const ground = useChatStore((state) => state.ground);
  const settle = useChatStore((state) => state.settle);
  const fail = useChatStore((state) => state.fail);
  const truncate = useChatStore((state) => state.truncate);
  const resume = useChatStore((state) => state.resume);

  const scope = useScope();
  const shops = useShops();
  const { summary } = useOverviewQuery();
  const { products } = useProductsQuery();
  const { run: runAction } = useInsightActionRunner();

  const controllerRef = useRef<AbortController | null>(null);

  /**
   * The run that stopped, kept in case the seller asks for it back.
   *
   * One at a time: a thread has a single pending answer, so a second failure
   * replaces the first — the older one has a transcript the seller can still
   * read and a question they can still ask again.
   */
  const stalledRef = useRef<{
    readonly id: string;
    readonly session: AgentSession;
    readonly deep: boolean;
    /* The clock the seller started, not the clock of the attempt that failed. */
    readonly startedAt: number;
  } | null>(null);

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

  /**
   * Start or continue one answer.
   *
   * Both entry points end here, and the only difference between them is the
   * session they arrive with: a fresh one from `ask`, or the one that stopped
   * from `retry`. The agent reads its position out of the session, so this
   * function does not need to know which of the two it is serving.
   */
  const launch = useCallback(
    (id: string, session: AgentSession, deep: boolean, startedAt: number) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

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
        session,
        context,
        language,
        granted: useChatStore.getState().grants,
        signal: controller.signal,
        /* Off is a shorter leash rather than no data at all: a direct question
           still needs one lookup to answer honestly. */
        budget: deep ? { rounds: 5, calls: 12 } : { rounds: 2, calls: 4 },
        onBlocks: (blocks) => append(id, blocks),
        /* The half-written sentence, so the panel reads like something is being
           written rather than staying blank until the line ends. It resolves to
           nothing the moment `onBlocks` delivers the same text as a block. */
        onDraft: (text) => draft(id, text),
        onGround: (facts, series) => ground(id, facts, series),
        onRun: runAction,
      })
        .then((outcome) => {
          stalledRef.current = null;
          settle(id, {
            routes: outcome.routes,
            elapsedMs: Date.now() - startedAt,
            costUsd: estimateCost(ai, {
              inputTokens: outcome.inputTokens,
              outputTokens: outcome.outputTokens,
              cachedInputTokens: outcome.cachedInputTokens,
            }),
            dropped: outcome.dropped,
            rejected: outcome.rejected,
            deep,
            rounds: outcome.rounds,
            calls: outcome.calls,
            cachedInputTokens: outcome.cachedInputTokens,
            plan: outcome.plan,
          });
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.isCancelled) {
            /* The seller stopped it on purpose. Nothing to offer to continue. */
            stalledRef.current = null;
            fail(id, t('tCancelled'));
            return;
          }

          /* The session is what makes the button worth pressing: everything the
             run collected before this round is still in it. */
          stalledRef.current = { id, session, deep, startedAt };

          fail(
            id,
            error instanceof ApiError ? describeFailure(error, t) : t('tFail'),
            error instanceof ApiError && error.isRetryable,
          );
        });
    },
    [
      ai,
      append,
      draft,
      fail,
      ground,
      language,
      products,
      runAction,
      scope,
      settle,
      shopNames,
      shops,
      t,
    ],
  );

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (trimmed === '') return;

      const id = begin(trimmed);
      const { deep } = useChatStore.getState();

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

      launch(id, createSession({ question: trimmed, history, seed }), deep, Date.now());
    },
    [begin, language, launch, seed],
  );

  const retry = useCallback(
    (id: string) => {
      const stalled = stalledRef.current;
      if (stalled === null || stalled.id !== id) return;

      /* Whatever the failed round had already written comes off first, because
         the round is about to write it again. Everything before that round —
         the lookups, the facts, the documents in the transcript — stays. */
      truncate(id, stalled.session.checkpoint);
      resume(id);
      launch(id, stalled.session, stalled.deep, stalled.startedAt);
    },
    [launch, resume, truncate],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const suggestions: readonly SuggestedQuestion[] = [
    { id: 'q-margin', text: t('explainQ') },
    { id: 'q-stock', text: t('qStock') },
    { id: 'q-ops', text: t('qOps') },
  ];

  return { ask, retry, cancel, suggestions, unconfigured: ai.apiKey.trim() === '' };
}
