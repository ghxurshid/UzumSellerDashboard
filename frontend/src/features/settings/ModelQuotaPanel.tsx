import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { findProvider, GEMINI_LIMITS_AS_OF } from '@/constants/settings';
import { useModelUsage, useModelUsageLoaded, useNow } from '@/hooks/useModelUsage';
import { formatCalendarDate } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { QuotaAxis } from '@/services/ai/usage';
import type { AiProvider } from '@/types/settings';

import { ModelQuotaBar } from './ModelQuotaBar';

/** Presentation order matches how the design lists them, not `summarizeUsage`'s tie-break order. */
const AXES: readonly QuotaAxis[] = ['rpm', 'tpm', 'rpd'];

interface ModelQuotaPanelProps {
  readonly provider: AiProvider;
  readonly model: string;
}

/**
 * "How much of the selected model's budget is left" — three bars built from
 * the catalogue's published limits and this browser's own request log.
 *
 * Renders nothing for a provider or model the catalogue has no `limits` for
 * (every adapter besides Gemini today, and Gemini's own free-text fallback):
 * there is no upper bound to gauge, and a blank bar would read as "zero left"
 * rather than "unknown," which the project's invariants forbid.
 */
export function ModelQuotaPanel({ provider, model }: ModelQuotaPanelProps): ReactNode {
  const { t } = useTranslation();
  const usage = useModelUsage(provider, model);
  const loaded = useModelUsageLoaded();
  const now = useNow();

  const limits = findProvider(provider).models.find((entry) => entry.id === model)?.limits;
  if (usage === null || limits === undefined) return null;

  return (
    <div className="flex flex-col gap-11 rounded-11 border border-line bg-panel px-11 py-13 sm:px-14">
      <span className="text-sm-plus font-medium">{t('quotaPanelTitle')}</span>

      {!loaded ? (
        <div className="flex flex-col gap-12" aria-hidden>
          {AXES.map((axis) => (
            <div key={axis} className="flex flex-col gap-4">
              <Skeleton className="h-11 w-[55%]" />
              <Skeleton className="h-6 w-full" shimmer={false} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          {AXES.map((axis) => (
            <ModelQuotaBar
              key={axis}
              axis={axis}
              gauge={usage[axis]}
              now={now}
              catalogueLimit={limits[axis]}
              emphasize={usage.bottleneck === axis}
            />
          ))}
        </div>
      )}

      <p className="m-0 text-tiny leading-[1.5] text-faint">
        {t('quotaSourceNote', { date: formatCalendarDate(GEMINI_LIMITS_AS_OF) })}
      </p>
    </div>
  );
}
