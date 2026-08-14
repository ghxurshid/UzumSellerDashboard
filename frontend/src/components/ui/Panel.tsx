import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The surface every card, table and section sits on: a 1px hairline, an 11px
 * radius and the panel fill. Declared once so no screen re-invents the border.
 */
export function Panel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      className={cn('rounded-11 border border-line bg-panel', className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface PanelHeaderProps extends HTMLAttributes<HTMLDivElement> {
  readonly title: string;
  readonly meta?: string;
  readonly actions?: ReactNode;
}

export function PanelHeader({
  title,
  meta,
  actions,
  className,
  ...props
}: PanelHeaderProps): ReactNode {
  return (
    <div
      className={cn('flex items-center gap-10 border-b border-line px-14 py-11', className)}
      {...props}
    >
      <span className="text-base font-medium">{title}</span>
      {meta !== undefined && <span className="text-mini text-faint">{meta}</span>}
      {actions !== undefined && <div className="ml-auto flex items-center gap-6">{actions}</div>}
    </div>
  );
}

/** Small uppercase kicker used above every panel metric group. */
export function PanelKicker({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <span className="text-meta uppercase tracking-[0.1em] text-faint">{children}</span>
  );
}
