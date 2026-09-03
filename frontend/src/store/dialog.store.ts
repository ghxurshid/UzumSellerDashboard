import { create } from 'zustand';

import type { ConfirmRequest, ProgressTask } from '@/types/domain';

/**
 * Transient overlays: the confirmation prompt and the long-running progress
 * task.
 *
 * Both are singletons by design — a second confirm stacked over the first would
 * leave the user unsure which action they are approving, and the design only
 * ever runs one export/print job at a time.
 */
interface ConfirmEntry extends ConfirmRequest {
  readonly run: () => void;
}

interface DialogState {
  readonly confirm: ConfirmEntry | null;
  readonly progress: ProgressTask | null;
  /**
   * How to stop whatever is running behind the overlay.
   *
   * Held here rather than in the hook because the overlay is one global element
   * while `useProgressTask` is called from several screens: the instance that
   * rendered the Cancel button is not the instance that started the task, so a
   * per-hook ref left the button hiding the overlay while the requests carried
   * on — a bulk order confirmation kept confirming after the user cancelled it.
   */
  readonly abortProgress: (() => void) | null;

  requestConfirm: (request: ConfirmRequest, run: () => void) => void;
  acceptConfirm: () => void;
  cancelConfirm: () => void;

  startProgress: (task: Omit<ProgressTask, 'pct'>, abort?: () => void) => void;
  /** Stop the running task and close the overlay. What the Cancel button does. */
  cancelProgress: () => void;
  setProgress: (pct: number | null) => void;
  endProgress: () => void;
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  confirm: null,
  progress: null,
  abortProgress: null,

  requestConfirm: (request, run) => set({ confirm: { ...request, run } }),

  acceptConfirm: () => {
    const entry = get().confirm;
    set({ confirm: null });
    entry?.run();
  },

  cancelConfirm: () => set({ confirm: null }),

  /* Starts indeterminate: a task only gets a percentage once it reports one. */
  startProgress: (task, abort) =>
    set({ progress: { ...task, pct: null }, abortProgress: abort ?? null }),
  setProgress: (pct) =>
    set((state) =>
      state.progress === null
        ? state
        : { progress: { ...state.progress, pct: pct === null ? null : Math.min(100, pct) } },
    ),
  endProgress: () => set({ progress: null, abortProgress: null }),

  cancelProgress: () => {
    get().abortProgress?.();
    set({ progress: null, abortProgress: null });
  },
}));
