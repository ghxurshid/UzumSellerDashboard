import { Check, Minus } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type CheckboxState = 'none' | 'some' | 'all';

interface CheckboxProps {
  readonly state: CheckboxState;
  readonly label: string;
  readonly onToggle: () => void;
  readonly stopPropagation?: boolean;
}

/**
 * Tri-state checkbox.
 *
 * A native `role="checkbox"` with `aria-checked="mixed"` for the partial case —
 * the header box in a table with a partly-selected page must report "mixed",
 * not "false", or the user is told nothing is selected when rows are.
 */
export function Checkbox({
  state,
  label,
  onToggle,
  stopPropagation = false,
}: CheckboxProps): ReactNode {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (stopPropagation) event.stopPropagation();
    onToggle();
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
      aria-label={label}
      onClick={handleClick}
      className={cn(
        'tap flex size-15 shrink-0 cursor-pointer items-center justify-center rounded-4 border p-0 transition-colors',
        state === 'none'
          ? 'border-line-2 bg-transparent'
          : 'border-acc bg-acc text-white',
      )}
    >
      {state === 'all' && <Check aria-hidden className="size-9" strokeWidth={3} />}
      {state === 'some' && <Minus aria-hidden className="size-9" strokeWidth={3} />}
    </button>
  );
}
