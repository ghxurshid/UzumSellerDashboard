import {
  AlertCircle,
  Brain,
  Database,
  FileSpreadsheet,
  Pin,
  Printer,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { IconButton } from '@core/ui/kit/IconButton';
import { useIsTouch } from '@core/hooks/useMediaQuery';
import { formatCost } from '@core/ai/pricing';
import { useTranslation, type Translator } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import { BlockRenderer, DraftText } from '@core/ui/blocks/BlockRenderer';
import {
  choiceState,
  findChoice,
  hasVisibleBlocks,
  type ChoiceContext,
} from '@core/ui/blocks/choiceState';
import { ASK_ACTION_ID, type ActionRegistry, type ResolvedAction } from '@core/agent/actionRegistry';
import type { Block } from '@core/agent/blocks';
import { exportAnswerCsv, printAnswer } from '@core/agent/export';
import { phrase } from '@core/agent/phrase';
import { useChatStore, type ChatTurn } from '@core/state/chat.store';
import { useAiModelLabel } from '@core/state/settings.store';
import type { BaseToolContext } from '@core/tools/contract';
import type { Language } from '@core/types/common';

import { ChoiceForm } from './ChoiceForm';
import type { CopilotHost, CopilotPinning } from './host';
import { useCopilotAnswers } from './useCopilotAnswers';

/**
 * The Copilot side panel.
 *
 * The transcript is an `aria-live="polite"` log so a reply is announced when it
 * lands, and the composer submits through a real `<form>` — Enter sends,
 * Shift+Enter breaks the line, which is what a chat input is expected to do.
 *
 * An assistant turn is a document rather than a paragraph: the same blocks the
 * insights rail renders, drawn by the same component, with the figures the
 * model computed written into them. That is what lets an answer carry a table,
 * a waterfall and a button without this file knowing anything about any of them.
 *
 * Nothing in here knows which page it sits in. Where the data comes from, what
 * a button may do, how the seller reaches the AI settings and whether answers
 * can be pinned all arrive through `host`; whether the panel is shown, and what
 * closes it, arrive as props. That is what lets the site's docked column and the
 * extension's frame be the same component.
 */
export interface CopilotPanelProps<C extends BaseToolContext = BaseToolContext, A extends string = string> {
  readonly host: CopilotHost<C, A>;
  /**
   * Whether the panel is shown. A host that mounts it only while open can leave
   * this out. One that keeps it mounted gets the conversation's in-flight state
   * kept across a close, and a question queued from elsewhere is held until the
   * panel opens.
   */
  readonly open?: boolean;
  /** Draws the close button when given; a host whose frame closes itself leaves it out. */
  readonly onClose?: () => void;
  /**
   * How the panel occupies its container.
   *
   * `docked` is the site's: a 433px column beside the content on a desktop, the
   * whole screen on a phone. `fill` takes whatever box it is put in and makes no
   * claim on the viewport, which is what a frame of fixed size needs.
   */
  readonly layout?: 'docked' | 'fill';
  /**
   * The host's own overlays — the site's confirmation dialog for a write the
   * model proposed. Rendered inside the panel so it shares the panel's lifetime.
   */
  readonly overlays?: ReactNode;
  /**
   * Controls the host wants in the header, between the clear and close buttons —
   * the extension's way into its settings, which this panel has no button for.
   * The site passes nothing and its header is unchanged.
   */
  readonly headerActions?: ReactNode;
  /**
   * A strip above the transcript for a state the host must state plainly (the
   * seller is signed out of the cabinet, the panel is not inside it). Drawn only
   * when given; the host owns its wording and its own live-region semantics.
   */
  readonly notice?: ReactNode;
  /**
   * The composer's textarea, so a host can focus it when its frame is shown.
   * The element exists only while the panel is open.
   */
  readonly composerRef?: Ref<HTMLTextAreaElement>;
}

export function CopilotPanel<C extends BaseToolContext = BaseToolContext, A extends string = string>({
  host,
  open = true,
  onClose,
  layout = 'docked',
  overlays,
  headerActions,
  notice,
  composerRef,
}: CopilotPanelProps<C, A>): ReactNode {
  const { t, language } = useTranslation();
  const modelLabel = useAiModelLabel();
  const isTouch = useIsTouch();

  const messages = useChatStore((state) => state.messages);
  const pending = useChatStore((state) => state.pending);
  const queued = useChatStore((state) => state.queued);
  const reset = useChatStore((state) => state.reset);
  const deep = useChatStore((state) => state.deep);
  const setDeep = useChatStore((state) => state.setDeep);
  const dismissChoice = useChatStore((state) => state.dismissChoice);
  const reopenChoice = useChatStore((state) => state.reopenChoice);

  const { ask, retry, cancel, suggestions, unconfigured } = useCopilotAnswers(host);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);

  /**
   * The composer, kept here as well as handed to the host.
   *
   * Focus has to be given back to it when a question the Copilot asked is
   * closed, and the host's ref is the host's — it may be absent, or a callback —
   * so the element is held locally and passed on. While a question is open the
   * same callback is handed to the form's own field instead: that field is the
   * composer for as long as the form is up, and a host that focuses "the
   * composer" when its frame is shown should land in it.
   */
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const setInput = useCallback(
    (node: HTMLTextAreaElement | null): void => {
      inputRef.current = node;
      if (typeof composerRef === 'function') composerRef(node);
      else if (composerRef !== undefined && composerRef !== null) composerRef.current = node;
    },
    [composerRef],
  );

  /**
   * The question waiting for the seller, if there is one.
   *
   * It is the first `choice` of the latest answer, once that answer has finished
   * arriving and unless the seller has closed it. While it is set the composer
   * is not drawn: `ChoiceForm` stands in its place, because the next thing the
   * seller does is answer — and a field that would accept something else beside
   * a question waiting for an answer is two inputs disagreeing about whose turn
   * it is.
   *
   * Nothing is taken while an answer is in flight. Answering starts a new
   * question, which would cut off the one still being written.
   */
  const latest = messages[messages.length - 1];
  const asked =
    latest !== undefined && latest.role === 'assistant' ? findChoice(latest.blocks) : undefined;
  const asking =
    latest !== undefined &&
    asked !== undefined &&
    !pending &&
    !unconfigured &&
    latest.pending !== true &&
    latest.choiceDismissed !== true
      ? { turnId: latest.id, block: asked }
      : null;
  const askingId = asking?.turnId ?? null;

  /* What was in the composer goes into the form's field with the seller (the
     form reads it as it mounts), so the composer is emptied here — otherwise the
     same sentence would be waiting in both when the composer comes back. */
  useEffect(() => {
    if (askingId !== null) setDraft('');
  }, [askingId]);

  /* The form has gone — answered or closed — and the composer is back where it
     was. Put the seller in it, after whatever came back with them: they were
     typing in this spot a moment ago, and a caret in front of their own words
     would have the next keystroke land in the wrong place. */
  const wasAsking = useRef(false);
  useEffect(() => {
    if (wasAsking.current && askingId === null) {
      const field = inputRef.current;
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    }
    wasAsking.current = askingId !== null;
  }, [askingId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    /* `askingId` as well: the form is taller than the composer it replaces, and
       the sentence that led up to the question must not end up behind it. */
    /* `open` is a dependency for a host that keeps the panel mounted while it is
       hidden: the log is a new element each time it reappears, so it starts at
       the top unless it is scrolled again. The site mounts the panel only while
       open, where this runs once on mount exactly as before. */
  }, [messages, open, askingId]);

  /**
   * A question handed over by an insight card or a pinned answer.
   *
   * The card knows what to ask but not how — `ask` is this panel's closure, and
   * the panel may not have been mounted when the button was pressed. So the
   * card leaves the question in the store and it is claimed here, once.
   *
   * Watching `queued` rather than only the panel opening is what makes the
   * button work when the panel is already open: setting it open again changes
   * nothing, and the question used to wait in the store until the next time the
   * panel happened to mount. It also waits for an answer in flight to finish,
   * because starting a question aborts the one before it.
   */
  useEffect(() => {
    if (!open || unconfigured || pending || queued === null) return;
    const claimed = useChatStore.getState().claim();
    if (claimed !== null) ask(claimed);
  }, [ask, open, pending, queued, unconfigured]);

  if (!open) return null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (draft.trim() === '' || pending || unconfigured) return;
    ask(draft);
    setDraft('');
  };

  return (
    /**
     * `docked`: a column beside the content on a desktop, the whole screen on a
     * phone.
     *
     * There is no room to put a 433px panel next to anything below 768px, and
     * a chat transcript is not a glance-at-it surface — it is where the user
     * goes to read and type, so it takes the screen while it is open and the
     * close button hands it back.
     *
     * `fill`: the box the host gave it, and nothing about the viewport.
     */
    <aside
      aria-label={t('askCopilot')}
      className={cn(
        'flex flex-col bg-chrome',
        layout === 'docked'
          ? [
              'fixed inset-0 z-40 animate-[sheet_0.24s_var(--ease-out-soft)]',
              'md:static md:z-auto md:w-433 md:shrink-0 md:animate-[slide-panel_0.26s_var(--ease-out-soft)]',
              'md:border-l md:border-line',
            ]
          : 'h-full min-h-0 w-full',
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
        {headerActions}
        {onClose !== undefined && (
          <IconButton
            label={t('mClose')}
            size="md"
            className="md:size-22 md:rounded-5"
            onClick={onClose}
          >
            <X aria-hidden className="size-16 md:size-12" />
          </IconButton>
        )}
      </header>

      {notice}

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
              onClick={host.openSettings}
              className="tap flex h-32 cursor-pointer items-center gap-5 rounded-6 border border-acc bg-acc-soft px-10 text-xs text-acc-dim hover:bg-acc-strong md:h-24 md:px-9"
            >
              <Settings2 aria-hidden className="size-11" />
              {t('sAi')}
            </button>
          </div>
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
                /* What a question the Copilot asked back needs to know about
                   the conversation: whether anything followed this answer, and
                   whether a pick can be taken now. A pick starts a new question,
                   which would cut off one still in flight — so nothing is
                   pressable until the thread is at rest. */
                reply={messages[index + 1]?.role === 'user' ? messages[index + 1]?.text : undefined}
                canReply={index === messages.length - 1 && !pending && !unconfigured}
                onReopenChoice={reopenChoice}
                t={t}
                language={language}
                registry={host.toolkit.actions}
                onAction={host.runAction}
                pins={host.pins}
                onAsk={ask}
                onCancel={cancel}
                onRetry={retry}
              />
            ),
          )
        )}
      </div>

      {/* The host's overlays — on the site, the gate in front of a write the model
          proposed. Held at the panel so one dialog serves every answer, and so
          the held action survives the transcript scrolling under it. */}
      {overlays}

      {asking !== null ? (
        <ChoiceForm
          /* Keyed by the turn that asked, so a new question is a new form: its
             own focus, its own field, its own grace period. */
          key={asking.turnId}
          block={asking.block}
          t={t}
          initialAnswer={draft}
          onAnswer={ask}
          onDismiss={(typed) => {
            dismissChoice(asking.turnId);
            /* What they had started to write is theirs; it goes back with them. */
            setDraft(typed);
          }}
          fieldRef={setInput}
        />
      ) : (
      <form
        onSubmit={submit}
        className="pb-safe-12 flex shrink-0 flex-col gap-8 border-t border-line px-12 pt-10 md:pb-12"
      >
        <div className="flex items-end gap-8">
          <textarea
            ref={setInput}
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
      )}
    </aside>
  );
}

interface AnswerTurnProps<A extends string> {
  readonly turn: ChatTurn;
  readonly question: string;
  readonly t: Translator;
  readonly language: Language;
  readonly registry: ActionRegistry<A>;
  readonly onAction: (action: ResolvedAction<A>) => void;
  /** Absent when the host keeps no pins; the pin button is then not drawn. */
  readonly pins: CopilotPinning | undefined;
  /** Continue this answer from the round it stopped in. */
  readonly onRetry: (id: string) => void;
  readonly onAsk: (question: string) => void;
  readonly onCancel: () => void;
  /** The seller's message after this answer, when there is one. */
  readonly reply: string | undefined;
  /** Whether this is the latest answer and the thread is at rest. */
  readonly canReply: boolean;
  /** Put a question the seller closed to them again. */
  readonly onReopenChoice: (id: string) => void;
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
function AnswerTurn<A extends string>({
  turn,
  question,
  t,
  language,
  registry,
  onAction,
  pins,
  onAsk,
  onCancel,
  onRetry,
  reply,
  canReply,
  onReopenChoice,
}: AnswerTurnProps<A>): ReactNode {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinned = pins?.isPinned(turn.id) ?? false;

  const isFollowUp = (block: Block): boolean =>
    block.kind === 'action' && block.actionId === ASK_ACTION_ID;

  const body = turn.blocks.filter((block) => !isFollowUp(block));
  const pinnable = pins?.pinnable(turn.blocks) ?? [];
  const followUps = turn.blocks.filter(isFollowUp).flatMap((block) => {
    if (block.kind !== 'action') return [];
    const resolved = registry.resolve(block.actionId, block.params);
    if (resolved === null) return [];
    const params = resolved.params as { question?: unknown };
    return typeof params.question === 'string' ? [params.question] : [];
  });

  /* What a question in this answer needs to know about the conversation. The
     question itself is answered in the form that takes the composer's place —
     see `ChoiceForm` — so all the transcript has to decide is what, if
     anything, to show of it here. */
  const asked = findChoice(turn.blocks);
  const dismissed = turn.choiceDismissed === true;
  const choice: ChoiceContext = {
    open: canReply && turn.pending !== true && !dismissed,
    ...(reply !== undefined ? { reply } : {}),
    dismissed,
    ...(asked !== undefined ? { docked: asked } : {}),
    /* Only while it can still be answered: once the conversation has moved on,
       reopening would ask a question about a thread that is no longer there. */
    ...(dismissed && canReply ? { onReopen: () => onReopenChoice(turn.id) } : {}),
  };

  /* The block the form is holding is not drawn in the transcript, and an answer
     that was nothing but that question has, for now, nothing to draw at all. */
  const phase =
    asked === undefined
      ? null
      : choiceState(
          asked.options.map((option) => phrase(t, option.label)),
          choice,
        ).phase;
  const held = phase === 'open' || phase === 'waiting' ? asked : undefined;

  const meta = turn.meta;
  /* The line the model has not finished writing. It is not a block and never
     becomes one — the block arrives separately when the line ends. */
  const writing = turn.draft ?? '';

  /* A frame around nothing, above a form that already says everything: the
     answer was only a question, it has finished arriving, and the question is
     in the form. The bubble comes back, with the question as its one line, the
     moment the question is dealt with. */
  if (
    held !== undefined &&
    turn.pending !== true &&
    turn.failure === undefined &&
    writing === '' &&
    !hasVisibleBlocks(body, held)
  ) {
    return null;
  }

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
            t={t}
            language={language}
            registry={registry}
            onAction={onAction}
            choice={choice}
          />
        )}

        {writing !== '' && turn.pending === true && <DraftText text={writing} />}

        {/* What stopped, and the offer to carry on. The button is only drawn
            when the run can actually be resumed — a wrong key is not something
            pressing again would fix, so that failure is stated and left. */}
        {turn.failure !== undefined && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-8 rounded-8 border border-neg-line bg-neg-soft px-9 py-8 text-tiny leading-[1.5] text-neg"
          >
            <span className="min-w-0 flex-1">{turn.failure}</span>
            {turn.resumable === true && (
              <button
                type="button"
                onClick={() => onRetry(turn.id)}
                className="tap flex h-26 shrink-0 cursor-pointer items-center gap-5 rounded-6 border border-neg-line bg-transparent px-9 text-tiny text-neg hover:bg-neg-soft"
              >
                <RotateCcw aria-hidden className="size-11" />
                {t('cResume')}
              </button>
            )}
          </div>
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

            {/* Keeping an answer keeps the answer — sentences and figures as
                they were, with the period they were written about. Offered only
                when there is something left to show once the buttons and traces
                are taken out. */}
            {pins !== undefined && pinnable.length > 0 && (
              <button
                type="button"
                disabled={pinned}
                onClick={() =>
                  pins.add({
                    id: turn.id,
                    title: question === '' ? t('askCopilot') : question,
                    blocks: pinnable,
                    createdAt: Date.now(),
                    ...(meta.window !== undefined ? { window: meta.window } : {}),
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
          /* The reasons hover rather than print. They are diagnostics — a schema
             message has no business in the line under an answer — but a seller
             who has seen this twice needs some way to find out which of the
             several things it can mean actually happened. */
          <span className="text-tiny text-warn" title={meta.rejected.join('\n')}>
            {t('droppedBlocks', { n: meta.dropped })}
          </span>
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
