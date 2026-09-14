import { describe, expect, it } from 'vitest';

import { createSession, type Capability } from './agent';

/**
 * What survives a failure.
 *
 * A run that stopped is resumed by handing the same session back, so the
 * session is the whole of the promise the retry button makes: the question, the
 * transcript, the lookups already answered and how far the last complete round
 * reached. If any of it were rebuilt instead of carried, "continue" would
 * quietly mean "start again".
 */

describe('createSession', () => {
  it('opens with the question and the history behind it', () => {
    const session = createSession({
      question: 'Bu oy sellerProfit qayerga ketmoqda?',
      history: [
        { role: 'user', content: 'Avgust qanday?' },
        { role: 'assistant', content: "Sof foyda: 457 924 so'm" },
      ],
    });

    expect(session.messages).toHaveLength(3);
    expect(session.messages[2]).toEqual({
      role: 'user',
      content: 'Bu oy sellerProfit qayerga ketmoqda?',
    });
  });

  it('copies the documents the thread holds rather than sharing the set', () => {
    const grants = new Set<Capability>(['widgets']);
    const session = createSession({ question: 'nima?', history: [], carried: grants });

    /* A document granted during this question lands in the thread's set — and
       must not appear in this question's system prompt as well as its
       transcript. */
    grants.add('tools');
    expect(session.carried.has('tools')).toBe(false);
    expect(session.carried.has('widgets')).toBe(true);
  });

  it('starts at the first round with nothing spent', () => {
    const session = createSession({ question: 'nima?', history: [] });

    expect(session.round).toBe(0);
    expect(session.calls).toBe(0);
    expect(session.emitted).toBe(0);
    expect(session.checkpoint).toBe(0);
    expect(session.answered.size).toBe(0);
    expect(session.carried.size).toBe(0);
  });
});
