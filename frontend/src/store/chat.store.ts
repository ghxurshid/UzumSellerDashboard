import { create } from 'zustand';

import { formatClock } from '@/lib/format';
import type { Block } from '@/services/insights/blocks';
import type { FactTable, SeriesTable } from '@/services/insights/facts';
import { EMPTY_SERIES } from '@/services/insights/facts';
import type { ChatRole } from '@/types/domain';

/**
 * Copilot thread.
 *
 * The store owns the transcript and nothing else: the answer comes from the
 * configured provider over the network, so a pending turn stays pending for
 * exactly as long as that request takes and turns into an error if it fails. No
 * timer stands in for a reply.
 *
 * ## An answer is a document, not a string
 *
 * A turn carries blocks, and the fact table that resolves them. Keeping the
 * facts *per turn* is what makes an old answer keep meaning what it meant: the
 * period selector moves, the totals change, and a message from three questions
 * ago still renders the figures it was written about rather than silently
 * re-resolving to today's. The alternative — one shared table — would quietly
 * rewrite history every time the scope changed.
 */

export interface AnswerMeta {
  /** Routes the retrieval phase touched, for the context chip. */
  readonly routes: readonly string[];
  readonly elapsedMs: number;
  /** Dollars, or `null` when this model's price is not known. */
  readonly costUsd: number | null;
  /** Lines the model sent that did not validate. Shown, never hidden. */
  readonly dropped: number;
  readonly deep: boolean;
}

export interface ChatTurn {
  readonly id: string;
  readonly role: ChatRole;
  /** The question, for a user turn. Empty for an assistant turn. */
  readonly text: string;
  readonly blocks: readonly Block[];
  readonly facts: FactTable;
  readonly series: SeriesTable;
  readonly time: string;
  readonly pending?: boolean;
  readonly meta?: AnswerMeta;
}

interface ChatState {
  readonly messages: readonly ChatTurn[];
  readonly pending: boolean;
  readonly error: string | null;
  /**
   * A question asked from somewhere other than the composer.
   *
   * An insight card's *Ask why* has a question but no access to the panel's
   * `ask` — that closure belongs to `useCopilotAnswers`, which only the panel
   * mounts. So the card leaves the question here and the panel picks it up when
   * it opens, which also means the question survives the panel not being
   * mounted yet.
   */
  readonly queued: string | null;
  /**
   * Whether to plan and retrieve before answering.
   *
   * Not a cosmetic switch: it selects the protocol. Off, the model answers from
   * the standing totals in one call. On, it first asks for the lookups the
   * question needs, the app runs them, and the answer is composed over what came
   * back — two calls, more context, a better answer to anything the standing
   * totals do not already contain.
   */
  readonly deep: boolean;

  begin: (question: string) => string;
  /** Streaming: attach blocks to the pending turn as they parse. */
  append: (id: string, blocks: readonly Block[]) => void;
  /** Give the pending turn the tables its refs resolve against. */
  ground: (id: string, facts: FactTable, series: SeriesTable) => void;
  settle: (id: string, meta: AnswerMeta) => void;
  fail: (id: string, reason: string) => void;
  queue: (question: string) => void;
  claim: () => string | null;
  setDeep: (deep: boolean) => void;
  reset: () => void;
}

function now(): string {
  return formatClock(Date.now());
}

function createId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const EMPTY_FACTS: FactTable = new Map();

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  pending: false,
  error: null,
  queued: null,
  deep: true,

  begin: (question) => {
    const answerId = createId();

    set((state) => ({
      pending: true,
      error: null,
      messages: [
        ...state.messages,
        {
          id: createId(),
          role: 'user',
          text: question,
          blocks: [],
          facts: EMPTY_FACTS,
          series: EMPTY_SERIES,
          time: now(),
        },
        {
          id: answerId,
          role: 'assistant',
          text: '',
          blocks: [],
          facts: EMPTY_FACTS,
          series: EMPTY_SERIES,
          time: now(),
          pending: true,
        },
      ],
    }));

    return answerId;
  },

  append: (id, blocks) => {
    if (blocks.length === 0) return;
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, blocks: [...message.blocks, ...blocks] } : message,
      ),
    }));
  },

  ground: (id, facts, series) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, facts, series } : message,
      ),
    })),

  settle: (id, meta) =>
    set((state) => ({
      pending: false,
      error: null,
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, pending: false, meta } : message,
      ),
    })),

  fail: (id, reason) =>
    set((state) => {
      const turn = state.messages.find((message) => message.id === id);

      /* A stream that failed part-way has already put blocks on screen, and
         throwing them away would be a worse answer than the partial one. So a
         turn with content is kept and merely stops being pending; only an empty
         one is removed, because a blank bubble states nothing. */
      const keep = turn !== undefined && turn.blocks.length > 0;

      return {
        pending: false,
        error: reason,
        messages: keep
          ? state.messages.map((message) =>
              message.id === id ? { ...message, pending: false } : message,
            )
          : state.messages.filter((message) => message.id !== id),
      };
    }),

  queue: (question) => set({ queued: question }),

  claim: () => {
    const { queued } = get();
    if (queued !== null) set({ queued: null });
    return queued;
  },

  setDeep: (deep) => set({ deep }),

  reset: () => set({ messages: [], pending: false, error: null, queued: null }),
}));
