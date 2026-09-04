import { describe, expect, it } from 'vitest';

import { cell, compose, dec, header, isoDay, isoMinute, num, pairs, parseDay, table, windowLabel } from './plaintext';

/**
 * The envelope every tool result travels in.
 *
 * Two things here are load-bearing and neither is obvious from reading the
 * functions. `parseDay` decides what "August" means — an off-by-one at the end
 * of the range silently drops the 31st from every figure in the answer. And
 * `table` is the only thing standing between a product called "Abaya | XL" and
 * a row the model reads as having an extra column.
 */

describe('parseDay', () => {
  it('reads a plain day as UTC midnight', () => {
    expect(parseDay('2026-08-01')).toBe(Date.UTC(2026, 7, 1));
  });

  it('includes the whole of the closing day', () => {
    /* A seller asking for 2026-08-01..2026-08-31 means the whole of the 31st.
       Parsing the end as midnight would lose a day of sales from every total. */
    expect(parseDay('2026-08-31', 'end')).toBe(Date.UTC(2026, 7, 31) + 86_399_999);
  });

  it('passes an epoch through unchanged', () => {
    expect(parseDay(1_770_000_000_000)).toBe(1_770_000_000_000);
  });

  it('rejects what is not a date', () => {
    expect(parseDay(undefined)).toBeNull();
    expect(parseDay('')).toBeNull();
    expect(parseDay('last august')).toBeNull();
    expect(parseDay(Number.NaN)).toBeNull();
  });

  it('accepts a full timestamp without shifting the end', () => {
    const at = parseDay('2026-08-31T10:00:00.000Z', 'end');
    expect(at).toBe(Date.parse('2026-08-31T10:00:00.000Z'));
  });
});

describe('formatting', () => {
  it('writes integers without separators', () => {
    /* Grouped thousands are for the seller, not the model: `38 400 000` costs
       more tokens and reads as three numbers. */
    expect(num(38_400_000)).toBe('38400000');
    expect(num(-12.4)).toBe('-12');
    expect(num(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('writes rates to one decimal', () => {
    expect(dec(23.456)).toBe('23.5');
    expect(dec(Number.NaN)).toBe('0');
  });

  it('names a day and a minute in UTC', () => {
    expect(isoDay(Date.UTC(2026, 7, 1))).toBe('2026-08-01');
    expect(isoMinute(Date.UTC(2026, 7, 1, 14, 20))).toBe('2026-08-01 14:20');
    expect(windowLabel(Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 31))).toBe(
      '2026-08-01..2026-08-31',
    );
  });
});

describe('table', () => {
  it('declares its columns and separates cells with pipes', () => {
    expect(table(['ref', 'units'], [['p.1', 12]])).toBe('cols: ref | units\np.1 | 12');
  });

  it('strips a pipe out of a product name so the row keeps its shape', () => {
    const rendered = table(['ref', 'name'], [['p.1', 'Abaya | XL']]);
    expect(rendered).toBe('cols: ref | name\np.1 | Abaya XL');
  });

  it('flattens a newline inside a cell', () => {
    expect(cell('two\nlines')).toBe('two lines');
  });
});

describe('header and compose', () => {
  it('drops the parts that had nothing to say', () => {
    expect(header('window.totals', ['2026-08-01..2026-08-31', null, '', undefined, 'shops 1'])).toBe(
      '[window.totals] 2026-08-01..2026-08-31 · shops 1',
    );
  });

  it('renders a bare header when every part is empty', () => {
    expect(header('shops.list', [null, undefined])).toBe('[shops.list]');
  });

  it('joins only the sections that exist', () => {
    expect(compose(['one', false, null, 'two', ''])).toBe('one\ntwo');
  });

  it('writes pairs as key=value', () => {
    expect(
      pairs([
        ['totals.netProfit', 457_924],
        ['totals.netMargin', '9.2'],
      ]),
    ).toBe('totals.netProfit=457924 totals.netMargin=9.2');
  });
});
