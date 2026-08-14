import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  readonly className?: string;
  /** Static blocks read as structure; shimmering ones read as pending data. */
  readonly shimmer?: boolean;
}

/**
 * Loading placeholder. The design never spins for content — it draws the shape
 * of what is coming, so every skeleton mirrors the real element's box.
 */
export function Skeleton({ className, shimmer = true }: SkeletonProps): ReactNode {
  return (
    <div
      aria-hidden
      className={cn('rounded-4', shimmer ? 'skeleton' : 'bg-line', className)}
    />
  );
}

/** The KPI strip skeleton — same grid, same tile padding as the loaded state. */
export function SkeletonTiles({ count }: { readonly count: number }): ReactNode {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-1 overflow-hidden rounded-10 border border-line bg-line">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-8 bg-panel p-11">
          <Skeleton className="h-8 w-[58%] rounded-3" />
          <Skeleton className="h-19 w-[74%]" />
          <Skeleton className="h-14 w-[42%]" shimmer={false} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows }: { readonly rows: number }): ReactNode {
  return (
    <div className="overflow-hidden rounded-11 border border-line bg-panel">
      <div className="flex items-center gap-10 border-b border-line px-14 py-11">
        <Skeleton className="h-11 w-120" shimmer={false} />
        <div className="flex-1" />
        <Skeleton className="h-11 w-74" shimmer={false} />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[26px_2.2fr_repeat(6,1fr)] items-center gap-12 border-b border-line px-14 py-11"
        >
          <Skeleton className="size-15" shimmer={false} />
          <Skeleton className="h-10" />
          {Array.from({ length: 6 }, (__, cell) => (
            <Skeleton key={cell} className="h-10" shimmer={false} />
          ))}
        </div>
      ))}
    </div>
  );
}
