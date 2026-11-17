import { clip, isoMinute, table } from '@core/tools/plaintext';

/**
 * Curated columns over rows a lookup recognised: named cells, values as received.
 *
 * The shape-agnostic renderer (`render.ts`) can print any JSON, but it has to
 * summarise a nested object as a shape (`{text,color,value}`), and for a
 * response whose shape is known that hides the very field a question is about
 * (an invoice's status code sits inside such an object). So a lookup that
 * recognises its response names the columns it wants here, by the API's own
 * dot path.
 *
 * Every cell is read from the row **as the response held it**, never from a
 * typed view: a value of a type the recorded sample did not show (a price that
 * arrives as the string "120000") is printed as it came, so the model never
 * reads "the API gave no price" where the API gave one in an unexpected type.
 * What is left empty is therefore only `null` or an absent key. A number is
 * printed as JSON held it (`plaintext.table` would round a fraction to two
 * decimals), and `null` is never a zero.
 *
 * Nothing here adds up a column. A timestamp may additionally be printed as UTC
 * text in a `.utc` column; the epoch value stays beside it.
 */

/** The default width of a cell; a column that holds a title or an address asks for more. */
export const CELL = 30;

export type Raw = Record<string, unknown>;

export const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a value too big for a cell is replaced by: its kind and size, never its content. */
function shape(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (isRaw(value)) {
    const keys = Object.keys(value);
    return `{${keys.slice(0, 3).join(',')}${keys.length > 3 ? `,+${keys.length - 3}` : ''}}`;
  }
  return '';
}

/** A scalar as the response held it, whatever its type; `null` and absent are the empty cell. */
export function show(value: unknown, max: number): string {
  if (value === null || value === undefined) return '';
  switch (typeof value) {
    case 'string':
      return clip(value, max);
    case 'number':
      return Number.isFinite(value) ? String(value) : clip(String(value), max);
    case 'boolean':
      return String(value);
    case 'bigint':
      return String(value);
    default:
      return shape(value);
  }
}

/** Walks a dot path; a step through something that is not an object says what was there instead. */
export function at(row: Raw, path: string, max = CELL): string {
  let current: unknown = row;
  const seen: string[] = [];
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return '';
    if (!isRaw(current)) return `(${seen.join('.')}: ${show(current, 20) || shape(current)})`;
    seen.push(key);
    current = current[key];
  }
  return show(current, max);
}

/** The value at a dot path as UTC text, when it is a number that makes a date; otherwise the empty cell. */
export function utcAt(row: Raw, path: string): string {
  let current: unknown = row;
  for (const key of path.split('.')) {
    if (!isRaw(current)) return '';
    current = current[key];
  }
  if (typeof current !== 'number' || !Number.isFinite(current)) return '';
  return Number.isNaN(new Date(current).getTime()) ? '' : isoMinute(current);
}

export interface Column {
  readonly name: string;
  readonly get: (row: Raw) => string;
}

/** A column named after the dot path it prints. */
export const field = (path: string, max = CELL): Column => ({ name: path, get: (row) => at(row, path, max) });

/** The `.utc` companion of an epoch-millisecond column. */
export const utcField = (path: string): Column => ({ name: `${path}.utc`, get: (row) => utcAt(row, path) });

/** How many entries an array at `path` holds, as a column named `<path>.length`; empty when it is not an array. */
export const lengthField = (path: string): Column => ({
  name: `${path}.length`,
  get: (row) => {
    let current: unknown = row;
    for (const key of path.split('.')) {
      if (!isRaw(current)) return '';
      current = current[key];
    }
    return Array.isArray(current) ? String(current.length) : '';
  },
});

/** Rows that fit `budget` characters; the first always goes in. */
function fit(lines: readonly (readonly string[])[], used: number, budget: number): readonly (readonly string[])[] {
  const kept: (readonly string[])[] = [];
  let total = used;
  for (const line of lines) {
    const cost = line.join('|').length + 1;
    if (kept.length > 0 && total + cost > budget) break;
    kept.push(line);
    total += cost;
  }
  return kept;
}

/**
 * A pipe-separated table of `columns` over `rows`, cut to `budget` characters.
 *
 * `lead` puts cells in front of every row that do not come from the row itself
 * (the shop that was asked, a parent's id), under `leadNames`.
 */
export function printTable(
  columns: readonly Column[],
  rows: readonly Raw[],
  lead: (index: number) => string[],
  leadNames: readonly string[],
  budget: number,
): { readonly text: string; readonly shown: number } {
  const names = [...leadNames, ...columns.map((column) => column.name)];
  const lines = rows.map((row, index) => [...lead(index), ...columns.map((column) => column.get(row))]);
  const kept = fit(lines, names.join('|').length + 1, budget);
  /* Strings only: `table` would round a number, and the values are already exact. */
  return { text: table(names, kept), shown: kept.length };
}
