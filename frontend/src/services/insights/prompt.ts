import type { Scope } from '@/services/api/queryKeys';
import type { Language } from '@/types/domain';

import { windowLabel } from '@core/tools/plaintext';
import { buildSystemPrompt, type PromptHost } from '@core/agent/systemPrompt';

/**
 * The site's system prompt: the generic protocol prompt with the site's parts.
 *
 * Everything bound to the protocol — how to ask, how to reply, the language
 * rule — is `systemPrompt.ts`, shared by every host. What is here is what only
 * the site can say: that the model sits inside Savdo, the dashboard; what a
 * seller asks a dashboard about; what its archive lookups hand back; and the
 * scope the seller has selected.
 */

export interface PromptContext {
  readonly language: Language;
  readonly scope: Scope;
  readonly shopNames: readonly string[];
  readonly now: number;
  /** Whether the provider carries tool calls itself — see `PromptProtocol.native`. */
  readonly native: boolean;
}

const SITE_IDENTITY: readonly string[] = [
  'You are the analyst inside Savdo, a dashboard one Uzum Market seller uses to run their own',
  'shops. You are talking to that seller, about their own business, in their own dashboard.',
];

const SITE_TOPICS: readonly string[] = [
  'Their sales and revenue, profit and unit economics, commission and logistics, prices,',
  'stock and supply, orders and deliveries, returns, expenses — and what to do about any of',
  'it. Operational questions about running the shop count: what is urgent today, what is',
  'losing money, what to reprice, what to reorder.',
  'Everything else is outside. Politics, medicine, law, general programming, world knowledge,',
  'other sellers\' data, and anything about evading marketplace rules, taxes or customs. Say',
  'in one sentence that it is not what you are here for, offer the nearest thing you can',
  'actually help with, and stop. Do not argue and do not lecture.',
];

const SITE_PROVENANCE: readonly string[] = [
  'A lookup hands you the data itself — totals, timelines, rankings, or the raw rows. You',
  'analyse it: every figure you state is either copied from a result or calculated by you',
  'from figures in results, and you do that arithmetic carefully. Prefer a lookup that has',
  'already computed what you need over adding up rows yourself, and when a figure you show',
  'is your own calculation, say how you reached it. If the data you need is not in a result,',
  'ask for it or say it is not there — never fill the gap with a plausible number.',
  'You do not forecast, predict, score or rank against other sellers: the seller API',
  'publishes no such data and neither do you. You say what the rows show.',
];

/**
 * Field names the language rule quotes. They are fields of the documented
 * seller API that the site's lookups hand back under these very names, so a
 * model told to keep them untranslated will actually meet them.
 */
const SITE_FIELD_NAMES: readonly string[] = ['sellPrice', 'commission', 'quantityAvailable'];

/** The site's parts for one question. */
export function sitePromptHost(context: PromptContext): PromptHost {
  const shops =
    context.shopNames.length === 0
      ? `shop ids ${context.scope.shopIds.join(', ')}`
      : context.shopNames.join(', ');

  return {
    identity: SITE_IDENTITY,
    topics: SITE_TOPICS,
    provenance: SITE_PROVENANCE,
    fieldNames: SITE_FIELD_NAMES,
    context: [
      `Shops: ${shops}`,
      `Selected period: ${windowLabel(context.scope.fromMs, context.scope.toMs)}`,
      `Today: ${new Date(context.now).toISOString().slice(0, 10)} · currency so'm · times in UTC`,
    ],
  };
}

export function buildBaseSystem(context: PromptContext): string {
  return buildSystemPrompt(sitePromptHost(context), {
    language: context.language,
    native: context.native,
  });
}
