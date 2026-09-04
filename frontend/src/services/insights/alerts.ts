import type { TranslationKey } from '@/lib/i18n/dictionary';
import type { FinanceTotals } from '@/services/derive/finance';
import { flattenSkus } from '@/services/derive/products';
import type { FbsOrder } from '@/services/uzum/types';
import type { Product } from '@/types/domain';

/**
 * Conditions the seller asked to be told about.
 *
 * Everything else in this application answers a question that has just been
 * asked. That is the wrong shape for the things that actually cost money on
 * this marketplace, because they are not events anybody thinks to ask about:
 * an order confirmed after `dateAcceptUntil` is cancelled by Uzum, and a SKU
 * that went to zero on Tuesday sells nothing on Wednesday. Both are invisible
 * until someone opens the right screen.
 *
 * So a rule is a standing question. The seller states it once — in the chat,
 * where the model turns it into a registry action — and it is checked after
 * every sync against rows the application already holds.
 *
 * ## Deliberately not a model
 *
 * Evaluation is arithmetic over the catalogue and the ledger, and it runs on
 * every sync of every session. Sending that to a language model would cost a
 * request each time to answer a question whose answer is a comparison, and it
 * would make a notification something a model *decided* rather than something
 * the rows say. The model's job is to write the rule; the rule is code.
 *
 * ## Why a rule remembers what it said
 *
 * A condition that is true stays true — an empty SKU is empty tomorrow as well.
 * Firing on every sync would turn the bell into noise, and the seller would
 * stop reading it, which is the same as not having it. So a firing carries a
 * **signature** of what it found, and a rule stays quiet until either the
 * signature changes or the cooldown has passed.
 */

export type AlertKind =
  | 'stock.empty'
  | 'stock.below'
  | 'order.deadline'
  | 'margin.below'
  | 'cancel.above';

export const ALERT_KINDS: readonly AlertKind[] = [
  'stock.empty',
  'stock.below',
  'order.deadline',
  'margin.below',
  'cancel.above',
];

export interface AlertRule {
  readonly id: string;
  readonly kind: AlertKind;
  /**
   * What the comparison is against, and what it means depends on the kind:
   * units for `stock.below`, hours for `order.deadline`, percent for the two
   * rate rules. `stock.empty` ignores it.
   */
  readonly threshold: number;
  readonly createdAt: number;
  readonly lastFiredAt: number | null;
  /** What it found last time, so the same finding is not announced twice. */
  readonly lastSignature: string | null;
}

/** What a rule found, ready to be worded by the dictionary. */
export interface AlertFiring {
  readonly ruleId: string;
  readonly signature: string;
  readonly key: TranslationKey;
  readonly vars: Readonly<Record<string, string | number>>;
  /** Which screen shows the rows behind it. */
  readonly screen: 'inventory' | 'ops' | 'overview';
}

export interface AlertInput {
  readonly products: readonly Product[];
  readonly orders: readonly FbsOrder[];
  readonly totals: FinanceTotals | null;
  readonly now: number;
}

/**
 * How long a rule stays quiet after firing on the same finding.
 *
 * Six hours is a working day split in two: long enough that a sync every few
 * minutes does not repeat itself, short enough that something urgent is raised
 * again before the day ends.
 */
export const COOLDOWN_MS = 6 * 60 * 60 * 1_000;

const HOUR_MS = 3_600_000;

/** Defaults that make sense when the model names a kind and no threshold. */
export function defaultThreshold(kind: AlertKind): number {
  switch (kind) {
    case 'stock.empty':
      return 0;
    case 'stock.below':
      return 5;
    case 'order.deadline':
      return 6;
    case 'margin.below':
      return 10;
    case 'cancel.above':
      return 15;
  }
}

/** One rule against the current rows, or `null` when it has nothing to say. */
function check(rule: AlertRule, input: AlertInput): AlertFiring | null {
  switch (rule.kind) {
    case 'stock.empty': {
      const empty = flattenSkus(input.products).filter((sku) => sku.quantityAvailable <= 0);
      if (empty.length === 0) return null;

      return {
        ruleId: rule.id,
        /* The ids rather than the count: two SKUs emptying and two others
           refilling is a different finding, not the same one. */
        signature: empty
          .map((sku) => sku.skuId)
          .sort((a, b) => a - b)
          .join(','),
        key: 'alStockEmpty',
        vars: { n: empty.length },
        screen: 'inventory',
      };
    }

    case 'stock.below': {
      const low = flattenSkus(input.products).filter(
        (sku) => sku.quantityAvailable > 0 && sku.quantityAvailable < rule.threshold,
      );
      if (low.length === 0) return null;

      return {
        ruleId: rule.id,
        signature: low
          .map((sku) => sku.skuId)
          .sort((a, b) => a - b)
          .join(','),
        key: 'alStockBelow',
        vars: { n: low.length, t: rule.threshold },
        screen: 'inventory',
      };
    }

    case 'order.deadline': {
      const deadline = input.now + rule.threshold * HOUR_MS;
      const due = input.orders.filter(
        (order) =>
          order.status === 'CREATED' &&
          order.dateAcceptUntil !== null &&
          order.dateAcceptUntil <= deadline,
      );
      if (due.length === 0) return null;

      return {
        ruleId: rule.id,
        signature: due
          .map((order) => order.id)
          .sort((a, b) => a - b)
          .join(','),
        key: 'alOrderDeadline',
        vars: { n: due.length, h: rule.threshold },
        screen: 'ops',
      };
    }

    case 'margin.below': {
      const totals = input.totals;
      if (totals === null || totals.sellPrice === 0) return null;
      if (totals.netMargin >= rule.threshold) return null;

      return {
        ruleId: rule.id,
        /* Rounded, so a margin drifting by hundredths does not re-announce
           itself while the seller is watching the same window. */
        signature: `m${Math.round(totals.netMargin)}`,
        key: 'alMarginBelow',
        vars: { t: rule.threshold },
        screen: 'overview',
      };
    }

    case 'cancel.above': {
      const totals = input.totals;
      if (totals === null || totals.liveItems + totals.cancelledItems === 0) return null;
      if (totals.cancellationRate <= rule.threshold) return null;

      return {
        ruleId: rule.id,
        signature: `c${Math.round(totals.cancellationRate)}`,
        key: 'alCancelAbove',
        vars: { t: rule.threshold },
        screen: 'ops',
      };
    }
  }
}

/**
 * Every rule that has something new to say.
 *
 * A rule is skipped when it found the same thing it found last time and the
 * cooldown has not expired. Both halves matter: without the signature the bell
 * repeats itself all day, and without the cooldown a condition that flickers —
 * one SKU refilled and emptied again — reports every flicker.
 */
export function evaluateAlerts(
  rules: readonly AlertRule[],
  input: AlertInput,
): readonly AlertFiring[] {
  const firings: AlertFiring[] = [];

  for (const rule of rules) {
    const firing = check(rule, input);
    if (firing === null) continue;

    const repeat = rule.lastSignature === firing.signature;
    const fresh = rule.lastFiredAt !== null && input.now - rule.lastFiredAt < COOLDOWN_MS;
    if (repeat && fresh) continue;

    firings.push(firing);
  }

  return firings;
}
