import { describe, expect, it } from 'vitest';

import { classifyOpenAiFailure, openAiIncompleteError } from '@core/ai/modelRules';
import { ModelQuotaError } from '@core/ai/usage';
import { ApiError, type ApiFailureKind } from '@/services/api/client';

/**
 * `useInsightsQuery.ts` reaches `@/store/filters.store` (via `./useScope`),
 * which reaches `@/constants/app`, which reads `__APP_VERSION__` — a bare
 * identifier that only exists because `vite.config.ts` substitutes it at
 * build time (`define: { __APP_VERSION__: ... }`). `vitest.config.ts` does
 * not carry the same `define`, so a plain static import of the module under
 * test throws `ReferenceError: __APP_VERSION__ is not defined` before a
 * single test runs. The stub below only supplies the missing global for this
 * test file; it does not touch the module being tested.
 */
(globalThis as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ = '0.0.0-test';

const { shouldRetryAiCards } = await import('./useInsightsQuery');

/**
 * `shouldRetryAiCards` is TanStack's `retry` option for the rail's AI query —
 * the rule that decides whether a paid request is sent a second time.
 *
 * The review this pins found the rail re-sending failures that repeat and
 * cost tokens: a 401, a spent daily quota, `insufficient_quota`, OpenAI's own
 * `response.incomplete` — every one of those bills the seller's key again for
 * an identical refusal. Only a transport hiccup earns the single retry this
 * query allows.
 */

/* ── a retryable ApiError: one retry, then stop ────────────────────────── */

const RETRYABLE_KINDS: readonly ApiFailureKind[] = ['network', 'timeout', 'server', 'rateLimited'];

describe.each(RETRYABLE_KINDS)('a %s ApiError', (kind) => {
  const error = new ApiError('transport hiccup', { kind });

  it('is retried on the first failure', () => {
    expect(shouldRetryAiCards(0, error)).toBe(true);
  });

  it('is not retried again after that one attempt', () => {
    expect(shouldRetryAiCards(1, error)).toBe(false);
  });
});

/* ── a non-retryable ApiError: never, even on the first failure ───────── */

const NON_RETRYABLE_KINDS: readonly ApiFailureKind[] = ['client', 'unauthorized', 'forbidden'];

describe.each(NON_RETRYABLE_KINDS)('a %s ApiError', (kind) => {
  it('is never retried, not even on the first failure', () => {
    const error = new ApiError('refused', { kind });
    expect(shouldRetryAiCards(0, error)).toBe(false);
  });
});

describe('OpenAI-specific refusals that a retry cannot fix', () => {
  it('does not retry the model stopping itself short on max_output_tokens', () => {
    // kind 'client', code 'incomplete' — an identical retry burns the same
    // reasoning tokens for the same empty answer.
    const error = openAiIncompleteError('max_output_tokens');
    expect(error.kind).toBe('client');
    expect(error.code).toBe('incomplete');
    expect(shouldRetryAiCards(0, error)).toBe(false);
  });

  it('does not retry insufficient_quota — billing, not a slow window', () => {
    const error = classifyOpenAiFailure('insufficient_quota', 'no quota left');
    expect(shouldRetryAiCards(0, error)).toBe(false);
  });
});

it('does not retry a spent daily Gemini quota', () => {
  // ModelQuotaError overrides isRetryable to false for the 'rpd' axis: only
  // the Pacific day turning over frees it, not another attempt right now.
  const error = new ModelQuotaError('daily quota exhausted', {
    quota: { axis: 'rpd', limit: 20, retryAfterMs: null },
  });
  expect(error.isRetryable).toBe(false);
  expect(shouldRetryAiCards(0, error)).toBe(false);
});

describe('a per-minute Gemini quota', () => {
  const error = new ModelQuotaError('rpm quota hit', {
    quota: { axis: 'rpm', limit: 5, retryAfterMs: null },
  });

  it('is retried once — the window reopens within a minute', () => {
    expect(shouldRetryAiCards(0, error)).toBe(true);
  });

  it('is not retried a second time', () => {
    expect(shouldRetryAiCards(1, error)).toBe(false);
  });
});

/* ── anything that is not an ApiError at all: treated as a transport hiccup ── */

describe.each([
  ['a plain Error', new Error('boom')],
  ['a string', 'boom'],
])('%s', (_label, error) => {
  it('is retried on the first failure', () => {
    expect(shouldRetryAiCards(0, error)).toBe(true);
  });

  it('is not retried again after that one attempt', () => {
    expect(shouldRetryAiCards(1, error)).toBe(false);
  });
});
