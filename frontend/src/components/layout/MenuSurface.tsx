import * as Popover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface MenuSurfaceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly width: string;
  readonly align?: 'start' | 'end';
}

/**
 * The dropdown shell every topbar menu shares.
 *
 * Radix Popover brings outside-click dismissal, `Escape`, focus return to the
 * trigger and arrow-key roving — behaviour the design specifies but that is
 * invisible until it is missing.
 */
export function MenuSurface({
  open,
  onOpenChange,
  trigger,
  children,
  width,
  align = 'start',
}: MenuSurfaceProps): ReactNode {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 overflow-hidden rounded-11 border border-line-2 bg-panel p-5',
            'shadow-[var(--shadow-menu)] data-[state=open]:animate-[pop_0.14s_ease]',
            width,
          )}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export const MENU_ITEM = cn(
  'flex w-full cursor-pointer items-center gap-9 rounded-8 border-0 bg-transparent',
  'px-9 py-7 text-left text-sm-plus text-text transition-colors hover:bg-acc-soft',
);
