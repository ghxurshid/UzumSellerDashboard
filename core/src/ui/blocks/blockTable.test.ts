import { describe, expect, it } from 'vitest';

import { padRow } from './blockTable';

describe('padRow', () => {
  it('leaves a row that already matches the header alone', () => {
    expect(padRow(['a', 1, 'b'], 3)).toEqual(['a', 1, 'b']);
  });

  it('pads a short row with empty cells rather than leaving them missing', () => {
    expect(padRow(['a'], 3)).toEqual(['a', '', '']);
  });

  it('trims a row that carries more cells than the header names', () => {
    expect(padRow(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });

  it('handles an empty row', () => {
    expect(padRow([], 2)).toEqual(['', '']);
  });
});
