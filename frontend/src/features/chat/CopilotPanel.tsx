import {
  AlertCircle,
  Brain,
  Database,
  FileSpreadsheet,
  Pin,
  Printer,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { IconButton } from '@/components/ui/IconButton';
import { useIsTouch } from '@/hooks/useMediaQuery';
import { formatCost } from '@/services/ai/pricing';
import { useTranslation, type Translator } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { ActionConfirmDialog } from '@/features/insights/ActionConfirmDialog';
import { BlockRenderer, DraftText } from '@/features/insights/BlockRenderer';
import { useInsightActionRunner } from '@/features/insights/useInsightActionRunner';
import { resolveAction } from '@/services/insights/actions';
import type { Block } from '@/services/insights/blocks';
import { exportAnswerCsv, printAnswer } from '@/services/insights/export';
import { pinnableBlocks } from '@/services/insights/pins';
import { usePinsStore } from '@/store/pins.store';
import { useChatStore, type ChatTurn } from '@/store/chat.store';
import { useAiModelLabel } from '@/store/settings.store';
import { useUiStore } from '@/store/ui.store';
import type { Language } from '@/types/domain';

import { useCopilotAnswers } from './useCopilotAnswers';

/**
 * The Copilot side panel.
 *
 * The transcript is an `aria-live="polite"` log so a reply is announced when it
 * lands, and the composer submits through a real `<form>` — Enter sends,
 * Shift+Enter breaks the line, which is what a chat input is expected to do.
 *
 * An assistant turn is a document rather than a paragraph: the same blocks the
 * insights rail renders, drawn by the same component, resolving figures against
 * the fact table that turn was grounded on. That is what lets an answer carry a
 * table, a waterfall and a button without this file knowing anything about any
 * of them.
 */
export function CopilotPanel(): ReactNode {
  const { t, language } = useTranslation();
  const modelLabel = useAiModelLabel();
  const isTouch = useIsTouch();

  const chatOpen = useUiStore((state) => state.chatOpen);
  const toggleChat = useUiStore((state) => state.toggleChat);

  const navigate = useNavigate();
  const messages = useChatStore((state) => state.messages);
  const pending = useChatStore((state) => state.pending);
  const error = useChatStore((state) => state.error);
  const reset = useChatStore((state) => state.reset);
  const deep = useChatStore((state) => state.deep);
  const setDeep = useChatStore((state) => state.setDeep);

  const { ask, cancel, suggestions, unconfigured } = useCopilotAnswers();
  const runner = useInsightActionRunner();
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /**
   * A question handed over by an insight card.
   *
   * The card knows what to ask but not how — `ask` is this panel's closure, and
   * the panel may not have been mounted when the button was pressed. So the
   * card leaves the question in the store and it is claimed here, once, on the
   * first render after the panel opens.
   */
  useEffect(() => {
    if (!chatOpen || unconfigured) return;
    const queued = useChatStore.getState().claim();
    if (queued !== null) ask(queued);
  }, [ask, chatOpen, unconfigured]);

  if (!chatOpen) return null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (draft.trim() === '' || pending || unconfigured) return;
    ask(draft);
    setDraft('');
  };

  return (
    /**
     * A column beside the content on a desktop, the whole screen on a phone.
     *
     * There is no room to put a 433px panel next to anything below 768px, and
     * a chat transcript is not a glance-at-it surface — it is where the user
     * goes to read and type, so it takes the screen while it is open and the
     * close button hands it back.
     */
    <aside
      aria-label={t('askCopilot')}
      className={cn(
        'fixed inset-0 z-40 flex animate-[sheet_0.24s_var(--ease-out-soft)] flex-col bg-chrome',
        'md:static md:z-auto md:w-433 md:shrink-0 md:animate-[slide-panel_0.26s_var(--ease-out-soft)]',
        'md:border-l md:border-line',
      )}
    >
      <header className="flex h-52 shrink-0 items-center gap-9 border-b border-line px-12 pt-safe md:h-46">
        <Sparkles aria-hidden className="size-14 shrink-0 text-acc-dim" />
        <span className="shrink-0 text-sm font-medium">{t('askCopilot')}</span>
        <span className="min-w-0 truncate text-mini text-faint">{modelLabel}</span>
        <div className="flex-1" />
        <IconButton
          label={t('copilotClear')}
          size="md"
          className="md:size-22 md:rounded-5"
          onClick={reset}
          disabled={messages.length === 0}
        >
          <Trash2 aria-hidden className="size-14 md:size-12" />
        </IconButton>
        <IconButton
          label={t('mClose')}
          size="md"
          className="md:size-22 md:rounded-5"
          onClick={toggleChat}
        >
          <X aria-hidden className="size-16 md:size-12" />
        </IconButton>
      </header>

      <div
        ref={logRef}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-11 overflow-auto overscroll-contain px-12 py-12"
      >
        {unconfigured && (
          <div className="flex flex-col items-start gap-9 rounded-9 border border-warn-line bg-warn-soft p-11">
            <span className="flex items-center gap-7 text-xs-plus text-warn">
              <AlertCircle aria-hidden className="size-13 shrink-0" />
              {t('connNone')}
            </span>
            <button
              type="button"
              onClick={() => void navigate('/settings')}
              className="tap flex h-32 cursor-pointer items-center gap-5 rounded-6 border border-acc bg-acc-soft px-10 text-xs text-acc-dim hover:bg-acc-strong md:h-24 md:px-9"
            >
              <Settings2 aria-hidden className="size-11" />
              {t('sAi')}
            </button>
          </div>
        )}

        {error !== null && (
          <p
            role="alert"
            className="m-0 rounded-9 border border-neg-line bg-neg-soft px-11 py-9 text-xs-plus text-neg"
          >
            {error}
          </p>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-col gap-11">
            <p className="m-0 text-xs-plus leading-[1.6] text-dim">{t('copilotEmpty')}</p>
            <div className="flex flex-col gap-6">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  disabled={unconfigured}
                  onClick={() => ask(suggestion.text)}
                  className="min-h-44 cursor-pointer rounded-8 border border-line px-11 py-9 text-left text-xs-plus text-dim transition-colors hover:border-acc-line hover:text-acc-dim md:min-h-0 md:px-10 md:py-8"
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) =>
            message.role === 'user' ? (
              <div
                key={message.id}
                className="flex max-w-[92%] flex-col gap-4 self-end rounded-9 border border-acc-line bg-acc-soft px-11 py-9 text-xs-plus leading-[1.6] text-text"
              >
                <span>{message.text}</span>
                <span className="text-tiny text-faint">{message.time}</span>
              </div>
            ) : (
              <AnswerTurn
                key={message.id}
                turn={message}
                /* The question this answered — the pinned card's heading, and
                   the only place the assistant turn can learn it, since an
                   answer carries blocks rather than a prompt. */
                question={messages[index - 1]?.text ?? ''}
                t={t}
                language={language}
                onAction={runner.run}
                onAsk={ask}
                onCancel={cancel}
              />
            ),
          )
        )}
      </div>

      {/* The gate in front of a write the model proposed. Held at the panel so
          one dialog serves every answer, and so the held action survives the
          transcript scrolling under it. */}
      <ActionConfirmDialog runner={runner} />

      <form
        onSubmit={submit}
        className="pb-safe-12 flex shrink-0 flex-col gap-8 border-t border-line px-12 pt-10 md:pb-12"
      >
        <div className="flex items-end gap-8">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              /* On a soft keyboard Enter is the newline key and there is no
                 Shift to hold, so the send button is the only way out — the
                 submit-on-Enter shortcut is a hardware-keyboard affordance. */
              if (event.key === 'Enter' && !event.shiftKey && !isTouch) {
                event.preventDefault();
                submit(event);
              }
            }}
            rows={2}
            placeholder={t('copilotPh')}
            aria-label={t('copilotPh')}
            enterKeyHint="enter"
            className="min-h-44 min-w-0 flex-1 resize-none rounded-8 border border-line-2 bg-panel px-10 py-8 text-sm text-text outline-none placeholder:text-faint focus-visible:border-acc"
          />
          <button
            type="submit"
            disabled={draft.trim() === '' || pending || unconfigured}
            aria-label={t('copilotSend')}
            className="flex size-44 shrink-0 cursor-pointer items-center justify-center rounded-8 border border-acc bg-acc-soft text-acc-dim transition-colors hover:bg-acc-strong disabled:cursor-not-allowed disabled:opacity-45 md:size-32"
          >
            <Send aria-hidden className="size-16 md:size-14" />
          </button>
        </div>

        {/* The toggle is not a preference — it selects whether the model may go
            and read the archive before answering. See `chat.store.ts`. Only the
            switch carries the state: the label names the control and holds one
            tone either way, so what is lit reads as the position it is in
            rather than as emphasis on the words. */}
        <button
          type="button"
          role="switch"
          aria-checked={deep}
          aria-label={t('deepMode')}
          onClick={() => setDeep(!deep)}
          className="tap flex w-fit cursor-pointer items-center gap-6 text-tiny text-faint"
        >
          <Brain aria-hidden className="size-11" />
          {t('deepMode')}
          <span
            aria-hidden
            className={cn(
              'flex h-14 w-24 shrink-0 items-center rounded-full border transition-colors',
              deep ? 'justify-end border-acc bg-acc-soft' : 'justify-start border-line-2',
            )}
          >
            <span
              className={cn(
                'mx-2 size-10 rounded-full transition-colors',
                deep ? 'bg-acc' : 'bg-faint',
              )}
            />
          </span>
        </button>
      </form>
    </aside>
  );
}

interface AnswerTurnProps {
  readonly turn: ChatTurn;
  readonly question: string;
  readonly t: Translator;
  readonly language: Language;
  readonly onAction: ReturnType<typeof useInsightActionRunner>['run'];
  readonly onAsk: (question: string) => void;
  readonly onCancel: () => void;
}

/**
 * One answer.
 *
 * Follow-up questions are pulled out of the block list rather than being their
 * own kind: the model already has `copilot.ask` in the action registry, so a
 * suggested question *is* an action, and lifting those to a chip row under the
 * answer costs one filter instead of a new schema. In the chat they ask
 * directly rather than going through the queue, because the panel that would
 * claim the queued question is the one already on screen.
 */
function AnswerTurn({
  turn,
  question,
  t,
  language,
  onAction,
  onAsk,
  onCancel,
}: AnswerTurnProps): ReactNode {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const addPin = usePinsStore((state) => state.add);
  const pinned = usePinsStore((state) => state.pins.some((pin) => pin.id === turn.id));

  const isFollowUp = (block: Block): boolean =>
    block.kind === 'action' && block.actionId === 'copilot.ask';

  const body = turn.blocks.filter((block) => !isFollowUp(block));
  const followUps = turn.blocks.filter(isFollowUp).flatMap((block) => {
    if (block.kind !== 'action') return [];
    const resolved = resolveAction(block.actionId, block.params);
    if (resolved === null) return [];
    const params = resolved.params as { question?: unknown };
    return typeof params.question === 'string' ? [params.question] : [];
  });

  const meta = turn.meta;
  /* The line the model has not finished writing. It is not a block and never
     becomes one — the block arrives separately when the line ends. */
  const writing = turn.draft ?? '';

  return (
    <div className="flex w-full flex-col gap-9 self-start">
      {turn.meta !== undefined && turn.meta.routes.length > 0 && (
        <span className="flex items-start gap-6 rounded-8 border border-line bg-grid/40 px-9 py-7 text-tiny leading-[1.5] text-faint">
          <Database aria-hidden className="size-11 shrink-0 translate-y-[1px]" />
          <span className="min-w-0">
            {t('ctxLabel')}: {turn.meta.routes.join(', ')}
          </span>
        </span>
      )}

      <div
        ref={bodyRef}
        className="flex flex-col gap-9 rounded-9 border border-line bg-panel px-11 py-10"
      >
        {/* "Thinking" is what there is to say only while there is nothing to
            read. A first sentence half-written counts as something to read. */}
        {turn.blocks.length === 0 && writing === '' && turn.pending === true ? (
          <span className="flex items-center gap-7 text-xs-plus text-faint">
            <span className="size-9 animate-[pulse-ring_1.4s_infinite] rounded-full bg-acc" />
            {t('copilotThinking')}
            <button
              type="button"
              onClick={onCancel}
              className="tap cursor-pointer border-0 bg-transparent p-0 text-tiny text-acc-dim underline underline-offset-2"
            >
              {t('cancel')}
            </button>
          </span>
        ) : (
          <BlockRenderer
            blocks={body}
            facts={turn.facts}
            series={turn.series}
            t={t}
            language={language}
            onAction={onAction}
          />
        )}

        {writing !== '' && turn.pending === true && (
          <DraftText text={writing} facts={turn.facts} language={language} />
        )}

        {/* Still streaming, but there is already something to read. */}
        {(turn.blocks.length > 0 || writing !== '') && turn.pending === true && (
          <span className="flex items-center gap-6 text-tiny text-faint">
            <span className="size-7 animate-[pulse-ring_1.4s_infinite] rounded-full bg-acc" />
            <button
              type="button"
              onClick={onCancel}
              className="tap cursor-pointer border-0 bg-transparent p-0 text-tiny text-acc-dim underline underline-offset-2"
            >
              {t('cancel')}
            </button>
          </span>
        )}

        {meta !== undefined && (
          <div className="flex flex-wrap items-center gap-6 border-t border-line pt-8">
            <button
              type="button"
              onClick={() =>
                void exportAnswerCsv({
                  blocks: body,
                  facts: turn.facts,
                  t,
                  language,
                  title: t('askCopilot'),
                })
              }
              className="tap flex h-26 cursor-pointer items-center gap-5 rounded-6 border border-line-2 bg-transparent px-8 text-tiny text-dim hover:border-acc-line hover:text-acc-dim"
            >
              <FileSpreadsheet aria-hidden className="size-11" />
              {t('exportCsv')}
            </button>
            <button
              type="button"
              onClick={() => printAnswer(bodyRef.current)}
              className="tap flex h-26 cursor-pointer items-center gap-5 rounded-6 border border-line-2 bg-transparent px-8 text-tiny text-dim hover:border-acc-line hover:text-acc-dim"
            >
              <Printer aria-hidden className="size-11" />
              {t('exportPdf')}
            </button>

            {/* Keeping an answer keeps the lookups behind it, not the figures —
                the card on the dashboard re-reads them. Offered only when there
                are lookups to replay: an answer composed from nothing would pin
                as a card that can never refresh. */}
            {meta !== undefined && meta.plan.length > 0 && (
              <button
                type="button"
                disabled={pinned}
                onClick={() =>
                  addPin({
                    id: turn.id,
                    title: question === '' ? t('askCopilot') : question,
                    blocks: pinnableBlocks(turn.blocks),
                    plan: meta.plan,
                    createdAt: Date.now(),
                  })
                }
                className="tap flex h-26 cursor-pointer items-center gap-5 rounded-6 border border-line-2 bg-transparent px-8 text-tiny text-dim hover:border-acc-line hover:text-acc-dim disabled:cursor-default disabled:text-faint"
              >
                <Pin aria-hidden className="size-11" />
                {t(pinned ? 'pinned' : 'pinAnswer')}
              </button>
            )}

            <div className="flex-1" />

            <span data-numeric className="text-tiny text-faint">
              {t('srcCount', {
                n: meta.routes.length,
                s: (meta.elapsedMs / 1000).toFixed(1),
              })}
              {meta.calls > 0 && ` · ${t('lookups', { n: meta.calls })}`}
              {meta.costUsd !== null && ` · ≈ ${formatCost(meta.costUsd)}`}
            </span>
          </div>
        )}

        {meta !== undefined && meta.dropped > 0 && (
          <span className="text-tiny text-warn">{t('droppedBlocks', { n: meta.dropped })}</span>
        )}
      </div>

      {followUps.length > 0 && (
        <div className="flex flex-wrap gap-5">
          {followUps.map((question, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onAsk(question)}
              className="tap cursor-pointer rounded-5 border border-line-2 bg-transparent px-8 py-3 text-tiny text-dim hover:border-acc-line hover:text-acc-dim"
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
