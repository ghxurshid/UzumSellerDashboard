import { z } from 'zod';

import type { TranslationKey } from '@/lib/i18n/dictionary';
import type { InsightSeverity, ScreenKey, Tone } from '@/types/domain';

import { ACTION_IDS, type InsightActionId } from './actions';

/**
 * The card body language.
 *
 * A card used to be a fixed shape — title, body, a list of label/value pairs —
 * which meant every finding had to be squeezed into the one layout the first
 * finding needed. A margin collapse wants a computation shown step by step; a
 * cancellation rate wants two counts side by side; a supply shortfall wants a
 * table of invoices. Those are different documents, not different values of the
 * same document.
 *
 * So a card carries a **list of blocks** instead, drawn from the closed set
 * below. The author — a rule in `derive/insights.ts` or the model in `ai.ts` —
 * chooses how many, in what order, nested how deeply. The renderer only ever
 * sees kinds it already knows, which is what keeps a generated card inside the
 * design system rather than beside it.
 *
 * ## Why the model never writes a number
 *
 * Every numeric block cites a `ref` into the fact table (`facts.ts`) rather
 * than carrying a figure. The model picks *which* fact to show and *how* to
 * frame it; the application resolves *what the fact is*, from the same sums the
 * tables on screen were drawn from. A model that types `258 000` into a string
 * has produced a number nobody can check, and in a finance tool an uncheckable
 * number is worse than no card at all. A `ref` that does not resolve is dropped
 * on arrival, so the failure mode is a missing line rather than a wrong one.
 */

/* ── phrases ────────────────────────────────────────────────────────────── */

/**
 * Text that may be authored or translated.
 *
 * Rules ship a dictionary key and its variables, because a rule's wording is
 * the same sentence in three languages and belongs in the table with the rest
 * of them. The model ships a plain string, because it was asked to write in the
 * interface language and there is no key to point at. The renderer resolves
 * both through `phrase()`.
 */
export type Phrase =
  | string
  | {
      readonly key: TranslationKey;
      readonly vars?: Readonly<Record<string, string | number>>;
    };

/* ── blocks ─────────────────────────────────────────────────────────────── */

/**
 * A paragraph. The prose of the card.
 *
 * A string authored by the model may carry `{{ref}}` placeholders, which
 * `template.ts` resolves against the fact table at render time. That is how a
 * sentence gets to read "net profit is 457 924 of 4 966 180 sellPrice (9.2%)"
 * without the model ever having typed a digit — see `SUSPECT_NUMBER` below for
 * the guard that keeps it honest.
 */
export interface TextBlock {
  readonly kind: 'text';
  readonly text: Phrase;
  readonly tone?: Tone;
}

/** One fact, stated large — the headline figure of a finding. */
export interface MetricBlock {
  readonly kind: 'metric';
  readonly label?: Phrase;
  readonly ref: string;
  /** Renders at heading size rather than inline. */
  readonly emphasis?: boolean;
}

/** A derivation, one step per line. Rendered with the `↳` gutter. */
export interface StepsBlock {
  readonly kind: 'steps';
  readonly items: ReadonlyArray<{
    readonly text: Phrase;
    readonly ref?: string;
  }>;
}

/** Label/value rows — the evidence list, dotted leader between the two. */
export interface KeyValueBlock {
  readonly kind: 'kv';
  readonly rows: ReadonlyArray<{
    readonly label: Phrase;
    readonly ref: string;
  }>;
}

/**
 * A small table.
 *
 * Cells are text rather than refs: a table enumerates rows the fact table does
 * not index individually — three invoice ids, four SKU codes — and every one of
 * them was already put in front of the model as a fact. Numbers that carry the
 * argument belong in `metric` or `kv`, where they are resolved rather than
 * transcribed.
 */
export interface TableBlock {
  readonly kind: 'table';
  readonly columns: readonly Phrase[];
  readonly rows: ReadonlyArray<readonly Phrase[]>;
}

/** A row of pills — statuses, tags, affected screens. */
export interface BadgesBlock {
  readonly kind: 'badges';
  readonly items: ReadonlyArray<{ readonly text: Phrase; readonly tone?: Tone }>;
}

/**
 * A drawing of figures that are already in the fact table.
 *
 * Two data shapes, and the split is forced rather than chosen. A waterfall or a
 * donut is four to six numbers, so the author names them by `ref` like any
 * other citation and the guarantee holds. A time series is ninety points, which
 * no author can name one at a time — so it cites a `seriesRef` instead, naming
 * a series the analytics worker computed. Either way the author never writes a
 * coordinate.
 *
 * The chart set is deliberately small and hand-drawn. `RevenueChart` already
 * establishes the house position: a charting dependency costs ~90 kB and brings
 * its own theming layer for shapes whose geometry is a dozen lines of SVG.
 */
export interface ChartBlock {
  readonly kind: 'chart';
  readonly chart: 'waterfall' | 'bar' | 'donut' | 'line';
  readonly title?: Phrase;
  /** For `waterfall`, `bar` and `donut` — one entry per column or segment. */
  readonly steps?: ReadonlyArray<{
    readonly label: Phrase;
    readonly ref: string;
    readonly tone?: Tone;
  }>;
  /** For `line` — names a precomputed series rather than listing its points. */
  readonly seriesRef?: string;
}

/** A bordered aside. What the design calls the recommended-action box. */
export interface CalloutBlock {
  readonly kind: 'callout';
  readonly tone: Tone;
  readonly title: Phrase;
  readonly blocks: readonly Block[];
}

/**
 * A button bound to something the application can actually do.
 *
 * `actionId` names an entry in the registry, and its parameters are validated
 * against that entry's schema before the button is drawn. The model cannot
 * describe a request; it can only select one the application already performs,
 * with arguments the registry accepts.
 */
export interface ActionBlock {
  readonly kind: 'action';
  readonly actionId: InsightActionId;
  readonly params?: unknown;
  readonly note?: Phrase;
}

/**
 * A line of the application's own working, shown mid-answer.
 *
 * The only block the model cannot author — it is not in the wire schema, and
 * nothing that arrives over the stream can become one. The chat emits it when a
 * lookup runs, so the transcript shows *what was read* between the question and
 * the answer rather than presenting figures that appeared from nowhere.
 *
 * That is a trust affordance rather than a debugging one. An answer about
 * August that was preceded by a visible `window.totals · 2026-08-01..2026-08-31
 * · 1204 rows` is checkable in a way that the same answer alone is not.
 */
export interface TraceBlock {
  readonly kind: 'trace';
  /** The lookup's id, verbatim. */
  readonly tool: string;
  /** What it read — window, row count, match. */
  readonly detail: string;
}

export type Block =
  | TextBlock
  | MetricBlock
  | StepsBlock
  | KeyValueBlock
  | TableBlock
  | BadgesBlock
  | ChartBlock
  | CalloutBlock
  | ActionBlock
  | TraceBlock;

/* ── the card ───────────────────────────────────────────────────────────── */

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
  readonly signalRef?: string;
  readonly blocks: readonly Block[];
  readonly target?: ScreenKey;
  /** Whether a rule derived this or the model wrote it. */
  readonly origin: 'rule' | 'ai';
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

/**
 * What the model is allowed to send.
 *
 * Deliberately narrower than the types above: every phrase is a plain string
 * (the model has no dictionary keys), every bound is finite, and every list has
 * a ceiling. The limits are less about correctness than about a card that still
 * fits a 320px rail — a model asked for evidence will otherwise happily produce
 * forty rows of it.
 */
const MAX_DEPTH = 2;

const toneSchema = z.enum(['positive', 'negative', 'warning', 'neutral', 'accent']);
const refSchema = z.string().trim().min(1).max(80);
const longPhrase = z.string().trim().min(1).max(600);
const shortPhrase = z.string().trim().min(1).max(120);

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

type UnionMembers = readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];

/**
 * Built per depth rather than with `z.lazy`.
 *
 * A recursive schema would let the model nest callouts inside callouts until
 * the rail is a set of Russian dolls. Rebuilding the union with a shallower
 * callout at each level bounds the depth in the schema itself, so an
 * over-nested document is rejected at the edge instead of rendering.
 */
function blockSchemaAtDepth(depth: number): z.ZodTypeAny {
  const leaves: z.ZodTypeAny[] = [
    z.object({ kind: z.literal('text'), text: longPhrase, tone: toneSchema.optional() }),
    z.object({
      kind: z.literal('metric'),
      label: shortPhrase.optional(),
      ref: refSchema,
      emphasis: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('steps'),
      items: z.array(z.object({ text: shortPhrase, ref: refSchema.optional() })).min(1).max(8),
    }),
    z.object({
      kind: z.literal('kv'),
      rows: z.array(z.object({ label: shortPhrase, ref: refSchema })).min(1).max(10),
    }),
    z.object({
      kind: z.literal('table'),
      columns: z.array(shortPhrase).min(1).max(4),
      rows: z.array(z.array(shortPhrase).min(1).max(4)).min(1).max(12),
    }),
    z.object({
      kind: z.literal('badges'),
      items: z.array(z.object({ text: shortPhrase, tone: toneSchema.optional() })).min(1).max(6),
    }),
    z.object({
      kind: z.literal('chart'),
      chart: z.enum(['waterfall', 'bar', 'donut', 'line']),
      title: shortPhrase.optional(),
      steps: z
        .array(z.object({ label: shortPhrase, ref: refSchema, tone: toneSchema.optional() }))
        .min(2)
        .max(8)
        .optional(),
      seriesRef: refSchema.optional(),
    }),
    z.object({
      kind: z.literal('action'),
      actionId: z.enum(ACTION_IDS),
      params: z.unknown().optional(),
      note: shortPhrase.optional(),
    }),
  ];

  if (depth <= 0) return z.union(leaves as unknown as UnionMembers);

  const callout = z.object({
    kind: z.literal('callout'),
    tone: toneSchema,
    title: shortPhrase,
    blocks: z.array(blockSchemaAtDepth(depth - 1)).min(1).max(8),
  });

  return z.union([...leaves, callout] as unknown as UnionMembers);
}

export const aiCardSchema = z.object({
  id: z.string().trim().min(1).max(60),
  severity: severitySchema,
  group: groupSchema,
  source: z.string().trim().min(1).max(80),
  title: shortPhrase,
  signalRef: refSchema.optional(),
  target: screenSchema.optional(),
  blocks: z.array(blockSchemaAtDepth(MAX_DEPTH)).min(1).max(10),
});

export const aiDocumentSchema = z.object({
  cards: z.array(aiCardSchema).max(6),
});

/**
 * One block, standing alone.
 *
 * The chat answers in NDJSON — one complete block per line — so this is the
 * schema the stream parser applies to each finished line. Validating a line at
 * a time is what makes streaming structured output tractable at all: a whole
 * document cannot be parsed until its last brace arrives, whereas a line can be
 * shown the moment its newline does.
 */
export const blockLineSchema = blockSchemaAtDepth(MAX_DEPTH);

/**
 * Figures the model should never have typed.
 *
 * Every legitimate number reaches the screen through a `ref` or a `{{ref}}`
 * placeholder, so once placeholders are stripped a text run has no business
 * containing money or a percentage. This catches the three shapes that matter:
 * any percent sign, a five-digit-or-longer run (so'm amounts start well above
 * that), and grouped thousands in any of the separators the app formats with.
 *
 * A four-digit run is deliberately allowed — that is a year, and "Abaya 2024"
 * is a product name rather than a claim about money.
 *
 * This is the difference between a prompt rule and an invariant. The prompt
 * asks; this enforces, and a block that breaks it is dropped before it renders.
 */
export const SUSPECT_NUMBER = /%|\d{5,}|\d{1,3}(?:[\s\u00A0\u2009.,]\d{3})+/;

/** `true` when a model-authored string states a figure it was told not to. */
export function statesRawNumber(text: string): boolean {
  return SUSPECT_NUMBER.test(text.replace(/\{\{[^}]*\}\}/g, ''));
}
