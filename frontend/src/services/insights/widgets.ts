import { WIDGET_LIMITS as L } from './blocks';

/**
 * The widget guide, handed over on request.
 *
 * Everything the chat can draw is a block kind in `blocks.ts` and a `switch`
 * arm in `BlockRenderer`. What changed is *when the model learns about them*.
 *
 * The instructions used to be pasted into every prompt, which had two costs.
 * The obvious one is tokens: the vocabulary, the chart rules and the number
 * rules are a page, and they were re-sent on every turn of every thread whether
 * the answer needed a chart or not. The one that matters more is that a model
 * shown a catalogue of shapes on every turn *uses* the catalogue — it reaches
 * for the waterfall because the waterfall was described, and every answer comes
 * out with the same furniture: a sentence, a metric, a chart, a callout.
 *
 * So the guide is a capability the model asks for once per thread. Once opened
 * it stays in front of the model for the rest of the thread — `agent.ts` carries
 * it into the system prompt of every later question, because a follow-up is
 * sent with a summary of the conversation rather than the conversation itself,
 * and a guide the model was told it holds but cannot see is worse than none.
 *
 * ## Values, not references
 *
 * Every figure in a widget is the value itself. The model reads rows, computes
 * what the question needs, and writes the result with a `format` that tells the
 * renderer how to print it. The limits below are the schema's own numbers, read
 * from `WIDGET_LIMITS`, so the guide cannot promise a length the parser refuses.
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
  'One JSON object per line, in the order they should appear. A line that is not one of these',
  'is not shown. A newline INSIDE a JSON string must be written as \\n — a real line break ends',
  'the object half-way and the whole line is lost. Markdown lists and tables inside a text block',
  'are the usual way this happens: write "- a\\n- b", never two physical lines.',
  '',
  'FIGURES',
  '  Wherever a widget shows a number you write the number itself, unformatted, and say what',
  '  kind it is with "format":',
  '    "money"    so\'m, a plain number: 457924      → drawn "457 924 so\'m"',
  '    "percent"  the percentage itself: 9.2         → drawn "9.2%"  (not 0.092)',
  '    "count"    orders, units, SKUs: 312           → drawn "312"',
  '    "number"   anything else numeric: 2.35',
  '  Do not group thousands, add a currency or a % sign inside "value" — the renderer does that',
  '  in the seller\'s own number format. A value that is not a number ("3 / 5", a date) is a',
  '  string and is drawn exactly as written.',
  '',
  'THE WIDGETS',
  '  {"kind":"text","text":"…","tone"?:"positive|negative|warning|neutral|accent"}',
  `      A paragraph in MARKDOWN, up to ${L.text} characters: **bold**, *italic*, "- " bullets,`,
  '      "1. " lists, "## " headings, "> " quotes and | pipe | tables |. This is where the',
  '      answer is told. Figures inside a sentence are yours to spell for a reader: group the',
  '      thousands and name the unit — "Sof foyda **457 924 so\'m**, tushumning 9.2 %i."',
  '  {"kind":"metric","label"?:"…","value":457924,"format":"money","change"?:12.4,"emphasis"?:true}',
  '      One figure alone. change is the signed percent change against what you compared it',
  '      with, drawn "+12.4%" in green or red. emphasis draws it at heading size — for the',
  '      headline of an answer, not for every figure in it.',
  `  {"kind":"kv","rows":[{"label":"…","value":…,"format"?:"…","tone"?:"…"}]}`,
  `      Up to ${L.kvRows} label/value lines with a dotted leader. The evidence list.`,
  '  {"kind":"steps","items":[{"text":"…","value"?:…,"format"?:"…"}]}',
  `      Up to ${L.steps} lines with a ↳ gutter, each text up to ${L.step} characters. A derivation read`,
  '      top to bottom: the figures you started from, what you did to them, what came out.',
  '      Use it whenever the answer rests on a number you calculated.',
  '  {"kind":"table","columns":["…"],"rows":[["…",12,457924]],"formats"?:["text","count","money"]}',
  `      Up to ${L.tableColumns} columns and ${L.tableRows} rows. A cell is text or a number; formats gives`,
  '      one format per column so a column of money is printed as money.',
  `  {"kind":"badges","items":[{"text":"…","tone"?:"…"}]}   up to ${L.badges} pills.`,
  '  {"kind":"chart","chart":"waterfall|bar|donut","title"?:"…","format"?:"money",',
  `                  "items":[{"label":"…","value":…,"tone"?:"…"}]}   2–${L.chartItems} items.`,
  '  {"kind":"chart","chart":"line","title"?:"…","format"?:"count",',
  '                  "labels":["09-07","09-08",…],"series":[{"name":"…","values":[12,9,…]}]}',
  `      2–${L.lineLabels} labels, 1–${L.lineSeries} series, and every series has exactly one value per label.`,
  '  {"kind":"callout","tone":"…","title":"…","blocks":[ … ]}',
  `      A bordered aside — the thing to do about what you just showed. Up to ${L.calloutBlocks} blocks,`,
  '      nested one level.',
  '  {"kind":"action","actionId":"…","params":{…},"note"?:"…"}',
  '      A button from the action registry in the toolkit, with the parameters it lists; a button',
  '      whose params the registry refuses is not drawn and you are told why.',
  '      {"kind":"action","actionId":"copilot.ask","params":{"question":"…"}} becomes a suggested',
  '      follow-up chip under the answer — at most two, and only when there is a real next question.',
  `  Every label, title, table cell and note is plain text up to ${L.label} characters (cells ${L.cell}).`,
  '  A line past a limit is refused whole — shorten a long product name rather than lose the row.',
  '',
  'NUMBERS — where they come from.',
  '  Every figure you show is either copied from a lookup result or calculated by you from',
  '  figures in results. Calculating is expected — totals, differences, shares, averages, growth',
  '  from one period to the next. Do it carefully, prefer a lookup that already computed it, and',
  '  when a headline figure is your own calculation show how you got it (a steps widget, or one',
  '  clause in the sentence). Round only for display, and keep money whole.',
  '  Never invent a row, a period or a figure no result supports. If what you need is not in a',
  '  result, ask for it, or say plainly that it is not available. No forecasts.',
  '',
  'CHARTS — four shapes, and the question picks one.',
  '  waterfall  a running balance being eaten. It must ARRIVE: the first item is the opening',
  '             total, the last is the closing total, and the items between are the deductions',
  '             written as positive amounts (a negative one puts money back). Check that the',
  '             opening total minus every deduction equals the closing total before you send it —',
  '             revenue to net profit needs sellerAdjustment among them, as window.totals says.',
  '  donut      shares of one whole. Every slice is a part, none negative; never the total.',
  '  bar        independent quantities side by side — products, weekdays, sources.',
  '  line       a trend over buckets — a day-by-day or week-by-week series, one line per measure',
  '             or per product. sales.timeline returns exactly these columns.',
  '  A chart that repeats what the sentence already said is noise. Draw one when the',
  '  shape is the finding.',
  '',
  'SHAPE — there is no house layout, and you should not invent one.',
  '  Answer in the form the question wants. "Did I make money in August" is a sentence and a',
  '  metric. "How did the last seven days go" is the finding and a line. "Why did margin fall" is',
  '  a derivation. "Which SKUs are empty" is a table. "What should I do about it" is the finding,',
  '  the evidence, and one button. Two blocks is a complete answer when two blocks say it.',
  '  Do not open every reply the same way. Do not restate at the end what you just showed. Do',
  '  not add a chart, a callout or a follow-up because the last answer had one. Vary your wording',
  '  between turns — a seller reading four answers should not be able to see the template behind',
  '  them, because there is not one.',
].join('\n');
