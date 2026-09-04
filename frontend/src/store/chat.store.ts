import { create } from 'zustand';

import { formatClock } from '@/lib/format';
import type { Capability, ExecutedCall } from '@/services/insights/agent';
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
  /** How many times the model went round before it answered. */
  readonly rounds: number;
  /** Lookups it ran on the way. */
  readonly calls: number;
  /** Prefix tokens the provider served from its cache. */
  readonly cachedInputTokens: number;
  /**
   * The lookups behind this answer, in order.
   *
   * Kept because it is what makes an answer *reproducible*: pinning one to the
   * dashboard replays these against whatever period is selected then, so the
   * card shows today's figures rather than a photograph of the day it was
   * written. See `insights/pins.ts`.
   */
  readonly plan: readonly ExecutedCall[];
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
  /**
   * The sentence still arriving, outside the block list.
   *
   * A block is only a block once its line ends, so prose that is halfway
   * written has nowhere legitimate to live — and putting it in `blocks` would
   * make every consumer of a turn handle a paragraph that is about to be
   * replaced. It sits here instead: rendered, never exported, never pinned,
   * never summarised back to the model, and empty again the moment the real
   * block lands.
   */
  readonly draft?: string;
  /**
   * Why this turn stopped, when it stopped badly.
   *
   * On the turn rather than on the panel, because a failure that can be
   * continued has to be shown where the thing to continue is. An empty failed
   * turn is kept for the same reason: it used to be removed as a blank bubble
   * that stated nothing, and a bubble carrying "the model was busy — continue"
   * states quite a lot.
   */
  readonly failure?: string;
  /** Whether the run behind `failure` can be picked up where it stopped. */
  readonly resumable?: boolean;
  readonly meta?: AnswerMeta;
}

interface ChatState {
  readonly messages: readonly ChatTurn[];
  readonly pending: boolean;
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
  /**
   * Capability documents this thread has already been handed.
   *
   * The toolkit and the widget guide are asked for, not pushed — but asking
   * costs a round trip, and a seller's third question should not spend one
   * re-requesting a document that is already three messages up the transcript.
   * So a grant is remembered for the life of the thread and forgotten when the
   * thread is cleared. Mutated in place by the agent; nothing renders it.
   */
  readonly grants: Set<Capability>;

  begin: (question: string) => string;
  /** Streaming: attach blocks to the pending turn as they parse. */
  append: (id: string, blocks: readonly Block[]) => void;
  /** Streaming: the line the model is still writing. Display only. */
  draft: (id: string, text: string) => void;
  /**
   * Cut a turn's blocks back to a length.
   *
   * The one writer is a resumed answer: a round that failed part-way may have
   * already put a paragraph or a trace on screen, and re-running it would write
   * them again underneath. The agent says how far back its last complete round
   * reached; this is that instruction carried out.
   */
  truncate: (id: string, count: number) => void;
  /** Put a failed turn back into flight, before its run is started again. */
  resume: (id: string) => void;
  /** Give the pending turn the tables its refs resolve against. */
  ground: (id: string, facts: FactTable, series: SeriesTable) => void;
  settle: (id: string, meta: AnswerMeta) => void;
  /**
   * Stop a turn badly.
   *
   * `resumable` is the difference between a dead end and a pause: a 503 that
   * three retries could not get past is worth a button, a wrong API key is not.
   */
  fail: (id: string, reason: string, resumable?: boolean) => void;
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
  queued: null,
  deep: true,
  grants: new Set<Capability>(),

  begin: (question) => {
    const answerId = createId();

    set((state) => ({
      pending: true,
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

  draft: (id, text) => {
    /* Called on every chunk of every stream, and most chunks leave the readable
       text unchanged — an unconditional `set` would re-render the whole
       transcript for a paragraph that did not move. */
    const current = get().messages.find((message) => message.id === id);
    if (current === undefined || (current.draft ?? '') === text) return;

    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, draft: text } : message,
      ),
    }));
  },

  append: (id, blocks) => {
    if (blocks.length === 0) return;
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, blocks: [...message.blocks, ...blocks] } : message,
      ),
    }));
  },

  truncate: (id, count) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id && message.blocks.length > count
          ? { ...message, blocks: message.blocks.slice(0, count) }
          : message,
      ),
    })),

  resume: (id) =>
    set((state) => ({
      pending: true,
      messages: state.messages.map((message) =>
        message.id === id
          ? { ...message, pending: true, draft: '', failure: undefined, resumable: false }
          : message,
      ),
    })),

  ground: (id, facts, series) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, facts, series } : message,
      ),
    })),

  settle: (id, meta) =>
    set((state) => ({
      pending: false,
      messages: state.messages.map((message) =>
        message.id === id
          ? { ...message, pending: false, draft: '', failure: undefined, resumable: false, meta }
          : message,
      ),
    })),

  /**
   * The run stopped and the seller has to decide what happens next.
   *
   * Blocks already on screen are kept — a partial answer is worth more than a
   * blank one, and the lookups behind it have been paid for. A draft is not: a
   * sentence cut mid-word will never be completed by the block that was going
   * to carry it, so it goes with the pending flag.
   */
  fail: (id, reason, resumable = false) =>
    set((state) => ({
      pending: false,
      messages: state.messages.map((message) =>
        message.id === id
          ? { ...message, pending: false, draft: '', failure: reason, resumable }
          : message,
      ),
    })),

  queue: (question) => set({ queued: question }),

  claim: () => {
    const { queued } = get();
    if (queued !== null) set({ queued: null });
    return queued;
  },

  setDeep: (deep) => set({ deep }),

  reset: () =>
    set({
      messages: [],
      pending: false,
      queued: null,
      /* A cleared thread is a new conversation, and a new conversation starts
         with the model knowing nothing again — including that a toolkit
         exists. */
      grants: new Set<Capability>(),
    }),
}));
