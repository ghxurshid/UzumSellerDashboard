import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Modal.
 *
 * Radix supplies the parts that are easy to get wrong and invisible when they
 * are: focus trap, scroll lock, restore-focus-on-close, `Escape`, and the
 * `aria-modal` wiring. The styling is the design's — backdrop blur over the
 * neutral-900 wash, a 14px radius and the top elevation step.
 */
interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'w-[min(560px,calc(100vw-48px))]',
}: DialogProps): ReactNode {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]',
            'data-[state=open]:animate-[rise_0.16s_ease]',
          )}
        />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex max-h-[85vh] flex-col gap-11 rounded-14 border border-line-2',
            'bg-panel p-16 shadow-[var(--shadow-menu)]',
            'data-[state=open]:animate-[pop_0.16s_ease]',
            width,
          )}
        >
          <div className="flex items-start gap-10">
            <div className="flex min-w-0 flex-col gap-3">
              <RadixDialog.Title className="text-xl font-medium tracking-[-0.02em]">
                {title}
              </RadixDialog.Title>
              {description !== undefined && (
                <RadixDialog.Description className="text-xs-plus text-dim">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="ml-auto cursor-pointer rounded-6 border-0 bg-transparent p-4 text-faint hover:bg-acc-soft hover:text-acc-dim"
            >
              <X aria-hidden className="size-14" />
            </RadixDialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-auto text-sm-plus leading-[1.6] text-dim">
            {children}
          </div>

          {footer !== undefined && (
            <div className="flex justify-end gap-8 border-t border-line pt-11">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
