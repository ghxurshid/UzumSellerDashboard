import { describe, expect, it } from 'vitest';

import type { AiProvider, ModelRateLimits } from '@/types/settings';

import {
  isKeyRejection,
  isModelRequestEvent,
  ModelQuotaError,
  nextPacificMidnight,
  pacificDayStart,
  pruneUsage,
  readQuotaFailure,
  recordModelRequest,
  subscribeModelRequests,
  summarizeUsage,
  USAGE_RETENTION_MS,
  type ModelRequestEvent,
  type QuotaSignal,
} from './usage';

/**
 * The quota meter: what this browser can prove it has spent, against what the
 * provider published and what a 429 has actually said.
 *
 * Nothing here reads a clock or storage — every function takes `now` (and the
 * event list) as a plain argument — so a fixed instant and a fixed event list
 * must always produce the same gauges. That determinism is the whole point:
 * a restored tab has to reproduce what a live tab would have shown.
 */

/* ── fixtures ───────────────────────────────────────────────────────────── */

const PROVIDER: AiProvider = 'gemini';
const MODEL = 'gemini-3.6-flash';

function event(input: {
  readonly at: number;
  readonly provider?: AiProvider;
  readonly model?: string;
  readonly inputTokens?: number | null;
  readonly outcome?: ModelRequestEvent['outcome'];
  readonly quota?: QuotaSignal;
}): ModelRequestEvent {
  return {
    id: `e${input.at}-${input.provider ?? PROVIDER}-${input.model ?? MODEL}`,
    provider: input.provider ?? PROVIDER,
    model: input.model ?? MODEL,
    at: input.at,
    inputTokens: input.inputTokens ?? null,
    outcome: input.outcome ?? 'ok',
    ...(input.quota === undefined ? {} : { quota: input.quota }),
  };
}

/* ── pacificDayStart / nextPacificMidnight ─────────────────────────────── */

describe('pacificDayStart', () => {
  it('finds midnight eight hours behind UTC on a PST date', () => {
    // Winter: Los Angeles runs UTC-8 outside daylight saving.
    const noonPacific = Date.UTC(2026, 0, 15, 20, 0, 0); // 2026-01-15 12:00 PT
    expect(pacificDayStart(noonPacific)).toBe(Date.UTC(2026, 0, 15, 8, 0, 0));
  });

  it('finds midnight seven hours behind UTC on a PDT date', () => {
    // Summer: Los Angeles runs UTC-7 under daylight saving.
    const noonPacific = Date.UTC(2026, 6, 15, 19, 0, 0); // 2026-07-15 12:00 PT
    expect(pacificDayStart(noonPacific)).toBe(Date.UTC(2026, 6, 15, 7, 0, 0));
  });

  it('treats an instant exactly at Pacific midnight as belonging to that day', () => {
    const midnight = Date.UTC(2026, 0, 15, 8, 0, 0);
    expect(pacificDayStart(midnight)).toBe(midnight);
  });

  it('treats one ms before Pacific midnight as still the previous day', () => {
    const midnight = Date.UTC(2026, 0, 15, 8, 0, 0);
    expect(pacificDayStart(midnight - 1)).toBe(Date.UTC(2026, 0, 14, 8, 0, 0));
  });

  it('returns the identical answer on every repeated call, not only the first (Intl.DateTimeFormat is cached per zone)', () => {
    // The quota panel calls this once per model per second while open — nine
    // models, every tick — off a module-level formatter cache keyed by time
    // zone. A regression that rebuilt the formatter per call would still be
    // correct, just slow; this pins that many repeated calls with the same
    // instant keep agreeing with the first, and that a second instant does
    // not leak state into the cached formatter either.
    const instant = Date.UTC(2026, 5, 1, 12, 0, 0);
    const first = pacificDayStart(instant);
    for (let i = 0; i < 200; i += 1) {
      expect(pacificDayStart(instant)).toBe(first);
    }

    const other = Date.UTC(2026, 5, 2, 3, 0, 0);
    const otherFirst = pacificDayStart(other);
    for (let i = 0; i < 50; i += 1) {
      expect(pacificDayStart(other)).toBe(otherFirst);
      expect(pacificDayStart(instant)).toBe(first);
    }
  });
});

describe('nextPacificMidnight', () => {
  it('is exactly 24 hours later on an ordinary day', () => {
    const noonPacific = Date.UTC(2026, 0, 15, 20, 0, 0);
    expect(nextPacificMidnight(noonPacific)).toBe(Date.UTC(2026, 0, 16, 8, 0, 0));
  });

  it('is only 23 hours away on the spring-forward day, 2026-03-08 (second Sunday of March)', () => {
    const afternoon = Date.UTC(2026, 2, 8, 20, 0, 0); // after the 2 a.m. jump PST -> PDT
    const start = pacificDayStart(afternoon);
    const next = nextPacificMidnight(afternoon);
    expect(start).toBe(Date.UTC(2026, 2, 8, 8, 0, 0)); // that midnight was still PST (UTC-8)
    expect(next).toBe(Date.UTC(2026, 2, 9, 7, 0, 0)); // the next one is already PDT (UTC-7)
    expect(next - start).toBe(23 * 60 * 60 * 1_000);
  });

  it('is 25 hours away on the fall-back day, 2026-11-01 (first Sunday of November)', () => {
    const afternoon = Date.UTC(2026, 10, 1, 20, 0, 0); // after the 2 a.m. fall back PDT -> PST
    const start = pacificDayStart(afternoon);
    const next = nextPacificMidnight(afternoon);
    expect(start).toBe(Date.UTC(2026, 10, 1, 7, 0, 0)); // that midnight was still PDT (UTC-7)
    expect(next).toBe(Date.UTC(2026, 10, 2, 8, 0, 0)); // the next one is already PST (UTC-8)
    expect(next - start).toBe(25 * 60 * 60 * 1_000);
  });

  it('rolls over into the new year at Pacific midnight on the last day of December', () => {
    const noonOnDec31 = Date.UTC(2026, 11, 31, 20, 0, 0);
    expect(nextPacificMidnight(noonOnDec31)).toBe(Date.UTC(2027, 0, 1, 8, 0, 0));
  });
});

/* ── summarizeUsage ─────────────────────────────────────────────────────── */

describe('summarizeUsage', () => {
  const LIMITS: ModelRateLimits = { rpm: 5, tpm: 1_000, rpd: 20 };
  const NOW = Date.UTC(2026, 0, 15, 20, 0, 0); // 2026-01-15 12:00 PT (PST)
  const DAY_START = Date.UTC(2026, 0, 15, 8, 0, 0); // Pacific midnight that day, see above

  it('reports full remaining and no exhaustion with no events at all', () => {
    const usage = summarizeUsage([], PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpm).toMatchObject({ used: 0, limit: LIMITS.rpm, remaining: LIMITS.rpm, exhausted: false });
    expect(usage.tpm).toMatchObject({ used: 0, limit: LIMITS.tpm, remaining: LIMITS.tpm, exhausted: false });
    expect(usage.rpd).toMatchObject({ used: 0, limit: LIMITS.rpd, remaining: LIMITS.rpd, exhausted: false });
    expect(usage.remainingShare).toBe(1);
  });

  it('ignores events from a different provider or a different model', () => {
    const events = [
      event({ at: NOW - 1_000, provider: 'openai', model: MODEL }),
      event({ at: NOW - 1_000, provider: PROVIDER, model: 'gemini-3.5-flash' }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpm.used).toBe(0);
    expect(usage.tpm.used).toBe(0);
    expect(usage.rpd.used).toBe(0);
  });

  it('excludes an event exactly 60 000 ms old from the rpm window', () => {
    // `at > now - 60_000` is strict — the boundary itself is already out.
    const usage = summarizeUsage([event({ at: NOW - 60_000 })], PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpm.used).toBe(0);
  });

  it('includes an event 59 999 ms old', () => {
    const usage = summarizeUsage([event({ at: NOW - 59_999 })], PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpm.used).toBe(1);
  });

  it('resets at now when the rpm window is empty', () => {
    const usage = summarizeUsage([], PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpm.resetsAt).toBe(NOW);
  });

  it('resets 60 000 ms after the oldest in-window event', () => {
    const events = [event({ at: NOW - 50_000 }), event({ at: NOW - 10_000 })];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpm.resetsAt).toBe(NOW - 50_000 + 60_000);
  });

  it('sums non-null input tokens and counts a null one as unknown', () => {
    const events = [
      event({ at: NOW - 1_000, inputTokens: 40 }),
      event({ at: NOW - 2_000, inputTokens: null }),
      event({ at: NOW - 3_000, inputTokens: 60, outcome: 'failed' }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.tpm.used).toBe(100);
    expect(usage.tpm.unknownTokens).toBe(1);
  });

  it('does not count an event from one ms before Pacific midnight toward today for rpd', () => {
    const usage = summarizeUsage([event({ at: DAY_START - 1 })], PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpd.used).toBe(0);
  });

  it('counts an event exactly at Pacific midnight toward today for rpd', () => {
    const usage = summarizeUsage([event({ at: DAY_START })], PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpd.used).toBe(1);
  });

  it('counts every outcome — ok, limited and failed — as a request', () => {
    const events = [
      event({ at: NOW - 1_000, outcome: 'ok' }),
      event({ at: NOW - 2_000, outcome: 'limited' }),
      event({ at: NOW - 3_000, outcome: 'failed' }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpm.used).toBe(3);
    expect(usage.rpd.used).toBe(3);
  });

  it('is exhausted the moment used reaches the limit, not before', () => {
    const belowLimit = [
      event({ at: NOW - 1_000 }),
      event({ at: NOW - 2_000 }),
      event({ at: NOW - 3_000 }),
      event({ at: NOW - 4_000 }),
    ]; // LIMITS.rpm is 5

    const under = summarizeUsage(belowLimit, PROVIDER, MODEL, LIMITS, NOW);
    expect(under.rpm.exhausted).toBe(false);
    expect(under.rpm.remaining).toBe(1);

    const atLimit = summarizeUsage([...belowLimit, event({ at: NOW - 5_000 })], PROVIDER, MODEL, LIMITS, NOW);
    expect(atLimit.rpm.exhausted).toBe(true);
    expect(atLimit.rpm.remaining).toBe(0);
  });

  it('is exhausted from an rpd 429 today even though used is below the limit', () => {
    const events = [
      event({ at: NOW - 1_000, outcome: 'limited', quota: { axis: 'rpd', limit: null, retryAfterMs: null } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpd.used).toBeLessThan(LIMITS.rpd);
    expect(usage.rpd.exhausted).toBe(true);
  });

  it('ignores an rpd 429 from a previous Pacific day', () => {
    const events = [
      event({ at: DAY_START - 1, outcome: 'limited', quota: { axis: 'rpd', limit: null, retryAfterMs: null } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpd.used).toBe(0);
    expect(usage.rpd.exhausted).toBe(false);
  });

  it('stays exhausted for the stated retryAfterMs, past the rpm window reset', () => {
    const limitedAt = NOW - 1_000;
    const events = [
      event({ at: limitedAt, outcome: 'limited', quota: { axis: 'rpm', limit: null, retryAfterMs: 120_000 } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpm.used).toBeLessThan(LIMITS.rpm);
    expect(usage.rpm.exhausted).toBe(true);
    // The stated wait (limitedAt + 120s) outlasts the plain 60s window reset.
    expect(usage.rpm.resetsAt).toBe(limitedAt + 120_000);
  });

  it('defaults the wait to 60 000 ms when the 429 gave no retryAfterMs', () => {
    const limitedAt = NOW - 1_000;
    const events = [
      event({ at: limitedAt, outcome: 'limited', quota: { axis: 'tpm', limit: null, retryAfterMs: null } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.tpm.exhausted).toBe(true);
    expect(usage.tpm.resetsAt).toBe(limitedAt + 60_000);
  });

  it('stops forcing exhaustion once the stated wait has passed', () => {
    const limitedAt = NOW - 120_000; // also outside the rpm window itself
    const events = [
      event({ at: limitedAt, outcome: 'limited', quota: { axis: 'rpm', limit: null, retryAfterMs: 60_000 } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpm.used).toBe(0);
    expect(usage.rpm.exhausted).toBe(false);
  });

  it('lets a later, larger stated limit override both the catalogue and an earlier one', () => {
    const events = [
      event({ at: NOW - 30_000, outcome: 'limited', quota: { axis: 'rpm', limit: 3, retryAfterMs: null } }),
      event({ at: NOW - 20_000, outcome: 'limited', quota: { axis: 'rpm', limit: 10, retryAfterMs: null } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpm.limit).toBe(10);
  });

  it('lets a later, smaller stated limit override an earlier larger one too', () => {
    const events = [
      event({ at: NOW - 30_000, outcome: 'limited', quota: { axis: 'rpm', limit: 3, retryAfterMs: null } }),
      event({ at: NOW - 20_000, outcome: 'limited', quota: { axis: 'rpm', limit: 10, retryAfterMs: null } }),
      event({ at: NOW - 10_000, outcome: 'limited', quota: { axis: 'rpm', limit: 2, retryAfterMs: null } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpm.limit).toBe(2);
  });

  it('ignores a non-positive stated limit, leaving the previous override in force', () => {
    const events = [
      event({ at: NOW - 10_000, outcome: 'limited', quota: { axis: 'rpm', limit: 2, retryAfterMs: null } }),
      event({ at: NOW - 5_000, outcome: 'limited', quota: { axis: 'rpm', limit: 0, retryAfterMs: null } }),
      event({ at: NOW - 4_000, outcome: 'limited', quota: { axis: 'rpm', limit: -1, retryAfterMs: null } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);
    expect(usage.rpm.limit).toBe(2);
  });

  it('marks nothing exhausted when a 429 did not say which axis ran out', () => {
    const events = [
      event({ at: NOW - 1_000, outcome: 'limited', quota: { axis: null, limit: null, retryAfterMs: null } }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, LIMITS, NOW);

    expect(usage.rpm.exhausted).toBe(false);
    expect(usage.tpm.exhausted).toBe(false);
    expect(usage.rpd.exhausted).toBe(false);
  });

  it('breaks a three-way tie toward rpd, the axis worth surfacing first', () => {
    const custom: ModelRateLimits = { rpm: 4, tpm: 100, rpd: 10 };
    const events = [
      // Two recent requests: rpm used 2/4, tpm used 50/100 — both share 0.5.
      event({ at: NOW - 5_000, inputTokens: 25 }),
      event({ at: NOW - 5_000 - 1, inputTokens: 25 }),
      // Three more from earlier today, outside the rpm/tpm window but still
      // counted by rpd: used 5/10 — also share 0.5.
      event({ at: NOW - 120_000, inputTokens: null }),
      event({ at: NOW - 130_000, inputTokens: null }),
      event({ at: NOW - 140_000, inputTokens: null }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, custom, NOW);

    expect(usage.rpd.remaining / usage.rpd.limit).toBe(0.5);
    expect(usage.tpm.remaining / usage.tpm.limit).toBe(0.5);
    expect(usage.rpm.remaining / usage.rpm.limit).toBe(0.5);
    expect(usage.bottleneck).toBe('rpd');
  });

  it('picks tpm when its share is the strict minimum', () => {
    const custom: ModelRateLimits = { rpm: 4, tpm: 100, rpd: 10 };
    const events = [
      // tpm used 90/100 (share 0.1) — strictly worse than rpm and rpd below.
      event({ at: NOW - 5_000, inputTokens: 45 }),
      event({ at: NOW - 5_000 - 1, inputTokens: 45 }),
      event({ at: NOW - 120_000, inputTokens: null }),
      event({ at: NOW - 130_000, inputTokens: null }),
      event({ at: NOW - 140_000, inputTokens: null }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, custom, NOW);

    expect(usage.tpm.remaining / usage.tpm.limit).toBeCloseTo(0.1);
    expect(usage.bottleneck).toBe('tpm');
  });

  it('picks rpm when its share is the strict minimum', () => {
    const custom: ModelRateLimits = { rpm: 4, tpm: 100, rpd: 10 };
    const events = [
      // Five zero-token requests: rpm used 5/4 (exhausted, share 0), tpm
      // untouched (share 1), rpd used 5/10 (share 0.5).
      event({ at: NOW - 1_000, inputTokens: 0 }),
      event({ at: NOW - 2_000, inputTokens: 0 }),
      event({ at: NOW - 3_000, inputTokens: 0 }),
      event({ at: NOW - 4_000, inputTokens: 0 }),
      event({ at: NOW - 5_000, inputTokens: 0 }),
    ];
    const usage = summarizeUsage(events, PROVIDER, MODEL, custom, NOW);

    expect(usage.rpm.remaining).toBe(0);
    expect(usage.bottleneck).toBe('rpm');
  });
});

/* ── ModelQuotaError.isRetryable ────────────────────────────────────────── */

describe('ModelQuotaError.isRetryable', () => {
  it('is false once the body named the daily request axis — only midnight Pacific frees it', () => {
    const error = new ModelQuotaError('daily quota', { quota: { axis: 'rpd', limit: 20, retryAfterMs: null } });
    expect(error.isRetryable).toBe(false);
  });

  it('is true for rpm, exactly like any other rate limit', () => {
    const error = new ModelQuotaError('per-minute quota', { quota: { axis: 'rpm', limit: 5, retryAfterMs: null } });
    expect(error.isRetryable).toBe(true);
  });

  it('is true for tpm, exactly like any other rate limit', () => {
    const error = new ModelQuotaError('token quota', {
      quota: { axis: 'tpm', limit: 250_000, retryAfterMs: null },
    });
    expect(error.isRetryable).toBe(true);
  });

  it('is true when the 429 body did not say which axis ran out', () => {
    const error = new ModelQuotaError('unspecified', { quota: { axis: null, limit: null, retryAfterMs: null } });
    expect(error.isRetryable).toBe(true);
  });

  it('is true when the body could not even be read as a quota error', () => {
    const error = new ModelQuotaError('unreadable', { quota: null });
    expect(error.isRetryable).toBe(true);
  });
});

/* ── readQuotaFailure ───────────────────────────────────────────────────── */

/**
 * The body shapes below are not recorded samples — see the JSDoc above
 * `readQuotaFailure` in `usage.ts`: Gemini has never sent this browser a 429
 * under normal operation, so there is nothing here to capture one from. They
 * are reconstructed from Google's public error-format documentation and the
 * literal body quoted in that comment.
 */
describe('readQuotaFailure', () => {
  const documentedBody = {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'Quota exceeded for quota metric generate_content_free_tier_requests.',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaDimensions: { location: 'global', model: 'gemini-2.5-flash' },
              quotaValue: '20',
            },
          ],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '23s' },
      ],
    },
  };

  it('reads the documented Gemini 429 body', () => {
    expect(readQuotaFailure(documentedBody)).toEqual({ axis: 'rpd', limit: 20, retryAfterMs: 23_000 });
  });

  it('reads the identical body serialized as a JSON string', () => {
    expect(readQuotaFailure(JSON.stringify(documentedBody))).toEqual({
      axis: 'rpd',
      limit: 20,
      retryAfterMs: 23_000,
    });
  });

  it('reads a per-minute request quota id as rpm', () => {
    const body = {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '5' }],
          },
        ],
      },
    };
    expect(readQuotaFailure(body)?.axis).toBe('rpm');
  });

  it('reads GenerateContentInputTokensPerModelPerMinute-FreeTier as tpm, not rpm', () => {
    // The id contains the word "minute" too — "token" has to win.
    const body = {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              { quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier', quotaValue: '250000' },
            ],
          },
        ],
      },
    };
    expect(readQuotaFailure(body)?.axis).toBe('tpm');
  });

  it('returns an all-null signal for an empty violations list on a quota error', () => {
    const body = {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [] }],
      },
    };
    expect(readQuotaFailure(body)).toEqual({ axis: null, limit: null, retryAfterMs: null });
  });

  it('treats a zero quotaValue as no real limit', () => {
    const body = {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '0' }],
          },
        ],
      },
    };
    expect(readQuotaFailure(body)?.limit).toBeNull();
  });

  it('treats a negative quotaValue as no real limit', () => {
    const body = {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '-5' }],
          },
        ],
      },
    };
    expect(readQuotaFailure(body)?.limit).toBeNull();
  });

  it('treats a non-numeric quotaValue as no real limit', () => {
    const body = {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: 'many' }],
          },
        ],
      },
    };
    expect(readQuotaFailure(body)?.limit).toBeNull();
  });

  it('parses a fractional retryDelay in seconds', () => {
    const body = {
      error: {
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1.5s' }],
      },
    };
    expect(readQuotaFailure(body)?.retryAfterMs).toBe(1_500);
  });

  it('returns an all-null signal for a 429 with no details at all', () => {
    expect(readQuotaFailure({ error: { code: 429 } })).toEqual({ axis: null, limit: null, retryAfterMs: null });
  });

  it('does not mistake an OpenAI-style 429 body for a Gemini quota error', () => {
    const body = {
      error: { message: 'Rate limit reached for requests', type: 'requests', param: null, code: 'rate_limit_exceeded' },
    };
    expect(readQuotaFailure(body)).toBeNull();
  });

  it('returns null for HTML that does not even parse as JSON', () => {
    expect(readQuotaFailure('<html><body>502 Bad Gateway</body></html>')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(readQuotaFailure(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(readQuotaFailure(null)).toBeNull();
  });
});

/**
 * `pickViolation` reads axis *and* limit from the same violation only — see
 * its own JSDoc for why pairing them from two different entries would turn a
 * 20-per-day cap and a 5-per-minute cap into a nonsense "5 requests per day".
 */
describe('readQuotaFailure — picking one violation among several', () => {
  const withDetails = (violations: readonly unknown[]): unknown => ({
    error: {
      code: 429,
      details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations }],
    },
  });

  const rpmViolation = { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '3' };
  const rpdViolation = { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' };

  it('picks the rpd violation over an rpm one, whichever order they arrive in', () => {
    expect(readQuotaFailure(withDetails([rpmViolation, rpdViolation]))).toEqual({
      axis: 'rpd',
      limit: 20,
      retryAfterMs: null,
    });
    expect(readQuotaFailure(withDetails([rpdViolation, rpmViolation]))).toEqual({
      axis: 'rpd',
      limit: 20,
      retryAfterMs: null,
    });
  });

  it("prefers tpm over rpm, and reads tpm's own limit rather than rpm's", () => {
    const tpmViolation = { quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier', quotaValue: '250000' };
    expect(readQuotaFailure(withDetails([tpmViolation, rpmViolation]))).toEqual({
      axis: 'tpm',
      limit: 250_000,
      retryAfterMs: null,
    });
  });

  it('resolves a lone per-day TOKEN quota id to no axis at all — rpd counts requests, not tokens', () => {
    const dailyTokenViolation = {
      quotaId: 'GenerateContentInputTokensPerModelPerDay-FreeTier',
      quotaValue: '1000000',
    };
    expect(readQuotaFailure(withDetails([dailyTokenViolation]))).toEqual({
      axis: null,
      limit: null,
      retryAfterMs: null,
    });
  });

  it('lets an rpm violation win with its own limit alongside an unmodelled per-day token violation', () => {
    const dailyTokenViolation = {
      quotaId: 'GenerateContentInputTokensPerModelPerDay-FreeTier',
      quotaValue: '1000000',
    };
    expect(readQuotaFailure(withDetails([dailyTokenViolation, rpmViolation]))).toEqual({
      axis: 'rpm',
      limit: 3,
      retryAfterMs: null,
    });
  });

  it('does not let a second violation on the same axis lend its quotaValue to a first one that had none', () => {
    const rpmNoValue = { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }; // no quotaValue field
    const rpmWithValue = { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '7' };
    expect(readQuotaFailure(withDetails([rpmNoValue, rpmWithValue]))).toEqual({
      axis: 'rpm',
      limit: null,
      retryAfterMs: null,
    });
  });
});

/* ── isKeyRejection ─────────────────────────────────────────────────────── */

describe('isKeyRejection', () => {
  it('treats 401 as a key rejection with no body at all', () => {
    expect(isKeyRejection(401, undefined)).toBe(true);
  });

  it('treats 401 as a key rejection with a body too', () => {
    expect(isKeyRejection(401, { error: { message: 'invalid api key' } })).toBe(true);
  });

  it('treats 403 as a key rejection, with or without a body', () => {
    expect(isKeyRejection(403, undefined)).toBe(true);
    expect(isKeyRejection(403, { error: { message: 'forbidden' } })).toBe(true);
  });

  it('treats a 400 whose ErrorInfo detail names API_KEY_INVALID as a key rejection', () => {
    const body = {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'API key not valid. Please pass a valid API key.',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' },
        ],
      },
    };
    expect(isKeyRejection(400, body)).toBe(true);
  });

  it('treats a 400 as a key rejection when only the plain-English message says API_KEY_INVALID (no details array)', () => {
    const body = { error: { code: 400, message: 'API_KEY_INVALID: bad key' } };
    expect(isKeyRejection(400, body)).toBe(true);
  });

  it('does not treat a different 400 reason — an unknown model id — as a key rejection', () => {
    const body = {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'Unknown model gemini-99-ultra',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'MODEL_NOT_FOUND' }],
      },
    };
    expect(isKeyRejection(400, body)).toBe(false);
  });

  it('does not treat a 429 as a key rejection', () => {
    expect(isKeyRejection(429, { error: { message: 'quota exceeded' } })).toBe(false);
  });

  it('does not treat a 500 as a key rejection', () => {
    expect(isKeyRejection(500, undefined)).toBe(false);
  });

  it('reads a 400 key-rejection body serialized as a JSON string, the same as the object', () => {
    const body = JSON.stringify({
      error: { code: 400, details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] },
    });
    expect(isKeyRejection(400, body)).toBe(true);
  });

  it('reads API_KEY_INVALID out of a plain string body with no JSON structure at all', () => {
    expect(isKeyRejection(400, 'API_KEY_INVALID')).toBe(true);
  });
});

/* ── isModelRequestEvent ────────────────────────────────────────────────── */

describe('isModelRequestEvent', () => {
  const valid: unknown = {
    id: 'evt-1',
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    at: 1_700_000_000_000,
    inputTokens: 120,
    outcome: 'ok',
  };

  it('accepts a well-formed event', () => {
    expect(isModelRequestEvent(valid)).toBe(true);
  });

  it('accepts inputTokens: 0', () => {
    expect(isModelRequestEvent({ ...(valid as object), inputTokens: 0 })).toBe(true);
  });

  it('rejects an event with no inputTokens field at all (intentional: the field is required, not optional)', () => {
    const withoutTokens = {
      id: 'evt-1',
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      at: 1_700_000_000_000,
      outcome: 'ok',
    };
    expect(isModelRequestEvent(withoutTokens)).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(isModelRequestEvent({ ...(valid as object), provider: 'made-up-provider' })).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(isModelRequestEvent({ ...(valid as object), id: '' })).toBe(false);
  });

  it('rejects a NaN at', () => {
    expect(isModelRequestEvent({ ...(valid as object), at: Number.NaN })).toBe(false);
  });

  it('rejects an unknown outcome', () => {
    expect(isModelRequestEvent({ ...(valid as object), outcome: 'pending' })).toBe(false);
  });

  it('rejects a malformed quota', () => {
    const withBadQuota = { ...(valid as object), quota: { axis: 'not-a-real-axis', limit: null, retryAfterMs: null } };
    expect(isModelRequestEvent(withBadQuota)).toBe(false);
  });

  /**
   * `structuredClone` — what a `BroadcastChannel` message or an IndexedDB
   * round trip both use — preserves `Infinity`/`NaN`/negative numbers exactly,
   * unlike `JSON.parse`. Each of these arrives here `typeof === 'number'` and
   * still has to be rejected on its own domain constraint; see the JSDoc above
   * `isQuotaSignal` in `usage.ts`.
   */
  it('rejects Infinity, a negative count and NaN for inputTokens', () => {
    expect(isModelRequestEvent({ ...(valid as object), inputTokens: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isModelRequestEvent({ ...(valid as object), inputTokens: -5 })).toBe(false);
    expect(isModelRequestEvent({ ...(valid as object), inputTokens: Number.NaN })).toBe(false);
  });

  it('rejects a NaN, a negative or a zero quota.limit — a limit is a positive ceiling', () => {
    const withLimit = (limit: number): unknown => ({
      ...(valid as object),
      quota: { axis: 'rpm', limit, retryAfterMs: null },
    });
    expect(isModelRequestEvent(withLimit(Number.NaN))).toBe(false);
    expect(isModelRequestEvent(withLimit(-1))).toBe(false);
    expect(isModelRequestEvent(withLimit(0))).toBe(false);
  });

  it('rejects a negative or -Infinity quota.retryAfterMs, but accepts a wait of exactly zero', () => {
    const withRetry = (retryAfterMs: number): unknown => ({
      ...(valid as object),
      quota: { axis: 'rpm', limit: 5, retryAfterMs },
    });
    expect(isModelRequestEvent(withRetry(Number.NEGATIVE_INFINITY))).toBe(false);
    expect(isModelRequestEvent(withRetry(-1))).toBe(false);
    expect(isModelRequestEvent(withRetry(0))).toBe(true);
  });
});

/* ── pruneUsage ─────────────────────────────────────────────────────────── */

describe('pruneUsage', () => {
  it('drops an event exactly at the retention boundary, strictly (>, not >=)', () => {
    const now = 10_000_000;
    const cutoff = now - USAGE_RETENTION_MS;
    const events = [event({ at: cutoff }), event({ at: cutoff + 1 })];

    const kept = pruneUsage(events, now).map((entry) => entry.at);
    expect(kept).toEqual([cutoff + 1]);
  });
});

/* ── recordModelRequest / subscribeModelRequests ───────────────────────── */

describe('recordModelRequest and subscribeModelRequests', () => {
  it('notifies every subscriber with the same minted event', () => {
    const seenA: ModelRequestEvent[] = [];
    const seenB: ModelRequestEvent[] = [];
    const unsubA = subscribeModelRequests((e) => seenA.push(e));
    const unsubB = subscribeModelRequests((e) => seenB.push(e));

    try {
      recordModelRequest({ provider: 'gemini', model: MODEL, at: 1_000, inputTokens: 10, outcome: 'ok' });

      expect(seenA).toHaveLength(1);
      expect(seenB).toHaveLength(1);
      expect(seenA[0]).toEqual(seenB[0]);
      expect(seenA[0]?.id).not.toBe('');
    } finally {
      unsubA();
      unsubB();
    }
  });

  it('does not let one throwing listener stop the others from being notified', () => {
    const calls: string[] = [];
    const unsubThrow = subscribeModelRequests(() => {
      throw new Error('boom');
    });
    const unsubOk = subscribeModelRequests(() => calls.push('ok'));

    try {
      expect(() =>
        recordModelRequest({ provider: 'gemini', model: MODEL, at: 1_000, inputTokens: null, outcome: 'failed' }),
      ).not.toThrow();
      expect(calls).toEqual(['ok']);
    } finally {
      unsubThrow();
      unsubOk();
    }
  });

  it('stops notifying a listener once it has unsubscribed', () => {
    const calls: number[] = [];
    const unsub = subscribeModelRequests(() => calls.push(1));
    unsub();

    recordModelRequest({ provider: 'gemini', model: MODEL, at: 1_000, inputTokens: null, outcome: 'ok' });
    expect(calls).toEqual([]);
  });
});
