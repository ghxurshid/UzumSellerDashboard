import { describe, expect, it } from 'vitest';

import type { Block, ChoiceBlock } from '@core/agent/blocks';

import {
  CHOICE_ARM_MS,
  choiceState,
  entryOption,
  findChoice,
  hasVisibleBlocks,
  isArmed,
  nextOption,
  optionForDigit,
  startsTyping,
} from './choiceState';

/**
 * A question the Copilot asked back: where it stands, and what the keys do.
 *
 * The block keeps no state of its own, so everything drawn is decided here from
 * the conversation around it. The cases that matter are the ones where a wrong
 * answer would put a form in front of the seller that must not be there — over
 * an answer still arriving, over a question already answered, over one they
 * closed — or would take a keystroke meant for something else.
 */

const LABELS = ['Oxirgi 7 kun', 'Oxirgi 30 kun', 'Shu yil'];

const CHOICE: ChoiceBlock = {
  kind: 'choice',
  question: 'Qaysi davr?',
  options: LABELS.map((label) => ({ label })),
};

describe('choiceState', () => {
  it('is open on the latest answer when the thread is at rest', () => {
    expect(choiceState(LABELS, { open: true })).toEqual({ phase: 'open', picked: null });
  });

  it('waits while an answer is still in flight', () => {
    expect(choiceState(LABELS, { open: false })).toEqual({ phase: 'waiting', picked: null });
  });

  it('is answered when the next message is one of its labels', () => {
    expect(choiceState(LABELS, { open: false, reply: 'Oxirgi 30 kun' })).toEqual({
      phase: 'answered',
      picked: 1,
    });
  });

  it('reads a label typed by hand as that label', () => {
    expect(choiceState(LABELS, { open: false, reply: '  oxirgi   30 KUN ' }).picked).toBe(1);
  });

  it('is passed when the seller answered in their own words', () => {
    expect(choiceState(LABELS, { open: false, reply: 'Avgust oyi uchun' })).toEqual({
      phase: 'passed',
      picked: null,
    });
  });

  it('is dismissed when the seller closed it, and stays closed', () => {
    expect(choiceState(LABELS, { open: false, dismissed: true })).toEqual({
      phase: 'dismissed',
      picked: null,
    });
    /* `open` cannot be true beside `dismissed` as the panel builds it; if it ever
       were, a closed question must still not be put back in front of the seller. */
    expect(choiceState(LABELS, { open: true, dismissed: true }).phase).toBe('dismissed');
  });

  it('lets a message that followed outrank everything else', () => {
    /* Closed, reopened and answered — or answered by a queued question while it
       was closed — is answered. The conversation is the record. */
    expect(choiceState(LABELS, { open: false, dismissed: true, reply: 'Shu yil' }).phase).toBe(
      'answered',
    );
    expect(choiceState(LABELS, { open: true, reply: 'boshqa' }).phase).toBe('passed');
  });

  it('is a record on a surface with no conversation', () => {
    expect(choiceState(LABELS, undefined)).toEqual({ phase: 'passed', picked: null });
  });
});

describe('findChoice', () => {
  const text: Block = { kind: 'text', text: 'Davrni aniqlab olay.' };
  const second: ChoiceBlock = { ...CHOICE, question: 'Qaysi mahsulot?' };

  it('finds the question an answer asks, also inside a callout', () => {
    expect(findChoice([text, CHOICE])).toBe(CHOICE);
    expect(
      findChoice([text, { kind: 'callout', tone: 'accent', title: 'Savol', blocks: [CHOICE] }]),
    ).toBe(CHOICE);
  });

  it('takes the first when an answer asks two — one question at a time', () => {
    expect(findChoice([CHOICE, second])).toBe(CHOICE);
  });

  it('finds none in an answer that only states', () => {
    expect(findChoice([text])).toBeUndefined();
  });
});

describe('hasVisibleBlocks', () => {
  it('sees nothing to draw in an answer that is only the question in the form', () => {
    expect(hasVisibleBlocks([CHOICE], CHOICE)).toBe(false);
    expect(
      hasVisibleBlocks(
        [{ kind: 'callout', tone: 'accent', title: 'Savol', blocks: [CHOICE] }],
        CHOICE,
      ),
    ).toBe(false);
  });

  it('sees the sentence that led up to it', () => {
    expect(hasVisibleBlocks([{ kind: 'text', text: 'Aniqlab olay.' }, CHOICE], CHOICE)).toBe(true);
  });

  it('sees the question itself once the form no longer holds it', () => {
    expect(hasVisibleBlocks([CHOICE], undefined)).toBe(true);
  });
});

describe('entryOption', () => {
  it('enters at the recommended option, else at the first', () => {
    expect(entryOption([{}, { recommended: true }, {}])).toBe(1);
    expect(entryOption([{}, {}, {}])).toBe(0);
    expect(entryOption([{ recommended: false }, {}])).toBe(0);
  });
});

describe('nextOption', () => {
  it('steps through the options with the arrows', () => {
    expect(nextOption('ArrowDown', 0, 3)).toBe(1);
    expect(nextOption('ArrowUp', 2, 3)).toBe(1);
  });

  it('goes from the last option down into the field for an own answer', () => {
    expect(nextOption('ArrowDown', 2, 3)).toBe('own');
  });

  it('stops at the first option going up', () => {
    expect(nextOption('ArrowUp', 0, 3)).toBeNull();
  });

  it('jumps to either end', () => {
    expect(nextOption('Home', 2, 3)).toBe(0);
    expect(nextOption('End', 0, 3)).toBe(2);
  });

  it('leaves every other key alone', () => {
    expect(nextOption('Enter', 0, 3)).toBeNull();
    expect(nextOption('ArrowLeft', 1, 3)).toBeNull();
    expect(nextOption('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('optionForDigit', () => {
  it('reads a digit as the option it names', () => {
    expect(optionForDigit('1', 3)).toBe(0);
    expect(optionForDigit('3', 3)).toBe(2);
  });

  it('ignores a digit past the last option, zero, and anything that is not a digit', () => {
    expect(optionForDigit('4', 3)).toBeNull();
    expect(optionForDigit('0', 3)).toBeNull();
    expect(optionForDigit('Enter', 3)).toBeNull();
    expect(optionForDigit('12', 3)).toBeNull();
  });
});

describe('startsTyping', () => {
  const key = (value: string, held: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
    key: value,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...held,
  });

  it('takes a letter as the start of an answer in the seller’s own words', () => {
    expect(startsTyping(key('a'))).toBe(true);
    expect(startsTyping(key('Ш'))).toBe(true);
    expect(startsTyping(key('?'))).toBe(true);
  });

  it('leaves the options their own keys', () => {
    /* A digit takes an option and the space bar presses the focused one. */
    expect(startsTyping(key('2'))).toBe(false);
    expect(startsTyping(key(' '))).toBe(false);
  });

  it('is not fooled by a named key or a shortcut', () => {
    expect(startsTyping(key('Enter'))).toBe(false);
    expect(startsTyping(key('ArrowDown'))).toBe(false);
    expect(startsTyping(key('c', { ctrlKey: true }))).toBe(false);
    expect(startsTyping(key('v', { metaKey: true }))).toBe(false);
  });
});

describe('isArmed', () => {
  it('takes no press in the moment the form appears', () => {
    expect(isArmed(1_000, 1_000)).toBe(false);
    expect(isArmed(1_000 + CHOICE_ARM_MS - 1, 1_000)).toBe(false);
  });

  it('takes one once the seller has had time to see it', () => {
    expect(isArmed(1_000 + CHOICE_ARM_MS, 1_000)).toBe(true);
  });
});
