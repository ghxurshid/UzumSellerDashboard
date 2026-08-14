import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useToastStore } from '@/store/toast.store';
import type { ToastKind } from '@/types/domain';

const ICON_BY_KIND: Record<ToastKind, ComponentType<{ className?: string }>> = {
  ok: CheckCircle2,
  err: XCircle,
  warn: AlertTriangle,
  info: Info,
  load: Loader2,
};

const COLOR_BY_KIND: Record<ToastKind, string> = {
  ok: 'text-pos',
  err: 'text-neg',
  warn: 'text-warn',
  info: 'text-acc-dim',
  load: 'text-acc-dim',
};

/**
 * Toast viewport.
 *
 * `aria-live="polite"` on the container rather than each toast, so a burst of
 * confirmations is announced in order instead of interrupting itself.
 */
export function Toaster(): ReactNode {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const runAction = useToastStore((state) => state.runAction);

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      /* Above the phone tab bar, not on top of it; back to the design's 14px
         gutter from `md` up where there is no tab bar to clear. */
      className="bottom-above-nav pointer-events-none absolute left-1/2 z-50 flex w-[calc(100vw-16px)] max-w-420 -translate-x-1/2 flex-col items-center gap-6 md:bottom-14 md:w-auto"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICON_BY_KIND[toast.kind];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.14 } }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className={cn(
                'pointer-events-auto flex w-full max-w-full items-center gap-9 rounded-9 border border-line-2',
                'bg-raise px-11 py-9 text-xs-plus shadow-[var(--shadow-float)] md:w-auto md:py-8',
              )}
            >
              <Icon
                aria-hidden
                className={cn('size-14 shrink-0', COLOR_BY_KIND[toast.kind], toast.kind === 'load' && 'animate-spin')}
              />
              <span className="min-w-0 flex-1 text-dim md:max-w-320 md:flex-none">{toast.text}</span>
              {toast.actionLabel !== undefined && (
                <button
                  type="button"
                  onClick={() => runAction(toast.id)}
                  className="tap shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-acc-dim underline underline-offset-2"
                >
                  {toast.actionLabel}
                </button>
              )}
              <button
                type="button"
                aria-label="Close"
                onClick={() => dismiss(toast.id)}
                className="tap shrink-0 cursor-pointer border-0 bg-transparent p-0 text-faint hover:text-text"
              >
                <X aria-hidden className="size-14 md:size-12" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
