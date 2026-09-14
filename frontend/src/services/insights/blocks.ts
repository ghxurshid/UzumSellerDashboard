import { z } from 'zod';

import type { TranslationKey } from '@/lib/i18n/dictionary';
import type { InsightSeverity, ScreenKey, Tone } from '@/types/domain';

import { ACTION_IDS, type InsightActionId } from './actions';
import { FIGURE_FORMATS, type FigureFormat, type FigureValue } from './figures';

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
 * below. The author — a rule in `derive/insights.ts` or the model in `ai.ts` and
 * `agent.ts` — chooses how many, in what order, nested how deeply. The renderer
 * only ever sees kinds it already knows, which is what keeps a generated card
 * inside the design system rather than beside it.
 *
 * ## Where a number comes from
 *
 * From its author, written into the block. A rule computes it from the totals it
 * was handed; the model computes it from the rows a lookup returned it. Neither
 * cites anything the application has to look up at render time — see
 * `figures.ts` for why the fact table that used to stand between them went.
 *
 * What the application still owns is the *shape*: every figure says what kind of
 * number it is (`money`, `percent`, `count`, `number`), and the renderer formats
 * it through the same code path as the tables on screen, so a model's 457924 and
 * the dashboard's 457 924 so'm read as the same number.
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

/** A value and what kind of number it is. */
export interface Figure {
  readonly value: FigureValue;
  readonly format?: FigureFormat;
}

/* ── blocks ─────────────────────────────────────────────────────────────── */

/** A paragraph, in Markdown. The prose of the card. */
export interface TextBlock {
  readonly kind: 'text';
  readonly text: Phrase;
  readonly tone?: Tone;
}

/** One figure, stated large — the headline of a finding. */
export interface MetricBlock {
  readonly kind: 'metric';
  readonly label?: Phrase;
  readonly value: FigureValue;
  readonly format?: FigureFormat;
  /** Signed change in percent against whatever the answer compared it with. */
  readonly change?: number;
  /** Renders at heading size rather than inline. */
  readonly emphasis?: boolean;
}

/** A derivation, one step per line. Rendered with the `↳` gutter. */
export interface StepsBlock {
  readonly kind: 'steps';
  readonly items: ReadonlyArray<{
    readonly text: Phrase;
    readonly value?: FigureValue;
    readonly format?: FigureFormat;
  }>;
}

/** Label/value rows — the evidence list, dotted leader between the two. */
export interface KeyValueBlock {
  readonly kind: 'kv';
  readonly rows: ReadonlyArray<{
    readonly label: Phrase;
    readonly value: FigureValue;
    readonly format?: FigureFormat;
    readonly tone?: Tone;
  }>;
}

/**
 * A small table.
 *
 * A cell is text or a number. `formats`, when given, says per column what kind
 * of number its cells hold, so a column of so'm is grouped and suffixed like
 * money everywhere else; a column without one is drawn as written.
 */
export interface TableBlock {
  readonly kind: 'table';
  readonly columns: readonly Phrase[];
  readonly rows: ReadonlyArray<ReadonlyArray<Phrase | number>>;
  readonly formats?: readonly FigureFormat[];
}

/** A row of pills — statuses, tags, affected screens. */
export interface BadgesBlock {
  readonly kind: 'badges';
  readonly items: ReadonlyArray<{ readonly text: Phrase; readonly tone?: Tone }>;
}

/**
 * A drawing of figures the author already has.
 *
 * Two data shapes, because the charts want two. A waterfall, a bar or a donut is
 * a handful of labelled amounts — `items`. A line is a run of buckets with one or
 * more measures over them — `labels` for the buckets, `series` for the measures,
 * one value per label. The split is the smallest thing that lets a seven-day
 * sales line and a three-product comparison both be written without the author
 * inventing coordinates.
 *
 * The chart set is deliberately small and hand-drawn. `RevenueChart` already
 * establishes the house position: a charting dependency costs ~90 kB and brings
 * its own theming layer for shapes whose geometry is a dozen lines of SVG.
 */
export interface ChartBlock {
  readonly kind: 'chart';
  readonly chart: 'waterfall' | 'bar' | 'donut' | 'line';
  readonly title?: Phrase;
  /** What kind of number every value in the chart is. */
  readonly format?: FigureFormat;
  /** For `waterfall`, `bar` and `donut` — one entry per column or segment. */
  readonly items?: ReadonlyArray<{
    readonly label: Phrase;
    readonly value: number;
    readonly tone?: Tone;
  }>;
  /** For `line` — the buckets along the axis. */
  readonly labels?: readonly string[];
  /** For `line` — one entry per measure, one value per label. */
  readonly series?: ReadonlyArray<{
    readonly name: Phrase;
    readonly values: readonly number[];
  }>;
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
  readonly signal?: Figure;
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
 * (the model has no dictionary keys), every number is finite, and every list
 * has a ceiling. The limits are less about correctness than about a card that
 * still fits a 320px rail — a model asked for evidence will otherwise happily
 * produce forty rows of it.
 *
 * The limits are also written out in `widgets.ts`, because a line refused for a
 * length nobody told the model about is a line it cannot fix. Change one, change
 * the other — `WIDGET_LIMITS` below is what both read.
 */
export const WIDGET_LIMITS = {
  text: 4_000,
  label: 120,
  cell: 160,
  step: 240,
  kvRows: 12,
  steps: 10,
  tableColumns: 6,
  tableRows: 30,
  badges: 8,
  chartItems: 12,
  lineLabels: 120,
  lineSeries: 4,
  calloutBlocks: 8,
} as const;

const MAX_DEPTH = 2;

const toneSchema = z.enum(['positive', 'negative', 'warning', 'neutral', 'accent']);
const formatSchema = z.enum(FIGURE_FORMATS);
const finite = z.number().finite();
/**
 * A figure's value: a number, or a short string for what is not one.
 *
 * The message is spelled out because a union's own is "Invalid input", which is
 * what a model that sent `"ref"` instead of `"value"` would otherwise be told —
 * and it cannot act on that.
 */
const valueSchema = z.union([finite, z.string().trim().min(1).max(60)], {
  errorMap: () => ({ message: 'must be a plain number, or a string of at most 60 characters' }),
});

/**
 * A paragraph. Generous, because prose carries the answer.
 *
 * 600 characters was the cap while a sentence was a frame around resolved
 * figures. A model writing a whole answer in Markdown — a heading, a list, the
 * reasoning under it — passes that inside two bullets, and the line was then
 * refused for a length nobody had told it about.
 */
const longPhrase = z.string().trim().min(1).max(WIDGET_LIMITS.text);
const label = z.string().trim().min(1).max(WIDGET_LIMITS.label);
const cellText = z.string().trim().max(WIDGET_LIMITS.cell);
const stepText = z.string().trim().min(1).max(WIDGET_LIMITS.step);

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
 * The chart, with its two data shapes checked against the chart they belong to.
 *
 * Every data field is optional in the object because a line uses two and the
 * other three use one; the refinement is what says which. Each message names the
 * field and what it needed, because it is read by a model being asked to send
 * the line again.
 */
const chartSchema = z
  .object({
    kind: z.literal('chart'),
    chart: z.enum(['waterfall', 'bar', 'donut', 'line']),
    title: label.optional(),
    format: formatSchema.optional(),
    items: z
      .array(z.object({ label, value: finite, tone: toneSchema.optional() }))
      .min(2)
      .max(WIDGET_LIMITS.chartItems)
      .optional(),
    labels: z.array(z.string().trim().min(1).max(40)).min(2).max(WIDGET_LIMITS.lineLabels).optional(),
    series: z
      .array(z.object({ name: label, values: z.array(finite) }))
      .min(1)
      .max(WIDGET_LIMITS.lineSeries)
      .optional(),
  })
  .superRefine((block, context) => {
    if (block.chart === 'line') {
      if (block.labels === undefined || block.series === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [block.labels === undefined ? 'labels' : 'series'],
          message: 'a line chart needs labels and series',
        });
        return;
      }
      block.series.forEach((entry, index) => {
        if (entry.values.length !== block.labels?.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['series', index, 'values'],
            message: `needs exactly one value per label (${block.labels?.length ?? 0})`,
          });
        }
      });
      return;
    }

    if (block.items === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: `a ${block.chart} chart needs items`,
      });
      return;
    }

    /* A slice is a share of a whole, and a negative share has no arc — the
       renderer used to take its magnitude, which drew a loss as a slice of
       profit. */
    if (block.chart === 'donut') {
      block.items.forEach((item, index) => {
        if (item.value < 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items', index, 'value'],
            message: 'a donut slice cannot be negative — use a bar chart',
          });
        }
      });
    }
  });

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
      label: label.optional(),
      value: valueSchema,
      format: formatSchema.optional(),
      change: finite.optional(),
      emphasis: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('steps'),
      items: z
        .array(
          z.object({
            text: stepText,
            value: valueSchema.optional(),
            format: formatSchema.optional(),
          }),
        )
        .min(1)
        .max(WIDGET_LIMITS.steps),
    }),
    z.object({
      kind: z.literal('kv'),
      rows: z
        .array(
          z.object({
            label,
            value: valueSchema,
            format: formatSchema.optional(),
            tone: toneSchema.optional(),
          }),
        )
        .min(1)
        .max(WIDGET_LIMITS.kvRows),
    }),
    z.object({
      kind: z.literal('table'),
      columns: z.array(label).min(1).max(WIDGET_LIMITS.tableColumns),
      rows: z
        .array(z.array(z.union([finite, cellText])).min(1).max(WIDGET_LIMITS.tableColumns))
        .min(1)
        .max(WIDGET_LIMITS.tableRows),
      formats: z.array(formatSchema).max(WIDGET_LIMITS.tableColumns).optional(),
    }),
    z.object({
      kind: z.literal('badges'),
      items: z
        .array(z.object({ text: label, tone: toneSchema.optional() }))
        .min(1)
        .max(WIDGET_LIMITS.badges),
    }),
    chartSchema,
    z.object({
      kind: z.literal('action'),
      actionId: z.enum(ACTION_IDS),
      params: z.unknown().optional(),
      note: label.optional(),
    }),
  ];

  if (depth <= 0) return z.union(leaves as unknown as UnionMembers);

  const callout = z.object({
    kind: z.literal('callout'),
    tone: toneSchema,
    title: label,
    blocks: z.array(blockSchemaAtDepth(depth - 1)).min(1).max(WIDGET_LIMITS.calloutBlocks),
  });

  return z.union([...leaves, callout] as unknown as UnionMembers);
}

export const aiCardSchema = z.object({
  id: z.string().trim().min(1).max(60),
  severity: severitySchema,
  group: groupSchema,
  source: z.string().trim().min(1).max(80),
  title: label,
  signal: z.object({ value: valueSchema, format: formatSchema.optional() }).optional(),
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
 *
 * It is also what a pinned answer is checked against when it is read back from
 * storage, so a card saved by an older build in a shape this one no longer draws
 * is dropped rather than rendered half-empty.
 */
export const blockLineSchema = blockSchemaAtDepth(MAX_DEPTH);
