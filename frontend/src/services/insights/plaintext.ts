/**
 * The wire a tool result travels over.
 *
 * A tool answers the model in **plain text**, not JSON. That is a deliberate
 * reversal of the usual instinct, and it is worth saying why: JSON spends most
 * of its tokens on punctuation and repeated key names, and a model reading
 * `{"productId":4471,"revenue":38400000,"units":312}` three hundred times over
 * pays for `"revenue":` three hundred times. The same rows as one header line
 * and pipe-separated values cost roughly a third of that — and read the way a
 * spreadsheet reads, which is what the model is being asked to reason over.
 *
 * Compact is not the same as lossy. Every result carries its own context: what
 * was asked, which window and shops it covers, where the rows came from and what
 * the units are. What it no longer carries is a citation footer — the model is
 * handed the data itself, computes from it, and writes the result into the
 * answer.
 *
 * ## The shape
 *
 *     [products.rank] 2026-08-01..2026-08-31 · shops 1,2 · by units
 *     money so'm, whole numbers · pct = percent
 *     productId|name|units|revenue|sellerProfit
 *     4471|Abaya klassik|312|38400000|9100000
 *     5512|Ko'ylak yozgi|210|12000000|-300000
 *
 * A header, a units line, and a table whose first row names its columns. No
 * padding around the pipes: a space either side of every separator is two tokens
 * a row that tell the reader nothing.
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

/**
 * An integer, unpunctuated.
 *
 * Grouped thousands are for the seller, not the model: `38 400 000` costs more
 * tokens and reads as three numbers. The model groups them itself when it
 * writes a figure into a sentence, and the renderer groups what it writes into
 * a block.
 */
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
 * the model would take the shifted values as the next column's. Runs of
 * whitespace collapse on the way through, which also saves the tokens a padded
 * name would cost.
 */
export function cell(value: string): string {
  return value.replace(/[|\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** A name, cut to a length that identifies it without paying for all of it. */
export function clip(value: string, max = 60): string {
  const clean = cell(value);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
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

/** A value for a table cell: integers bare, other numbers to two decimals. */
function cellValue(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'string') return cell(value);
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * A pipe-separated table whose first line names the columns.
 *
 * CSV in all but the separator: a comma is common inside a product name and a
 * pipe is not, so the pipe needs no quoting rules for the model to get wrong.
 * `null` is an empty cell — a value the row does not have, which is different
 * from a zero it does.
 */
export function table(
  columns: readonly string[],
  rows: ReadonlyArray<readonly (string | number | null)[]>,
): string {
  const lines = [columns.join('|')];
  for (const row of rows) lines.push(row.map(cellValue).join('|'));
  return lines.join('\n');
}

/** `a=1 b=2` — for the handful of figures that do not want a table. */
export function pairs(entries: ReadonlyArray<readonly [string, string | number]>): string {
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'number' ? cellValue(value) : cell(value)}`)
    .join(' ');
}

/** Joins the parts of a result, dropping the ones that had nothing in them. */
export function compose(parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join('\n');
}
