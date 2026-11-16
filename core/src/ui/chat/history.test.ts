import { beforeEach, describe, expect, it } from 'vitest';

import { createSession } from '@core/agent/agent';
import { useChatStore, type AnswerMeta } from '@core/state/chat.store';

import { conversationHistory, HISTORY_TURNS, startQuestion } from './history';

/**
 * What a follow-up question is sent with.
 *
 * The defect these guard against was invisible on screen: every follow-up went
 * to the model twice, once as the last line of the history and once as the
 * question, because the history was read after the question had been added to
 * the thread. Nothing looked wrong; the model simply read each question twice
 * and had one turn less of real history to answer it from.
 *
 * So the assertions are on the messages the session would actually send, built
 * through the same `startQuestion` the panel calls.
 */

const META: AnswerMeta = {
  routes: [],
  elapsedMs: 0,
  costUsd: null,
  dropped: 0,
  rejected: [],
  deep: true,
  rounds: 1,
  calls: 0,
  cachedInputTokens: 0,
};

/** Ask a question and have it answered, the way the panel and the loop do between them. */
function exchange(question: string, answer: string): void {
  const { id } = startQuestion(question, 'uz');
  useChatStore.getState().append(id, [{ kind: 'text', text: answer }]);
  useChatStore.getState().settle(id, META);
}

/** The messages a session opened for `question` would send, as "role: content". */
function sent(question: string): readonly string[] {
  const { history } = startQuestion(question, 'uz');
  /* A session's transcript can also hold tool replies, which have no content of
     their own; a session that has not run yet holds none. */
  return createSession({ question, history }).messages.map((message) =>
    'content' in message ? `${message.role}: ${message.content}` : message.role,
  );
}

beforeEach(() => {
  useChatStore.getState().reset();
});

describe('startQuestion', () => {
  it('sends a first question with nothing before it', () => {
    expect(sent('Sotuvlarim qanday?')).toEqual(['user: Sotuvlarim qanday?']);
  });

  it('sends a follow-up once, after the exchange that came before it', () => {
    exchange('Sotuvlarim qanday?', 'Yaxshi: 312 ta sotildi.');

    expect(sent('Nega?')).toEqual([
      'user: Sotuvlarim qanday?',
      'assistant: Yaxshi: 312 ta sotildi.',
      'user: Nega?',
    ]);
  });

  it('never repeats the question, however long the thread', () => {
    for (let index = 1; index <= 5; index += 1) exchange(`savol ${index}`, `javob ${index}`);

    const messages = sent('oxirgi savol');

    expect(messages.filter((message) => message === 'user: oxirgi savol')).toHaveLength(1);
    expect(messages[messages.length - 1]).toBe('user: oxirgi savol');
    expect(messages[messages.length - 2]).toBe('assistant: javob 5');
  });

  it('spends every place in the history on what came before', () => {
    for (let index = 1; index <= 5; index += 1) exchange(`savol ${index}`, `javob ${index}`);

    /* Three whole exchanges and then the question — not two and a half with the
       question taking the sixth place a second time. */
    expect(sent('oxirgi savol')).toEqual([
      'user: savol 3',
      'assistant: javob 3',
      'user: savol 4',
      'assistant: javob 4',
      'user: savol 5',
      'assistant: javob 5',
      'user: oxirgi savol',
    ]);
  });

  it('opens the turn the answer is streamed into', () => {
    const { id } = startQuestion('Sotuvlarim qanday?', 'uz');
    const { messages, pending } = useChatStore.getState();

    expect(pending).toBe(true);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.text).toBe('Sotuvlarim qanday?');
    expect(messages[1]?.id).toBe(id);
  });

  it('carries the pick after a question the Copilot asked back, once', () => {
    const { id } = startQuestion('Sotuvlarim qanday?', 'uz');
    useChatStore.getState().append(id, [
      {
        kind: 'choice',
        question: 'Qaysi davr?',
        options: [{ label: 'Oxirgi 7 kun' }, { label: 'Oxirgi 30 kun' }],
      },
    ]);
    useChatStore.getState().settle(id, META);

    expect(sent('Oxirgi 30 kun')).toEqual([
      'user: Sotuvlarim qanday?',
      'assistant: [you asked the seller to choose — "Qaysi davr?": Oxirgi 7 kun | Oxirgi 30 kun. Their next message is their answer: one of these labels, or their own words.]',
      'user: Oxirgi 30 kun',
    ]);
  });
});

describe('conversationHistory', () => {
  it('keeps the last few messages and no more', () => {
    for (let index = 1; index <= 5; index += 1) exchange(`savol ${index}`, `javob ${index}`);

    const history = conversationHistory(useChatStore.getState().messages, 'uz');

    expect(history).toHaveLength(HISTORY_TURNS);
    expect(history[0]).toEqual({ role: 'user', content: 'savol 3' });
  });

  it('leaves out an answer that said nothing a summary can hold', () => {
    /* An answer that failed before its first block: there is nothing to send
       back, and an empty assistant turn is not a turn. */
    const { id } = startQuestion('Sotuvlarim qanday?', 'uz');
    useChatStore.getState().fail(id, 'Provayder band');

    expect(conversationHistory(useChatStore.getState().messages, 'uz')).toEqual([
      { role: 'user', content: 'Sotuvlarim qanday?' },
    ]);
  });

  it('says a question was dismissed when the turn that asked it was closed', () => {
    const { id } = startQuestion('Sotuvlarim qanday?', 'uz');
    useChatStore.getState().append(id, [
      { kind: 'choice', question: 'Qaysi davr?', options: [{ label: '7 kun' }, { label: '30 kun' }] },
    ]);
    useChatStore.getState().settle(id, META);
    useChatStore.getState().dismissChoice(id);

    expect(conversationHistory(useChatStore.getState().messages, 'uz')[1]?.content).toContain(
      'They dismissed the question without answering.',
    );
  });
});
