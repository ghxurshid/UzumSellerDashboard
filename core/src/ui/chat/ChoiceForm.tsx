import { Send } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import type { ChoiceBlock } from '@core/agent/blocks';
import { phrase } from '@core/agent/phrase';
import { useIsTouch } from '@core/hooks/useMediaQuery';
import type { Translator } from '@core/i18n/useTranslation';
import { cn } from '@core/lib/utils';
import {
  entryOption,
  isArmed,
  nextOption,
  optionForDigit,
  startsTyping,
} from '@core/ui/blocks/choiceState';
import { Pill } from '@core/ui/kit/Pill';

/**
 * A question the Copilot asked, standing where the composer stood.
 *
 * When the model needs something decided before it can answer, the seller's
 * next move is to decide it. So the question does not wait in the transcript
 * for them to notice: it takes the composer's place, takes the focus, and holds
 * both until it has been dealt with. There is nothing else to type into, which
 * is the whole of what makes it a modal form — the transcript above stays
 * readable and scrollable, because what is in it may be what the answer
 * depends on.
 *
 * ## Three ways out, and only three
 *
 *   an option        one press. The label goes out as the seller's message.
 *   their own words  the field under the options, for an answer that is none
 *                    of them. It is the composer's stand-in — same shape, same
 *                    keys — so nothing has to be learned to use it.
 *   dismiss          closes the question unanswered and gives the composer back.
 *                    Escape does the same from anywhere in the panel.
 *
 * ## The keyboard
 *
 * Focus lands on the option the author recommended, or the first. The list is
 * one tab stop with the arrows moving inside it; down from the last option
 * arrives in the field and up from an empty field returns. The digit on each
 * row is a key that takes that option. Starting to type on the list is starting
 * an answer, so the first character goes to the field. Tab cycles inside the
 * form rather than leaving it.
 *
 * ## What the seller was already doing
 *
 * The form appears at a moment the seller does not choose. Two things keep it
 * from being answered by accident. Whatever they had typed in the composer is
 * carried into the field and the caret stays in it, so a sentence in progress
 * is still a sentence in progress — and its digits are text, never option keys.
 * And for the first third of a second the form takes no press at all
 * (`CHOICE_ARM_MS`): a click already on its way to the send button lands on
 * nothing.
 *
 * It is a `dialog` to assistive technology and to the host's own Escape
 * handling, which leaves the key alone while a dialog is open. It is not marked
 * `aria-modal`: that would hide the transcript from a screen reader, and the
 * transcript is the context the question is about.
 */
export interface ChoiceFormProps {
  readonly block: ChoiceBlock;
  readonly t: Translator;
  /** What the seller had typed in the composer when the question arrived. */
  readonly initialAnswer: string;
  /** Send an answer — an option's label, or the seller's own words. */
  readonly onAnswer: (reply: string) => void;
  /** Close the question unanswered. Given what was typed, so it is not lost. */
  readonly onDismiss: (typed: string) => void;
  /**
   * The field for the seller's own words, handed to whoever holds the composer.
   * While the form is up this field *is* the composer, and a host that focuses
   * the composer when its frame is shown should land here.
   */
  readonly fieldRef?: (node: HTMLTextAreaElement | null) => void;
}

export function ChoiceForm({
  block,
  t,
  initialAnswer,
  onAnswer,
  onDismiss,
  fieldRef,
}: ChoiceFormProps): ReactNode {
  const isTouch = useIsTouch();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const shownAt = useRef(Date.now());

  const [entry, setEntry] = useState(() => entryOption(block.options));
  const [own, setOwn] = useState(initialAnswer);

  const labels = block.options.map((option) => phrase(t, option.label));
  const count = labels.length;

  const setField = useCallback(
    (node: HTMLTextAreaElement | null): void => {
      ownRef.current = node;
      fieldRef?.(node);
    },
    [fieldRef],
  );

  const focusOption = (index: number): void => {
    setEntry(index);
    listRef.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
  };

  /* Take the focus once, when the question arrives. Into the field when the
     seller was mid-sentence, with the caret after what they wrote; otherwise
     onto the option the list is entered at. */
  useEffect(() => {
    if (initialAnswer !== '') {
      const field = ownRef.current;
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
      return;
    }
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>('button');
    rows?.[entryOption(block.options)]?.focus();
    /* Once per question: the form is keyed by the turn that asked it. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (index: number): void => {
    const label = labels[index];
    if (label === undefined || !isArmed(Date.now(), shownAt.current)) return;
    onAnswer(label);
  };

  const sendOwn = (): void => {
    const text = own.trim();
    if (text === '') return;
    onAnswer(text);
  };

  const dismiss = useCallback((): void => {
    if (!isArmed(Date.now(), shownAt.current)) return;
    onDismiss(ownRef.current?.value ?? '');
  }, [onDismiss]);

  /* Escape closes the question from anywhere in the panel, not only from inside
     the form: a seller who clicked into the transcript to read something still
     expects the key to mean what it means on a form. Bubble phase, and only an
     Escape nothing else has claimed — an open menu or a text composition keeps
     its own. */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss]);

  /* Tab stays inside the form. The list is one stop, so the cycle is short:
     the list, the field, send when there is something to send, dismiss. */
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const stops = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), textarea',
      ) ?? []),
    ];
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const digit = optionForDigit(event.key, count);
    if (digit !== null) {
      event.preventDefault();
      pick(digit);
      return;
    }

    /* Not prevented on purpose: the field has the focus by the time the key
       is turned into a character, so the character is typed into it. */
    if (startsTyping(event)) {
      ownRef.current?.focus();
      return;
    }

    const target = nextOption(event.key, entry, count);
    if (target === null) return;
    event.preventDefault();
    if (target === 'own') ownRef.current?.focus();
    else focusOption(target);
  };

  const onOwnKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    /* On a soft keyboard Enter is the newline key, as it is in the composer. */
    if (event.key === 'Enter' && !event.shiftKey && !isTouch) {
      event.preventDefault();
      sendOwn();
      return;
    }
    const field = event.currentTarget;
    if (event.key === 'ArrowUp' && field.selectionStart === 0 && field.selectionEnd === 0) {
      event.preventDefault();
      focusOption(count - 1);
    }
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    sendOwn();
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={titleId}
      data-choice-form
      onKeyDown={onRootKeyDown}
      className={cn(
        'pb-safe-12 flex max-h-[72%] shrink-0 flex-col gap-9 overflow-y-auto overscroll-contain',
        'border-t border-acc-line bg-panel px-12 pt-11 md:pb-12',
        'animate-[rise_0.22s_var(--ease-out-soft)]',
      )}
    >
      <div className="flex flex-col gap-2">
        <p id={titleId} className="m-0 text-sm font-medium leading-[1.45] text-text">
          {phrase(t, block.question)}
        </p>
        {block.note !== undefined && (
          <p className="m-0 text-xs leading-[1.5] text-dim">{phrase(t, block.note)}</p>
        )}
      </div>

      <div
        ref={listRef}
        role="group"
        aria-labelledby={titleId}
        onKeyDown={onListKeyDown}
        className="flex shrink-0 flex-col overflow-hidden rounded-8 border border-acc-line"
      >
        {block.options.map((option, index) => (
          <button
            key={index}
            type="button"
            tabIndex={index === entry ? 0 : -1}
            onClick={() => pick(index)}
            onFocus={() => setEntry(index)}
            className={cn(
              'group flex w-full cursor-pointer items-start gap-9 border-0 border-t border-line',
              'bg-transparent px-10 py-8 text-left first:border-t-0',
              'hover:bg-acc-soft focus-visible:bg-acc-soft focus-visible:-outline-offset-2',
              'active:bg-acc-strong',
              isTouch && 'min-h-44',
            )}
          >
            {isTouch ? (
              <span
                aria-hidden
                className="size-18 shrink-0 rounded-full border border-line-2 group-hover:border-acc-line"
              />
            ) : (
              <span
                aria-hidden
                data-numeric
                className={cn(
                  'flex size-18 shrink-0 items-center justify-center rounded-5 border border-line-2',
                  'text-tiny text-dim group-hover:border-acc-line group-hover:text-acc-dim',
                  'group-focus-visible:border-acc-line group-focus-visible:text-acc-dim',
                )}
              >
                {index + 1}
              </span>
            )}

            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-7 gap-y-2">
                <span className="text-xs-plus leading-[1.45] text-text">{labels[index]}</span>
                {option.recommended === true && (
                  <Pill size="sm" tone="accent">
                    {t('choiceRecommended')}
                  </Pill>
                )}
              </span>
              {option.description !== undefined && option.description !== '' && (
                <span className="text-xs leading-[1.45] text-dim">
                  {phrase(t, option.description)}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex shrink-0 items-end gap-8">
        <textarea
          ref={setField}
          value={own}
          onChange={(event) => setOwn(event.target.value)}
          onKeyDown={onOwnKeyDown}
          rows={1}
          placeholder={t('choiceOwnAnswer')}
          aria-label={t('choiceOwnAnswer')}
          enterKeyHint="send"
          className="min-h-44 min-w-0 flex-1 resize-none rounded-8 border border-line-2 bg-chrome px-10 py-8 text-sm text-text outline-none placeholder:text-faint focus-visible:border-acc md:min-h-32"
        />
        <button
          type="submit"
          disabled={own.trim() === ''}
          aria-label={t('copilotSend')}
          className="flex size-44 shrink-0 cursor-pointer items-center justify-center rounded-8 border border-acc bg-acc-soft text-acc-dim transition-colors hover:bg-acc-strong disabled:cursor-not-allowed disabled:opacity-45 md:size-32"
        >
          <Send aria-hidden className="size-16 md:size-14" />
        </button>
      </form>

      <div className="flex shrink-0 items-center gap-7">
        <button
          type="button"
          onClick={dismiss}
          className="tap cursor-pointer border-0 bg-transparent p-0 text-tiny text-dim underline-offset-2 hover:text-acc-dim hover:underline"
        >
          {t('choiceDismiss')}
        </button>
        {!isTouch && (
          <kbd
            aria-hidden
            className="rounded-4 border border-line-2 px-4 font-sans text-meta leading-[1.6] text-faint"
          >
            Esc
          </kbd>
        )}
      </div>
    </div>
  );
}
