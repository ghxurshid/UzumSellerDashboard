import { INSIGHT_REGISTRY, type InsightActionId } from './actions';
import { freshnessNote } from './digest';
import { READ_TOOLS, type ToolContext } from './toolkit';
import { createToolkit, type ToolkitSection } from '@core/tools/createToolkit';
import type { AgentToolkit } from '@core/tools/contract';
import { isoDay, windowLabel } from '@core/tools/plaintext';
import type { WidgetHints } from '@core/agent/widgets';

/**
 * The site's toolkit, as the Copilot loop sees it.
 *
 * What the site decides is here: its lookups (`toolkit.ts`), its action table
 * (`actions.ts`), its freshness note (`digest.ts`) and the paragraphs that tell
 * the model where this archive's data comes from. How a toolkit is *presented* —
 * the native declarations, the name map, running a lookup, the generated
 * LOOKUPS and ACTIONS listings — is `createToolkit` in core, shared with the
 * other host. `sitePrompt.test.ts` pins the result byte for byte.
 */

const DAY_MS = 86_400_000;

/**
 * What the widget guide says about the site's lookups.
 *
 * `window.totals` publishes `sellerAdjustment`, the residual that makes a
 * revenue-to-profit waterfall arrive; `sales.timeline` returns a line chart's
 * buckets as they are. A host without those lookups gets a guide without these
 * sentences.
 */
export const SITE_WIDGET_HINTS: WidgetHints = {
  charts: {
    waterfall: 'revenue to net profit needs sellerAdjustment among them, as window.totals says.',
    line: 'sales.timeline returns exactly these columns.',
  },
};

/** The prose between "what a result is" and the lookup listing. */
function siteSections(context: ToolContext): readonly ToolkitSection[] {
  return [
    {
      title: 'CONVENTIONS',
      lines: [
        `  from/to   whole UTC days, "YYYY-MM-DD", both ends included. Omit them and I use the`,
        `            period the seller has selected: ${windowLabel(context.scope.fromMs, context.scope.toMs)}.`,
        `            "the last 7 days" ending today is from ${isoDay(context.now - 6 * DAY_MS)} to ${isoDay(context.now)}.`,
        '  fresh     true forces a re-read from Uzum whatever the age of what is stored — slow, and it',
        '            spends the seller\'s hourly request budget. Ask for it only on the seller\'s own',
        '            explicit request for the very latest from Uzum, never by habit or because a',
        '            figure feels important; the stored copy answers otherwise and refreshes itself.',
        "  money     so'm, whole numbers, no grouping. Pct columns are percentages (23.5 means 23.5%).",
        '  paging    data.rows returns one page; its header says "next page: offset N" when there is more.',
      ],
    },
    {
      title: 'CHOOSING A LOOKUP',
      lines: [
        '  Computing lookups did the arithmetic over every row: window.totals, period.compare,',
        '  sales.timeline, sales.pattern, products.rank, product.find, expenses.breakdown. Use them',
        '  whenever they answer the question — their totals are exact, and a column you add up',
        '  yourself from three hundred rows is not. data.rows is for what they do not cover; when you',
        '  compute from it, keep the arithmetic small and say what you counted.',
      ],
    },
    {
      title: 'WHERE THE DATA COMES FROM',
      lines: [
        '  A lookup answers from this machine\'s archive. A period already held is answered with no',
        '  request at all; if part of it is missing, I fetch exactly that part from the Uzum seller',
        '  API, store it, and then answer — so a period read before costs nothing and an unseen one',
        '  costs one fetch. Beyond that, the store refreshes itself from Uzum on its own schedule once',
        '  a table has gone past its freshness window — not because you asked, and not on every',
        '  question. You do not manage any of this and should not try to; fresh above is the one lever,',
        '  and only for the seller\'s own explicit ask.',
      ],
    },
  ];
}

const SITE_CLOSING: readonly ToolkitSection[] = [
  {
    title: 'NOT AVAILABLE',
    lines: [
      '  The Uzum seller API has no route for renaming a product or editing its description, and',
      '  none for reading or replying to customer reviews — the catalogue reports rating and',
      '  feedbackQuantity and nothing further. It publishes no forecast, no score and no',
      '  competitor data. If the seller asks for one of these, say plainly that the API does not',
      '  offer it and what you can do instead.',
    ],
  },
];

export const SITE_TOOLKIT: AgentToolkit<ToolContext, InsightActionId> = createToolkit({
  tools: READ_TOOLS,
  actions: INSIGHT_REGISTRY,
  sections: siteSections,
  closing: () => SITE_CLOSING,
  freshness: (context) => freshnessNote(context.scope, context.now),
  widgetHints: SITE_WIDGET_HINTS,
});
