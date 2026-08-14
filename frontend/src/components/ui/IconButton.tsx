import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

const iconButtonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center cursor-pointer',
    'transition-colors duration-150',
    'disabled:cursor-not-allowed disabled:opacity-45',
  ),
  {
    variants: {
      variant: {
        chrome: 'border-0 bg-transparent text-dim hover:bg-acc-soft hover:text-acc-dim',
        outline:
          'border border-line-2 bg-transparent text-dim hover:border-acc-line hover:text-acc-dim',
        danger: 'border-0 bg-transparent text-dim hover:bg-neg-soft hover:text-neg',
      },
      size: {
        /* 22, 24×26, 26, 28, 34 — the five icon-button footprints in the design. */
        xs: 'size-22 rounded-5 text-tiny',
        sm: 'h-24 w-26 rounded-5 text-base',
        md: 'size-26 rounded-7 text-sm',
        lg: 'size-28 rounded-7 text-md',
        rail: 'size-34 rounded-8 text-xl',
      },
      active: {
        true: 'bg-acc-soft text-acc-dim',
        false: '',
      },
    },
    defaultVariants: { variant: 'chrome', size: 'md', active: false },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Required — an icon-only control has no accessible name without it. */
  readonly label: string;
  readonly children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, active, label, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size, active }), className)}
      {...props}
    >
      {children}
    </button>
  );
});
