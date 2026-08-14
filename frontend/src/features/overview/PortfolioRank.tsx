import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { Panel } from '@/components/ui/Panel';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { RankBucket } from '@/types/domain';

interface PortfolioRankProps {
  readonly buckets: readonly RankBucket[];
  readonly total: number;
  readonly activeRank: string | null;
  readonly onSelect: (code: string) => void;
}

/**
 * The portfolio card, bucketed by `status.value`. Each row filters the product
 * table, so the active bucket is reflected with `aria-pressed` as well as the
 * accent border.
 *
 * The code chip sizes to its content rather than sitting in the square the
 * ABC×XYZ design drew: what lands there is the API's own status value, and
 * `ARCHIVED` does not fit in the two characters a rank class needed.
 */
export function PortfolioRank({
  buckets,
  total,
  activeRank,
  onSelect,
}: PortfolioRankProps): ReactNode {
  const { t } = useTranslation();

  return (
    <Panel className="flex flex-col gap-10 px-14 py-13">
      <div className="flex items-baseline justify-between">
        <span className="text-base font-medium">{t('rankTitle')}</span>
        <span className="text-tiny text-faint">{total} productList</span>
      </div>

      <div className="flex flex-col gap-4">
        {buckets.map((bucket) => {
          const active = activeRank === bucket.code;
          return (
            <button
              key={bucket.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(bucket.code)}
              className={cn(
                'flex cursor-pointer items-center gap-9 rounded-8 border px-9 py-7 text-left transition-colors hover:border-acc-line',
                active ? 'border-acc-line bg-acc-soft' : 'border-line bg-transparent',
              )}
            >
              <span className="flex h-20 min-w-20 shrink-0 items-center justify-center rounded-5 bg-grid px-6 font-mono text-meta tracking-[0.06em] text-acc-dim">
                {bucket.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs-plus text-dim">{bucket.label}</span>
              <span data-numeric className="shrink-0 text-base">
                {bucket.count}
              </span>
            </button>
          );
        })}
      </div>

      <p className="flex items-start gap-7 border-t border-line pt-9 text-xs leading-[1.5] text-dim">
        <Info aria-hidden className="mt-2 size-12 shrink-0 text-acc-dim" />
        {t('rankNote')}
      </p>
    </Panel>
  );
}
