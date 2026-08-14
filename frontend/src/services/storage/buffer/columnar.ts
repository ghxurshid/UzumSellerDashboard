/**
 * A columnar packer for arrays of uniform objects.
 *
 * The buffer holds whole API payloads, and the measurement that motivated this
 * is blunt: of the 488 KB a real catalogue takes as projected JSON, roughly
 * 300 KB is **key names repeated once per row**. 766 SKUs × 23 keys is 17 618
 * copies of strings like `"quantityAvailable"` — for values that are mostly a
 * single digit.
 *
 * So rows are stored the way a database stores them, not the way JSON does:
 *
 *   • the key names appear **once**, as a header;
 *   • each row is an array of values, positional against that header;
 *   • repeated strings and repeated sub-objects (`status`, `rankInfo` — a
 *     handful of distinct values across thousands of rows) are **interned** and
 *     stored as an index.
 *
 * Columns are typed at pack time so nothing is ambiguous on the way back: a
 * numeric column stores real numbers, an interned column stores integer indices,
 * and the two never have to be told apart by inspection.
 *
 * The contract that matters: `unpack(pack(rows))` is deeply equal to `rows` for
 * any array of JSON-safe objects. Nothing in the application above this module
 * knows the buffer is packed — the query layer hands out the same shapes the
 * API returned.
 */

/** How a column's values are stored. */
const enum Kind {
  /** Numbers and booleans, written as themselves. */
  Raw = 0,
  /** Strings and sub-objects, written as an index into the value table. */
  Interned = 1,
}

export interface PackedTable {
  /** Column names, in row order. */
  readonly k: readonly string[];
  /** Per-column storage kind. */
  readonly t: readonly Kind[];
  /** Interned values: strings verbatim, everything else as JSON. */
  readonly v: readonly string[];
  /** Whether each interned entry needs `JSON.parse` on the way out. */
  readonly j: readonly number[];
  /** Rows, positional against `k`. */
  readonly d: readonly (readonly (number | boolean | null)[])[];
}

export const EMPTY_TABLE: PackedTable = { k: [], t: [], v: [], j: [], d: [] };

/** Objects only — see `pack`, which drops anything else. */
function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pack rows into a table.
 *
 * The column set is the union of every row's own keys, so a payload where some
 * rows omit a field round-trips with that field genuinely absent rather than
 * present-and-null. Absence is recorded per row.
 *
 * Entries that are not objects are **dropped**. A table has columns, and a bare
 * string has none: keeping one would mean tagging every row with its own kind,
 * for a case the seller API never produces. Dropping is also the safe failure —
 * the alternative, letting `Object.keys('abc')` contribute the columns `0`,
 * `1`, `2`, corrupts the shape of every other row in the payload.
 */
export function pack(rows: readonly Record<string, unknown>[]): PackedTable {
  const sound = rows.filter(isRow);
  if (sound.length === 0) return EMPTY_TABLE;

  /* Column order follows first appearance, which keeps a packed table readable
     in the debugger and stable across runs of the same payload shape. */
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of sound) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }

  /* A column is raw only if every value in it is a number, a boolean or null.
     One string anywhere in the column makes the whole column interned — mixing
     the two would need a per-cell tag, which costs more than it saves. */
  const kinds = columns.map((key): Kind => {
    for (const row of sound) {
      const value = row[key];
      if (value === null || value === undefined) continue;
      if (typeof value === 'number' || typeof value === 'boolean') continue;
      return Kind.Interned;
    }
    return Kind.Raw;
  });

  const values: string[] = [];
  const isJson: number[] = [];
  const index = new Map<string, number>();

  /** Intern a value, returning its position. Absence is −1 and stores nothing. */
  function intern(value: unknown): number {
    if (value === null || value === undefined) return -1;

    const json = typeof value === 'string';
    const encoded = json ? (value as string) : JSON.stringify(value);
    if (encoded === undefined) return -1;

    /* Strings and JSON share one table, so the key is prefixed to keep the
       string "5" apart from the number-shaped JSON `5`. */
    const cacheKey = json ? `s${encoded}` : `j${encoded}`;
    const existing = index.get(cacheKey);
    if (existing !== undefined) return existing;

    const position = values.length;
    values.push(encoded);
    isJson.push(json ? 0 : 1);
    index.set(cacheKey, position);
    return position;
  }

  const data = sound.map((row) =>
    columns.map((key, column): number | boolean | null => {
      const value = row[key];
      if (value === undefined) return null;

      if (kinds[column] === Kind.Raw) {
        return value as number | boolean | null;
      }
      return intern(value);
    }),
  );

  return { k: columns, t: kinds, v: values, j: isJson, d: data };
}

/** Rebuild the original rows. */
export function unpack<T>(table: PackedTable): T[] {
  if (table.d.length === 0) return [];

  /* Decoded once per distinct value rather than once per cell: a status object
     shared by four thousand rows is parsed once. */
  const decoded = table.v.map((raw, position) => {
    if (table.j[position] !== 1) return raw;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  });

  return table.d.map((row) => {
    const object: Record<string, unknown> = {};

    for (let column = 0; column < table.k.length; column += 1) {
      const key = table.k[column];
      if (key === undefined) continue;

      const cell = row[column];

      if (table.t[column] === Kind.Raw) {
        object[key] = cell ?? null;
        continue;
      }

      /* −1 is absence. Restoring it as `null` matches how the API sends every
         optional field, and how the wire types declare them. */
      object[key] = typeof cell === 'number' && cell >= 0 ? decoded[cell] : null;
    }

    return object as T;
  });
}

/**
 * Whether a stored blob still looks like a table this build can read.
 *
 * Positional storage is unforgiving: a table whose header is missing would be
 * read as a table of empty rows rather than failing, so the shape is checked
 * before anything is trusted.
 */
export function isTable(value: unknown): value is PackedTable {
  if (typeof value !== 'object' || value === null) return false;
  const table = value as Record<string, unknown>;

  return (
    Array.isArray(table['k']) &&
    Array.isArray(table['t']) &&
    Array.isArray(table['v']) &&
    Array.isArray(table['j']) &&
    Array.isArray(table['d'])
  );
}

/** Rows, oldest first, trimmed to the newest `limit` — what a budget enforces. */
export function tail(table: PackedTable, limit: number): PackedTable {
  if (table.d.length <= limit) return table;
  /* Re-packing rather than slicing `d`: dropping rows usually orphans interned
     values, and carrying a value table for rows that no longer exist is exactly
     the waste the trim was trying to reclaim. */
  return pack(unpack<Record<string, unknown>>(table).slice(-limit));
}
