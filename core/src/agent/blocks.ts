import { z } from 'zod';

import type { TranslationKey } from '@core/i18n/dictionary';
import type { Tone } from '@core/types/common';

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
 * This file is the block language and nothing else, and it is shared by every
 * host the Copilot runs in. The site's insight-card envelope that wraps a list
 * of blocks — severity, group, the rail's sort order — is `cards.ts`.
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

/**
 * Two to four figures side by side — the state of something at a glance.
 *
 * A `metric` is one figure. "How is the shop doing" is four of them, and four
 * metric blocks stack into a column the eye has to walk down; a row of tiles is
 * the same figures read across.
 *
 * A tile carries `previous` rather than `change`: the author gives the two
 * figures it read and the application does the division (`changeFrom` in
 * `figures.ts`), so a tile cannot show a percentage that disagrees with the
 * numbers it was derived from.
 */
export interface MetricsBlock {
  readonly kind: 'metrics';
  readonly items: ReadonlyArray<{
    readonly label: Phrase;
    readonly value: FigureValue;
    readonly format?: FigureFormat;
    /** What `value` is compared with, in the same unit. The change is derived. */
    readonly previous?: number;
  }>;
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
 * A figure against the whole it is part of — returned out of sold, sold out of
 * stocked, done out of planned.
 *
 * The author gives the part and the whole; the share and the fill are derived
 * (`shareOf` in `figures.ts`). Both figures are printed beside the bar, so the
 * percentage is always standing next to the two numbers it came from.
 */
export interface ProgressBlock {
  readonly kind: 'progress';
  readonly rows: ReadonlyArray<{
    readonly label: Phrase;
    readonly value: number;
    /** The whole `value` is a share of. Above zero. */
    readonly total: number;
    /** What kind of number `value` and `total` both are. */
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

/**
 * A ranking — who leads, and by how much.
 *
 * A `bar` chart draws quantities in the order they were written and says
 * nothing about place. A ranking is a claim about order, so the order is not
 * left to the author: the application sorts the items, numbers the places and
 * gives equal values the same place (`rankOrder` in `figures.ts`). A list the
 * model wrote out of order is still a correct ranking when it is drawn.
 *
 * The bar under each row is its value against the largest one in the list —
 * not a share of a total, because the rows are whatever the author read and
 * rarely the whole shop.
 */
export interface RankBlock {
  readonly kind: 'rank';
  readonly title?: Phrase;
  /** What kind of number every value in the ranking is. */
  readonly format?: FigureFormat;
  /** Which end leads: the largest (`desc`, the default) or the smallest. */
  readonly order?: 'desc' | 'asc';
  readonly items: ReadonlyArray<{
    readonly label: Phrase;
    readonly value: number;
    /** A second line under the name — a SKU, a category, what was counted. */
    readonly note?: Phrase;
    readonly tone?: Tone;
  }>;
}

/**
 * One product, as a card — the thing an answer is about, shown rather than named.
 *
 * A seller knows a product by its picture and its title long before its id, so
 * an answer about one product leads with those and puts the handful of figures
 * that describe it underneath. Everything on the card is the author's: the title
 * and the figures are copied from a result, and nothing is looked up at render.
 *
 * `image` is the one field that makes a request when it is drawn, so it is held
 * to the marketplace's own image host (`PRODUCT_IMAGE_PREFIX`). A URL from
 * anywhere else is refused at the wire: an address a model was talked into
 * writing must not be able to send anything to a third party.
 */
export interface ProductBlock {
  readonly kind: 'product';
  readonly title: Phrase;
  /** A second line under the title — an id, a SKU, a category. */
  readonly note?: Phrase;
  /** The product's own image, as a result returned it. */
  readonly image?: string;
  /** Where it stands — in stock, run out, in moderation. */
  readonly status?: { readonly text: Phrase; readonly tone?: Tone };
  readonly figures?: ReadonlyArray<{
    readonly label: Phrase;
    readonly value: FigureValue;
    readonly format?: FigureFormat;
    readonly tone?: Tone;
  }>;
}

/**
 * Two things side by side, measure by measure.
 *
 * `a` is what the answer is about and `b` is what it is held against — this
 * product and that one, this month and the last. Each row carries the two
 * figures as they were read; the difference between them is derived
 * (`compareRow` in `figures.ts`), like every other figure a block leaves to the
 * application.
 *
 * `better` is what lets the block take a side. Without it a difference is only
 * a difference and is drawn in plain ink. With it the row knows whether `a`
 * leads or trails — returns that fell are good news, sales that fell are not —
 * and only then is a gap coloured as one or the other.
 */
export interface CompareBlock {
  readonly kind: 'compare';
  readonly title?: Phrase;
  /** The name of the subject. */
  readonly a: Phrase;
  /** The name of what it is compared with. */
  readonly b: Phrase;
  readonly rows: ReadonlyArray<{
    readonly label: Phrase;
    readonly a: number;
    readonly b: number;
    /** What kind of number both figures are. */
    readonly format?: FigureFormat;
    /** Which way is good for this measure. Left out, the row takes no side. */
    readonly better?: 'higher' | 'lower';
  }>;
}

/**
 * A question back to the seller, with the answers it can take.
 *
 * Some questions have more than one honest reading — which period, which of
 * three products with the same name, a summary or the full breakdown — and an
 * answer to the wrong one is worse than a moment's pause. This block is that
 * pause: the readings are laid out, the seller presses one, and the pick goes
 * back as their next message, worded as the option's label.
 *
 * While it is open it is not a card in the transcript: it takes the composer's
 * place as a form and holds the focus (`ChoiceForm`), because answering it is
 * the seller's next move. The transcript keeps the question as one line once it
 * has been dealt with.
 *
 * The block carries no state. Whether it has been answered is read off the
 * conversation — the message that follows it either is one of its labels or is
 * not — so there is no second record that could disagree with what was said.
 * The one outcome that leaves no message is the seller closing the question,
 * and that is written on the turn that asked (`ChatTurn.choiceDismissed`).
 *
 * It is not an `action`: nothing is run. A pick is a message, exactly as if the
 * seller had typed the label, which is also why an answer in their own words is
 * always a valid one.
 */
export interface ChoiceBlock {
  readonly kind: 'choice';
  readonly question: Phrase;
  /** One line under the question — why it is being asked. */
  readonly note?: Phrase;
  readonly options: ReadonlyArray<{
    /** What the seller reads, and what is sent as their reply when they pick it. */
    readonly label: Phrase;
    /** Where this option leads. */
    readonly description?: Phrase;
    /** The one the author would take. At most one. */
    readonly recommended?: boolean;
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
 * `actionId` names an entry in the host's registry, and its parameters are
 * validated against that entry's schema before the button is drawn. The model
 * cannot describe a request; it can only select one the application already
 * performs, with arguments the registry accepts.
 *
 * A plain string here, because the block language is shared by hosts with
 * different registries. The id is checked where the registry is known: the
 * Copilot loop refuses an unknown one before it is emitted (`checkActions` in
 * `agent.ts`), the rail refuses it before a card is kept (`ai.ts`), and the
 * renderer resolves it again and draws nothing for one that does not resolve.
 */
export interface ActionBlock {
  readonly kind: 'action';
  readonly actionId: string;
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
  | MetricsBlock
  | StepsBlock
  | KeyValueBlock
  | ProgressBlock
  | TableBlock
  | BadgesBlock
  | ChartBlock
  | RankBlock
  | ProductBlock
  | CompareBlock
  | ChoiceBlock
  | CalloutBlock
  | ActionBlock
  | TraceBlock;

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
  /** A bucket along a line chart's axis — a date, a weekday, an hour. */
  axisLabel: 40,
  /** A figure that is not a number — "3 / 5", a date. */
  valueText: 60,
  kvRows: 12,
  /** Tiles in a `metrics` row. Four is two rows of two on a 320px rail. */
  metricsItems: 4,
  progressRows: 8,
  rankItems: 10,
  /** Figures on a `product` card — three rows of two on a 320px rail. */
  productFigures: 6,
  /** A product image address. The recorded ones are about 65 characters. */
  imageUrl: 200,
  /** A product's status pill — one or two words, never a sentence. */
  statusText: 24,
  compareRows: 8,
  /**
   * Options a `choice` may offer. Past four a question is no longer a fork, it
   * is a menu, and the seller is better served by being asked something narrower.
   */
  choiceOptions: 4,
  /** An option's label — it is also the message sent when it is picked. */
  choiceLabel: 80,
  steps: 10,
  tableColumns: 6,
  tableRows: 30,
  badges: 8,
  chartItems: 12,
  /**
   * Slices a donut may have when the model draws one.
   *
   * The categorical palette has eight hues and a hue is never repeated, because
   * two slices of one colour read as one slice. Pins saved before this limit may
   * carry more; they are read back by the lenient schema and the renderer draws
   * them without cycling.
   */
  donutItems: 8,
  lineLabels: 120,
  lineSeries: 4,
  calloutBlocks: 8,
} as const;

const MAX_DEPTH = 2;

const toneSchema = z.enum(['positive', 'negative', 'warning', 'neutral', 'accent']);
const formatSchema = z.enum(FIGURE_FORMATS);
const finite = z.number().finite();
/**
 * A position that holds a number and nothing else — a chart value, a change.
 *
 * Spelled out for the same reason as `valueSchema`: zod's own "Expected number,
 * received string" does not tell a model that sent "9.2%" what to send instead.
 * Nothing reads a numeric string as the number it spells before this, so "9.2"
 * is refused here just as "9.2%" is, and this message is the reason given back.
 */
const plainNumber = z
  .number({
    invalid_type_error:
      'must be a plain JSON number — no quotes, %, spaces, currency or thousands separators',
  })
  .finite();
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

/**
 * An action id as the wire may carry it: a short dotted name, nothing else.
 *
 * Not an enum of one host's ids, because the language is shared — which ids
 * exist is the registry's to say, and it says so with a reason the model can
 * act on (see `ActionBlock`). This only keeps text that could never be an id
 * from travelling further.
 */
const actionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/, {
    message: 'must be an action id from the toolkit, e.g. "copilot.ask"',
  });

/**
 * One tile of a `metrics` row.
 *
 * Strict, unlike every other shape here, for one field. A lone `metric` takes
 * `change`, so a model that knows that block will write `change` on a tile too —
 * and an ordinary object would drop the key in silence and draw the tile without
 * it. Refusing the line instead gets it sent again with the two figures the
 * change is derived from.
 */
const metricsItemSchema = z
  .object({
    label,
    value: valueSchema,
    format: formatSchema.optional(),
    previous: plainNumber.optional(),
  })
  .strict({
    message:
      'a tile takes label, value, format and previous — send "previous" (the figure compared with) and the change is derived',
  });

/**
 * One row of a `progress` block.
 *
 * The two refusals are the two ways a share stops meaning anything: a negative
 * part has no fill to draw, and a whole of zero has no share to take.
 */
const progressRowSchema = z.object({
  label,
  value: plainNumber.min(0, {
    message: 'cannot be negative — a part of a whole has no negative fill; use a bar chart',
  }),
  total: plainNumber.gt(0, {
    message: 'must be above zero — it is the whole that value is a part of',
  }),
  format: formatSchema.optional(),
  tone: toneSchema.optional(),
});

/**
 * Where a product image may come from: Uzum's own image host, and nowhere else.
 *
 * An `<img>` is a request the seller's browser makes the moment the card is
 * drawn. If a block could name any address, text hidden in a product title
 * could talk a model into writing one that carries the seller's figures away in
 * its path. Held to this host, the worst a forged address can do is ask Uzum for
 * a picture that does not exist.
 */
export const PRODUCT_IMAGE_PREFIX = 'https://images.uzum.uz/';

/** The path after the host: plain path characters only — no query, fragment or userinfo. */
const PRODUCT_IMAGE_PATH = /^[A-Za-z0-9._~/-]+$/;

/**
 * Whether an address may be drawn as a product image.
 *
 * Exported because the wire is not the only way a block reaches the renderer —
 * a rule can author one — and the renderer asks the same question before it
 * lets the browser make the request.
 */
export function isProductImage(url: string): boolean {
  return (
    url.length <= WIDGET_LIMITS.imageUrl &&
    url.startsWith(PRODUCT_IMAGE_PREFIX) &&
    PRODUCT_IMAGE_PATH.test(url.slice(PRODUCT_IMAGE_PREFIX.length))
  );
}

const productImageSchema = z.string().trim().refine(isProductImage, {
  message: `must be a ${PRODUCT_IMAGE_PREFIX}… address copied from a result, with no query string — leave image out if you have none`,
});

const productSchema = z.object({
  kind: z.literal('product'),
  title: label,
  note: label.optional(),
  image: productImageSchema.optional(),
  status: z
    .object({
      text: z.string().trim().min(1).max(WIDGET_LIMITS.statusText),
      tone: toneSchema.optional(),
    })
    .optional(),
  figures: z
    .array(
      z.object({
        label,
        value: valueSchema,
        format: formatSchema.optional(),
        tone: toneSchema.optional(),
      }),
    )
    .min(1)
    .max(WIDGET_LIMITS.productFigures)
    .optional(),
});

/**
 * One row of a `compare` block.
 *
 * Strict for the same reason a `metrics` tile is: the difference is derived, and
 * a model that has just worked one out will want to send it. A key the row does
 * not take is refused with the reason, not dropped while the row is drawn
 * without it.
 */
const compareRowSchema = z
  .object({
    label,
    a: plainNumber,
    b: plainNumber,
    format: formatSchema.optional(),
    better: z.enum(['higher', 'lower']).optional(),
  })
  .strict({
    message:
      'a row takes label, a, b, format and better — send the two figures and the difference is derived',
  });

const compareSchema = z.object({
  kind: z.literal('compare'),
  title: label.optional(),
  a: label,
  b: label,
  rows: z.array(compareRowSchema).min(1).max(WIDGET_LIMITS.compareRows),
});

const choiceLabel = z.string().trim().min(1).max(WIDGET_LIMITS.choiceLabel);

/**
 * The question, with the two things that would make its answer unreadable.
 *
 * A pick comes back as the option's label, so two options with one label are one
 * option the seller cannot tell apart and the next turn cannot either. And a
 * recommendation is a single opinion: two of them recommend nothing.
 */
const choiceSchema = z
  .object({
    kind: z.literal('choice'),
    question: stepText,
    note: stepText.optional(),
    options: z
      .array(
        z.object({
          label: choiceLabel,
          description: cellText.optional(),
          recommended: z.boolean().optional(),
        }),
      )
      .min(2)
      .max(WIDGET_LIMITS.choiceOptions),
  })
  .superRefine((block, context) => {
    const seen = new Set<string>();
    block.options.forEach((option, index) => {
      const key = option.label.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options', index, 'label'],
          message: 'repeats another option — every label must be different, the pick is sent back as its label',
        });
      }
      seen.add(key);
    });

    const recommended = block.options.flatMap((option, index) =>
      option.recommended === true ? [index] : [],
    );
    const second = recommended[1];
    if (second !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', second, 'recommended'],
        message: 'only one option can be recommended',
      });
    }
  });

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
      .array(z.object({ label, value: plainNumber, tone: toneSchema.optional() }))
      .min(2)
      .max(WIDGET_LIMITS.chartItems)
      .optional(),
    labels: z.array(z.string().trim().min(1).max(40)).min(2).max(WIDGET_LIMITS.lineLabels).optional(),
    series: z
      .array(z.object({ name: label, values: z.array(plainNumber) }))
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
      change: plainNumber.optional(),
      emphasis: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('metrics'),
      items: z.array(metricsItemSchema).min(2).max(WIDGET_LIMITS.metricsItems),
    }),
    z.object({
      kind: z.literal('progress'),
      rows: z.array(progressRowSchema).min(1).max(WIDGET_LIMITS.progressRows),
    }),
    z.object({
      kind: z.literal('rank'),
      title: label.optional(),
      format: formatSchema.optional(),
      order: z.enum(['desc', 'asc']).optional(),
      items: z
        .array(
          z.object({
            label,
            value: plainNumber,
            note: label.optional(),
            tone: toneSchema.optional(),
          }),
        )
        .min(2)
        .max(WIDGET_LIMITS.rankItems),
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
    productSchema,
    compareSchema,
    choiceSchema,
    z.object({
      kind: z.literal('action'),
      actionId: actionIdSchema,
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

/** A short plain-text label — a title, a heading — as the wire accepts it. */
export const labelSchema = label;

/** A figure standing alone: a value and what kind of number it is. */
export const figureSchema = z.object({ value: valueSchema, format: formatSchema.optional() });

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
