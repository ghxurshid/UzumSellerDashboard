import { z } from 'zod';

import type { TranslationKey } from '@core/i18n/dictionary';
import type { InsightSeverity, ScreenKey } from '@/types/domain';

import { INSIGHT_REGISTRY } from './actions';
import { blockLineSchema, figureSchema, labelSchema, type Block, type Figure, type Phrase } from '@core/agent/blocks';

/**
 * The insight card: the site's envelope around a list of blocks.
 *
 * The block language (`blocks.ts`) is shared by every host the Copilot runs in.
 * The card is not — it is how the site's insights rail files a finding: how bad
 * it is, which part of the business it belongs to, which screen holds its rows.
 * The rules in `derive/insights.ts` and the model in `ai.ts` both author it,
 * which is why this module is a contract the derive layer may import.
 */

/**
 * How the rail groups findings for its filter chips.
 *
 * Coarser than `categoryKey`, which names the finding; this names the part of
 * the business it belongs to, and there are only ever a few chips.
 */
export type InsightGroup = 'profit' | 'stockOps' | 'anomaly';

export const INSIGHT_GROUPS: readonly InsightGroup[] = ['profit', 'stockOps', 'anomaly'];

/**
 * The envelope.
 *
 * These fields stay typed while the body is free, because the panel reasons
 * about them: it counts severities for the chips, groups by `group`, sorts by
 * severity, dedupes by `id` and remembers dismissals by it. A card whose
 * severity were prose could not be filtered, and the chips in the design would
 * have nothing to count.
 */
export interface InsightCard {
  readonly id: string;
  readonly severity: InsightSeverity;
  /** The finding's own name — `catMargin`, `catInventory`. */
  readonly categoryKey: TranslationKey;
  readonly group: InsightGroup;
  /** The route the claim came from, shown verbatim in the card's header. */
  readonly source: string;
  readonly title: Phrase;
  /** The headline figure, rendered beside the title. */
  readonly signal?: Figure;
  readonly blocks: readonly Block[];
  readonly target?: ScreenKey;
  /** Whether a rule derived this or the model wrote it. */
  readonly origin: 'rule' | 'ai';
  /**
   * Why blocks the model wrote for this card were left out, one reason each.
   *
   * The rail has no second turn to ask for them again, so a block that fails is
   * dropped and the card keeps the rest of its argument — but a card that lost a
   * block is not the card the model wrote, and this is where that is said.
   * Absent on rule cards and on a model card that arrived whole.
   */
  readonly rejected?: readonly string[];
}

export const SEVERITY_ORDER: Readonly<Record<InsightSeverity, number>> = {
  critical: 0,
  high: 1,
  watch: 2,
  idea: 3,
};

/** Severities the `important` chip counts. */
export function isImportant(card: InsightCard): boolean {
  return card.severity === 'critical' || card.severity === 'high';
}

/* ── the wire format ────────────────────────────────────────────────────── */

const severitySchema = z.enum(['critical', 'high', 'watch', 'idea']);
const groupSchema = z.enum(['profit', 'stockOps', 'anomaly']);
const screenSchema = z.enum([
  'overview',
  'products',
  'inventory',
  'ops',
  'invoices',
  'finance',
  'settings',
]);

/** Every action id a list of wire blocks names, callouts included. */
function actionIdsIn(blocks: readonly unknown[]): readonly string[] {
  return blocks.flatMap((block) => {
    if (block === null || typeof block !== 'object') return [];
    const record = block as Record<string, unknown>;
    if (record['kind'] === 'action' && typeof record['actionId'] === 'string') return [record['actionId']];
    if (record['kind'] === 'callout' && Array.isArray(record['blocks'])) return actionIdsIn(record['blocks']);
    return [];
  });
}

/**
 * One card as the rail's model sends it.
 *
 * The shared block schema accepts any well-formed action id, because which ids
 * exist is a host's registry's to say. The rail's own registry says it here: a
 * card naming an action the site does not have is refused at the edge, exactly
 * as it was while the block schema carried the site's id enum — so a document
 * with an invented action is still dropped whole rather than rendered.
 */
export const aiCardSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    severity: severitySchema,
    group: groupSchema,
    source: z.string().trim().min(1).max(80),
    title: labelSchema,
    signal: figureSchema.optional(),
    target: screenSchema.optional(),
    blocks: z.array(blockLineSchema).min(1).max(10),
  })
  .superRefine((card, context) => {
    for (const id of actionIdsIn(card.blocks)) {
      if (INSIGHT_REGISTRY.get(id) === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blocks'],
          message: `no action named "${id}"`,
        });
      }
    }
  });

export const aiDocumentSchema = z.object({
  cards: z.array(aiCardSchema).max(6),
});
