import { z } from 'zod';

import type { TranslationKey } from '@/lib/i18n/dictionary';

/**
 * Everything the analysis layer is allowed to offer as a button.
 *
 * The rail and the chat exist to be acted on — a finding a seller has to go and
 * re-enact by hand in another screen is a report, not an operator. But what
 * proposes the action is partly a language model, and "let the model describe a
 * request" is how you end up sending a `POST` nobody designed.
 *
 * So actions are a **closed registry**. The model names an `actionId` and hands
 * over parameters; the parameters are checked against that entry's schema
 * before the button is drawn, and the button is wired to a function this
 * application already had. The model chooses among capabilities. It never
 * describes one.
 *
 * Each entry carries the route it will call, how much it costs to get wrong,
 * and a one-line description written for the model rather than for the screen —
 * the toolkit document is generated from these, so an action the registry gains
 * is an action the model learns about, with no second list to keep in step.
 *
 * ## Risk decides who presses
 *
 *   `none`  changes nothing and reaches no network. The model may run it
 *           outright: navigating a screen or moving the period selector is
 *           something a seller can undo by looking away.
 *   `low`   sends a request that only reads — a label or an act to download.
 *           A button, because it spends a rate-limited call and produces a file
 *           the seller did not necessarily ask for.
 *   `mid`   writes something reversible: an order confirmed, a shipment
 *           cancelled.
 *   `high`  changes what the marketplace charges a buyer or believes is on the
 *           shelf. A button *and* a confirmation dialog in front of it.
 *
 * A model never performs `low`, `mid` or `high` itself. It places the button;
 * the seller reads the route and the risk and presses it, or does not.
 *
 * ## What is not here, and why
 *
 * Two capabilities are missing because the Uzum seller OpenAPI does not publish
 * them, not because they were left out: **renaming a product** (only
 * `sendPriceData` writes to the catalogue, and it carries prices alone) and
 * **replying to a customer review** (there is no feedback route at all — the
 * catalogue reports `rating` and `feedbackQuantity` and nothing else). The
 * toolkit says so in as many words, so a seller who asks gets told the truth
 * instead of watching the model invent an endpoint.
 */

export type ActionRisk = 'none' | 'low' | 'mid' | 'high';

export interface ActionDefinition {
  /** Button label. */
  readonly labelKey: TranslationKey;
  /** The route this performs, verbatim. `null` for navigation and chat. */
  readonly endpoint: string | null;
  readonly risk: ActionRisk;
  /** Parameters this action needs, validated before the button is drawn. */
  readonly params: z.ZodTypeAny;
  /** The argument shape, written out for the toolkit document. */
  readonly argsDoc: string;
  /** One line for the model: what pressing this does. */
  readonly summary: string;
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

const rangeSchema = z.enum(['r7', 'r30', 'r90', 'ryear']);

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
 * The cancellation reasons the seller API accepts.
 *
 * Enumerated rather than left as a free string so a model cannot invent a
 * reason code: the route rejects an unknown one, and the rejection would arrive
 * after the seller had already pressed the button.
 */
const cancelReasonSchema = z.enum([
  'OUT_OF_STOCK',
  'OUT_OF_PACKAGE',
  'OUT_OF_TIME',
  'ACCEPTANCE_TIME_EXPIRED',
  'DELIVERY_TIME_EXPIRED',
  'RETURNED_BY_CUSTOMER',
  'CANCELED_BY_CUSTOMER',
  'MARKET_REASON',
  'OTHER',
]);

/**
 * The parameter schemas, named so the runner can re-parse against the concrete
 * shape rather than casting. `resolveAction` proves the parameters are valid;
 * these give the call site the type that proof implies.
 */
const alertKindSchema = z.enum([
  'stock.empty',
  'stock.below',
  'order.deadline',
  'margin.below',
  'cancel.above',
]);

export const NAV_PARAMS = z.object({ screen: screenSchema });
export const ALERT_PARAMS = z.object({
  kind: alertKindSchema,
  threshold: z.number().min(0).max(100000).optional(),
});
export const ALERT_CLEAR_PARAMS = z.object({ kind: alertKindSchema.optional() });
export const RANGE_PARAMS = z.object({ rangeKey: rangeSchema });
export const ASK_PARAMS = z.object({ question: z.string().trim().min(1).max(300) });
export const PRICE_PARAMS = z.object({
  shopId: z.number().int().positive(),
  entries: z.array(priceEntrySchema).min(1).max(50),
});
export const STOCK_PARAMS = z.object({ entries: z.array(stockEntrySchema).min(1).max(50) });
export const CONFIRM_PARAMS = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(100),
});
export const CANCEL_ORDER_PARAMS = z.object({
  orderId: z.number().int().positive(),
  reason: cancelReasonSchema,
  comment: z.string().trim().max(300).optional(),
});
export const ORDER_PARAMS = z.object({ orderId: z.number().int().positive() });
export const COMPLETE_PARAMS = z.object({
  orderId: z.number().int().positive(),
  issueCode: z.string().trim().min(1).max(40),
});
export const INVOICE_PARAMS = z.object({ invoiceId: z.number().int().positive() });
export const LABEL_PARAMS = z.object({
  orderId: z.number().int().positive(),
  size: z.string().trim().min(1).max(20),
});
export const BARCODE_PARAMS = z.object({
  shopId: z.number().int().positive(),
  barcodeTypeId: z.string().trim().min(1),
  skus: z
    .array(
      z.object({
        skuId: z.number().int().positive(),
        labelCount: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(100),
});

/** The registry. */
export const INSIGHT_ACTIONS = {
  'nav.open': {
    labelKey: 'openRows',
    endpoint: null,
    risk: 'none',
    params: NAV_PARAMS,
    argsDoc: '{screen:"overview|products|inventory|ops|invoices|finance|settings"}',
    summary: 'Open the screen that lists the rows behind what you just said. Runs immediately.',
  },
  'ui.range': {
    labelKey: 'iaRange',
    endpoint: null,
    risk: 'none',
    params: RANGE_PARAMS,
    argsDoc: '{rangeKey:"r7|r30|r90|ryear"}',
    summary:
      "Move the dashboard's own period selector. Runs immediately. Use it when the seller wants the screens to show another span — reading another span is what from/to on a lookup is for.",
  },
  'alert.create': {
    labelKey: 'iaAlert',
    endpoint: null,
    risk: 'none',
    params: ALERT_PARAMS,
    argsDoc:
      '{kind:"stock.empty|stock.below|order.deadline|margin.below|cancel.above", threshold?:number}',
    summary:
      'Set a standing rule the dashboard checks after every sync and reports in the bell. threshold is units for stock.below, hours before dateAcceptUntil for order.deadline, and percent for the two rate rules; omit it for a sensible default. One rule per kind — setting the same kind again replaces it. Runs immediately.',
  },
  'alert.clear': {
    labelKey: 'iaAlertOff',
    endpoint: null,
    risk: 'none',
    params: ALERT_CLEAR_PARAMS,
    argsDoc: '{kind?:"…"} — omit kind to remove every rule',
    summary: 'Remove a standing rule the seller no longer wants. Runs immediately.',
  },
  'copilot.ask': {
    labelKey: 'askWhy',
    endpoint: null,
    risk: 'none',
    params: ASK_PARAMS,
    argsDoc: '{question:"…"}',
    summary:
      'Offer a follow-up question as a chip under your answer. Place it as a widget, not as a call.',
  },
  'product.price': {
    labelKey: 'iaPrice',
    endpoint: 'POST /v1/product/{shopId}/sendPriceData',
    risk: 'high',
    params: PRICE_PARAMS,
    argsDoc: '{shopId:number, entries:[{skuId:number, fullPrice:number, sellPrice:number}]} ≤50',
    summary:
      'Change what the marketplace charges for these SKUs. fullPrice is the struck-through price, sellPrice what the buyer pays.',
  },
  'stock.update': {
    labelKey: 'iaStock',
    endpoint: 'POST /v2/fbs/sku/stocks',
    risk: 'high',
    params: STOCK_PARAMS,
    argsDoc: '{entries:[{skuId:number, barcode:"…", amount:number}]} ≤50',
    summary:
      'Set the FBS quantity held for these SKUs. The barcode is mandatory and must be the one the stock rows carry.',
  },
  'order.confirm': {
    labelKey: 'iaConfirm',
    endpoint: 'POST /v1/fbs/order/{orderId}/confirm',
    risk: 'mid',
    params: CONFIRM_PARAMS,
    argsDoc: '{orderIds:[number]} ≤100, one request each',
    summary: 'Accept FBS orders into packing before their dateAcceptUntil passes.',
  },
  'order.cancel': {
    labelKey: 'iaCancelOrder',
    endpoint: 'POST /v1/fbs/order/{orderId}/cancel',
    risk: 'mid',
    params: CANCEL_ORDER_PARAMS,
    argsDoc:
      '{orderId:number, reason:"OUT_OF_STOCK|OUT_OF_PACKAGE|OUT_OF_TIME|ACCEPTANCE_TIME_EXPIRED|DELIVERY_TIME_EXPIRED|RETURNED_BY_CUSTOMER|CANCELED_BY_CUSTOMER|MARKET_REASON|OTHER", comment?:"…"}',
    summary: 'Cancel one FBS order with a reason code the marketplace understands.',
  },
  'dbs.deliver': {
    labelKey: 'iaDeliver',
    endpoint: 'POST /v1/dbs/order/{orderId}/delivering',
    risk: 'mid',
    params: ORDER_PARAMS,
    argsDoc: '{orderId:number}',
    summary: 'DBS only: mark an order as out for delivery by the seller.',
  },
  'dbs.complete': {
    labelKey: 'iaComplete',
    endpoint: 'POST /v1/dbs/order/{orderId}/completed',
    risk: 'mid',
    params: COMPLETE_PARAMS,
    argsDoc: '{orderId:number, issueCode:"…"}',
    summary: 'DBS only: confirm the buyer received the order, with the code they gave.',
  },
  'dbs.refund': {
    labelKey: 'iaRefund',
    endpoint: 'POST /v1/dbs/order/{orderId}/refund',
    risk: 'high',
    params: ORDER_PARAMS,
    argsDoc: '{orderId:number}',
    summary: 'DBS only: register a refund against a delivered order. Money moves.',
  },
  'invoice.cancel': {
    labelKey: 'iaCancelInvoice',
    endpoint: 'POST /v1/fbs/invoice/{invoiceId}/cancel',
    risk: 'mid',
    params: INVOICE_PARAMS,
    argsDoc: '{invoiceId:number}',
    summary: 'Cancel an FBS shipment invoice that has not been handed over yet.',
  },
  'print.orderLabel': {
    labelKey: 'iaLabel',
    endpoint: 'GET /v1/fbs/order/{orderId}/labels/print',
    risk: 'low',
    params: LABEL_PARAMS,
    argsDoc: '{orderId:number, size:"…"} — size comes from GET /v1/product/barcodes/types',
    summary: 'Download the shipping label for one order as a PDF.',
  },
  'print.skuLabels': {
    labelKey: 'iaBarcodes',
    endpoint: 'POST /v1/product/shop/{shopId}/barcodes/print',
    risk: 'low',
    params: BARCODE_PARAMS,
    argsDoc: '{shopId:number, barcodeTypeId:"…", skus:[{skuId:number, labelCount:number}]}',
    summary: 'Download barcode labels for SKUs — at most 100 SKUs, 100 labels each.',
  },
  'print.supplyAct': {
    labelKey: 'iaSupplyAct',
    endpoint: 'GET /v1/fbs/invoice/{invoiceId}/print',
    risk: 'low',
    params: INVOICE_PARAMS,
    argsDoc: '{invoiceId:number}',
    summary: 'Download the supply act for a shipment invoice.',
  },
  'print.acceptanceAct': {
    labelKey: 'iaAcceptAct',
    endpoint: 'GET /v1/fbs/invoice/{invoiceId}/closing-documents',
    risk: 'low',
    params: INVOICE_PARAMS,
    argsDoc: '{invoiceId:number}',
    summary: 'Download the acceptance act — what the warehouse says it actually took in.',
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
  'ui.range',
  'alert.create',
  'alert.clear',
  'copilot.ask',
  'product.price',
  'stock.update',
  'order.confirm',
  'order.cancel',
  'dbs.deliver',
  'dbs.complete',
  'dbs.refund',
  'invoice.cancel',
  'print.orderLabel',
  'print.skuLabels',
  'print.supplyAct',
  'print.acceptanceAct',
] as const satisfies readonly InsightActionId[];

export interface ResolvedAction {
  readonly actionId: InsightActionId;
  readonly definition: ActionDefinition;
  readonly params: unknown;
}

/**
 * Validate a proposed action against the registry.
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

/**
 * Why the registry refused, in one line the model can act on.
 *
 * A rejected action used to disappear silently, which is the right behaviour on
 * screen and the wrong one in a conversation: the model asked for something,
 * nothing happened, and it had no way to learn that `entries` needed a barcode.
 * The chat feeds this back and gives it one chance to correct itself.
 */
export function explainRejection(actionId: string, params: unknown): string {
  if (!(actionId in INSIGHT_ACTIONS)) return `no action named "${actionId}"`;

  const definition: ActionDefinition = INSIGHT_ACTIONS[actionId as InsightActionId];
  const parsed = definition.params.safeParse(params ?? {});
  if (parsed.success) return 'accepted';

  return parsed.error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`)
    .join('; ');
}
