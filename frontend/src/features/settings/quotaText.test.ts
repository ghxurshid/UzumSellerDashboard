import { describe, expect, it } from 'vitest';

import type { TranslationKey } from '@/lib/i18n/dictionary';
import type { Translator } from '@/lib/i18n/useTranslation';
import type { ModelUsage, QuotaAxis, QuotaGauge } from '@/services/ai/usage';

import { formatResetText, optionSummaryText, toneForGauge } from './quotaText';

/**
 * The sentences the quota panel and the model picker read off a `QuotaGauge`.
 *
 * `t` is faked rather than the real dictionary — the point of these functions
 * is which key and which params they choose for a given gauge shape, not the
 * wording a translator later puts behind that key. The fake echoes both back
 * verbatim so a wrong key or a wrong param shows up as a wrong string.
 */
const fakeT: Translator = (key: TranslationKey, vars) =>
  vars === undefined ? key : `${key}:${JSON.stringify(vars)}`;

function gauge(overrides: Partial<QuotaGauge> & { readonly axis: QuotaAxis }): QuotaGauge {
  return {
    used: 0,
    limit: 10,
    remaining: 10,
    exhausted: false,
    resetsAt: 0,
    unknownTokens: 0,
    ...overrides,
  };
}

function usageWithBottleneck(axis: QuotaAxis, bottleneckGauge: QuotaGauge): ModelUsage {
  const gauges: Record<QuotaAxis, QuotaGauge> = {
    rpm: gauge({ axis: 'rpm' }),
    tpm: gauge({ axis: 'tpm' }),
    rpd: gauge({ axis: 'rpd' }),
  };
  gauges[axis] = bottleneckGauge;

  return {
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    rpm: gauges.rpm,
    tpm: gauges.tpm,
    rpd: gauges.rpd,
    remainingShare: bottleneckGauge.remaining / bottleneckGauge.limit,
    bottleneck: axis,
  };
}

/* ── formatResetText ────────────────────────────────────────────────────── */

describe('formatResetText', () => {
  it.each(['rpm', 'tpm'] as const)(
    'reads %s as "not used yet" when nothing has been spent and nothing is exhausted',
    (axis) => {
      const g = gauge({ axis, used: 0, exhausted: false, resetsAt: 60_000 });
      expect(formatResetText(fakeT, axis, g, 0)).toBe('quotaFull');
    },
  );

  it.each(['rpm', 'tpm'] as const)(
    '%s does not read "not used yet" once a 429 has forced exhaustion, even at used === 0',
    (axis) => {
      // `summarizeUsage` can mark a gauge exhausted from a 429 whose stated
      // axis matched before any request of this browser's own has landed in
      // the window — the `!gauge.exhausted` guard exists precisely so that
      // case still reads as a countdown, not as "nothing spent".
      const g = gauge({ axis, used: 0, exhausted: true, resetsAt: 30_000 });
      expect(formatResetText(fakeT, axis, g, 0)).not.toBe('quotaFull');
    },
  );

  it('reads a sub-minute wait as a seconds countdown', () => {
    const g = gauge({ axis: 'rpm', used: 3, exhausted: false, resetsAt: 30_000 });
    expect(formatResetText(fakeT, 'rpm', g, 0)).toBe('quotaResetsInSeconds:{"s":30}');
  });

  it('reads a minute-plus wait as a minutes countdown, rounded up', () => {
    const g = gauge({ axis: 'tpm', used: 500, exhausted: false, resetsAt: 125_000 });
    expect(formatResetText(fakeT, 'tpm', g, 0)).toBe('quotaResetsInMinutes:{"m":3}');
  });

  it('reads rpd as a clock time regardless of used/exhausted — a daily budget is never a countdown', () => {
    const resetsAt = Date.UTC(2026, 0, 15, 19, 0, 0); // 19:00 UTC == 00:00 Asia/Tashkent (UTC+5, no DST)
    const g = gauge({ axis: 'rpd', used: 0, exhausted: false, resetsAt });
    expect(formatResetText(fakeT, 'rpd', g, 0)).toBe('quotaResetsAt:{"time":"00:00"}');
  });

  it('reads rpd as a clock time even when exhausted', () => {
    const resetsAt = Date.UTC(2026, 0, 15, 19, 0, 0);
    const g = gauge({ axis: 'rpd', used: 20, exhausted: true, resetsAt });
    expect(formatResetText(fakeT, 'rpd', g, 0)).toBe('quotaResetsAt:{"time":"00:00"}');
  });
});

/* ── toneForGauge ───────────────────────────────────────────────────────── */

describe('toneForGauge', () => {
  it('is neg once exhausted, whatever the remaining share says', () => {
    const g = gauge({ axis: 'rpm', exhausted: true, remaining: 9, limit: 10 });
    expect(toneForGauge(g)).toBe('neg');
  });

  it('is warn just under a quarter remaining', () => {
    const g = gauge({ axis: 'rpm', exhausted: false, remaining: 24, limit: 100 });
    expect(toneForGauge(g)).toBe('warn');
  });

  it('is pos at exactly a quarter remaining — the threshold is strictly less-than', () => {
    const g = gauge({ axis: 'rpm', exhausted: false, remaining: 25, limit: 100 });
    expect(toneForGauge(g)).toBe('pos');
  });

  it('is pos with plenty left', () => {
    const g = gauge({ axis: 'rpm', exhausted: false, remaining: 10, limit: 10 });
    expect(toneForGauge(g)).toBe('pos');
  });
});

/* ── optionSummaryText ──────────────────────────────────────────────────── */

describe('optionSummaryText', () => {
  it('reads the bottleneck axis as "left of" when it is not exhausted', () => {
    const g = gauge({ axis: 'rpm', used: 2, remaining: 3, limit: 5, exhausted: false });
    const usage = usageWithBottleneck('rpm', g);

    expect(optionSummaryText(fakeT, usage, 0)).toBe(
      'quotaOptionLeft:{"axis":"quotaAxisRpm","remaining":"3","limit":"5"}',
    );
  });

  it('reads the bottleneck axis as "exhausted · <reset>" when it is exhausted, reusing formatResetText verbatim', () => {
    const g = gauge({ axis: 'tpm', used: 250_000, remaining: 0, limit: 250_000, exhausted: true, resetsAt: 45_000 });
    const usage = usageWithBottleneck('tpm', g);
    const now = 0;

    const expectedReset = formatResetText(fakeT, 'tpm', g, now);
    expect(optionSummaryText(fakeT, usage, now)).toBe(
      `quotaOptionExhausted:${JSON.stringify({ reset: expectedReset })}`,
    );
  });

  it('reads off whichever axis summarizeUsage named the bottleneck, not always rpm', () => {
    const g = gauge({ axis: 'rpd', used: 18, remaining: 2, limit: 20, exhausted: false });
    const usage = usageWithBottleneck('rpd', g);

    expect(optionSummaryText(fakeT, usage, 0)).toBe(
      'quotaOptionLeft:{"axis":"quotaAxisRpd","remaining":"2","limit":"20"}',
    );
  });
});
