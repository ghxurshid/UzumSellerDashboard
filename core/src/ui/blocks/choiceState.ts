import type { Block, ChoiceBlock } from '@core/agent/blocks';

/**
 * Where a `choice` block stands, read off the conversation around it.
 *
 * The block itself carries no state — see `ChoiceBlock` in `blocks.ts`. What it
 * shows is decided by facts the transcript already holds: whether a message
 * followed it, whether that message is one of its own labels, and whether the
 * seller closed it. Kept apart from the components so the phases and the keys
 * can be checked without a DOM.
 *
 * ## Two places, one question
 *
 * While a question is open it is not drawn in the transcript at all. It takes
 * the composer's place as a form (`ChoiceForm`) — the seller's next move is to
 * answer it, so it sits where their next move is made. The transcript gets the
 * question back as a line of the conversation once it has been dealt with.
 */

/**
 * What the surface drawing an answer knows about the conversation around it.
 *
 * A surface with no conversation — the insight rail, a pinned card — passes
 * nothing, and a choice there is a record of what was asked.
 */
export interface ChoiceContext {
  /** Whether an answer can be taken now: this is the latest answer and nothing is in flight. */
  readonly open: boolean;
  /** The seller's next message, when there is one. */
  readonly reply?: string;
  /** The seller closed the question without answering. */
  readonly dismissed?: boolean;
  /**
   * The block this answer puts to the seller in the form — the first choice in
   * it. Any other choice in the same answer cannot be asked at the same time and
   * is drawn as a record.
   */
  readonly docked?: ChoiceBlock;
  /** Put a closed question to the seller again. Absent when it can no longer be answered. */
  readonly onReopen?: () => void;
}

/**
 * `open`       the form is up and the seller can answer.
 * `waiting`    the answer is still arriving, or another is in flight.
 * `answered`   the message that followed is one of the options.
 * `passed`     the conversation moved on with something else — the seller's own words.
 * `dismissed`  the seller closed the question.
 */
export type ChoicePhase = 'open' | 'waiting' | 'answered' | 'passed' | 'dismissed';

export interface ChoiceState {
  readonly phase: ChoicePhase;
  /** Index of the option that was taken, in `answered`. */
  readonly picked: number | null;
}

/** Case and spacing do not make a different answer: a label typed by hand is still that label. */
const normalise = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

export function choiceState(
  labels: readonly string[],
  context: Pick<ChoiceContext, 'open' | 'reply' | 'dismissed'> | undefined,
): ChoiceState {
  if (context === undefined) return { phase: 'passed', picked: null };

  /* A message that followed settles it, whatever else is recorded: a question
     that was closed and then answered anyway was answered. */
  if (context.reply !== undefined) {
    const reply = normalise(context.reply);
    const picked = labels.findIndex((label) => normalise(label) === reply);
    return picked === -1 ? { phase: 'passed', picked: null } : { phase: 'answered', picked };
  }

  if (context.dismissed === true) return { phase: 'dismissed', picked: null };

  return { phase: context.open ? 'open' : 'waiting', picked: null };
}

/**
 * The question an answer puts to the seller: its first `choice`, wherever it sits.
 *
 * One at a time. A form that takes the composer's place can hold one question,
 * and a second asked in the same breath could only be answered by guessing which
 * of the two a typed reply was meant for.
 */
export function findChoice(blocks: readonly Block[]): ChoiceBlock | undefined {
  for (const block of blocks) {
    if (block.kind === 'choice') return block;
    if (block.kind === 'callout') {
      const inner = findChoice(block.blocks);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/**
 * Whether drawing these blocks puts anything on screen while `docked` is in the form.
 *
 * An answer that is only a question has nothing to show in the transcript until
 * the question is dealt with, and an empty bubble above the form would be a
 * frame around nothing.
 */
export function hasVisibleBlocks(blocks: readonly Block[], docked: ChoiceBlock | undefined): boolean {
  return blocks.some((block) => {
    if (block === docked) return false;
    if (block.kind === 'callout') return hasVisibleBlocks(block.blocks, docked);
    return true;
  });
}

/**
 * Which option the keyboard lands on first: the recommended one, else the first.
 *
 * The list is a single tab stop with the arrow keys moving inside it, so one
 * option has to be the way in — and the author's suggestion is the honest
 * default for it.
 */
export function entryOption(options: ReadonlyArray<{ readonly recommended?: boolean }>): number {
  const recommended = options.findIndex((option) => option.recommended === true);
  return recommended === -1 ? 0 : recommended;
}

/**
 * Where a key moves to from option `current`.
 *
 * A number is another option. `'own'` is the field under the list, where the
 * seller writes an answer of their own: the list and the field are one column,
 * so down from the last option arrives there instead of wrapping to the top.
 * `null` is a key that moves nowhere.
 */
export function nextOption(key: string, current: number, count: number): number | 'own' | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current >= count - 1 ? 'own' : current + 1;
    case 'ArrowUp':
      return current <= 0 ? null : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** The option a digit key names — `1` is the first — or null when it names none. */
export function optionForDigit(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return index < count ? index : null;
}

/**
 * Whether a key pressed on the list is the start of a typed answer.
 *
 * A seller who starts typing means to answer in their own words, so the first
 * character takes them to the field instead of being lost on a row of buttons.
 * Digits are the options' own keys and the space bar presses the focused one;
 * everything else that prints is text.
 */
export function startsTyping(event: {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.key.length === 1 && event.key !== ' ' && !/^[0-9]$/.test(event.key);
}

/**
 * How long after the form appears before it takes a press.
 *
 * It appears where the composer was, at a moment the seller does not choose. A
 * click already on its way to the send button, or a digit already on its way to
 * the composer, would otherwise answer a question nobody had read yet. Shorter
 * than anyone can read an option and decide; long enough to swallow a press that
 * was aimed at what stood there before.
 */
export const CHOICE_ARM_MS = 350;

export function isArmed(now: number, shownAt: number): boolean {
  return now - shownAt >= CHOICE_ARM_MS;
}
