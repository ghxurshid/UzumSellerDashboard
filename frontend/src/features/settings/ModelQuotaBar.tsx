import type { ReactNode } from 'react';

import { Pill } from '@/components/ui/Pill';
import { formatNumber } from '@/lib/format';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import type { QuotaAxis, QuotaGauge } from '@/services/ai/usage';

import { axisFullLabel, formatResetText, gaugeValueText, toneForGauge } from './quotaText';

const FILL_TONE: Readonly<Record<'pos' | 'warn' | 'neg', string>> = {
  pos: 'bg-pos',
  warn: 'bg-warn',
  neg: 'bg-neg',
};

const TEXT_TONE: Readonly<Record<'pos' | 'warn' | 'neg', string>> = {
  pos: 'text-pos',
  warn: 'text-warn',
  neg: 'text-neg',
};

interface ModelQuotaBarProps {
  readonly axis: QuotaAxis;
  readonly gauge: QuotaGauge;
  readonly now: number;
  /** The catalogue's own published number for this axis, to say when a live 429 overrode it. */
  readonly catalogueLimit: number;
  /** Highlights the gauge `summarizeUsage` picked as the reason the model would refuse next. */
  readonly emphasize?: boolean;
}

/**
 * One axis of one model's budget: a labelled bar showing the REMAINING share
 * — full means plenty left — plus the number behind it and when it frees up.
 *
 * `role="progressbar"` carries the same fact three ways on purpose: the fill
 * width for a sighted glance, `aria-valuenow` for anything reading the value
 * as a percentage, and `aria-valuetext` for the sentence a screen reader
 * actually speaks — the three must never disagree about what "remaining"
 * means here.
 */
export function ModelQuotaBar({
  axis,
  gauge,
  now,
  catalogueLimit,
  emphasize = false,
}: ModelQuotaBarProps): ReactNode {
  const { t } = useTranslation();

  const tone = toneForGauge(gauge);
  const share = gauge.limit > 0 ? Math.max(0, Math.min(1, gauge.remaining / gauge.limit)) : 0;
  const overridden = gauge.limit !== catalogueLimit;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-6 text-xs text-dim">
        <span className="truncate">{axisFullLabel(t, axis)}</span>
        {emphasize && (
          <Pill tone="accent" size="sm">
            {t('quotaBottleneckTag')}
          </Pill>
        )}
        <span className={cn('ml-auto shrink-0 text-xs-plus', TEXT_TONE[tone])}>
          {gauge.exhausted
            ? t('quotaExhausted')
            : t('quotaRemainingOf', {
                remaining: formatNumber(gauge.remaining),
                limit: formatNumber(gauge.limit),
              })}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={gaugeValueText(t, axis, gauge, now)}
        className="relative h-6 overflow-hidden rounded-3 bg-grid"
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-3 transition-[width] duration-300',
            FILL_TONE[tone],
          )}
          style={{ width: `${(share * 100).toFixed(1)}%` }}
        />
      </div>

      <p className="m-0 text-tiny leading-[1.45] text-faint">
        {formatResetText(t, axis, gauge, now)}
        {gauge.unknownTokens > 0 && ` · ${t('quotaUnknownTokens', { n: gauge.unknownTokens })}`}
        {overridden && ` · ${t('quotaOverridden', { limit: formatNumber(gauge.limit) })}`}
      </p>
    </div>
  );
}
