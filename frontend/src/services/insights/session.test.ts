import { describe, expect, it } from 'vitest';

import { createSession } from './agent';
import type { Fact, FactTable } from './facts';

/**
 * What survives a failure.
 *
 * A run that stopped is resumed by handing the same session back, so the
 * session is the whole of the promise the retry button makes: the question, the
 * transcript, the lookups already answered and how far the last complete round
 * reached. If any of it were rebuilt instead of carried, "continue" would
 * quietly mean "start again".
 */

const seed = (): FactTable => {
  const fact: Fact = { ref: 'totals.netProfit', label: 'Net profit', value: 12, format: 'money' };
  return new Map([[fact.ref, fact]]);
};

describe('createSession', () => {
  it('opens with the question and the history behind it', () => {
    const session = createSession({
      question: 'Bu oy sellerProfit qayerga ketmoqda?',
      history: [
        { role: 'user', content: 'Avgust qanday?' },
        { role: 'assistant', content: 'Net profit: 12' },
      ],
      seed: new Map(),
    });

    expect(session.messages).toHaveLength(3);
    expect(session.messages[2]).toEqual({
      role: 'user',
      content: 'Bu oy sellerProfit qayerga ketmoqda?',
    });
  });

  it('copies the seed rather than sharing it', () => {
    const table = seed();
    const session = createSession({ question: 'nima?', history: [], seed: table });

    session.facts.delete('totals.netProfit');
    /* The screen's own table is not the run's scratch space. */
    expect(table.has('totals.netProfit')).toBe(true);
  });

  it('starts at the first round with nothing spent', () => {
    const session = createSession({ question: 'nima?', history: [], seed: new Map() });

    expect(session.round).toBe(0);
    expect(session.calls).toBe(0);
    expect(session.emitted).toBe(0);
    expect(session.checkpoint).toBe(0);
    expect(session.answered.size).toBe(0);
    expect(session.plan).toHaveLength(0);
  });
});
