import { useCallback, useMemo, useRef } from 'react';

import { formatDay } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ApiError } from '@/services/api/client';
import { estimateCost } from '@/services/ai/pricing';
import { streamComplete } from '@/services/ai/stream';
import { statesRawNumber, type Block } from '@/services/insights/blocks';
import { buildFacts, type Fact, type FactTable, type FactSeries, type SeriesTable } from '@/services/insights/facts';
import { createBlockStream, flush, pushChunk } from '@/services/insights/ndjson';
import { runPlan, type ToolOutcome } from '@/services/insights/tools';
import { useOverviewQuery } from '@/services/queries/useOverviewQuery';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useScope } from '@/services/queries/useScope';
import { useChatStore } from '@/store/chat.store';
import { useAiSettings } from '@/store/settings.store';

import {
  buildComposeSystem,
  buildPlanSystem,
  parsePlan,
  summariseAnswer,
} from './copilotProtocol';

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
 * An answer is composed the same way an insight card is — blocks citing facts
 * the application resolved — and for the same reason: every figure a seller
 * reads should be one they can find in the table behind it. What the chat adds
 * is that the *question* decides which facts are needed, so the run has three
 * movements rather than one.
 *
 *   **Plan.** The model is shown the question and the read registry and answers
 *   with the lookups it wants. Skipped entirely in shallow mode, where the
 *   standing totals are taken as the whole of the evidence.
 *
 *   **Retrieve.** The plan runs against the analytics worker — bounded index
 *   ranges over IndexedDB, off the main thread — and its results are folded into
 *   the fact table as new refs.
 *
 *   **Compose.** The model is asked again, now over the enlarged table, and
 *   streams NDJSON. Each finished line is validated and pushed to the transcript
 *   the moment it arrives, so the answer builds on screen instead of appearing
 *   whole after four seconds of nothing.
 *
 * Cancellation cuts all three: one `AbortController` is threaded through both
 * requests and the worker jobs between them.
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
  const { summary } = useOverviewQuery();
  const { products } = useProductsQuery();

  const controllerRef = useRef<AbortController | null>(null);

  /** The standing table: what is true about the window before anyone asks. */
  const standing = useMemo<FactTable>(() => {
    if (summary === null) return new Map();
    return buildFacts({ totals: summary.totals, products, invoices: undefined });
  }, [products, summary]);

  const scopeLine = useMemo(
    () =>
      `shopIds=[${scope.shopIds.join(', ')}] · ${formatDay(scope.fromMs)} – ${formatDay(scope.toMs)}`,
    [scope.fromMs, scope.shopIds, scope.toMs],
  );

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (trimmed === '') return;

      const id = begin(trimmed);
      const deep = useChatStore.getState().deep;
      const startedAt = Date.now();

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const signal = controller.signal;

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

      void (async (): Promise<void> => {
        let inputTokens = 0;
        let outputTokens = 0;

        /* ── plan and retrieve ──────────────────────────────────────────── */

        let retrieved: ToolOutcome = { facts: [], series: [], routes: [] };

        if (deep) {
          const planned = await streamComplete({
            settings: ai,
            request: {
              system: buildPlanSystem(language),
              messages: [{ role: 'user', content: trimmed }],
              signal,
            },
            /* Nothing is shown while planning: the plan is machinery, and
               streaming it would put JSON in front of the seller. */
            onDelta: () => undefined,
          });

          inputTokens += planned.inputTokens;
          outputTokens += planned.outputTokens;

          const steps = parsePlan(planned.text);
          if (steps.length > 0) {
            retrieved = await runPlan(steps, {
              shopIds: scope.shopIds,
              fromMs: scope.fromMs,
              toMs: scope.toMs,
              products,
              language,
              signal,
            });
          }
        }

        /* ── the table this answer will resolve against ─────────────────── */

        const facts = new Map<string, Fact>(standing);
        for (const fact of retrieved.facts) facts.set(fact.ref, fact);

        const series = new Map<string, FactSeries>();
        for (const entry of retrieved.series) series.set(entry.ref, entry);

        ground(id, facts as FactTable, series as SeriesTable);

        /* ── compose, streamed ──────────────────────────────────────────── */

        const stream = createBlockStream();

        /**
         * Blocks are filtered on the way in, not on the way out.
         *
         * `statesRawNumber` is the enforcement half of the "never type a
         * figure" rule: a model that slipped and wrote `9.2%` into a sentence
         * loses that block here rather than putting an unverifiable number in
         * front of a seller. Dropping is counted and reported under the answer.
         */
        const accept = (blocks: readonly Block[]): readonly Block[] => {
          const kept = blocks.filter((block) => {
            if (block.kind !== 'text' || typeof block.text !== 'string') return true;
            if (!statesRawNumber(block.text)) return true;
            stream.dropped += 1;
            return false;
          });
          return kept;
        };

        const composed = await streamComplete({
          settings: ai,
          request: {
            system: buildComposeSystem({
              facts: facts as FactTable,
              series: series as SeriesTable,
              language,
              routes: retrieved.routes,
              scopeLine,
            }),
            messages: [...history, { role: 'user', content: trimmed }],
            signal,
          },
          onDelta: (chunk) => append(id, accept(pushChunk(stream, chunk))),
        });

        append(id, accept(flush(stream)));

        inputTokens += composed.inputTokens;
        outputTokens += composed.outputTokens;

        settle(id, {
          routes: retrieved.routes,
          elapsedMs: Date.now() - startedAt,
          costUsd: estimateCost(ai, { inputTokens, outputTokens }),
          dropped: stream.dropped,
          deep,
        });
      })().catch((error: unknown) => {
        if (error instanceof ApiError && error.isCancelled) {
          fail(id, t('tCancelled'));
          return;
        }
        fail(id, error instanceof ApiError ? error.message : t('tFail'));
      });
    },
    [ai, append, begin, fail, ground, language, products, scope, scopeLine, settle, standing, t],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const suggestions: readonly SuggestedQuestion[] = [
    { id: 'q-margin', text: t('explainQ') },
    { id: 'q-stock', text: t('qStock') },
    { id: 'q-ops', text: t('qOps') },
  ];

  return { ask, cancel, suggestions, unconfigured: ai.apiKey.trim() === '' };
}
