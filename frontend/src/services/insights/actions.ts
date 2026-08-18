import { z } from 'zod';

import type { TranslationKey } from '@/lib/i18n/dictionary';

/**
 * Everything a card is allowed to offer as a button.
 *
 * The rail exists to be acted on — a finding a seller has to go and re-enact by
 * hand in another screen is a report, not an operator. But a card body is
 * partly written by a model, and "let the model describe a request" is how you
 * end up sending a `POST` nobody designed.
 *
 * So actions are a **closed registry**. A card names an `actionId` and hands
 * over parameters; the parameters are checked against that entry's schema
 * before the button is rendered, and the button is wired to a function this
 * application already had. The model chooses among capabilities. It never
 * describes one.
 *
 * Each entry also carries the route it will call and how much it costs to get
 * wrong, both of which are shown on the button — a seller pressing *Apply*
 * should be able to see that it is a price write before it goes out, not after.
 */

export type ActionRisk = 'none' | 'mid' | 'high';

export interface ActionDefinition {
  /** Button label. */
  readonly labelKey: TranslationKey;
  /** The route this performs, verbatim. `null` for navigation and chat. */
  readonly endpoint: string | null;
  readonly risk: ActionRisk;
  /** Parameters this action needs, validated before the button is drawn. */
  readonly params: z.ZodTypeAny;
}

const screenSchema = z.enum([
  'overview',
  'products',
  'inventory',
  'ops',
  'invoices',
  'finance',
  'settings',
]);

const priceEntrySchema = z.object({
  skuId: z.number().int().positive(),
  fullPrice: z.number().int().nonnegative(),
  sellPrice: z.number().int().nonnegative(),
});

const stockEntrySchema = z.object({
  skuId: z.number().int().positive(),
  barcode: z.string().trim().min(1),
  amount: z.number().int().nonnegative(),
});

/**
 * The parameter schemas, named so the runner can re-parse against the concrete
 * shape rather than casting. `resolveAction` proves the parameters are valid;
 * these give the call site the type that proof implies.
 */
export const NAV_PARAMS = z.object({ screen: screenSchema });
export const ASK_PARAMS = z.object({ question: z.string().trim().min(1).max(300) });
export const PRICE_PARAMS = z.object({
  shopId: z.number().int().positive(),
  entries: z.array(priceEntrySchema).min(1).max(50),
});
export const STOCK_PARAMS = z.object({ entries: z.array(stockEntrySchema).min(1).max(50) });
export const CONFIRM_PARAMS = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(100),
});

/**
 * The registry.
 *
 * `sendPriceData` and the stock write are `high` because they change what the
 * marketplace charges a buyer and what it believes is on the shelf; confirming
 * orders is `mid` because it is reversible by cancelling; navigation and asking
 * the Copilot change nothing at all.
 */
export const INSIGHT_ACTIONS = {
  'nav.open': { labelKey: 'openRows', endpoint: null, risk: 'none', params: NAV_PARAMS },
  'copilot.ask': { labelKey: 'askWhy', endpoint: null, risk: 'none', params: ASK_PARAMS },
  'product.price': {
    labelKey: 'iaPrice',
    endpoint: 'POST /v1/product/{shopId}/sendPriceData',
    risk: 'high',
    params: PRICE_PARAMS,
  },
  'stock.update': {
    labelKey: 'iaStock',
    endpoint: 'POST /v2/fbs/sku/stocks',
    risk: 'high',
    params: STOCK_PARAMS,
  },
  'order.confirm': {
    labelKey: 'iaConfirm',
    endpoint: 'POST /v1/fbs/order/{orderId}/confirm',
    risk: 'mid',
    params: CONFIRM_PARAMS,
  },
} as const satisfies Record<string, ActionDefinition>;

export type InsightActionId = keyof typeof INSIGHT_ACTIONS;

/**
 * The ids as a tuple, for `z.enum` in the block schema.
 *
 * Written out rather than derived from `Object.keys`, because `z.enum` needs a
 * literal tuple type and `keys` erases it to `string[]`. The `satisfies` keeps
 * the two in step: dropping an entry above without editing here is a compile
 * error.
 */
export const ACTION_IDS = [
  'nav.open',
  'copilot.ask',
  'product.price',
  'stock.update',
  'order.confirm',
] as const satisfies readonly InsightActionId[];

export interface ResolvedAction {
  readonly actionId: InsightActionId;
  readonly definition: ActionDefinition;
  readonly params: unknown;
}

/**
 * Validate a card's action against the registry.
 *
 * Returns `null` for an unknown id or parameters the entry rejects, and the
 * renderer then draws nothing. A card that suggested an impossible action loses
 * its button and keeps its argument, which is the right degradation: the
 * finding may still be true even when the remedy was malformed.
 */
export function resolveAction(actionId: string, params: unknown): ResolvedAction | null {
  if (!(actionId in INSIGHT_ACTIONS)) return null;

  const id = actionId as InsightActionId;
  const definition: ActionDefinition = INSIGHT_ACTIONS[id];
  const parsed = definition.params.safeParse(params ?? {});
  if (!parsed.success) return null;

  return { actionId: id, definition, params: parsed.data };
}
