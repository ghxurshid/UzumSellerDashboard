import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { RowMenuAction } from './RowContextMenu';

interface RowActionsMenuProps {
  readonly actions: readonly RowMenuAction[];
  readonly label: string;
}

/**
 * The kebab trigger — the same action list as the right-click menu, reachable
 * by pointer and keyboard. Both surfaces share `RowMenuAction`, so an action
 * can never exist in one and be missing from the other.
 */
export function RowActionsMenu({ actions, label }: RowActionsMenuProps): ReactNode {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          className="flex size-22 cursor-pointer items-center justify-center justify-self-end rounded-5 border-0 bg-transparent text-faint hover:bg-raise hover:text-acc-dim"
        >
          <MoreVertical aria-hidden className="size-13" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'z-50 w-216 rounded-11 border border-line-2 bg-panel p-5',
            'shadow-[var(--shadow-menu)] data-[state=open]:animate-[pop_0.14s_ease]',
          )}
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <DropdownMenu.Item
                key={action.key}
                disabled={action.disabled === true}
                onSelect={action.run}
                className={cn(
                  'flex cursor-pointer select-none items-center gap-9 rounded-7 px-9 py-6 text-sm outline-none',
                  'data-[highlighted]:bg-acc-soft data-[highlighted]:text-acc-dim',
                  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
                  action.danger === true ? 'mt-4 border-t border-line text-neg' : 'text-text',
                )}
              >
                <Icon aria-hidden className="size-13 shrink-0" />
                {action.label}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
