/**
 * The names of the six data sources, and nothing else.
 *
 * This file exists to break a cycle. The sync store needs the source ids to
 * build its per-source log, and the sources now need the sync store to report
 * a lazy read into that log — so if the ids lived beside the queries, the two
 * modules would import each other. At module-evaluation time one of them would
 * win and the other would see `undefined`, which is a failure that depends on
 * bundler ordering and therefore appears at the worst possible moment.
 *
 * Keeping the ids in a leaf module with no imports of its own makes the cycle
 * impossible rather than merely unlikely.
 */

export const SOURCE_IDS = [
  'products',
  'stocks',
  'finance',
  'expenses',
  'orders',
  'invoices',
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

/** Whether a source's stored payload depends on the selected window. */
export const PERIODIC_SOURCES: Readonly<Record<SourceId, boolean>> = {
  products: false,
  stocks: false,
  invoices: false,
  orders: true,
  finance: true,
  expenses: true,
};
