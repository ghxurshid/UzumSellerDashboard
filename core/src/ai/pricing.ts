import type { AiProvider, AiSettings } from '@core/types/settings';

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
  /* Longest-prefix-wins (see `priceOf`) is what keeps `claude-opus-4` — 4.0/4.1
     — from being priced as 4.6/4.7/4.8, and what keeps `claude-sonnet-4` from
     being priced as 4.6, even though every one of those ids starts with the
     shorter row above it. */
  ['claude-opus-5', { input: 5, output: 25 }],
  ['claude-sonnet-5', { input: 2, output: 10 }],
  ['claude-haiku-4-5', { input: 1, output: 5 }],
  ['claude-opus-4-8', { input: 5, output: 25 }],
  ['claude-opus-4-7', { input: 5, output: 25 }],
  ['claude-opus-4-6', { input: 5, output: 25 }],
  ['claude-sonnet-4-6', { input: 3, output: 15 }],
  ['claude-opus-4', { input: 15, output: 75 }],
  ['claude-sonnet-4', { input: 3, output: 15 }],
  ['claude-haiku-4', { input: 1, output: 5 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4 }],
  /* OpenAI's own model pages, checked 2026-09-28. Cached input is exactly a
     tenth of the input rate on all three — the same ratio `costFromPrice`
     already applies for every provider, so no per-model cache price is
     needed here. */
  ['gpt-6-astra', { input: 10, output: 50 }],
  ['gpt-6-sol', { input: 2, output: 10 }],
  ['gpt-6-luna', { input: 0.1, output: 0.5 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1', { input: 2, output: 8 }],
  ['o4-mini', { input: 1.1, output: 4.4 }],
  /* Listed ahead of `gemini-2.5-flash` in source order for readability, but
     `priceOf`'s longest-prefix match is what actually keeps this one from
     being shadowed by it — `gemini-2.5-flash-lite` starts with
     `gemini-2.5-flash` too, and the shorter prefix would otherwise win and
     price it as the non-lite model, more than double the real rate. */
  ['gemini-2.5-flash-lite', { input: 0.1, output: 0.4 }],
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
 * A cached prefix is billed at about a tenth of the input rate.
 *
 * All the providers that cache converge on roughly that ratio, and the agent
 * loop is where it matters: the toolkit document is re-sent on every round,
 * and without this the cost line would charge full price for tokens the
 * provider explicitly did not charge full price for — which is the one
 * direction an estimate must not be wrong in, because it would make the
 * caching work look like it had not.
 *
 * Shared by `estimateCost` and `costOfTokens` so the two can never price the
 * same model two different ways; what differs between them is only which
 * convention their caller's `inputTokens` already is (see each one's own
 * doc).
 */
function costFromPrice(
  price: ModelPrice,
  uncachedInputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  return (
    (uncachedInputTokens * price.input +
      cachedInputTokens * price.input * 0.1 +
      outputTokens * price.output) /
    1_000_000
  );
}

/**
 * Dollars for one exchange, or `null` when this model's price is not known.
 *
 * A locally hosted model costs nothing per query and is reported as `0`, which
 * is a fact rather than an absence — the distinction the composer needs to
 * decide between showing "free" and showing nothing.
 *
 * `usage.inputTokens` here is the UNCACHED prompt — `stream.ts`'s accumulator
 * already discounts the cached prefix out of it before this is called. The
 * write side is folded into ordinary input rather than marked up, so a
 * thread's first round reads slightly low and every round after it reads
 * true. Hence the "≈" the composer prints. `costOfTokens` below takes the
 * opposite, RAW convention — see its own doc for why.
 */
export function estimateCost(
  settings: AiSettings,
  usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** Prefix tokens the provider served from its own cache. */
    readonly cachedInputTokens?: number;
  },
): number | null {
  if (settings.provider === 'ollama') return 0;

  const price = priceOf(settings.model);
  if (price === null) return null;

  return costFromPrice(price, usage.inputTokens, usage.cachedInputTokens ?? 0, usage.outputTokens);
}

/**
 * Dollars for one request, from the usage ledger's own numbers.
 *
 * Unlike `estimateCost`, `usage.inputTokens` here is RAW — cache included,
 * the same convention `ModelRequestEvent.inputTokens` uses — because that is
 * what `summarizeTokens` sums, and re-deriving the uncached figure from a
 * total that already dropped it would need information this call site does
 * not have. The uncached portion is recovered here instead:
 * `inputTokens - cachedInputTokens`.
 *
 * `usage.cachedInputTokens` has no room for "the provider never said" —
 * `0` reads as a fact, not an absence. A caller summing `TokenTotals` must
 * check `cachedReported` first: passing `0` for a provider that simply never
 * reports its cache (DeepSeek, Mistral) prices the *whole* prompt at the full
 * input rate, which is a real number — an upper bound on the true cost, not a
 * wrong one — but only true when the caller already knows it is an upper
 * bound and says so, rather than printing it as the answer.
 */
export function costOfTokens(
  provider: AiProvider,
  model: string,
  usage: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
  },
): number | null {
  if (provider === 'ollama') return 0;

  const price = priceOf(model);
  if (price === null) return null;

  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return costFromPrice(price, uncached, usage.cachedInputTokens, usage.outputTokens);
}

/** `≈ $0.004` — three decimals, because a query is rarely more than cents. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0';
  if (dollars < 0.001) return '< $0.001';
  return `$${dollars.toFixed(3)}`;
}
