import { create } from 'zustand';

import { formatClock } from '@/lib/format';
import type { ChatMessage } from '@/types/domain';

interface ChatState {
  readonly messages: readonly ChatMessage[];
  readonly pending: boolean;
  /** The last failure, kept so the thread can offer a retry. */
  readonly error: string | null;

  /** Records the question and an empty assistant turn; returns its id. */
  begin: (question: string) => string;
  /** Fills the pending turn with the model's answer. */
  settle: (id: string, text: string) => void;
  /** Marks the pending turn as failed and surfaces the reason. */
  fail: (id: string, reason: string) => void;
  reset: () => void;
}

function now(): string {
  return formatClock(Date.now());
}

function createId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Copilot thread.
 *
 * The store owns the transcript and nothing else: the answer comes from the
 * configured provider over the network, so the pending turn stays pending for
 * exactly as long as that request takes and turns into an error if it fails.
 * No timer stands in for a reply.
 */
export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  pending: false,
  error: null,

  begin: (question) => {
    const answerId = createId();

    set((state) => ({
      pending: true,
      error: null,
      messages: [
        ...state.messages,
        { id: createId(), role: 'user', text: question, time: now() },
        { id: answerId, role: 'assistant', text: '', time: now(), pending: true },
      ],
    }));

    return answerId;
  },

  settle: (id, text) =>
    set((state) => ({
      pending: false,
      error: null,
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, text, pending: false } : message,
      ),
    })),

  fail: (id, reason) =>
    set((state) => ({
      pending: false,
      error: reason,
      /* Drop the empty turn rather than leaving a blank bubble behind. */
      messages: state.messages.filter((message) => message.id !== id),
    })),

  reset: () => set({ messages: [], pending: false, error: null }),
}));
