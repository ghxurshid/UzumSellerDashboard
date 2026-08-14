import { AlertCircle, Send, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { IconButton } from '@/components/ui/IconButton';
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
    <aside
      aria-label={t('askCopilot')}
      className="flex w-433 shrink-0 animate-[slide-panel_0.26s_var(--ease-out-soft)] flex-col border-l border-line bg-chrome"
    >
      <header className="flex h-46 shrink-0 items-center gap-9 border-b border-line px-12">
        <Sparkles aria-hidden className="size-14 text-acc-dim" />
        <span className="text-sm font-medium">{t('askCopilot')}</span>
        <span className="truncate text-mini text-faint">{modelLabel}</span>
        <div className="flex-1" />
        <IconButton label={t('copilotClear')} size="xs" onClick={reset} disabled={messages.length === 0}>
          <Trash2 aria-hidden className="size-12" />
        </IconButton>
        <IconButton label={t('mClose')} size="xs" onClick={toggleChat}>
          <X aria-hidden className="size-12" />
        </IconButton>
      </header>

      <div
        ref={logRef}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-11 overflow-auto px-12 py-12"
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
              className="flex h-24 cursor-pointer items-center gap-5 rounded-6 border border-acc bg-acc-soft px-9 text-xs text-acc-dim hover:bg-acc-strong"
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
                  className="cursor-pointer rounded-8 border border-line px-10 py-8 text-left text-xs-plus text-dim transition-colors hover:border-acc-line hover:text-acc-dim"
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
                    className="cursor-pointer border-0 bg-transparent p-0 text-tiny text-acc-dim underline underline-offset-2"
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

      <form onSubmit={submit} className="flex shrink-0 items-end gap-8 border-t border-line p-12">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
          rows={2}
          placeholder={t('copilotPh')}
          aria-label={t('copilotPh')}
          className="min-h-44 flex-1 resize-none rounded-8 border border-line-2 bg-panel px-10 py-8 text-sm text-text outline-none placeholder:text-faint focus-visible:border-acc"
        />
        <button
          type="submit"
          disabled={draft.trim() === '' || pending || unconfigured}
          aria-label={t('copilotSend')}
          className="flex size-32 shrink-0 cursor-pointer items-center justify-center rounded-8 border border-acc bg-acc-soft text-acc-dim transition-colors hover:bg-acc-strong disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Send aria-hidden className="size-14" />
        </button>
      </form>
    </aside>
  );
}
