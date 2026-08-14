import { AlertCircle, Send, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { IconButton } from '@/components/ui/IconButton';
import { useIsTouch } from '@/hooks/useMediaQuery';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat.store';
import { useAiModelLabel } from '@/store/settings.store';
import { useUiStore } from '@/store/ui.store';

import { useCopilotAnswers } from './useCopilotAnswers';

/**
 * The Copilot side panel.
 *
 * The transcript is an `aria-live="polite"` log so a reply is announced when it
 * lands, and the composer submits through a real `<form>` — Enter sends,
 * Shift+Enter breaks the line, which is what a chat input is expected to do.
 */
export function CopilotPanel(): ReactNode {
  const { t } = useTranslation();
  const modelLabel = useAiModelLabel();
  const isTouch = useIsTouch();

  const chatOpen = useUiStore((state) => state.chatOpen);
  const toggleChat = useUiStore((state) => state.toggleChat);

  const navigate = useNavigate();
  const messages = useChatStore((state) => state.messages);
  const pending = useChatStore((state) => state.pending);
  const error = useChatStore((state) => state.error);
  const reset = useChatStore((state) => state.reset);

  const { ask, cancel, suggestions, unconfigured } = useCopilotAnswers();
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex max-w-[92%] flex-col gap-4 rounded-9 px-11 py-9 text-xs-plus leading-[1.6]',
                message.role === 'user'
                  ? 'self-end border border-acc-line bg-acc-soft text-text'
                  : 'self-start border border-line bg-panel text-dim',
              )}
            >
              {message.pending === true ? (
                <span className="flex items-center gap-7 text-faint">
                  <span className="size-9 animate-[pulse-ring_1.4s_infinite] rounded-full bg-acc" />
                  {t('copilotThinking')}
                  <button
                    type="button"
                    onClick={cancel}
                    className="tap cursor-pointer border-0 bg-transparent p-0 text-tiny text-acc-dim underline underline-offset-2"
                  >
                    {t('cancel')}
                  </button>
                </span>
              ) : (
                <span>{message.text}</span>
              )}
              <span className="text-tiny text-faint">{message.time}</span>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={submit}
        className="pb-safe-12 flex shrink-0 items-end gap-8 border-t border-line px-12 pt-12 md:pb-12"
      >
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
      </form>
    </aside>
  );
}
