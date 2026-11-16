import { cell, compose, pairs, table } from '@core/tools/plaintext';

/**
 * Any JSON the cabinet returns, as the plain text the model reads.
 *
 * The extension's tools read a live API whose response bodies are not
 * documented, and a renderer written for one guessed shape would quietly drop
 * every field it did not guess. So this one assumes nothing about names or
 * envelopes. It looks for lists of objects wherever they sit (the payload
 * itself, or a property of it, down a few levels) and prints each as a
 * pipe-separated table whose columns are the API's own field names; it prints
 * top-level scalars as `key=value` pairs; and anything nested deeper than a cell
 * can hold becomes a short shape (`{id,title,+3}`, `[12 objects]`) instead of a
 * dump. The next cabinet tool reuses it as is, and the day a real response is
 * known a tool can wrap it with a specialised renderer without touching this one.
 *
 * ## Bounded, and honest about it
 *
 * Every dimension has a ceiling: rows per table, columns, characters per cell,
 * pairs, tables, and a total character budget. Whenever a ceiling cuts something
 * the result says what was cut, and `truncated` is true — the same `TRUNCATED`
 * the site's lookups put in their headers, so the model never mistakes a clipped
 * list for the whole one. It never throws: an empty list, a scalar, `null`,
 * thousands of columns or a structure nested a hundred deep all produce a
 * truthful, bounded text.
 *
 * Numbers are printed exactly as JSON held them. `plaintext.table` would round a
 * fraction to two decimals, which is a decision about precision this renderer has
 * no basis for while units and scales are unknown.
 */

export interface RenderLimits {
  /** Rows printed per table. */
  readonly maxRows: number;
  /** Payload columns per table. */
  readonly maxColumns: number;
  /** Characters per cell or pair value. */
  readonly maxCell: number;
  /** Roughly the whole text; a first row is always printed even when it alone exceeds this. */
  readonly maxChars: number;
  /** `key=value` pairs from the payload's scalars. */
  readonly maxPairs: number;
  /** Tables printed; further lists are named and counted. */
  readonly maxTables: number;
  /** Object levels searched for lists and scalars. */
  readonly maxDepth: number;
  /** Values shown from a list of scalars. */
  readonly maxListItems: number;
  /** Summary lines for nested objects and non-table arrays. */
  readonly maxSummaries: number;
}

export const DEFAULT_RENDER_LIMITS: RenderLimits = {
  maxRows: 100,
  maxColumns: 16,
  maxCell: 80,
  maxChars: 12_000,
  maxPairs: 40,
  maxTables: 4,
  maxDepth: 3,
  maxListItems: 8,
  maxSummaries: 20,
};

export interface RenderOptions {
  readonly limits?: Partial<RenderLimits>;
  /**
   * A column put first on the largest table, with the same value on every row.
   * For the shop that was asked: it comes from the caller, never from the
   * payload, so it is printed apart from whatever the rows say about themselves.
   */
  readonly rowTag?: { readonly column: string; readonly value: string | number };
}

export interface Rendered {
  /** The data: pairs, tables and shape summaries. No header — the tool writes that. */
  readonly text: string;
  /** True when anything was cut or clipped; `cuts` says what. */
  readonly truncated: boolean;
  readonly cuts: readonly string[];
  /**
   * The largest list of objects found: how many items the payload held and how
   * many are printed. Null when the payload held none — the caller cannot then
   * tell whether a page was full.
   */
  readonly primary: {
    /** Where it was found: '' for the payload itself, otherwise the property path. */
    readonly path: string;
    readonly count: number;
    readonly shown: number;
  } | null;
}

/* ── small readers ──────────────────────────────────────────────────────── */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Everything that is not an object or an array, `null` and `undefined` included. */
const isScalar = (value: unknown): boolean => typeof value !== 'object' || value === null;

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/** How many items of a long array are looked at to decide what kind of array it is. */
const SAMPLE = 50;
/** How many rows are scanned for column names. */
const COLUMN_SCAN_ROWS = 500;

class Cuts {
  readonly notes: string[] = [];
  clipped = false;

  note(text: string): void {
    if (!this.notes.includes(text)) this.notes.push(text);
  }
}

function clipText(raw: string, max: number, cuts: Cuts): string {
  /* A megabyte string must not be whitespace-collapsed whole just to keep eighty
     characters of it. */
  const bounded = raw.length > max * 4 ? raw.slice(0, max * 4) : raw;
  const clean = cell(bounded);
  if (clean.length <= max && bounded.length === raw.length) return clean;
  cuts.clipped = true;
  return `${clean.slice(0, max - 1)}…`;
}

function scalarText(value: unknown, max: number, cuts: Cuts): string {
  switch (typeof value) {
    case 'string':
      return clipText(value, max, cuts);
    case 'number':
      return Number.isFinite(value) ? String(value) : '';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return String(value);
    default:
      return '';
  }
}

/** A key as it appears in a header, a pair or a shape — never able to break the line it is on. */
function keyText(key: string, cuts: Cuts, max = 40): string {
  return clipText(key, max, cuts) || '(empty)';
}

/** A pair's key also may not hold the separators `pairs()` reads by. */
const pairKey = (key: string, cuts: Cuts): string => keyText(key, cuts).replace(/[\s=]+/g, '_');

/** What a value too big for a cell is replaced by: its kind and a few key names, never its content. */
function shapeOf(value: unknown, cuts: Cuts): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const sample = value.slice(0, SAMPLE);
    if (value.length <= 5 && sample.every(isScalar)) {
      return `[${sample.map((item) => scalarText(item, 20, cuts)).join(',')}]`;
    }
    return sample.every(isRecord) ? `[${value.length} objects]` : `[${value.length} items]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const shown = keys.slice(0, 4).map((key) => keyText(key, cuts, 24)).join(',');
    return `{${shown}${keys.length > 4 ? `,+${keys.length - 4}` : ''}}`;
  }
  return '';
}

function cellOf(value: unknown, limits: RenderLimits, cuts: Cuts): string {
  return isScalar(value) ? scalarText(value, limits.maxCell, cuts) : shapeOf(value, cuts);
}

/* ── finding the structure ──────────────────────────────────────────────── */

interface Found {
  readonly path: string;
  readonly rows: readonly Record<string, unknown>[];
  /** Items in the array, objects or not — what a page-fullness check must count. */
  readonly count: number;
}

interface Walk {
  readonly pairs: Array<readonly [string, string]>;
  readonly lists: Found[];
  readonly summaries: string[];
  /** Fields not recorded because a cap was already reached. */
  omitted: number;
}

const labelOf = (path: string): string => (path === '' ? 'list' : path);

function collectArray(path: string, items: readonly unknown[], walk: Walk, limits: RenderLimits, cuts: Cuts): void {
  const sample = items.slice(0, SAMPLE);

  if (items.length === 0) {
    walk.lists.push({ path, rows: [], count: 0 });
    return;
  }

  if (sample.some(isRecord)) {
    const rows = items.filter(isRecord);
    const skipped = items.length - rows.length;
    if (skipped > 0) cuts.note(`${labelOf(path)}: ${skipped} items that are not objects were skipped`);
    walk.lists.push({ path, rows, count: items.length });
    return;
  }

  if (sample.every(isScalar)) {
    const shown = items.slice(0, limits.maxListItems).map((item) => scalarText(item, 30, cuts));
    if (items.length > shown.length) {
      cuts.note(`${labelOf(path)}: ${shown.length} of ${items.length} values shown`);
    }
    addSummary(walk, `${labelOf(path)}: [${items.length} values] ${shown.join(', ')}`, limits);
    return;
  }

  addSummary(walk, `${labelOf(path)}: ${shapeOf(items, cuts)}`, limits);
}

function addSummary(walk: Walk, line: string, limits: RenderLimits): void {
  if (walk.summaries.length < limits.maxSummaries) walk.summaries.push(line);
  else walk.omitted += 1;
}

function walkRecord(
  record: Record<string, unknown>,
  path: string,
  depth: number,
  walk: Walk,
  limits: RenderLimits,
  cuts: Cuts,
): void {
  for (const key of Object.keys(record)) {
    const child = record[key];
    const childPath = path === '' ? pairKey(key, cuts) : `${path}.${pairKey(key, cuts)}`;

    if (isScalar(child)) {
      if (walk.pairs.length < limits.maxPairs) {
        walk.pairs.push([childPath, scalarText(child, limits.maxCell, cuts)]);
      } else {
        walk.omitted += 1;
      }
    } else if (Array.isArray(child)) {
      collectArray(childPath, child, walk, limits, cuts);
    } else if (isRecord(child)) {
      if (depth + 1 < limits.maxDepth) walkRecord(child, childPath, depth + 1, walk, limits, cuts);
      else addSummary(walk, `${childPath}: ${shapeOf(child, cuts)}`, limits);
    }
  }
}

/* ── printing ───────────────────────────────────────────────────────────── */

/** Union of keys, in order of first appearance — the API's order, not an alphabetical one. */
function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows.slice(0, COLUMN_SCAN_ROWS)) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

function printTable(
  found: Found,
  limits: RenderLimits,
  remaining: number,
  tag: RenderOptions['rowTag'],
  cuts: Cuts,
): { readonly text: string; readonly shown: number } {
  const label = labelOf(found.path);
  if (found.rows.length === 0) return { text: `${label} — 0 rows`, shown: 0 };

  const keys = columnsOf(found.rows);
  const kept = keys.slice(0, limits.maxColumns);
  if (keys.length > kept.length) {
    const dropped = keys.slice(kept.length, kept.length + 8).map((key) => keyText(key, cuts, 24));
    cuts.note(
      `${label}: ${kept.length} of ${keys.length} columns shown (not shown: ${dropped.join(',')}${keys.length - kept.length > 8 ? ',…' : ''})`,
    );
  }

  const columns = [
    ...(tag === undefined ? [] : [keyText(tag.column, cuts)]),
    ...kept.map((key) => keyText(key, cuts)),
  ];
  const tagCell = tag === undefined ? [] : [String(tag.value)];

  const lines: string[][] = [];
  let used = columns.join('|').length + 1;
  for (const row of found.rows.slice(0, limits.maxRows)) {
    const cells = [
      ...tagCell,
      ...kept.map((key) => (hasOwn(row, key) ? cellOf(row[key], limits, cuts) : '')),
    ];
    const cost = cells.join('|').length + 1;
    /* The first row always goes in: a result with a header and no rows at all is
       worse than one slightly over budget. */
    if (lines.length > 0 && used + cost > remaining) break;
    lines.push(cells);
    used += cost;
  }

  const total = found.rows.length;
  if (lines.length < total) cuts.note(`${label}: ${lines.length} of ${total} rows shown`);

  return {
    text: compose([
      lines.length < total ? `${label} — ${lines.length} of ${total} rows shown` : `${label} — ${total} rows`,
      table(columns, lines),
    ]),
    shown: lines.length,
  };
}

function unreadable(): Rendered {
  return {
    text: 'the response could not be rendered',
    truncated: true,
    cuts: ['the response could not be rendered'],
    primary: null,
  };
}

/** The text for a payload that is not an object or an array. */
function scalarPayload(value: unknown, limits: RenderLimits, cuts: Cuts): string {
  if (value === undefined || value === null) return 'the response body is empty (null)';
  /* A string body is often an error page; it may be longer than a cell. */
  return `value: ${scalarText(value, limits.maxCell * 4, cuts)}`;
}

export function renderPayload(data: unknown, options: RenderOptions = {}): Rendered {
  try {
    const limits: RenderLimits = { ...DEFAULT_RENDER_LIMITS, ...options.limits };
    const cuts = new Cuts();

    if (isScalar(data)) {
      const text = scalarPayload(data, limits, cuts);
      return finish(text, cuts, null, limits);
    }

    const walk: Walk = { pairs: [], lists: [], summaries: [], omitted: 0 };
    if (Array.isArray(data)) collectArray('', data, walk, limits, cuts);
    else if (isRecord(data)) walkRecord(data, '', 0, walk, limits, cuts);

    /* Pairs and summaries are bounded by count and take at most half the budget
       between them; the tables get the rest. */
    const fields = fieldsLine(walk.pairs, Math.floor(limits.maxChars * 0.3), cuts);
    const summaries = takeLines(walk.summaries, Math.floor(limits.maxChars * 0.2), cuts, 'summary lines');
    if (walk.omitted > 0) cuts.note(`${walk.omitted} more fields or summaries were not listed`);

    /* The primary table is the largest list: the one whose fullness a page check
       reads, and the one rows are tagged on. */
    const primary = walk.lists.reduce<Found | null>(
      (best, entry) => (best === null || entry.count > best.count ? entry : best),
      null,
    );

    const tables: string[] = [];
    let remaining = limits.maxChars - fields.length - summaries.join('\n').length;
    let primaryShown = 0;
    walk.lists.forEach((found, index) => {
      if (index >= limits.maxTables) {
        cuts.note(`${labelOf(found.path)}: a list of ${found.count} was not printed (only ${limits.maxTables} tables are)`);
        return;
      }
      const printed = printTable(found, limits, remaining, found === primary ? options.rowTag : undefined, cuts);
      remaining -= printed.text.length;
      tables.push(printed.text);
      if (found === primary) primaryShown = printed.shown;
    });

    const empty =
      fields === '' && tables.length === 0 && summaries.length === 0
        ? Array.isArray(data)
          ? 'the response holds no rows'
          : 'the response holds no fields'
        : '';

    return finish(
      compose([fields, ...tables, ...summaries, empty]),
      cuts,
      primary === null ? null : { path: primary.path, count: primary.count, shown: primaryShown },
      limits,
    );
  } catch {
    /* A getter that throws, or a structure the engine itself refuses: say so
       rather than fail the answer. */
    return unreadable();
  }
}

function finish(text: string, cuts: Cuts, primary: Rendered['primary'], limits: RenderLimits): Rendered {
  if (cuts.clipped) cuts.note(`values longer than ${limits.maxCell} characters were clipped`);
  return { text, truncated: cuts.notes.length > 0, cuts: cuts.notes, primary };
}

function fieldsLine(entries: ReadonlyArray<readonly [string, string]>, budget: number, cuts: Cuts): string {
  if (entries.length === 0) return '';
  const kept: Array<readonly [string, string]> = [];
  let used = 'fields: '.length;
  for (const entry of entries) {
    const cost = entry[0].length + entry[1].length + 2;
    if (kept.length > 0 && used + cost > budget) break;
    kept.push(entry);
    used += cost;
  }
  if (kept.length < entries.length) cuts.note(`fields: ${kept.length} of ${entries.length} shown`);
  return `fields: ${pairs(kept)}`;
}

function takeLines(lines: readonly string[], budget: number, cuts: Cuts, what: string): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (kept.length > 0 && used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  if (kept.length < lines.length) cuts.note(`${kept.length} of ${lines.length} ${what} shown`);
  return kept;
}
