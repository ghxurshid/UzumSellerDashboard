/**
 * The widget guide, handed over on request.
 *
 * Everything the chat can draw is a block kind in `blocks.ts` and a `switch`
 * arm in `BlockRenderer`. What changed is *when the model learns about them*.
 *
 * The instructions used to be pasted into every prompt, which had two costs.
 * The obvious one is tokens: the vocabulary, the chart rules and the number
 * rule are a page, and they were re-sent on every turn of every thread whether
 * the answer needed a chart or not. The one that matters more is that a model
 * shown a catalogue of shapes on every turn *uses* the catalogue — it reaches
 * for the waterfall because the waterfall was described, and every answer comes
 * out with the same furniture: a sentence, a metric, a chart, a callout.
 *
 * So the guide is a capability the model asks for once per thread. Asking is
 * cheap, the answer is complete, and what arrives is a vocabulary rather than a
 * template — the shape section says so in as many words, because "there is no
 * house layout" is the instruction most worth spending tokens on.
 */

/** The one-line mention in the base prompt. Names, no syntax. */
export const WIDGET_NAMES =
  'text, metric, kv, steps, table, badges, chart (waterfall/bar/donut/line), callout, action';

/**
 * The guide.
 *
 * English, like every other prompt in this application, and for the same
 * reason: the field names it talks about are English, and a mixed-language
 * instruction is where a model starts answering in the language of its
 * instructions rather than the one the seller chose.
 */
export const WIDGET_GUIDE = [
  'WIDGETS — how your answer is drawn.',
  '',
  'One JSON object per line, in the order they should appear. A line that is not one of',
  'these is not shown, so nothing outside a block reaches the seller.',
  '',
  '  {"kind":"text","text":"…","tone"?:"positive|negative|warning|neutral|accent"}',
  '      A paragraph, written in MARKDOWN. **bold**, *italic*, `code`, "- " bullets,',
  '      "1. " numbered lists, "## " headings, "> " quotes and | pipe | tables | are all',
  '      drawn. A newline inside the JSON string is \\n; a blank line starts a paragraph.',
  '      This is where the answer goes. Write the figures into the sentence yourself,',
  '      spelled the way the seller reads them: "Sof foyda **457 924 so\'m** — tushumning',
  '      9.2 %i." One text block can hold the whole answer; it does not have to be short.',
  '  {"kind":"metric","ref":"totals.netProfit","label"?:"…","emphasis"?:true}',
  '      One figure, alone. `emphasis` renders it at heading size — the headline of an',
  '      answer, not every figure in it.',
  '  {"kind":"kv","rows":[{"label":"…","ref":"…"}]}',
  '      Up to ten label/value lines with a dotted leader. The evidence list.',
  '  {"kind":"steps","items":[{"text":"…","ref"?:"…"}]}',
  '      Up to eight lines with a ↳ gutter. A derivation read top to bottom; a step with',
  '      no ref is the reasoning between two figures.',
  '  {"kind":"table","columns":["…"],"rows":[["…"]]}',
  '      Up to 4 columns and 12 rows. Cells are TEXT — names, ids, statuses. A number',
  '      that carries the argument belongs in kv or metric, where it is resolved.',
  '  {"kind":"badges","items":[{"text":"…","tone"?:…}]}   up to six pills.',
  '  {"kind":"chart","chart":"waterfall|bar|donut","title"?:"…",',
  '                  "steps":[{"label":"…","ref":"…","tone"?:…}]}   2–8 steps.',
  '  {"kind":"chart","chart":"line","seriesRef":"series.revenue","title"?:"…"}',
  '  {"kind":"callout","tone":…,"title":"…","blocks":[ … ]}',
  '      A bordered aside — the thing to do about what you just showed. Nest one level.',
  '  {"kind":"action","actionId":"…","params":{…},"note"?:"…"}',
  '      A button. Same registry as {"call":…}; use this form when the button belongs at',
  '      a particular place in the answer. {"kind":"action","actionId":"copilot.ask",',
  '      "params":{"question":"…"}} becomes a suggested follow-up chip under the answer —',
  '      at most two, and only when there is genuinely a next question.',
  '',
  'NUMBERS — where you write one, and where you point at one.',
  '  In prose you WRITE the figure. Copy it from the tool result as the result gave it to',
  '  you, group the thousands, and name the currency: "1 250 000 so\'m", "9.2 %".',
  '  Never put a ref in a sentence. "p.2753034.revenue" is drawn as those very characters',
  '  and means nothing to the seller — write what the result says that ref is worth.',
  '  In every OTHER block a figure is a "ref" and the application resolves it, so that a',
  '  card pinned to the dashboard shows today\'s value rather than today\'s sentence. Only',
  '  refs a tool result defined exist; one you invent renders as a dash.',
  '  Every figure you write is one a result put in front of you. You do not add, divide,',
  '  estimate or round into a new number — if the figure you want is not in a result, ask',
  '  for it, or say plainly that it is not available.',
  '',
  'CHARTS — four shapes, and the question picks one.',
  '  waterfall  a running balance being eaten. It must ARRIVE: first step is the opening',
  '             total, last is the closing total, and the steps between must account for',
  '             the whole distance. Revenue to net profit needs totals.sellerAdjustment',
  '             among them or the columns stop short of the total.',
  '  donut      shares of one whole. Every slice is a part; never put the total in.',
  '  bar        independent quantities side by side.',
  '  line       a trend. Needs a seriesRef; a line never lists its own points.',
  '  A chart that repeats what the sentence already said is noise. Draw one when the',
  '  shape is the finding.',
  '',
  'SHAPE — there is no house layout, and you should not invent one.',
  '  Answer in the form the question wants. "Did I make money in August" is a sentence',
  '  and a metric. "Why did margin fall" is a derivation. "Which SKUs are empty" is a',
  '  table. "What should I do about it" is the finding, the evidence, and one button.',
  '  Two blocks is a complete answer when two blocks say it.',
  '  Do not open every reply the same way. Do not restate at the end what you just',
  '  showed. Do not add a chart, a callout or a follow-up because the last answer had',
  '  one. Vary your wording between turns — a seller reading four answers should not be',
  '  able to see the template behind them, because there is not one.',
].join('\n');
