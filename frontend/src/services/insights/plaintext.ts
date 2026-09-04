/**
 * The wire a tool result travels over.
 *
 * A tool answers the model in **plain text**, not JSON. That is a deliberate
 * reversal of the usual instinct, and it is worth saying why: JSON spends most
 * of its tokens on punctuation and repeated key names, and a model reading
 * `{"productId":4471,"revenue":38400000,"units":312}` twelve times over pays
 * for `"revenue":` twelve times. The same twelve rows as a header line and
 * twelve pipe-separated lines cost roughly a third of that, and — the part that
 * matters more — read the way a table reads, which is what the model is being
 * asked to reason about.
 *
 * Compact is not the same as lossy. Every result carries its own context: what
 * was asked, which window and shops it covers, where the rows came from, what
 * the units are, and — the piece nothing else can supply — **the refs it
 * defined**. A figure the model cannot name by ref is a figure it cannot show,
 * so a result that lists rows without naming their refs would be data the
 * answer cannot use.
 *
 * ## The shape
 *
 *     [tool.id] archive · 2026-08-01..2026-08-31 · shops 1,2
 *     money=so'm, plain integers
 *     cols: ref | name | units | revenue | profit
 *     p.4471 | Abaya klassik | 312 | 38400000 | 9100000
 *     p.5512 | Ko'ylak yozgi | 210 | 12000000 | -300000
 *     refs: <row ref>.units .revenue .profit
 *
 * One header, one units line, a table, and a citation footer. Nothing about it
 * needs a parser on the other side, which is the point — the reader is a
 * language model, and the format it reads best is the one a person would.
 */

/** `2026-08-01`, always UTC — the clock the archive indexes on. */
export function isoDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** `2026-08-01 14:20` UTC, for rows where the hour carries meaning. */
export function isoMinute(at: number): string {
  return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * A day the model named, as an instant.
 *
 * Whole days in UTC, both ends included: `to` resolves to the last millisecond
 * of that day rather than its midnight, because a seller asking for
 * `2026-08-01..2026-08-31` means the whole of the 31st and would otherwise
 * silently lose it.
 */
export function parseDay(value: unknown, edge: 'start' | 'end' = 'start'): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const day = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const at = Date.parse(day ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (Number.isNaN(at)) return null;

  return day && edge === 'end' ? at + 86_399_999 : at;
}

/** An integer, unpunctuated. The model never prints these — it cites refs. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value));
}

/** One decimal, for rates and shares. */
export function dec(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(digits);
}

/**
 * A cell that cannot break the pipe-separated table it sits in.
 *
 * A product called "Abaya | XL" would otherwise read as an extra column, and
 * the model would take the shifted values as facts. Runs of whitespace collapse
 * on the way through, which also saves the tokens a padded name would cost.
 */
export function cell(value: string): string {
  return value.replace(/[|\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * The header of a result.
 *
 * Falsy parts are dropped rather than printed empty, so a tool that has nothing
 * to say about, for instance, freshness simply says less.
 */
export function header(id: string, parts: readonly (string | false | null | undefined)[]): string {
  const kept = parts.filter((part): part is string => typeof part === 'string' && part !== '');
  return kept.length === 0 ? `[${id}]` : `[${id}] ${kept.join(' · ')}`;
}

/** `2026-08-01..2026-08-31`, the way every header states its window. */
export function windowLabel(fromMs: number, toMs: number): string {
  return `${isoDay(fromMs)}..${isoDay(toMs)}`;
}

/** A pipe-separated table with a declared column line. */
export function table(
  columns: readonly string[],
  rows: ReadonlyArray<readonly (string | number)[]>,
): string {
  const lines = [`cols: ${columns.join(' | ')}`];
  for (const row of rows) {
    lines.push(row.map((value) => (typeof value === 'number' ? num(value) : cell(value))).join(' | '));
  }
  return lines.join('\n');
}

/** `a=1 b=2` — for the handful of figures that do not want a table. */
export function pairs(entries: ReadonlyArray<readonly [string, string | number]>): string {
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'number' ? num(value) : cell(value)}`)
    .join(' ');
}

/** Joins the parts of a result, dropping the ones that had nothing in them. */
export function compose(parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join('\n');
}
