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
    /* Tops the painted box up to a 44px finger target on touch screens; a
       no-op with a mouse. See `.tap` in `globals.css`. */
    'tap',
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
        /* Two scales, one variant.
           At `md` and above these are the heights drawn in the source —
           22/24/26/28/30px, the density the desktop layout is built on. Below
           it every button grows by 8–10px and gains horizontal padding,
           because a 22px control with 7px of padding is not something a thumb
           can land on. The `.tap` base class covers the remaining few px of
           the 44px guideline without moving anything visually. */
        xs: 'h-32 rounded-6 px-11 text-xs md:h-22 md:px-7',
        sm: 'h-34 rounded-6 px-12 text-xs md:h-24 md:px-8',
        md: 'h-36 rounded-7 px-13 text-xs-plus md:h-26 md:px-9 md:text-xs',
        lg: 'h-38 rounded-8 px-14 text-sm md:h-28 md:rounded-7 md:px-12 md:text-xs-plus',
        xl: 'h-40 rounded-8 px-16 text-sm md:h-30 md:rounded-7 md:px-14',
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
