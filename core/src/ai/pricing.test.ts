import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_SETTINGS, defaultAiConnection } from '@core/constants/settings';
import type { AiProvider, AiSettings } from '@core/types/settings';

import { costOfTokens, estimateCost, formatCost } from './pricing';

/**
 * `estimateCost` and `costOfTokens` price the same models from the same
 * table but read a different convention for `inputTokens` — see each
 * function's own doc in `pricing.ts`. These tests pin both conventions
 * against the GPT-6 rows, and pin that the two agree once the raw/uncached
 * difference is accounted for.
 */

function settingsFor(overrides: Partial<AiSettings> & { readonly provider?: AiProvider }): AiSettings {
  const provider = overrides.provider ?? DEFAULT_AI_SETTINGS.provider;
  return { provider, ...defaultAiConnection(provider), apiKey: 'test-key', ...overrides };
}

describe('estimateCost', () => {
  it('prices a known model, uncached input plus output', () => {
    const cost = estimateCost(settingsFor({ provider: 'claude', model: 'claude-haiku-4-5' }), {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1 + 5);
  });

  it('discounts a cached prefix to a tenth of the input rate', () => {
    const cost = estimateCost(settingsFor({ provider: 'claude', model: 'claude-haiku-4-5' }), {
      inputTokens: 0,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(cost).toBeCloseTo(0.1);
  });

  it('returns null for a model this table has never priced', () => {
    expect(
      estimateCost(settingsFor({ provider: 'custom', model: 'unknown-model-x' }), {
        inputTokens: 100,
        outputTokens: 100,
      }),
    ).toBeNull();
  });

  it('reports a local model as free, a fact rather than an absence', () => {
    expect(
      estimateCost(settingsFor({ provider: 'ollama', model: 'llama3' }), { inputTokens: 1_000, outputTokens: 1_000 }),
    ).toBe(0);
  });

  it('prices every GPT-6 model from OpenAI\'s own published rates', () => {
    expect(
      estimateCost(settingsFor({ provider: 'openai', model: 'gpt-6-astra' }), {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(10 + 50);
    expect(
      estimateCost(settingsFor({ provider: 'openai', model: 'gpt-6-sol' }), {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(2 + 10);
    expect(
      estimateCost(settingsFor({ provider: 'openai', model: 'gpt-6-luna' }), {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.1 + 0.5);
  });
});

describe('costOfTokens', () => {
  it('is ollama-free regardless of the model id', () => {
    expect(costOfTokens('ollama', 'anything', { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 1_000 })).toBe(
      0,
    );
  });

  it('returns null for a model this table has never priced', () => {
    expect(
      costOfTokens('custom', 'unknown-model-x', { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 }),
    ).toBeNull();
  });

  it('recovers the uncached portion from raw inputTokens minus cachedInputTokens', () => {
    const cost = costOfTokens('openai', 'gpt-6-astra', {
      inputTokens: 1_000_000, // raw, cache included
      cachedInputTokens: 200_000,
      outputTokens: 0,
    });
    // 800k uncached at $10/M + 200k cached at $1/M (a tenth of input).
    expect(cost).toBeCloseTo((800_000 * 10) / 1_000_000 + (200_000 * 1) / 1_000_000);
  });

  it('agrees with estimateCost once the raw/uncached difference is accounted for', () => {
    const uncached = 700_000;
    const cached = 300_000;

    const fromEstimate = estimateCost(settingsFor({ provider: 'claude', model: 'claude-sonnet-5' }), {
      inputTokens: uncached,
      cachedInputTokens: cached,
      outputTokens: 250_000,
    });
    const fromLedger = costOfTokens('claude', 'claude-sonnet-5', {
      inputTokens: uncached + cached, // raw
      cachedInputTokens: cached,
      outputTokens: 250_000,
    });

    expect(fromLedger).toBeCloseTo(fromEstimate ?? Number.NaN);
  });

  it('never goes negative when cachedInputTokens is reported larger than inputTokens', () => {
    // Defensive only — a provider is not expected to report this, but a
    // negative uncached figure would invert the whole calculation.
    const cost = costOfTokens('openai', 'gpt-6-luna', {
      inputTokens: 100,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});

describe('formatCost', () => {
  it('prints exactly $0 for a free model', () => {
    expect(formatCost(0)).toBe('$0');
  });

  it('prints a sub-cent floor rather than rounding to $0.000', () => {
    expect(formatCost(0.0002)).toBe('< $0.001');
  });

  it('prints three decimals otherwise', () => {
    expect(formatCost(0.1234)).toBe('$0.123');
  });
});
