import type { AiSettings } from '@/types/settings';

/**
 * What a question cost, when that can be said honestly.
 *
 * A per-query price next to the composer is genuinely useful — it is the
 * difference between a seller asking freely and a seller wondering. But the
 * number is only useful if it is right, and model prices are set by the
 * provider, change without notice, and vary by region and tier. A confidently
 * wrong figure is worse than none.
 *
 * So the table below is small and explicit, and **anything not in it returns
 * `null`**, which the composer renders as no cost line at all. A user pointing
 * the custom adapter at their own gateway sees nothing rather than a number
 * invented on their behalf.
 *
 * Prices are US dollars per million tokens.
 */

interface ModelPrice {
  readonly input: number;
  readonly output: number;
}

/**
 * Matched on a prefix, because providers append dates and revisions to model
 * ids and pinning the exact string would make the table wrong within a month.
 */
const PRICES: ReadonlyArray<readonly [string, ModelPrice]> = [
  ['claude-opus-4', { input: 15, output: 75 }],
  ['claude-sonnet-4', { input: 3, output: 15 }],
  ['claude-haiku-4', { input: 1, output: 5 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1', { input: 2, output: 8 }],
  ['o4-mini', { input: 1.1, output: 4.4 }],
  ['gemini-2.5-flash', { input: 0.3, output: 2.5 }],
  ['gemini-2.5-pro', { input: 1.25, output: 10 }],
  ['gemini-2.0-flash', { input: 0.1, output: 0.4 }],
  ['deepseek-chat', { input: 0.27, output: 1.1 }],
  ['deepseek-reasoner', { input: 0.55, output: 2.19 }],
  ['mistral-large', { input: 2, output: 6 }],
  ['mistral-small', { input: 0.2, output: 0.6 }],
];

function priceOf(model: string): ModelPrice | null {
  const id = model.trim().toLowerCase();
  /* Longest prefix wins, so `gpt-4o-mini` is not matched by `gpt-4o`. */
  let best: ModelPrice | null = null;
  let bestLength = 0;

  for (const [prefix, price] of PRICES) {
    if (id.startsWith(prefix) && prefix.length > bestLength) {
      best = price;
      bestLength = prefix.length;
    }
  }

  return best;
}

/**
 * Dollars for one exchange, or `null` when this model's price is not known.
 *
 * A locally hosted model costs nothing per query and is reported as `0`, which
 * is a fact rather than an absence — the distinction the composer needs to
 * decide between showing "free" and showing nothing.
 */
export function estimateCost(
  settings: AiSettings,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): number | null {
  if (settings.provider === 'ollama') return 0;

  const price = priceOf(settings.model);
  if (price === null) return null;

  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/** `≈ $0.004` — three decimals, because a query is rarely more than cents. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0';
  if (dollars < 0.001) return '< $0.001';
  return `$${dollars.toFixed(3)}`;
}
