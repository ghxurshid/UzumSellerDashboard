import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { SourceStatus } from '@/store/sync.store';

/**
 * The bar every sync indicator draws.
 *
 * One component so that a source in the settings pane and the strip under the
 * topbar button cannot disagree about what "half done" looks like. It renders
 * three genuinely different things, and never blurs them:
 *
 *   • a **measured** bar, when the route published a row total;
 *   • an **indeterminate** sweep, when it did not — the bare-array collections
 *     have no total, and a bar sitting at 0% or guessing 50% would both be
 *     claims the data does not support;
 *   • a **settled** bar, full and toned by how the source ended.
 *
 * `fraction` of `null` is the indeterminate case. It is not the same as 0, and
 * the two must not be conflated by callers passing `?? 0`.
 */

const TONE: Readonly<Record<SourceStatus, string>> = {
  idle: 'bg-line-2',
  pending: 'bg-line-2',
  running: 'bg-acc',
  ok: 'bg-pos',
  failed: 'bg-neg',
  cancelled: 'bg-warn',
};

export function SyncProgress({
  status,
  fraction,
  className,
}: {
  readonly status: SourceStatus;
  /** 0–1, or null when the route publishes nothing to measure against. */
  readonly fraction: number | null;
  readonly className?: string;
}): ReactNode {
  const track = cn('relative h-4 overflow-hidden rounded-3 bg-grid', className);

  if (status === 'idle' || status === 'pending') {
    return <div className={track} />;
  }

  if (status === 'running' && fraction === null) {
    return (
      <div className={track}>
        {/* A sweep, not a fill: it says "working" without claiming a share. */}
        <div className="absolute inset-y-0 w-1/3 animate-[pulse-ring_1.2s_infinite] rounded-3 bg-acc" />
      </div>
    );
  }

  const width = status === 'running' ? Math.min(1, Math.max(0, fraction ?? 0)) : 1;

  return (
    <div className={track}>
      <div
        className={cn('absolute inset-y-0 left-0 rounded-3 transition-[width] duration-300', TONE[status])}
        style={{ width: `${(width * 100).toFixed(1)}%` }}
      />
    </div>
  );
}
