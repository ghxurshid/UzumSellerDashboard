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
        {/**
         * Two shapes, one component.
         *
         * On a phone this is a sheet rising from the bottom edge, capped at
         * 92% of the dynamic viewport so the page behind stays visible as
         * context and the header — with its close button — lands where a thumb
         * already is. From `md` up it is the right-hand side panel the design
         * draws, full height and 468px wide.
         *
         * `dvh` rather than `vh`: a sheet sized against the large viewport
         * would have its footer buttons hidden behind the browser's own bar
         * for as long as that bar is showing.
         */}
        <RadixDialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-panel shadow-[var(--shadow-menu)]',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-14 border-t border-line-2',
            'data-[state=open]:animate-[sheet_0.28s_var(--ease-out-soft)]',
            'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[min(468px,100vw)]',
            'md:rounded-none md:border-l md:border-t-0',
            'md:data-[state=open]:animate-[slide-panel_0.26s_var(--ease-out-soft)]',
          )}
        >
          {/* The grab affordance every mobile sheet is expected to have. It is
              decoration — the sheet is dismissed by the close button, the
              backdrop or Escape — so it is hidden from assistive tech. */}
          <span
            aria-hidden
            className="mx-auto mt-8 h-4 w-40 shrink-0 rounded-full bg-line-2 md:hidden"
          />

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
              className="tap ml-auto flex size-32 shrink-0 cursor-pointer items-center justify-center rounded-8 border-0 bg-transparent text-faint hover:bg-acc-soft hover:text-acc-dim md:size-24 md:rounded-6"
            >
              <X aria-hidden className="size-16 md:size-14" />
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-14 py-12">
            {children}
          </div>

          {footer !== undefined && (
            <footer className="pb-safe-12 flex shrink-0 flex-wrap justify-end gap-8 border-t border-line px-14 pt-12 md:pb-12">
              {footer}
            </footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
