import { HelpCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useDialogStore } from '@/store/dialog.store';

/**
 * The single confirmation prompt, mounted once at the shell.
 *
 * Any call site raises one through `requestConfirm(request, run)` — the action
 * only executes on accept, so a destructive path cannot be triggered by the
 * dialog merely opening.
 */
export function ConfirmDialog(): ReactNode {
  const { t } = useTranslation();

  const confirm = useDialogStore((state) => state.confirm);
  const accept = useDialogStore((state) => state.acceptConfirm);
  const cancel = useDialogStore((state) => state.cancelConfirm);

  const isWarning = confirm?.tone === 'warn';
  const Icon = isWarning ? TriangleAlert : HelpCircle;

  return (
    <Dialog
      open={confirm !== null}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      title={confirm?.title ?? ''}
      width="w-[min(440px,calc(100vw-48px))]"
      footer={
        <>
          <Button size="lg" onClick={cancel}>
            {t('cancel')}
          </Button>
          <Button
            variant={isWarning ? 'danger' : 'primary'}
            size="lg"
            onClick={accept}
            autoFocus
          >
            {confirm?.cta ?? ''}
          </Button>
        </>
      }
    >
      <div className="flex gap-11">
        <span
          className={cn(
            'flex size-32 shrink-0 items-center justify-center rounded-9 border',
            isWarning
              ? 'border-neg-line bg-neg-soft text-neg'
              : 'border-acc bg-acc-soft text-acc-dim',
          )}
        >
          <Icon aria-hidden className="size-16" />
        </span>
        <p className="m-0">{confirm?.body ?? ''}</p>
      </div>
    </Dialog>
  );
}
