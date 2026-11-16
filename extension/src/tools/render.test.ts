import { describe, expect, it } from 'vitest';

import { DEFAULT_RENDER_LIMITS, renderPayload } from './render';

/**
 * The renderer meets JSON nobody has seen yet, so these shapes are invented on
 * purpose: none of the field names below is claimed to be the cabinet's.
 */

describe('finding rows', () => {
  it('prints a top-level array of objects as a table with the objects\' own keys', () => {
    const out = renderPayload([
      { id: 1, title: 'Alpha', price: 12.5 },
      { id: 2, title: 'Beta', price: 8 },
    ]);

    expect(out.text).toBe('list — 2 rows\nid|title|price\n1|Alpha|12.5\n2|Beta|8');
    expect(out.truncated).toBe(false);
    expect(out.primary).toEqual({ path: '', count: 2, shown: 2 });
  });

  it('finds an array held by an object, and prints the scalars beside it as pairs', () => {
    const out = renderPayload({ page: 0, flag: true, items: [{ id: 1 }, { id: 2 }] });

    expect(out.text).toBe('fields: page=0 flag=true\nitems — 2 rows\nid\n1\n2');
    expect(out.primary).toEqual({ path: 'items', count: 2, shown: 2 });
  });

  it('looks inside nested objects for the list and names its path', () => {
    const out = renderPayload({ data: { total: 7, rows: [{ id: 1 }] } });

    expect(out.text).toContain('fields: data.total=7');
    expect(out.text).toContain('data.rows — 1 rows');
    expect(out.primary?.path).toBe('data.rows');
  });

  it('takes the largest list as the primary one and prints every table', () => {
    const out = renderPayload({ small: [{ a: 1 }], big: [{ b: 1 }, { b: 2 }, { b: 3 }] });

    expect(out.primary).toEqual({ path: 'big', count: 3, shown: 3 });
    expect(out.text).toContain('small — 1 rows');
    expect(out.text).toContain('big — 3 rows');
  });

  it('unions the columns of rows that differ, leaving a missing value empty', () => {
    const out = renderPayload([{ a: 1 }, { b: 2 }, { a: 3, b: null }]);

    expect(out.text).toBe('list — 3 rows\na|b\n1|\n|2\n3|');
  });

  it('prints numbers exactly, without the two-decimal rounding of plaintext.table', () => {
    expect(renderPayload([{ x: 0.00012345, y: 1234567890123 }]).text).toContain('0.00012345|1234567890123');
  });

  it('summarises a nested value in a cell instead of dumping it', () => {
    const out = renderPayload([
      { id: 1, meta: { color: 'red', size: 'm', a: 1, b: 2, c: 3 }, tags: ['x', 'y'], skus: [{ id: 1 }, { id: 2 }], none: [] },
    ]);

    expect(out.text).toContain('id|meta|tags|skus|none');
    expect(out.text).toContain('1|{color,size,a,b,+1}|[x,y]|[2 objects]|[]');
    expect(out.truncated).toBe(false);
  });

  it('shows a list of scalars as a short value list, not a table', () => {
    const out = renderPayload({ ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });

    expect(out.text).toBe('ids: [10 values] 1, 2, 3, 4, 5, 6, 7, 8');
    expect(out.truncated).toBe(true);
    expect(out.cuts).toEqual(['ids: 8 of 10 values shown']);
    expect(out.primary).toBeNull();
  });

  it('summarises an object nested deeper than it searches', () => {
    const out = renderPayload({ a: { b: { c: { d: 1, e: 2 } } } });

    expect(out.text).toBe('a.b.c: {d,e}');
  });
});

describe('empty and scalar payloads', () => {
  it('says an empty list has no rows, with a count of zero', () => {
    const out = renderPayload([]);

    expect(out.text).toBe('list — 0 rows');
    expect(out.primary).toEqual({ path: '', count: 0, shown: 0 });
    expect(out.truncated).toBe(false);
  });

  it('says an object holding an empty list has zero rows there', () => {
    const out = renderPayload({ content: [], page: 0 });

    expect(out.text).toBe('fields: page=0\ncontent — 0 rows');
    expect(out.primary).toEqual({ path: 'content', count: 0, shown: 0 });
  });

  it('says an empty object holds no fields', () => {
    expect(renderPayload({}).text).toBe('the response holds no fields');
  });

  it.each([
    [null, 'the response body is empty (null)'],
    [undefined, 'the response body is empty (null)'],
    [42, 'value: 42'],
    [false, 'value: false'],
    ['plain text', 'value: plain text'],
  ])('prints the scalar %s', (value, text) => {
    const out = renderPayload(value);

    expect(out.text).toBe(text);
    expect(out.primary).toBeNull();
  });
});

describe('bounds', () => {
  const wide = (rows: number, columns: number, width: number) =>
    Array.from({ length: rows }, (_, row) =>
      Object.fromEntries(Array.from({ length: columns }, (_, col) => [`field${col}`, `${row}-${'x'.repeat(width)}`])),
    );

  it('cuts columns, clips cells and says so', () => {
    const out = renderPayload(wide(3, 40, 200));

    expect(out.truncated).toBe(true);
    expect(out.cuts.join(' ')).toContain(`${DEFAULT_RENDER_LIMITS.maxColumns} of 40 columns shown`);
    expect(out.cuts.join(' ')).toContain('were clipped');
    expect(out.text.split('\n')[2]?.split('|')).toHaveLength(DEFAULT_RENDER_LIMITS.maxColumns);
    expect(out.text).toContain('…');
  });

  it('stops adding rows when the character budget is spent, and counts what it left out', () => {
    const out = renderPayload(wide(100, 12, 70));

    expect(out.truncated).toBe(true);
    expect(out.primary?.count).toBe(100);
    expect(out.primary?.shown).toBeGreaterThan(0);
    expect(out.primary?.shown).toBeLessThan(100);
    expect(out.cuts.join(' ')).toMatch(/list: \d+ of 100 rows shown/);
    expect(out.text.length).toBeLessThan(DEFAULT_RENDER_LIMITS.maxChars + 2_000);
  });

  it('prints at least the first row, however wide it is', () => {
    const out = renderPayload(wide(5, 16, 80), { limits: { maxChars: 10 } });

    expect(out.primary?.shown).toBe(1);
    expect(out.truncated).toBe(true);
  });

  it('caps rows per table, pairs and tables', () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    const pairs = renderPayload(many);
    expect(pairs.cuts).toContain('40 more fields or summaries were not listed');

    const rows = renderPayload(Array.from({ length: 250 }, (_, i) => ({ i })), { limits: { maxChars: 1_000_000 } });
    expect(rows.primary).toEqual({ path: '', count: 250, shown: DEFAULT_RENDER_LIMITS.maxRows });

    const lists = renderPayload(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`l${i}`, [{ v: i }]])));
    expect(lists.cuts.join(' ')).toContain('only 4 tables are');
    expect(lists.text.match(/ — 1 rows/g)).toHaveLength(4);
  });

  it('keeps a pipe or a newline in a value from breaking the table', () => {
    const out = renderPayload([{ 'a|b': 'x | y\nz' }]);

    expect(out.text).toBe('list — 1 rows\na b|x y z\n'.replace('a b|x y z\n', 'a b\nx y z'));
  });

  it('counts items that are not objects as skipped', () => {
    const out = renderPayload([{ a: 1 }, 5, null, { a: 2 }]);

    expect(out.primary).toEqual({ path: '', count: 4, shown: 2 });
    expect(out.cuts).toContain('list: 2 items that are not objects were skipped');
  });

  it('tags the primary table with the caller\'s column, apart from the payload\'s own', () => {
    const out = renderPayload([{ shopId: 99, id: 1 }], { rowTag: { column: 'askedShopId', value: 11 } });

    expect(out.text).toBe('list — 1 rows\naskedShopId|shopId|id\n11|99|1');
  });
});

describe('never throws', () => {
  it('survives a structure nested very deep', () => {
    let deep: unknown = { leaf: 1 };
    for (let i = 0; i < 20_000; i += 1) deep = { next: deep };

    expect(() => renderPayload(deep)).not.toThrow();
    expect(renderPayload(deep).text).toContain('next.next.next: {next}');
  });

  it('survives a cycle', () => {
    const loop: Record<string, unknown> = { id: 1 };
    loop['self'] = loop;

    expect(() => renderPayload(loop)).not.toThrow();
    expect(() => renderPayload([loop, loop])).not.toThrow();
  });

  it('survives keys that are prototype names', () => {
    const body = JSON.parse('{"__proto__":{"x":1},"constructor":[{"toString":1}],"hasOwnProperty":"y"}') as unknown;
    const out = renderPayload(body);

    expect(out.text).toContain('constructor — 1 rows');
    expect(out.text).toContain('hasOwnProperty=y');
  });

  it('survives a huge string and a huge array', () => {
    const out = renderPayload({ blob: 'x'.repeat(5_000_000), list: Array.from({ length: 200_000 }, (_, i) => i) });

    expect(out.text.length).toBeLessThan(2_000);
    expect(out.truncated).toBe(true);
  });

  it('reports a value it cannot read instead of throwing', () => {
    const hostile = {
      get boom(): never {
        throw new Error('nope');
      },
    };
    const out = renderPayload(hostile);

    expect(out.text).toBe('the response could not be rendered');
    expect(out.truncated).toBe(true);
  });

  it.each([[[[1, 2], [3]]], [[1, 'a', true]], [{ a: undefined }], [Symbol('s')], [10n]])(
    'returns text for the odd value %#',
    (value) => {
      const out = renderPayload(value);
      expect(typeof out.text).toBe('string');
      expect(out.text).not.toBe('');
    },
  );
});
