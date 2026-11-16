import { useCallback, useRef } from 'react';

import { formatClock } from '@core/lib/format';
import { useTranslation, type Translator } from '@core/i18n/useTranslation';
import { ApiError } from '@core/errors/apiError';
import type { BaseToolContext } from '@core/tools/contract';
import { estimateCost } from '@core/ai/pricing';
import { isAiConfigured } from '@core/ai/modelRules';
import { supportsNativeTools } from '@core/ai/messages';
import { ModelQuotaError, nextPacificMidnight } from '@core/ai/usage';
import {
  createSession,
  runAgent,
  type AgentOutcome,
  type AgentSession,
} from '@core/agent/agent';
import { useChatStore } from '@core/state/chat.store';
import { useAiSettings } from '@core/state/settings.store';

import { startQuestion } from './history';
import type { CopilotHost, PreparedRun } from './host';

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
  /* A daily quota is not "busy" — retrying before the Pacific reset cannot
     help, so the sentence names the reset time and the way out (another
     model in Settings) instead of the generic "try again" `aiBusy` gives
     every other rate limit. `error.isRetryable` is already `false` for this
     one (see `ModelQuotaError`), which is what drops the continue button;
     this only changes what the seller reads while it is missing. */
  if (error instanceof ModelQuotaError && error.quota?.axis === 'rpd') {
    return t('aiDailyQuotaExhausted', { time: formatClock(nextPacificMidnight(Date.now())) });
  }

  switch (error.kind) {
    case 'rateLimited':
    case 'server':
      return t('aiBusy');
    case 'network':
      return t('aiOffline');
    case 'timeout':
      return t('aiSlow');
    case 'client':
    case 'notFound':
      /* Same two codes `ui/settings/aiErrors.ts` names for the settings
         pane's own connection test — the chat hits the identical OpenAI
         failure and must not paraphrase it two different ways depending on
         which surface the seller was looking at when it happened. */
      if (error.code === 'incomplete') return t('aiErrIncomplete');
      if (error.code === 'insufficient_quota') return t('aiErrInsufficientQuota');
      return error.message;
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
  /** True when there is not enough to send a request — the panel offers Settings instead. */
  readonly unconfigured: boolean;
}

/**
 * The Copilot.
 *
 * What this file owns is small on purpose: the conversation itself lives in
 * `agent/agent.ts`, which knows nothing about React. Here is where the pieces
 * the agent needs are assembled — the prompt and lookup context the host
 * prepares, the store writers that put blocks on screen, and the host's action
 * runner for the actions a model is allowed to perform itself. Where the data
 * comes from is the host's business and arrives through `CopilotHost`.
 *
 * An answer is composed the same way an insight card is: blocks, with the
 * figures the model worked out from the data written into them. The model is
 * not handed a fact table and a vocabulary up front. It is handed a question and
 * a way to ask, and it goes and gets what the question needs — which is why two
 * different questions no longer produce two answers with the same furniture.
 *
 * Cancellation cuts every round: one `AbortController` is threaded through the
 * host's preparation, the model requests and the lookups between them.
 */
export function useCopilotAnswers<C extends BaseToolContext, A extends string>(
  host: CopilotHost<C, A>,
): UseCopilotAnswersResult {
  const { t, language } = useTranslation();
  const ai = useAiSettings();

  const append = useChatStore((state) => state.append);
  const draft = useChatStore((state) => state.draft);
  const settle = useChatStore((state) => state.settle);
  const fail = useChatStore((state) => state.fail);
  const truncate = useChatStore((state) => state.truncate);
  const resume = useChatStore((state) => state.resume);

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
   * Start or continue one answer.
   *
   * Both entry points end here, and the only difference between them is the
   * session they arrive with: a fresh one from `ask`, or the one that stopped
   * from `retry`. The agent reads its position out of the session, so this
   * function does not need to know which of the two it is serving.
   *
   * The host prepares first, and that can take a moment (the extension reads a
   * fresh session). The controller is already in place by then, so a cancel
   * during the wait is an ordinary cancel: nothing is started, and the turn
   * ends the way a cancelled run does.
   */
  const launch = useCallback(
    (id: string, session: AgentSession, deep: boolean, startedAt: number) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const execute = async (): Promise<{
        readonly outcome: AgentOutcome;
        readonly window: { readonly fromMs: number; readonly toMs: number } | undefined;
      }> => {
        const now = Date.now();
        const cancelled = (): ApiError => new ApiError('Cancelled', { kind: 'cancelled' });

        let prepared: PreparedRun<C>;
        try {
          prepared = await host.prepare({
            language,
            now,
            native: supportsNativeTools(ai.provider),
            signal: controller.signal,
          });
        } catch (error) {
          /* A preparation that gave up because it was cancelled is a cancel, not
             a failure with a button beside it. */
          if (controller.signal.aborted) throw cancelled();
          throw error;
        }
        if (controller.signal.aborted) throw cancelled();

        const outcome = await runAgent({
          settings: ai,
          system: prepared.system,
          session,
          toolkit: host.toolkit,
          context: prepared.context,
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
          onRun: host.runAction,
        });

        return { outcome, window: prepared.window };
      };

      execute()
        .then(({ outcome, window }) => {
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
            ...(window !== undefined ? { window } : {}),
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
    [ai, append, draft, fail, host, language, settle, t],
  );

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (trimmed === '') return;

      /* The new turn and the turns before it, taken together so the history
         cannot include the question it is the history of — see `history.ts`. */
      const { id, history } = startQuestion(trimmed, language);
      const { deep } = useChatStore.getState();

      /* The documents this thread already holds ride into the new question's
         system prompt — the summarised history above no longer contains them. */
      const carried = new Set(useChatStore.getState().grants);

      launch(id, createSession({ question: trimmed, history, carried }), deep, Date.now());
    },
    [language, launch],
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

  const suggestions: readonly SuggestedQuestion[] = host.suggestions.map((key) => ({
    id: key,
    text: t(key),
  }));

  return { ask, retry, cancel, suggestions, unconfigured: !isAiConfigured(ai) };
}

