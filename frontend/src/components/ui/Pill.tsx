import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { Tone } from '@/types/domain';

const pillVariants = cva('inline-flex items-center gap-4 whitespace-nowrap rounded-5 px-7 py-1', {
  variants: {
    tone: {
      positive: 'bg-pos-soft text-pos',
      negative: 'bg-neg-soft text-neg',
      warning: 'bg-warn-soft text-warn',
      accent: 'bg-acc-soft text-acc-dim',
      neutral: 'bg-grid text-dim',
    },
    size: {
      sm: 'text-tiny',
      md: 'text-mini',
    },
    outline: {
      true: 'border bg-transparent',
      false: '',
    },
  },
  compoundVariants: [
    { outline: true, tone: 'positive', class: 'border-pos text-pos' },
    { outline: true, tone: 'negative', class: 'border-neg-line text-neg' },
    { outline: true, tone: 'warning', class: 'border-warn-line text-warn' },
    { outline: true, tone: 'accent', class: 'border-acc-line text-acc-dim' },
    { outline: true, tone: 'neutral', class: 'border-line-2 text-dim' },
  ],
  defaultVariants: { tone: 'neutral', size: 'md', outline: false },
});

interface PillProps extends VariantProps<typeof pillVariants> {
  readonly children: ReactNode;
  readonly className?: string;
  readonly tone?: Tone;
}

/** Status chip used for product state, SLA state, payout state and severity. */
export function Pill({ children, className, tone, size, outline }: PillProps): ReactNode {
  return <span className={cn(pillVariants({ tone, size, outline }), className)}>{children}</span>;
}
