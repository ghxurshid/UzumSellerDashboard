import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The design's action language: outlined, never filled. The primary variant is
 * an accent border over a soft accent wash; hover and pressed states step the
 * wash up rather than swapping colours.
 */
const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-6 whitespace-nowrap',
    'font-sans transition-colors duration-150 cursor-pointer',
    'disabled:cursor-not-allowed disabled:opacity-45',
  ),
  {
    variants: {
      variant: {
        primary: cn(
          'border border-acc bg-acc-soft text-acc-dim font-medium',
          'hover:bg-acc-strong active:bg-acc-strong',
        ),
        secondary: cn(
          'border border-line-2 bg-transparent text-dim',
          'hover:border-acc-line hover:text-acc-dim',
        ),
        ghost: cn(
          'border border-transparent bg-transparent text-dim',
          'hover:bg-acc-soft hover:text-acc-dim',
        ),
        danger: cn(
          'border border-neg-line bg-neg-soft text-neg',
          'hover:bg-neg-soft/70',
        ),
      },
      size: {
        /* Heights are the ones drawn in the source: 22/24/26/28/30px. */
        xs: 'h-22 rounded-6 px-7 text-xs',
        sm: 'h-24 rounded-6 px-8 text-xs',
        md: 'h-26 rounded-7 px-9 text-xs',
        lg: 'h-28 rounded-7 px-12 text-xs-plus',
        xl: 'h-30 rounded-7 px-14 text-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Renders the child element instead of a `<button>` — for links styled as buttons. */
  readonly asChild?: boolean;
  readonly loading?: boolean;
  readonly icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, icon, children, disabled, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-12 animate-spin" /> : icon}
      {children}
    </Component>
  );
});
