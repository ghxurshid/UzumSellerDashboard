import { describe, expect, it } from 'vitest';

import { ApiError } from '@/services/api/client';

import { RETRIES, retryDelay, shouldRetry } from './stream';
import { ModelQuotaError } from './usage';

/**
 * When a failed request is worth repeating.
 *
 * The provider this exists for answers `503 UNAVAILABLE` under load and means
 * "come back in a moment" — so the two questions are how long to wait and when
 * to stop asking. The second one has an answer that is not about the error at
 * all: once part of the answer is on screen, no retry is safe, because the
 * words would be written a second time underneath the first.
 */

const busy = (retryAfterMs?: number): ApiError =>
  new ApiError('overloaded', {
    kind: 'server',
    status: 503,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

describe('shouldRetry', () => {
  it('repeats an overloaded model', () => {
    expect(shouldRetry(busy(), { attempt: 0, produced: false })).toBe(true);
  });

  it('repeats a rate limit and a dropped connection', () => {
    const limited = new ApiError('slow down', { kind: 'rateLimited', status: 429 });
    const dropped = new ApiError('unreachable', { kind: 'network' });

    expect(shouldRetry(limited, { attempt: 1, produced: false })).toBe(true);
    expect(shouldRetry(dropped, { attempt: 1, produced: false })).toBe(true);
  });

  it('does not repeat what repeating cannot fix', () => {
    const key = new ApiError('bad key', { kind: 'unauthorized', status: 401 });
    const bad = new ApiError('unknown model', { kind: 'client', status: 400 });

    expect(shouldRetry(key, { attempt: 0, produced: false })).toBe(false);
    expect(shouldRetry(bad, { attempt: 0, produced: false })).toBe(false);
  });

  it('does not repeat once the seller has read part of the answer', () => {
    /* The retry would stream the same sentences again, under the first copy. */
    expect(shouldRetry(busy(), { attempt: 0, produced: true })).toBe(false);
  });

  it('gives up after three attempts and hands it over', () => {
    expect(shouldRetry(busy(), { attempt: RETRIES - 1, produced: false })).toBe(true);
    expect(shouldRetry(busy(), { attempt: RETRIES, produced: false })).toBe(false);
  });

  it('ignores anything that is not an ApiError', () => {
    expect(shouldRetry(new Error('boom'), { attempt: 0, produced: false })).toBe(false);
    expect(shouldRetry(null, { attempt: 0, produced: false })).toBe(false);
  });

  describe('a daily quota', () => {
    /* A DAILY quota does not reopen inside this session — only the Pacific day
       turning over frees it — so a retry here is a request Google's own
       counter would hold against the project for the same refusal. */
    it('never repeats an rpd 429, however early in the attempts it is', () => {
      const rpdExhausted = new ModelQuotaError('quota', { quota: { axis: 'rpd', limit: 20, retryAfterMs: null } });
      expect(shouldRetry(rpdExhausted, { attempt: 0, produced: false })).toBe(false);
    });

    it('repeats an rpm 429 exactly like any other rate limit', () => {
      const rpmExhausted = new ModelQuotaError('quota', { quota: { axis: 'rpm', limit: 5, retryAfterMs: null } });
      expect(shouldRetry(rpmExhausted, { attempt: 0, produced: false })).toBe(true);
      expect(shouldRetry(rpmExhausted, { attempt: 0, produced: true })).toBe(false);
      expect(shouldRetry(rpmExhausted, { attempt: RETRIES, produced: false })).toBe(false);
    });

    it('repeats a 429 whose body said nothing about which axis ran out', () => {
      const unspecified = new ModelQuotaError('quota', { quota: { axis: null, limit: null, retryAfterMs: null } });
      expect(shouldRetry(unspecified, { attempt: 0, produced: false })).toBe(true);
    });

    it('repeats a 429 the body could not even be read as a quota error for', () => {
      const noQuotaInfo = new ModelQuotaError('quota', { quota: null });
      expect(shouldRetry(noQuotaInfo, { attempt: 0, produced: false })).toBe(true);
    });
  });
});

describe('retryDelay', () => {
  it('believes the provider over its own arithmetic', () => {
    expect(retryDelay(0, 2_500)).toBe(2_500);
  });

  it('doubles the wait when the provider says nothing', () => {
    /* Jitter is added on top, so the floor is what is asserted. */
    expect(retryDelay(0)).toBeGreaterThanOrEqual(1_000);
    expect(retryDelay(1)).toBeGreaterThanOrEqual(2_000);
    expect(retryDelay(2)).toBeGreaterThanOrEqual(4_000);
  });

  it('caps the wait, however long the header asks for', () => {
    expect(retryDelay(0, 600_000)).toBe(8_000);
    expect(retryDelay(9)).toBeLessThanOrEqual(8_250);
  });
});
