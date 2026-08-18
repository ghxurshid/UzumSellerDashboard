import { ACTION_IDS, INSIGHT_ACTIONS } from '@/services/insights/actions';
import type { Block } from '@/services/insights/blocks';
import { describeFacts, describeSeries, formatFact, type FactTable, type SeriesTable } from '@/services/insights/facts';
import { renderTemplate } from '@/services/insights/template';
import { describeTools, planStepSchema, type PlanStep } from '@/services/insights/tools';
import type { Language } from '@/types/domain';

/**
 * What the model is asked, and how its answer is read back.
 *
 * The chat runs in two phases, and the split is forced by the seller API rather
 * than chosen for elegance. The insights rail could work from one standing fact
 * table because its question never changed. A chat's question decides what data
 * the answer needs, and "which SKUs are out of stock" cannot be precomputed
 * alongside every other thing a seller might ask.
 *
 * So: **plan, retrieve, compose**.
 *
 *   1. The model is shown the question and the read registry, and answers with
 *      a list of lookups.
 *   2. The application runs them against the analytics worker and folds the
 *      results into the fact table.
 *   3. The model is asked again, now with the facts it requested, and streams
 *      the answer as blocks.
 *
 * ## Why the plan is text rather than tool-calling
 *
 * Nine providers behind three request shapes, and native tool use is not evenly
 * available across them — a self-hosted Ollama or a custom gateway may offer
 * none. A plan expressed as lines of JSON is just text, so it works everywhere
 * the app already works. Where a provider does have real tool calling it can be
 * added later as an optimisation; it cannot be the floor.
 */

/** Written out so the model is told a language, not a code. */
export const LANGUAGE_NAME: Record<Language, string> = {
  en: 'English',
  ru: 'Russian (русский)',
  uz: 'Uzbek, Latin script (o‘zbekcha)',
};

/* ── phase one: the plan ────────────────────────────────────────────────── */

export function buildPlanSystem(language: Language): string {
  return [
    'You are the retrieval planner of a dashboard for Uzum Market sellers.',
    '',
    'You do not answer the question. You decide which lookups the answer will need.',
    'Reply with one JSON object per line and nothing else:',
    '',
    '  {"tool":"products.top","args":{"limit":10}}',
    '',
    'Available lookups:',
    describeTools(),
    '',
    'Rules:',
    '  • At most four lines. Ask for what the question needs and nothing more —',
    '    every lookup costs the seller time and context.',
    '  • If the standing totals already answer it, reply with no lines at all.',
    '  • Never invent a tool name or an argument that is not listed.',
    `  • The seller reads ${LANGUAGE_NAME[language]}, but this reply is machine-read: no prose.`,
  ].join('\n');
}

/**
 * Read a plan back.
 *
 * Same NDJSON discipline as the answer itself, and the same tolerance: a line
 * that is not a valid step is skipped rather than failing the plan, because a
 * plan of three good lookups and one typo is worth three lookups.
 */
export function parsePlan(text: string): readonly PlanStep[] {
  const steps: PlanStep[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const result = planStepSchema.safeParse(parsed);
    if (result.success) steps.push(result.data);
    if (steps.length >= 4) break;
  }

  return steps;
}

/* ── phase two: the answer ──────────────────────────────────────────────── */

export interface ComposeContext {
  readonly facts: FactTable;
  readonly series: SeriesTable;
  readonly language: Language;
  /** Routes the plan touched, for the model to cite as its sources. */
  readonly routes: readonly string[];
  readonly scopeLine: string;
}

function actionCatalogue(): string {
  return ACTION_IDS.map((id) => {
    const definition = INSIGHT_ACTIONS[id];
    return `${id} — ${definition.endpoint ?? 'navigation only'} (risk: ${definition.risk})`;
  }).join('\n');
}

/**
 * The composition instructions.
 *
 * Two rules carry almost all of the weight, and both are stated where the model
 * will still be reading. The **language** rule comes first because the fact
 * labels below are English and a model left to itself will answer in the
 * language it is reading rather than the one the seller chose. The **no digits**
 * rule comes second because it is the one that separates a checkable answer
 * from a plausible one — and unlike the language rule, it is also enforced in
 * code, in `statesRawNumber`.
 */
export function buildComposeSystem(context: ComposeContext): string {
  const language = LANGUAGE_NAME[context.language];

  return [
    'You are the analysis layer of a dashboard for Uzum Market sellers.',
    '',
    `WRITE EVERY PIECE OF TEXT IN ${language.toUpperCase()}.`,
    'Titles, prose, table headers, labels, badges and callout headings — all of it.',
    'The fact labels below are English because they are internal identifiers. Never copy them',
    'through. API field names (sellPrice, commission, quantityAvailable) stay in English.',
    '',
    'Answer with ONE JSON OBJECT PER LINE. No prose, no code fence, no wrapping array.',
    'Each line is one block, and the blocks together are your answer:',
    '',
    '  {"kind":"text","text":"…"}',
    '  {"kind":"metric","ref":"totals.netProfit","label":"…","emphasis":true}',
    '  {"kind":"steps","items":[{"text":"…","ref":"…"}]}',
    '  {"kind":"kv","rows":[{"label":"…","ref":"…"}]}',
    '  {"kind":"table","columns":["…"],"rows":[["…"]]}',
    '  {"kind":"badges","items":[{"text":"…","tone":"warning"}]}',
    '  {"kind":"chart","chart":"waterfall","title":"…","steps":[{"label":"…","ref":"…"}]}',
    '  {"kind":"chart","chart":"line","seriesRef":"series.revenue","title":"…"}',
    '  {"kind":"callout","tone":"warning","title":"…","blocks":[…]}',
    '  {"kind":"action","actionId":"…","params":{…},"note":"…"}',
    '',
    'NUMBERS. You may not type a figure. Not in prose, not in a title, not in a table cell.',
    'Two ways to state one, and no third:',
    '  • Inside text, write a placeholder: "Net profit is {{totals.netProfit}} of',
    '    {{totals.sellPrice}} ({{totals.netMargin}})." The app fills these in.',
    '  • Anywhere else, cite "ref".',
    'A block containing a percentage or a grouped number in its text is discarded on arrival.',
    'Only refs listed below exist; one you invent takes its block with it.',
    '',
    'SHAPE. Lead with one or two sentences that answer the question. Then show the working —',
    'a table, a waterfall, a kv list — then a callout if there is something to do about it.',
    'Prefer a chart when the answer is about composition or a trend. Four to eight blocks.',
    '',
    'Actions you may offer:',
    actionCatalogue(),
    '',
    `Scope: ${context.scopeLine}`,
    context.routes.length > 0 ? `Sources read: ${context.routes.join(', ')}` : '',
    '',
    'FACTS — the only numbers that exist:',
    describeFacts(context.facts, context.language),
    context.series.size > 0 ? '\nSERIES — cite by seriesRef, never by point:' : '',
    context.series.size > 0 ? describeSeries(context.series) : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/* ── history ────────────────────────────────────────────────────────────── */

/**
 * A previous answer, as prose.
 *
 * The obvious thing is to send the model its own blocks back. It is also the
 * wasteful thing: the JSON scaffolding is several times the size of what it
 * actually said, and the model does not need to re-read its own markup to
 * remember its own argument. So a past turn is flattened to a sentence or two
 * with the figures resolved — which is both cheaper and closer to what a person
 * would recall of the exchange.
 */
export function summariseAnswer(
  blocks: readonly Block[],
  facts: FactTable,
  language: Language,
): string {
  const parts: string[] = [];

  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (parts.length >= 6) return;

      switch (block.kind) {
        case 'text':
          if (typeof block.text === 'string') {
            parts.push(renderTemplate(block.text, facts, language));
          }
          break;
        case 'metric': {
          const fact = facts.get(block.ref);
          if (fact !== undefined) parts.push(`${fact.label}: ${formatFact(fact, language)}`);
          break;
        }
        case 'kv':
          for (const row of block.rows.slice(0, 4)) {
            const fact = facts.get(row.ref);
            if (fact !== undefined) parts.push(`${fact.label}: ${formatFact(fact, language)}`);
          }
          break;
        case 'callout':
          walk(block.blocks);
          break;
        default:
          break;
      }
    }
  };

  walk(blocks);
  return parts.join(' ');
}
