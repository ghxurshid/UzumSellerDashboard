import { Download, Settings2, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useDialogStore } from '@/store/dialog.store';

interface ProgressOverlayProps {
  readonly onCancel: () => void;
}

/**
 * Progress for a real operation.
 *
 * Two modes, and which one is used is a fact about the work rather than a
 * style choice: countable work (rows serialised, orders confirmed one by one)
 * reports a percentage; a single request of unknown duration gets an
 * indeterminate bar. Nothing animates a number the operation cannot supply.
 */
export function ProgressOverlay({ onCancel }: ProgressOverlayProps): ReactNode {
  const { t } = useTranslation();
  const progress = useDialogStore((state) => state.progress);

  if (progress === null) return null;

  const determinate = progress.pct !== null;
  const rounded = determinate ? Math.round(progress.pct ?? 0) : 0;
  const Icon = progress.kind === 'down' ? Download : Settings2;

  return (
    <div className="bottom-above-nav absolute left-1/2 z-40 flex w-[calc(100vw-16px)] max-w-360 -translate-x-1/2 flex-col gap-8 rounded-11 border border-line-2 bg-raise px-13 py-11 shadow-[var(--shadow-float)] md:bottom-14 md:w-320">
      <div className="flex items-center gap-9">
        <Icon aria-hidden className="size-14 shrink-0 text-acc-dim" />
        <span className="flex min-w-0 flex-col leading-[1.3]">
          <span className="truncate text-xs-plus">{progress.label}</span>
          <span className="truncate font-mono text-tiny text-faint">{progress.sub}</span>
        </span>
        <div className="flex-1" />
        {determinate && (
          <span data-numeric className="text-sm text-dim">
            {rounded}%
          </span>
        )}
        {progress.cancellable && (
          <IconButton label={t('cancel')} size="xs" onClick={onCancel}>
            <X aria-hidden className="size-11" />
          </IconButton>
        )}
      </div>

      <div
        role="progressbar"
        {...(determinate
          ? { 'aria-valuenow': rounded, 'aria-valuemin': 0, 'aria-valuemax': 100 }
          : {})}
        aria-label={progress.label}
        className="h-4 overflow-hidden rounded-3 bg-grid"
      >
        <div
          className={cn(
            'h-full rounded-3 bg-acc',
            determinate
              ? 'transition-[width] duration-200 ease-[var(--ease-out-soft)]'
              : 'w-1/3 animate-[pulse-ring_1.2s_infinite]',
          )}
          {...(determinate ? { style: { width: `${rounded}%` } } : {})}
        />
      </div>
    </div>
  );
}
