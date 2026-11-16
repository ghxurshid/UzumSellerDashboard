import { summariseAnswer, type AgentMessage } from '@core/agent/agent';
import { useChatStore, type ChatTurn } from '@core/state/chat.store';
import type { Language } from '@core/types/common';

/**
 * What a new question is sent with: the conversation that came before it.
 *
 * ## Before, not including
 *
 * The session puts the question at the end of the history itself
 * (`createSession`), so the history must stop short of it. That sounds too
 * obvious to write down, and it was got wrong for exactly that reason: the
 * history used to be read from the store *after* the new question had been
 * added to it, with only the empty answer filtered back out. Every follow-up
 * therefore reached the model twice — once as the last line of the history and
 * once as the question — and one of the six places the history has was spent
 * on the repeat.
 *
 * `startQuestion` is the fix made structural: it reads the transcript, then
 * opens the new turn, in that order, in one function. There is no moment at
 * which a caller holds both the new turn and a history still to be built.
 */

/** How many earlier messages ride along. Three exchanges is enough for "and that one?". */
export const HISTORY_TURNS = 6;

/**
 * Earlier turns, flattened to what the model needs of them.
 *
 * A question goes back as it was asked. An answer goes back as a summary of
 * what it said — see `summariseAnswer` — and an answer that said nothing a
 * summary can hold (it failed before its first block, or was only a button) is
 * left out rather than sent as an empty turn.
 */
export function conversationHistory(
  turns: readonly ChatTurn[],
  language: Language,
): readonly AgentMessage[] {
  return turns
    .slice(-HISTORY_TURNS)
    .map((turn) => ({
      role: turn.role,
      content:
        turn.role === 'user'
          ? turn.text
          : summariseAnswer(turn.blocks, language, {
              choiceDismissed: turn.choiceDismissed === true,
            }),
    }))
    .filter((message) => message.content !== '');
}

/**
 * Open a new question in the thread, and say what came before it.
 *
 * `id` is the answer turn to stream into. `history` is the transcript as it
 * stood the instant before the question was added — never containing it.
 */
export function startQuestion(
  question: string,
  language: Language,
): { readonly id: string; readonly history: readonly AgentMessage[] } {
  const history = conversationHistory(useChatStore.getState().messages, language);
  const id = useChatStore.getState().begin(question);
  return { id, history };
}
