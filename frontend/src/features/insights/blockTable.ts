import type { Phrase } from '@/services/insights/blocks';

/**
 * A `table` block's row, made to fit its own header.
 *
 * `blockLineSchema` only bounds a row's length, it does not force it to equal
 * `columns.length` — a model that skipped a trailing "note" cell on most rows
 * still sends a valid line. Left alone, a short row loses its bottom border
 * under the columns it never filled (there is no `<td>` there to carry one),
 * and a long row adds a column the header never named. Padding — and, the
 * other way, trimming — to the header's width is what keeps every row's grid
 * the one the header promises, checked here rather than in the render so it
 * can be tested without a DOM.
 */
export function padRow(
  row: ReadonlyArray<Phrase | number>,
  columnCount: number,
): ReadonlyArray<Phrase | number> {
  if (row.length === columnCount) return row;
  if (row.length > columnCount) return row.slice(0, columnCount);
  return [...row, ...Array.from({ length: columnCount - row.length }, () => '')];
}
