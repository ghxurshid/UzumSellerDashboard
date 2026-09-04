import { describe, expect, it } from 'vitest';

import { estimateCost } from '@/services/ai/pricing';
import type { AiSettings } from '@/types/settings';

import type { Fact, FactTable } from './facts';
import { renderTemplate, resolveTemplate, templateRefs } from './template';

/**
 * Numbers inside a sentence, and what a question costs.
 *
 * The two are related more closely than they look. A template is how a figure
 * reaches prose without the model having typed it, and the cost line is how a
 * seller decides whether to ask again — both are places where being confidently
 * wrong is worse than saying nothing.
 */

const facts: FactTable = new Map<string, Fact>([
  ['totals.netProfit', { ref: 'totals.netProfit', label: 'Net profit', value: 457_924, format: 'money' }],
  ['totals.netMargin', { ref: 'totals.netMargin', label: 'Net margin', value: 9.2, format: 'percent' }],
]);

describe('resolveTemplate', () => {
  it('splits a sentence into text and resolved values', () => {
    const segments = resolveTemplate('Profit is {{totals.netProfit}} this month', facts, 'en');

    expect(segments.map((segment) => segment.kind)).toEqual(['text', 'value', 'text']);
  });

  it('marks a ref that does not exist rather than dropping it', () => {
    /* A sentence that quietly loses its figure still reads as a complete
       sentence, and is then simply wrong. A visible marker reads as a hole. */
    const segments = resolveTemplate('Profit is {{totals.invented}}', facts, 'en');

    expect(segments[1]).toEqual({ kind: 'missing', ref: 'totals.invented' });
    expect(renderTemplate('Profit is {{totals.invented}}', facts, 'en')).toBe('Profit is —');
  });

  it('resolves every placeholder in a run, not only the first', () => {
    /* The module-level regex is stateful; a shared `lastIndex` across calls is
       the classic way to lose every second match. */
    const rendered = renderTemplate(
      '{{totals.netProfit}} at {{totals.netMargin}} — {{totals.netProfit}}',
      facts,
      'en',
    );

    expect(rendered.match(/457/g)).toHaveLength(2);
  });

  it('lists the refs a template cites', () => {
    expect(templateRefs('{{a.b}} and {{ c.d }}')).toEqual(['a.b', 'c.d']);
  });

  it('leaves a sentence with no placeholders alone', () => {
    expect(renderTemplate('Nothing to resolve here', facts, 'en')).toBe(
      'Nothing to resolve here',
    );
  });
});

describe('estimateCost', () => {
  const settings = (over: Partial<AiSettings> = {}): AiSettings => ({
    provider: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'k',
    orgId: '',
    model: 'claude-sonnet-4-5',
    timeoutMs: 30_000,
    temperature: 0.2,
    maxTokens: 4096,
    ...over,
  });

  it('prices input and output at the model rate', () => {
    const cost = estimateCost(settings(), { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBeCloseTo(3, 6);
  });

  it('charges a cached prefix at a tenth', () => {
    /* The point of the caching work: without this the cost line would report
       full price for tokens the provider did not charge full price for, and
       the saving would be invisible. */
    const cost = estimateCost(settings(), {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });

    expect(cost).toBeCloseTo(0.3, 6);
  });

  it('says nothing rather than guessing for an unknown model', () => {
    expect(estimateCost(settings({ model: 'some-gateway-model' }), {
      inputTokens: 10,
      outputTokens: 10,
    })).toBeNull();
  });

  it('reports a local model as free, which is a fact rather than an absence', () => {
    expect(estimateCost(settings({ provider: 'ollama', model: 'llama3' }), {
      inputTokens: 10_000,
      outputTokens: 10_000,
    })).toBe(0);
  });
});
