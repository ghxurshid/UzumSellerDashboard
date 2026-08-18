import { complete } from '@/services/ai/client';
import type { AiSettings } from '@/types/settings';
import type { Language } from '@/types/domain';

import { resolveAction, INSIGHT_ACTIONS, ACTION_IDS } from './actions';
import { aiDocumentSchema, type Block, type InsightCard } from './blocks';
import { describeFacts, type FactTable } from './facts';

/**
 * The model as a card author.
 *
 * The rules in `derive/insights.ts` find what someone thought to look for. This
 * finds the rest — the interaction between a return rate and a unit margin, the
 * one product carrying the loss, the expense line that only matters because
 * revenue fell. Those are not thresholds anybody can write in advance, which is
 * the whole argument for a model being here at all.
 *
 * What it is not allowed to do is state a number, invent a remedy, or design a
 * layout. It composes blocks from a closed vocabulary, cites facts by `ref`, and
 * selects actions from a registry. Everything it sends is validated before it
 * reaches the screen, and anything that fails validation is dropped rather than
 * repaired — a half-understood card is not worth showing in a finance tool.
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
  readonly facts: FactTable;
  readonly language: Language;
  /** Ids the rules already produced, so the model does not restate them. */
  readonly covered: readonly string[];
  readonly signal?: AbortSignal;
}

function actionCatalogue(): string {
  return ACTION_IDS.map((id) => {
    const definition = INSIGHT_ACTIONS[id];
    const route = definition.endpoint ?? 'no request — navigation only';
    return `${id} — ${route} (risk: ${definition.risk})`;
  }).join('\n');
}

/**
 * The instructions.
 *
 * The language rule is first and stated twice, because it is the one the model
 * is most likely to drop: the facts it is reading are labelled in English and
 * the field names are English, so left to itself it answers in English however
 * the interface is set. Everything a seller reads on this card — titles, prose,
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
    'The fact labels below are in English only because they are internal identifiers — never',
    'copy them through to the card. Field names from the API (sellPrice, commission,',
    'quantityAvailable) stay in English, because they are what the seller sees in the API.',
    '',
    'You return ONE JSON object and nothing else. No prose before it, no code fence around it.',
    '',
    '{ "cards": [ { id, severity, group, source, title, signalRef?, target?, blocks: [...] } ] }',
    '',
    '  id        a short stable slug you invent, e.g. "ai-margin-leader"',
    '  severity  critical | high | watch | idea',
    '  group     profit | stockOps | anomaly',
    '  source    the route the claim rests on, e.g. "GET /v1/finance/orders"',
    '  title     one sentence, the finding itself — not a heading like "Margin analysis"',
    '  signalRef a fact ref whose value is the headline figure of the card',
    '  target    the screen that shows the rows: overview | products | inventory | ops |',
    '            invoices | finance | settings',
    '',
    'Block kinds — compose freely, in any order, as many as the finding needs:',
    '',
    '  { "kind": "text", "text": "…", "tone"?: positive|negative|warning|neutral|accent }',
    '  { "kind": "metric", "ref": "totals.netProfit", "label"?: "…", "emphasis"?: true }',
    '  { "kind": "steps", "items": [ { "text": "…", "ref"?: "…" } ] }',
    '  { "kind": "kv", "rows": [ { "label": "…", "ref": "…" } ] }',
    '  { "kind": "table", "columns": ["…"], "rows": [["…"]] }',
    '  { "kind": "badges", "items": [ { "text": "…", "tone"?: … } ] }',
    '  { "kind": "callout", "tone": …, "title": "…", "blocks": [ … ] }',
    '  { "kind": "action", "actionId": "…", "params": { … }, "note"?: "…" }',
    '',
    'RULES, in order of how much damage breaking them does:',
    '',
    '1. NEVER write a number, a sum, a percentage or a money amount into any text, title or',
    '   table cell. Every figure is cited with "ref" and the application renders it. If a fact',
    '   you need is not in the table below, the card cannot be written — drop it.',
    '2. Only use refs that appear verbatim in the fact table. A ref you invent is discarded and',
    '   takes its block with it.',
    '3. Only use actionId values from the action registry, with the parameters that registry',
    '   expects. Never describe an HTTP request in prose as if the seller could press it.',
    '4. Every card states a finding that costs or earns money, and says what to do about it.',
    '   A card that only restates a total is noise — do not send it.',
    '5. Do not predict, forecast or score. The seller API publishes no such data and neither do',
    '   you. Say what the rows already show.',
    '6. At most four cards. Fewer is better. An account with nothing wrong gets an empty array.',
    '',
    'Actions available:',
    actionCatalogue(),
    '',
    options.covered.length > 0
      ? `Rules already produced these findings — do not repeat them: ${options.covered.join(', ')}`
      : 'No rule-derived findings fired for this window.',
    '',
    'FACT TABLE — the only numbers that exist:',
    describeFacts(options.facts, options.language),
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
 * A block citing a ref that is not in the table would render blank; a block
 * naming an action the registry rejects would render a button that does
 * nothing. Both are removed here rather than defended against in the renderer,
 * so the component can assume everything it receives resolves.
 */
function sanitizeBlocks(blocks: readonly Block[], facts: FactTable): readonly Block[] {
  const kept: Block[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case 'metric': {
        if (facts.has(block.ref)) kept.push(block);
        break;
      }
      case 'kv': {
        const rows = block.rows.filter((row) => facts.has(row.ref));
        if (rows.length > 0) kept.push({ ...block, rows });
        break;
      }
      case 'steps': {
        /* A step without a ref is prose, and prose is allowed — it is the
           reasoning between two figures. Only a step citing a ref that does not
           exist is dropped, because that one was meant to show a number. */
        const items = block.items.filter((item) => item.ref === undefined || facts.has(item.ref));
        if (items.length > 0) kept.push({ ...block, items });
        break;
      }
      case 'action': {
        if (resolveAction(block.actionId, block.params) !== null) kept.push(block);
        break;
      }
      case 'callout': {
        const inner = sanitizeBlocks(block.blocks, facts);
        if (inner.length > 0) kept.push({ ...block, blocks: inner });
        break;
      }
      case 'text':
      case 'table':
      case 'badges': {
        kept.push(block);
        break;
      }
    }
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
          'Analyse this window and return the JSON object. Remember: every figure by ref, all text in the interface language.',
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
    const blocks = sanitizeBlocks(card.blocks as readonly Block[], options.facts);
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
      ...(card.signalRef !== undefined && options.facts.has(card.signalRef)
        ? { signalRef: card.signalRef }
        : {}),
      ...(card.target !== undefined ? { target: card.target } : {}),
    });
  }

  return cards;
}
