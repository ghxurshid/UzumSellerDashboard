import { ENTITY_TYPES, type EntityType } from './idb/schema';

/**
 * How much history each entity keeps.
 *
 * This module replaces the character budget the localStorage tiers needed. That
 * budget existed for one reason: an origin got roughly five megabytes, the
 * ceiling could not be queried, and the only way to discover it was a write that
 * threw. A good deal of the old archive was machinery for serialising a shop's
 * whole history, measuring it, evicting rows and trying again — up to twelve
 * rounds per write.
 *
 * None of that is needed here. IndexedDB gives an origin a share of free disk,
 * typically gigabytes, and `navigator.storage.estimate()` reports it. So the
 * policy is no longer "what fits" but "what is worth keeping", which is a
 * question about the data rather than about the browser:
 *
 *   • **Settled history is capped by count, generously.** An order item is the
 *     record of a sale and the only copy of it this machine will ever have — the
 *     seller API pages at fifty rows behind a per-hour rate limit, so re-fetching
 *     a year costs hundreds of requests. Two hundred thousand rows is several
 *     years for most shops and still a small database.
 *
 *   • **Current state is not capped at all.** A catalogue capture is one row per
 *     SKU, replaced whole on every sync. It cannot grow.
 *
 *   • **The change journal is capped by count, not by age.** It is the only
 *     record of a price move — no endpoint replays it — so a shop that changed
 *     nothing for a year should still be able to see last spring's change.
 *
 * Pruning is by *age within the entity*, oldest first, and the coverage record
 * is clipped to match so the archive never claims a period whose rows it
 * discarded.
 */

export interface RetentionPolicy {
  /** Rows kept before the oldest are pruned. `Infinity` means no cap. */
  readonly maxRows: number;
  /**
   * Whether pruning this entity un-covers a period.
   *
   * True for settled history: dropping March's rows means March is no longer
   * held, and the coverage record has to say so. False for a capture, which has
   * no period to un-cover.
   */
  readonly clipsCoverage: boolean;
}

const POLICIES: Readonly<Record<EntityType, RetentionPolicy>> = {
  [ENTITY_TYPES.orderItem]: { maxRows: 200_000, clipsCoverage: true },
  [ENTITY_TYPES.expense]: { maxRows: 50_000, clipsCoverage: true },
  /* One row per SKU, replaced on every capture — bounded by the catalogue. */
  [ENTITY_TYPES.catalogSku]: { maxRows: Number.POSITIVE_INFINITY, clipsCoverage: false },
  [ENTITY_TYPES.changeEvent]: { maxRows: 20_000, clipsCoverage: false },
};

export function retentionFor(entity: EntityType): RetentionPolicy {
  return POLICIES[entity];
}

/**
 * Whether a row count has passed the point where pruning is worth a pass.
 *
 * A small margin above the cap, so a shop hovering at the limit does not run a
 * delete pass after every single window it fetches.
 */
export function needsPruning(entity: EntityType, rows: number): boolean {
  const { maxRows } = retentionFor(entity);
  if (!Number.isFinite(maxRows)) return false;
  return rows > maxRows * 1.05;
}

/** Bytes, formatted for the storage read-out in Settings. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
