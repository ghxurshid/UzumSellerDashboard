import * as ContextMenu from '@radix-ui/react-context-menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface RowMenuAction {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly run: () => void;
}

interface RowContextMenuProps {
  readonly actions: readonly RowMenuAction[];
  readonly children: ReactNode;
}

const ITEM = cn(
  'flex cursor-pointer select-none items-center gap-9 rounded-7 px-9 py-6 text-sm outline-none',
  'data-[highlighted]:bg-acc-soft data-[highlighted]:text-acc-dim',
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
);

/**
 * Right-click menu for table rows.
 *
 * Radix gives this the keyboard path a hand-rolled menu usually loses — the
 * context-menu key and Shift+F10 open it, arrows move through it, and focus
 * returns to the row on close.
 */
export function RowContextMenu({ actions, children }: RowContextMenuProps): ReactNode {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={cn(
            'z-50 w-216 rounded-11 border border-line-2 bg-panel p-5',
            'shadow-[var(--shadow-menu)] data-[state=open]:animate-[pop_0.14s_ease]',
          )}
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <ContextMenu.Item
                key={action.key}
                disabled={action.disabled === true}
                onSelect={action.run}
                className={cn(
                  ITEM,
                  action.danger === true ? 'mt-4 border-t border-line text-neg' : 'text-text',
                )}
              >
                <Icon aria-hidden className="size-13 shrink-0" />
                {action.label}
              </ContextMenu.Item>
            );
          })}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
