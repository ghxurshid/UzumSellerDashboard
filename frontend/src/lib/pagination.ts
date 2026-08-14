/**
 * Which page numbers a pager draws.
 *
 * A module can run to hundreds of pages, and a button for every one of them
 * turns the footer into a wall of numbers nobody reads. The window keeps the
 * first and last page always reachable plus `siblings` pages either side of the
 * current one; every skipped stretch collapses into a gap the pager renders as
 * an ellipsis.
 *
 * Once the pager overflows the result has a fixed length, so stepping through
 * pages never reflows the row of buttons under the cursor.
 */
export type PageItem = number | 'gap';

/** Pages are zero-based here, as they are in the table state. */
export function buildPageItems(
  page: number,
  pageCount: number,
  siblings = 1,
): readonly PageItem[] {
  /* first + last + the current page with its siblings + two gaps. Below this a
     gap would hide fewer pages than the slot it occupies, so nothing collapses. */
  const maxVisible = 2 * siblings + 5;
  if (pageCount <= maxVisible) return sequence(0, pageCount - 1);

  const last = pageCount - 1;
  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, last - 1);

  /* Near either edge a gap would hide a single page, which costs the slot it
     saves; that edge takes the freed slots instead, so the button count and the
     positions of the numbers stay put. */
  if (left <= 2) return [...sequence(0, 2 * siblings + 2), 'gap', last];
  if (right >= last - 2) return [0, 'gap', ...sequence(last - (2 * siblings + 2), last)];

  return [0, 'gap', ...sequence(left, right), 'gap', last];
}

function sequence(from: number, to: number): readonly number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
