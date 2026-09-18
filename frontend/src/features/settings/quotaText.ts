import { formatClock, formatNumber } from '@/lib/format';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import type { Translator } from '@/lib/i18n/useTranslation';
import type { ModelUsage, QuotaAxis, QuotaGauge } from '@/services/ai/usage';

/**
 * Reading a `QuotaGauge` into the sentences the quota panel and the model
 * picker both need.
 *
 * Kept apart from the components so the two surfaces — a full bar with a
 * caption, a one-line summary inside a `Select.Item` — describe the same
 * gauge in the same words instead of drifting into two vocabularies for one
 * number.
 */

const AXIS_SHORT_KEY: Readonly<Record<QuotaAxis, TranslationKey>> = {
  rpm: 'quotaAxisRpm',
  tpm: 'quotaAxisTpm',
  rpd: 'quotaAxisRpd',
};

const AXIS_LABEL_KEY: Readonly<Record<QuotaAxis, TranslationKey>> = {
  rpm: 'quotaLabelRpm',
  tpm: 'quotaLabelTpm',
  rpd: 'quotaLabelRpd',
};

export function axisShortLabel(t: Translator, axis: QuotaAxis): string {
  return t(AXIS_SHORT_KEY[axis]);
}

export function axisFullLabel(t: Translator, axis: QuotaAxis): string {
  return t(AXIS_LABEL_KEY[axis]);
}

/**
 * When this axis frees up, in the shape that axis calls for.
 *
 * A minute window is read off as a countdown — the seller is looking at the
 * number *because* it is about to change. A daily one is read off as a clock
 * time, because "resets in 41 634s" is not a sentence anyone reads; the design
 * asked for the local clock explicitly for that reason.
 */
export function formatResetText(t: Translator, axis: QuotaAxis, gauge: QuotaGauge, now: number): string {
  if (axis === 'rpd') return t('quotaResetsAt', { time: formatClock(gauge.resetsAt) });

  /* `summarizeUsage` reports an empty window's `resetsAt` as `now` (there is
     no oldest request to time out yet), which would otherwise read as
     "resets in 0s" — true of the arithmetic, false of the budget: nothing
     has been spent, so there is nothing about to free up. */
  if (gauge.used === 0 && !gauge.exhausted) return t('quotaFull');

  const seconds = Math.max(0, Math.round((gauge.resetsAt - now) / 1_000));
  if (seconds < 60) return t('quotaResetsInSeconds', { s: seconds });
  return t('quotaResetsInMinutes', { m: Math.ceil(seconds / 60) });
}

export function formatRemainingText(t: Translator, gauge: QuotaGauge): string {
  return t('quotaRemainingOf', {
    remaining: formatNumber(gauge.remaining),
    limit: formatNumber(gauge.limit),
  });
}

/** Tone by remaining share: plenty left reads positive, under a quarter warns, none is a stop. */
export function toneForGauge(gauge: QuotaGauge): 'pos' | 'warn' | 'neg' {
  if (gauge.exhausted) return 'neg';
  const share = gauge.limit > 0 ? gauge.remaining / gauge.limit : 0;
  return share < 0.25 ? 'warn' : 'pos';
}

/** The compact line a model-picker option shows: the bottleneck axis, at a glance. */
export function optionSummaryText(t: Translator, usage: ModelUsage, now: number): string {
  const axis = usage.bottleneck;
  const gauge = usage[axis];

  if (gauge.exhausted) {
    return t('quotaOptionExhausted', { reset: formatResetText(t, axis, gauge, now) });
  }

  return t('quotaOptionLeft', {
    axis: axisShortLabel(t, axis),
    remaining: formatNumber(gauge.remaining),
    limit: formatNumber(gauge.limit),
  });
}

/** `aria-valuetext` for one axis' bar — the fact a screen reader needs, said once. */
export function gaugeValueText(t: Translator, axis: QuotaAxis, gauge: QuotaGauge, now: number): string {
  const state = gauge.exhausted ? t('quotaExhausted') : formatRemainingText(t, gauge);
  return `${axisFullLabel(t, axis)}: ${state}, ${formatResetText(t, axis, gauge, now)}`;
}
