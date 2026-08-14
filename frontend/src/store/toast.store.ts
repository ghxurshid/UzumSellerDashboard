import { create } from 'zustand';

import { TOAST_TIMEOUT_MS } from '@/constants/app';
import type { Toast, ToastKind } from '@/types/domain';

export interface ToastOptions {
  readonly kind?: ToastKind;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly sticky?: boolean;
  readonly durationMs?: number;
}

interface ToastEntry extends Toast {
  readonly onAction?: () => void;
}

interface ToastState {
  readonly toasts: readonly ToastEntry[];
  push: (text: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  runAction: (id: string) => void;
  clear: () => void;
}

/**
 * Toast queue.
 *
 * Timers are held outside the store so a dismissal cancels its own timeout
 * instead of leaving an orphaned callback that pops the *next* toast early.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (text, options = {}) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: ToastEntry = {
      id,
      text,
      kind: options.kind ?? 'ok',
      ...(options.actionLabel !== undefined ? { actionLabel: options.actionLabel } : {}),
      ...(options.onAction !== undefined ? { onAction: options.onAction } : {}),
      ...(options.sticky !== undefined ? { sticky: options.sticky } : {}),
    };

    set((state) => ({ toasts: [...state.toasts, entry] }));

    if (!options.sticky) {
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), options.durationMs ?? TOAST_TIMEOUT_MS),
      );
    }
    return id;
  },

  dismiss: (id) => {
    clearTimer(id);
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  runAction: (id) => {
    const toast = get().toasts.find((item) => item.id === id);
    get().dismiss(id);
    toast?.onAction?.();
  },

  clear: () => {
    for (const id of timers.keys()) clearTimer(id);
    set({ toasts: [] });
  },
}));

/** Imperative entry point for non-React callers (query `onError`, interceptors). */
export const toast = (text: string, options?: ToastOptions): string =>
  useToastStore.getState().push(text, options);
