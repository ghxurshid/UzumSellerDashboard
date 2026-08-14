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

  requestConfirm: (request: ConfirmRequest, run: () => void) => void;
  acceptConfirm: () => void;
  cancelConfirm: () => void;

  startProgress: (task: Omit<ProgressTask, 'pct'>) => void;
  setProgress: (pct: number | null) => void;
  endProgress: () => void;
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  confirm: null,
  progress: null,

  requestConfirm: (request, run) => set({ confirm: { ...request, run } }),

  acceptConfirm: () => {
    const entry = get().confirm;
    set({ confirm: null });
    entry?.run();
  },

  cancelConfirm: () => set({ confirm: null }),

  /* Starts indeterminate: a task only gets a percentage once it reports one. */
  startProgress: (task) => set({ progress: { ...task, pct: null } }),
  setProgress: (pct) =>
    set((state) =>
      state.progress === null
        ? state
        : { progress: { ...state.progress, pct: pct === null ? null : Math.min(100, pct) } },
    ),
  endProgress: () => set({ progress: null }),
}));
