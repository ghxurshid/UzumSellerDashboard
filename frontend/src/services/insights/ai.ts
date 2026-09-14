import { complete } from '@/services/ai/client';
import type { AiSettings } from '@/types/settings';
import type { Language } from '@/types/domain';

import { resolveAction, INSIGHT_ACTIONS, ACTION_IDS } from './actions';
import { aiDocumentSchema, WIDGET_LIMITS, type Block, type InsightCard } from './blocks';

/**
 * The model as a card author.
 *
 * The rules in `derive/insights.ts` find what someone thought to look for. This
 * finds the rest — the interaction between a return rate and a unit margin, the
 * one product carrying the loss, the expense line that only matters because
 * revenue fell. Those are not thresholds anybody can write in advance, which is
 * the whole argument for a model being here at all.
 *
 * It reads the window as data — the digest from `digest.ts` — works out what
 * is worth a card, and writes the figures that support it into the blocks. What
 * it is not allowed to do is invent a remedy or design a layout: it composes
 * blocks from a closed vocabulary and selects actions from a registry, and
 * everything it sends is validated before it reaches the screen. Anything that
 * fails validation is dropped rather than repaired — a half-understood card is
 * not worth showing in a finance tool.
 *
 * ## Structured output without structured-output support
 *
 * The nine providers behind `ai/client.ts` speak three request shapes and none
 * of them is guaranteed to offer JSON mode or tool use. So the contract is
 * carried in the prompt and enforced on arrival: ask for one JSON object,
 * extract the first balanced one from whatever came back, validate it, and
 * return nothing at all if it does not parse. Returning nothing is safe — the
 * rail still has its rule-derived cards.
 */

/** Written out for the prompt so the model names a real language, not a code. */
const LANGUAGE_NAME: Record<Language, string> = {
  en: 'English',
  ru: 'Russian (русский)',
  uz: 'Uzbek, Latin script (o‘zbekcha)',
};

export interface GenerateOptions {
  readonly ai: AiSettings;
  /** The window, written out by `buildDigest`. */
  readonly digest: string;
  readonly language: Language;
  /** Ids the rules already produced, so the model does not restate them. */
  readonly covered: readonly string[];
  readonly signal?: AbortSignal;
}

function actionCatalogue(): string {
  return ACTION_IDS.map((id) => {
    const definition = INSIGHT_ACTIONS[id];
    const route = definition.endpoint ?? 'no request — navigation only';
    return `${id} ${definition.argsDoc} — ${route} (risk: ${definition.risk})`;
  }).join('\n');
}

/**
 * The instructions.
 *
 * The language rule is first and stated twice, because it is the one the model
 * is most likely to drop: the data it is reading is labelled in English and the
 * field names are English, so left to itself it answers in English however the
 * interface is set. Everything a seller reads on this card — titles, prose,
 * evidence labels, callout headings — is theirs to write, and all of it must be
 * in the language they chose.
 */
function buildSystem(options: GenerateOptions): string {
  const language = LANGUAGE_NAME[options.language];

  return [
    'You are the analysis layer of a dashboard for Uzum Market sellers.',
    '',
    `WRITE EVERY PIECE OF TEXT IN ${language.toUpperCase()}.`,
    `The seller has chosen ${language} as their interface language. Card titles, paragraphs,`,
    'evidence labels, table headers, badge text and callout titles must all be in that language.',
    'The data below is labelled in English only because those are field names — never copy a',
    'label through as prose. Field names from the API (sellPrice, commission, quantityAvailable)',
    'may stay in English, because they are what the seller sees in the API.',
    '',
    'You return ONE JSON object and nothing else. No prose before it, no code fence around it.',
    '',
    '{ "cards": [ { id, severity, group, source, title, signal?, target?, blocks: [...] } ] }',
    '',
    '  id        a short stable slug you invent, e.g. "ai-margin-leader"',
    '  severity  critical | high | watch | idea',
    '  group     profit | stockOps | anomaly',
    '  source    the data the claim rests on, e.g. "GET /v1/finance/orders"',
    '  title     one sentence, the finding itself — not a heading like "Margin analysis"',
    '  signal    {"value":457924,"format":"money"} — the headline figure of the card',
    '  target    the screen that shows the rows: overview | products | inventory | ops |',
    '            invoices | finance | settings',
    '',
    'Block kinds — compose freely, in any order, as many as the finding needs:',
    '',
    '  { "kind": "text", "text": "…", "tone"?: positive|negative|warning|neutral|accent }',
    '  { "kind": "metric", "label"?: "…", "value": 457924, "format": "money", "change"?: -12.4 }',
    '  { "kind": "steps", "items": [ { "text": "…", "value"?: 1250000, "format"?: "money" } ] }',
    '  { "kind": "kv", "rows": [ { "label": "…", "value": 9.2, "format": "percent" } ] }',
    '  { "kind": "table", "columns": ["…"], "rows": [["…", 12]], "formats"?: ["text", "count"] }',
    '  { "kind": "badges", "items": [ { "text": "…", "tone"?: … } ] }',
    '  { "kind": "callout", "tone": …, "title": "…", "blocks": [ … ] }',
    '  { "kind": "action", "actionId": "…", "params": { … }, "note"?: "…" }',
    '',
    '  format is money (so\'m), percent (9.2 means 9.2%), count or number. Write values as plain',
    '  numbers — no grouping, no currency, no % sign; the renderer formats them.',
    `  Labels, titles and cells are at most ${WIDGET_LIMITS.label} characters; text at most ${WIDGET_LIMITS.text}.`,
    '',
    'RULES, in order of how much damage breaking them does:',
    '',
    '1. Every figure is either copied from the DATA below or calculated by you from it. Calculate',
    '   carefully; when a card rests on a figure you calculated, show the calculation in a steps',
    '   block. Never invent a figure the data does not support — if it is not there, drop the card.',
    '2. Only use actionId values from the action registry, with the parameters it lists. Never',
    '   describe an HTTP request in prose as if the seller could press it.',
    '3. Every card states a finding that costs or earns money, and says what to do about it.',
    '   A card that only restates a total is noise — do not send it.',
    '4. Do not predict, forecast or score. The seller API publishes no such data and neither do',
    '   you. Say what the rows already show.',
    '5. At most four cards. Fewer is better. An account with nothing wrong gets an empty array.',
    '',
    'Actions available:',
    actionCatalogue(),
    '',
    options.covered.length > 0
      ? `Rules already produced these findings — do not repeat them: ${options.covered.join(', ')}`
      : 'No rule-derived findings fired for this window.',
    '',
    'DATA — the selected window and the catalogue:',
    options.digest,
  ].join('\n');
}

/**
 * The first balanced JSON object in whatever the model sent.
 *
 * Models fenced it, prefaced it with "Here is the analysis:", or both. Scanning
 * for balance rather than regex-matching survives all of that, and quote/escape
 * tracking keeps a brace inside a string from ending the object early.
 */
function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/**
 * Drop what cannot be rendered honestly.
 *
 * A block naming an action the registry rejects would render a button that does
 * nothing. It is removed here rather than defended against in the renderer, so
 * the component can assume every button it receives resolves.
 */
function sanitizeBlocks(blocks: readonly Block[]): readonly Block[] {
  const kept: Block[] = [];

  for (const block of blocks) {
    if (block.kind === 'action') {
      if (resolveAction(block.actionId, block.params) !== null) kept.push(block);
      continue;
    }

    if (block.kind === 'callout') {
      const inner = sanitizeBlocks(block.blocks);
      if (inner.length > 0) kept.push({ ...block, blocks: inner });
      continue;
    }

    kept.push(block);
  }

  return kept;
}

/**
 * Ask the model for cards.
 *
 * Two failures, deliberately told apart. A **transport** failure — provider
 * down, key rejected, request cancelled — throws, so the caller records it as an
 * error and can ask again later. A **content** failure — the answer was not
 * JSON, or was JSON of the wrong shape — returns an empty list, because asking
 * the same model the same question again will produce the same nonsense and
 * spending the seller's credits to find that out twice is not worth it.
 *
 * Either way the rail is unaffected in the only way that matters: it has its
 * rule-derived cards and shows them. Nothing here surfaces an error banner over
 * a side panel. The Copilot is where a broken provider gets reported, because
 * that is where the user asked a question and is waiting for the answer.
 */
export async function generateInsightCards(
  options: GenerateOptions,
): Promise<readonly InsightCard[]> {
  if (options.ai.apiKey.trim() === '') return [];

  const answer = await complete(options.ai, {
    system: buildSystem(options),
    messages: [
      {
        role: 'user',
        content:
          'Analyse this window and return the JSON object. Remember: figures as plain numbers with a format, all text in the interface language.',
      },
    ],
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

  const json = extractJson(answer);
  if (json === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const document = aiDocumentSchema.safeParse(parsed);
  if (!document.success) return [];

  const cards: InsightCard[] = [];

  for (const card of document.data.cards) {
    const blocks = sanitizeBlocks(card.blocks as readonly Block[]);
    if (blocks.length === 0) continue;

    cards.push({
      id: `ai-${card.id}`,
      severity: card.severity,
      /* The model groups; the category label comes from the group, because
         `categoryKey` indexes the dictionary and the model has no keys. */
      categoryKey:
        card.group === 'profit' ? 'catMargin' : card.group === 'anomaly' ? 'catAnomaly' : 'catOperations',
      group: card.group,
      source: card.source,
      title: card.title,
      blocks,
      origin: 'ai',
      ...(card.signal !== undefined ? { signal: card.signal } : {}),
      ...(card.target !== undefined ? { target: card.target } : {}),
    });
  }

  return cards;
}
