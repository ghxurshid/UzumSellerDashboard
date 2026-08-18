import { z } from 'zod';

import { flattenSkus } from '@/services/derive/products';
import {
  loadExpenseTotals,
  loadProductTotals,
  loadSeries,
} from '@/services/storage/idb/analytics.client';
import type { Language, Product } from '@/types/domain';

import type { Fact, FactSeries } from './facts';

/**
 * What the model may go and look up.
 *
 * The rail could work from one standing fact table because its question was
 * fixed: *what is wrong with this account?* A chat has no fixed question. "Which
 * SKUs are out of stock" wants a list, "why is the abaya losing money" wants one
 * product's rows, and neither can be precomputed into a prompt alongside every
 * other thing someone might ask.
 *
 * So the model gets a **read** registry to sit beside the write registry in
 * `actions.ts`, and the same rule governs both: it selects from a closed set
 * with validated arguments, and never describes a query of its own.
 *
 * ## This is the storage rebuild being spent
 *
 * Every tool below is a thin cover over `analytics.client.ts`, which runs the
 * job in a worker against a bounded IndexedDB index range. That is what makes
 * an open-ended question affordable: "revenue by day for the year" is an index
 * walk off the main thread, not a hundred thousand rows deserialised into the
 * renderer. Without the per-entity stores and the analytics worker, this whole
 * layer would have to fall back to whatever happened to be in the React Query
 * cache.
 *
 * ## Results become facts, never raw JSON
 *
 * A tool returns rows; the executor turns them into `Fact`s and `FactSeries`
 * and only those reach the second prompt. So retrieval widens what the model
 * can cite without widening what it can *state* — after a tool runs, the answer
 * is still composed entirely of refs the application resolved.
 */

export interface ToolDefinition {
  /** Where the rows come from, for the answer's context chip. */
  readonly route: string;
  readonly args: z.ZodTypeAny;
  /** One line for the prompt catalogue. */
  readonly summary: string;
}

const granularitySchema = z.enum(['hour', 'day', 'week', 'month']);

export const QUERY_TOOLS = {
  'series.revenue': {
    route: 'archive:order_items',
    args: z.object({ granularity: granularitySchema.optional() }),
    summary: 'Revenue, units and sellerProfit per bucket across the selected window.',
  },
  'products.top': {
    route: 'archive:order_items',
    args: z.object({ limit: z.number().int().min(1).max(30).optional() }),
    summary: 'Products ranked by revenue in the window, with units and profit each.',
  },
  'product.find': {
    route: 'archive:order_items',
    args: z.object({ name: z.string().trim().min(2).max(60) }),
    summary: 'One product matched by name fragment, with its price, cost, sales and returns.',
  },
  'expenses.breakdown': {
    route: 'archive:expenses',
    args: z.object({}),
    summary: 'The expense ledger split by source, biggest outgoing first.',
  },
  'catalogue.zeroStock': {
    route: 'GET /v1/product/shop/{shopId}',
    args: z.object({ limit: z.number().int().min(1).max(30).optional() }),
    summary: 'SKUs whose quantityAvailable is zero or below, with the product each belongs to.',
  },
} as const satisfies Record<string, ToolDefinition>;

export type ToolId = keyof typeof QUERY_TOOLS;

export const TOOL_IDS = [
  'series.revenue',
  'products.top',
  'product.find',
  'expenses.breakdown',
  'catalogue.zeroStock',
] as const satisfies readonly ToolId[];

/** One line of the plan the model streams back in phase one. */
export const planStepSchema = z.object({
  tool: z.enum(TOOL_IDS),
  args: z.unknown().optional(),
});

export type PlanStep = z.infer<typeof planStepSchema>;

export interface ToolContext {
  readonly shopIds: readonly number[];
  readonly fromMs: number;
  readonly toMs: number;
  /** The catalogue already in the query cache — no request is made for it. */
  readonly products: readonly Product[];
  readonly language: Language;
  readonly signal?: AbortSignal | undefined;
}

export interface ToolOutcome {
  readonly facts: readonly Fact[];
  readonly series: readonly FactSeries[];
  /** Routes touched, deduped — this is what the context chip lists. */
  readonly routes: readonly string[];
}

const EMPTY: ToolOutcome = { facts: [], series: [], routes: [] };

/** Path-safe, and stable enough that the same product keeps the same ref. */
function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

async function runStep(step: PlanStep, context: ToolContext): Promise<ToolOutcome> {
  const definition: ToolDefinition = QUERY_TOOLS[step.tool];
  const parsed = definition.args.safeParse(step.args ?? {});
  if (!parsed.success) return EMPTY;

  const args = parsed.data as Record<string, unknown>;
  const { shopIds, fromMs, toMs, signal } = context;
  const routes = [definition.route];

  switch (step.tool) {
    case 'series.revenue': {
      const granularity = args['granularity'];
      const result = await loadSeries(shopIds, fromMs, toMs, {
        ...(typeof granularity === 'string'
          ? { granularity: granularity as 'hour' | 'day' | 'week' | 'month' }
          : {}),
        ...(signal !== undefined ? { signal } : {}),
      });

      const { at } = result.series;

      return {
        routes,
        series: [
          { ref: 'series.revenue', label: 'Revenue per bucket', at, values: result.series.revenue, format: 'money' },
          { ref: 'series.profit', label: 'sellerProfit per bucket', at, values: result.series.profit, format: 'money' },
          { ref: 'series.units', label: 'Units per bucket', at, values: result.series.units, format: 'count' },
        ],
        facts: [
          { ref: 'archive.revenue', label: 'Revenue over the archived window', value: result.totals.revenue, format: 'money' },
          { ref: 'archive.profit', label: 'sellerProfit over the archived window', value: result.totals.profit, format: 'money' },
          { ref: 'archive.units', label: 'Units over the archived window', value: result.totals.units, format: 'count' },
          { ref: 'archive.orders', label: 'Distinct orders in the archive', value: result.totals.orders, format: 'count' },
          { ref: 'archive.cancelled', label: 'Cancelled items in the archive', value: result.totals.cancelled, format: 'count' },
          { ref: 'archive.products', label: 'Distinct products the window touched', value: result.totals.products, format: 'count' },
        ],
      };
    }

    case 'products.top': {
      const limit = typeof args['limit'] === 'number' ? args['limit'] : 10;
      const totals = await loadProductTotals(shopIds, fromMs, toMs, {
        limit,
        ...(signal !== undefined ? { signal } : {}),
      });

      const facts: Fact[] = [];
      for (const product of totals) {
        const base = `top.${product.productId}`;
        facts.push(
          { ref: `${base}.revenue`, label: `Revenue of "${product.title}"`, value: product.revenue, format: 'money' },
          { ref: `${base}.profit`, label: `sellerProfit of "${product.title}"`, value: product.profit, format: 'money' },
          { ref: `${base}.units`, label: `Units sold of "${product.title}"`, value: product.units, format: 'count' },
        );
      }

      return { facts, series: [], routes };
    }

    case 'product.find': {
      const needle = String(args['name'] ?? '').toLowerCase();
      const match = context.products.find((product) =>
        product.name.toLowerCase().includes(needle),
      );
      if (match === undefined) return EMPTY;

      const base = `found.${slug(match.name)}`;
      const unitMargin = match.price - match.purchasePrice;

      return {
        series: [],
        routes,
        facts: [
          { ref: `${base}.price`, label: `Price of "${match.name}"`, value: match.price, format: 'money' },
          { ref: `${base}.purchasePrice`, label: `Purchase price of "${match.name}"`, value: match.purchasePrice, format: 'money' },
          { ref: `${base}.unitMargin`, label: `Price minus purchase price for "${match.name}"`, value: unitMargin, format: 'money' },
          { ref: `${base}.sold`, label: `Units sold of "${match.name}"`, value: match.sold, format: 'count' },
          { ref: `${base}.turnover`, label: `Turnover of "${match.name}"`, value: match.turnover, format: 'money' },
          { ref: `${base}.returnedPct`, label: `Return rate of "${match.name}"`, value: match.returnedPct, format: 'percent' },
          { ref: `${base}.available`, label: `Available stock of "${match.name}"`, value: match.quantityAvailable, format: 'count' },
        ],
      };
    }

    case 'expenses.breakdown': {
      const totals = await loadExpenseTotals(shopIds, fromMs, toMs, {
        ...(signal !== undefined ? { signal } : {}),
      });

      const facts: Fact[] = [
        { ref: 'ledger.net', label: 'Net cash movement in the ledger', value: totals.net, format: 'money' },
        { ref: 'ledger.income', label: 'Ledger income', value: totals.income, format: 'money' },
        { ref: 'ledger.outgoing', label: 'Ledger outgoings', value: totals.outgoing, format: 'money' },
      ];

      for (const entry of totals.byName.slice(0, 12)) {
        facts.push({
          ref: `ledger.${slug(entry.name)}`,
          label: `Ledger outgoing, ${entry.name}`,
          value: entry.amount,
          format: 'money',
        });
      }

      return { facts, series: [], routes };
    }

    case 'catalogue.zeroStock': {
      const limit = typeof args['limit'] === 'number' ? args['limit'] : 15;
      const empty = flattenSkus(context.products)
        .filter((sku) => sku.quantityAvailable <= 0)
        .slice(0, limit);

      const facts: Fact[] = [
        {
          ref: 'zero.count',
          label: 'SKUs at or below zero available',
          value: empty.length,
          format: 'count',
        },
      ];

      for (const sku of empty) {
        facts.push({
          ref: `zero.${sku.skuId}.available`,
          label: `Available stock of SKU ${sku.skuId}, "${sku.productTitle}"`,
          value: sku.quantityAvailable,
          format: 'count',
        });
      }

      return { facts, series: [], routes };
    }
  }
}

/**
 * How many facts one question may add.
 *
 * A plan that asks for the top thirty products and every expense line can
 * produce several hundred entries, and they all go into the second prompt.
 * Without a ceiling a single question could cost more in context than the
 * answer is worth, so the plan is executed in order and stops when the budget
 * is spent — earlier steps are the ones the model asked for first.
 */
const FACT_BUDGET = 400;

/** Run a plan, in order, and merge what it found. */
export async function runPlan(
  steps: readonly PlanStep[],
  context: ToolContext,
): Promise<ToolOutcome> {
  const facts: Fact[] = [];
  const series: FactSeries[] = [];
  const routes = new Set<string>();

  for (const step of steps) {
    if (facts.length >= FACT_BUDGET) break;

    let outcome: ToolOutcome;
    try {
      outcome = await runStep(step, context);
    } catch {
      /* One tool failing is not the answer failing. The archive may be empty
         for this window, or the worker may have been torn down by a scope
         change — either way the model composes from what did arrive. */
      continue;
    }

    facts.push(...outcome.facts.slice(0, FACT_BUDGET - facts.length));
    series.push(...outcome.series);
    for (const route of outcome.routes) routes.add(route);
  }

  return { facts, series, routes: [...routes] };
}

/** The catalogue, written out for the planning prompt. */
export function describeTools(): string {
  return TOOL_IDS.map((id) => `${id} — ${QUERY_TOOLS[id].summary}`).join('\n');
}
