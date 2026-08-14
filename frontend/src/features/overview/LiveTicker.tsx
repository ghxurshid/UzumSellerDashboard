import { Activity } from 'lucide-react';
import type { ReactNode } from 'react';

import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { TickerItem } from '@/types/domain';

const TREND_TEXT = { up: 'text-pos', down: 'text-neg', flat: 'text-faint' } as const;

/** The 32px live strip beneath the KPI tiles. */
export function LiveTicker({ items }: { readonly items: readonly TickerItem[] }): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="flex h-32 shrink-0 items-center overflow-hidden rounded-9 border border-line bg-panel">
      <span className="flex h-full items-center gap-5 border-r border-line px-11 text-meta uppercase tracking-[0.1em] text-acc-dim">
        <Activity aria-hidden className="size-12" />
        {t('tkLive')}
      </span>

      {items.map((item) => (
        <div
          key={item.key}
          className="flex h-full shrink basis-auto items-center gap-6 whitespace-nowrap border-r border-line px-13"
        >
          <span className="text-tiny uppercase tracking-[0.05em] text-faint">
            {t(item.labelKey as TranslationKey)}
          </span>
          <span data-numeric className="text-sm">
            {item.value}
          </span>
          <span data-numeric className={cn('text-mini', TREND_TEXT[item.trend])}>
            {item.delta}
          </span>
        </div>
      ))}
    </div>
  );
}
