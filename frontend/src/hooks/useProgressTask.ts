import { useCallback, useEffect, useRef } from 'react';

import { useDialogStore } from '@/store/dialog.store';
import type { ProgressTask } from '@/types/domain';

/**
 * Runs a real operation behind the progress overlay.
 *
 * The task owns its own progress: it is handed a `report(done, total)` callback
 * and an `AbortSignal`, and the bar shows exactly what it reports. Work that
 * cannot be counted — one request of unknown duration — simply never calls
 * `report`, and the bar stays indeterminate instead of pretending.
 *
 * Cancellation aborts the signal the task was given, so an in-flight request is
 * actually stopped rather than merely hidden.
 */

export interface ProgressHandle {
  /** Report countable progress. Calling it switches the bar to determinate. */
  readonly report: (done: number, total: number) => void;
  readonly signal: AbortSignal;
}

export interface RunOptions<T> extends Omit<ProgressTask, 'pct' | 'cancellable'> {
  readonly cancellable?: boolean;
  readonly task: (handle: ProgressHandle) => Promise<T>;
  readonly onDone?: (result: T) => void;
  readonly onError?: (error: unknown) => void;
  /** Called on user cancellation, after the signal has been aborted. */
  readonly onCancelled?: () => void;
}

export interface UseProgressTaskResult {
  readonly run: <T>(options: RunOptions<T>) => Promise<T | undefined>;
  readonly cancel: () => void;
}

export function useProgressTask(): UseProgressTaskResult {
  const startProgress = useDialogStore((state) => state.startProgress);
  const setProgress = useDialogStore((state) => state.setProgress);
  const endProgress = useDialogStore((state) => state.endProgress);

  const controllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  /* An operation must not outlive the screen that started it. */
  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    controllerRef.current?.abort();
    endProgress();
  }, [endProgress]);

  const run = useCallback(
    async <T,>({
      task,
      onDone,
      onError,
      onCancelled,
      cancellable = true,
      ...descriptor
    }: RunOptions<T>): Promise<T | undefined> => {
      controllerRef.current?.abort();

      const controller = new AbortController();
      controllerRef.current = controller;
      cancelledRef.current = false;

      /* Registered with the store so the global overlay's Cancel button aborts
         *this* controller, whichever screen created it. */
      startProgress({ ...descriptor, cancellable }, () => {
        cancelledRef.current = true;
        controller.abort();
      });

      const report = (done: number, total: number): void => {
        if (controller.signal.aborted) return;
        setProgress(total === 0 ? 100 : Math.min(100, (done / total) * 100));
      };

      try {
        const result = await task({ report, signal: controller.signal });
        if (controller.signal.aborted) {
          onCancelled?.();
          return undefined;
        }

        endProgress();
        onDone?.(result);
        return result;
      } catch (error) {
        endProgress();
        if (cancelledRef.current || controller.signal.aborted) {
          onCancelled?.();
          return undefined;
        }
        onError?.(error);
        return undefined;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [endProgress, setProgress, startProgress],
  );

  return { run, cancel };
}
