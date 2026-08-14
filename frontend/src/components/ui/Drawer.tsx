import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface DrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

/**
 * The right-hand side panel used for row details and record forms.
 *
 * Built on Radix Dialog rather than a bare fixed div: a drawer is modal here —
 * it holds a form whose focus must not escape to the table behind it, and it
 * must return focus to the row that opened it when dismissed.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
}: DrawerProps): ReactNode {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-[rise_0.16s_ease]" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-[min(468px,100vw)] flex-col',
            'border-l border-line-2 bg-panel shadow-[var(--shadow-menu)]',
            'data-[state=open]:animate-[slide-panel_0.26s_var(--ease-out-soft)]',
          )}
        >
          <header className="flex shrink-0 items-start gap-10 border-b border-line px-14 py-12">
            <div className="flex min-w-0 flex-col gap-2">
              <RadixDialog.Title className="truncate text-md font-medium tracking-[-0.015em]">
                {title}
              </RadixDialog.Title>
              {subtitle !== undefined && (
                <RadixDialog.Description className="truncate font-mono text-tiny text-faint">
                  {subtitle}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="ml-auto cursor-pointer rounded-6 border-0 bg-transparent p-4 text-faint hover:bg-acc-soft hover:text-acc-dim"
            >
              <X aria-hidden className="size-14" />
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-14 py-12">{children}</div>

          {footer !== undefined && (
            <footer className="flex shrink-0 justify-end gap-8 border-t border-line px-14 py-12">
              {footer}
            </footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
