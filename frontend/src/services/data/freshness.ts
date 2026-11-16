import {
  ENTITY_TYPES,
  lastReadAt,
  readShopMeta,
  type EntityType,
  type SyncMetadataRecord,
} from '@/services/storage/archive/archive.service';
import { bounds } from '@/services/storage/archive/coverage';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import { isWindowed } from '@/services/storage/idb/schema';
import { readDataSettings } from '@core/settings/settings.service';

/**
 * When each table was last read from Uzum — and nothing else.
 *
 * This module makes no request, ever. It is a keyed read of `sync_metadata` and
 * an arithmetic comparison against the freshness window, which is what makes it
 * safe to call before every Copilot question: asking "how old is my data" must
 * not be the thing that goes and refreshes it.
 *
 * It exists because the answer used to be unavailable without triggering the
 * work it describes. The Copilot needs to tell the model how stale its figures
 * are, Settings wants to show it, and a caller deciding whether to pass `force`
 * wants it too — all three previously had to infer it from a sync they started.
 *
 * ## What "last read" means here
 *
 * `last_synced_at` is stamped by every coverage commit, by a capture that came
 * back empty and was believed (the catalogue's empty answer is not — see
 * `trustsEmptyAnswer` in `archive/archive.service.ts`), and by a route that
 * definitively refused — so it is the honest answer to *when did we last ask
 * Uzum about this*, which is the question the freshness gate decides on.
 * `captured_at` is consulted only as a fallback for records written before that
 * was true.
 *
 * For a windowed table the stamp alone can flatter the record: a backfill writes
 * a chunk of last spring and stamps the instant it did so, while nothing near
 * the present was read. So the newest covered instant is taken into account and
 * the more conservative of the two is reported — which is also the figure the
 * planner's live-edge rule judges.
 *
 * ## "Read" is not "holds something"
 *
 * The two come apart in exactly the case worth reporting. An FBO-only account's
 * `/v1/fbs/invoice` answers 400 on every run; that is a definitive refusal, it
 * is stamped as read, and reading the stamp alone would have this module say the
 * FBS invoice table was read at 14:08 — true, and read by a caller as "the
 * figures are current" when what happened is *we asked, they refused, and
 * nothing is held*. `held` states the other half so the two can be told apart,
 * and a caller quoting a stamp without it is quoting half an answer.
 *
 * ## The shop set
 *
 * A table is as fresh as its stalest shop: `syncedAt` is the oldest across the
 * shops asked about, and null as soon as one of them has never read it. Stock
 * and the invoice collections are account-wide at the source but are captured
 * per shop, so the same set applies to them — it is the set the capture would
 * run for.
 */

export type FreshnessTable =
  | 'sales'
  | 'expenses'
  | 'orders'
  | 'catalogue'
  | 'stock'
  | 'supplyInvoices'
  | 'returns'
  | 'fbsInvoices';

export interface TableFreshness {
  readonly table: FreshnessTable;
  /** The instant this table was last read from Uzum — the oldest across the shops asked about. Null when any of them has never read it. */
  readonly syncedAt: number | null;
  /**
   * Whether this machine actually holds anything for this table.
   *
   * A capture is held for a snapshot table, or some period is covered for a
   * windowed one — in both cases: *a read landed and its answer is on disk*.
   * False with a `syncedAt` set is the case worth printing rather than hiding:
   * the table was asked about and nothing came back, because the route refused
   * (an FBO-only account's FBS invoices) or answered an empty collection that
   * was believed. A figure drawn from such a table has nothing behind it.
   *
   * True as soon as *any* shop in the scope holds *any* of the table's
   * entities — the opposite quantifier to `syncedAt`, deliberately: freshness is
   * as good as its stalest shop, while "is there anything behind this" is
   * answered yes by one shop's rows. A covered window with no rows in it counts
   * as held: the period was read and the answer was "nothing happened", which is
   * knowledge, not absence of it.
   */
  readonly held: boolean;
}

/**
 * What every table was last read, and whether anything came of it.
 *
 * There is deliberately no "stale" flag. It used to be computed here and read by
 * nobody, and it claimed more than it could: a table whose freshness window has
 * passed still costs nothing to read when the caller only asks about windows the
 * archive already covers, so "stale" and "the next read goes to Uzum" are not
 * the same statement. A caller that wants the window comparison can make it from
 * what is here — `now - syncedAt >= refreshMinutes * 60_000` — and will then own
 * the claim it is making.
 */
export interface DataFreshness {
  readonly now: number;
  /** The freshness window in minutes, from Settings — how long a read is served from disk. */
  readonly refreshMinutes: number;
  readonly tables: readonly TableFreshness[];
}

/**
 * Which entities each table is made of.
 *
 * Mostly one, and never more than the entities a single read writes together:
 * an FBS order and its lines come out of one payload, as do a product and its
 * SKUs, so a table is only as fresh as the older of them. Deliberately *not*
 * listed are the children that a read may legitimately skip — supply invoice
 * lines are expanded only for invoices that exist, and a seller with none would
 * otherwise show that table as never read for ever.
 */
const TABLE_ENTITIES: Readonly<Record<FreshnessTable, readonly EntityType[]>> = {
  sales: [ENTITY_TYPES.orderItem],
  expenses: [ENTITY_TYPES.expense],
  orders: [ENTITY_TYPES.fbsOrder, ENTITY_TYPES.fbsOrderItem],
  catalogue: [ENTITY_TYPES.product, ENTITY_TYPES.productSku],
  stock: [ENTITY_TYPES.fbsStock],
  supplyInvoices: [ENTITY_TYPES.supplyInvoice],
  returns: [ENTITY_TYPES.sellerReturn],
  fbsInvoices: [ENTITY_TYPES.fbsInvoice],
};

/** Declared rather than derived from the map, so the order of the report is fixed. */
const FRESHNESS_TABLES: readonly FreshnessTable[] = [
  'sales',
  'expenses',
  'orders',
  'catalogue',
  'stock',
  'supplyInvoices',
  'returns',
  'fbsInvoices',
];

const NEEDED_ENTITIES: readonly EntityType[] = [
  ...new Set(FRESHNESS_TABLES.flatMap((table) => TABLE_ENTITIES[table])),
];

/**
 * When one pair was last read, as conservatively as the record allows.
 *
 * A windowed entity reports the earlier of its read stamp and the newest instant
 * its coverage claims, because a stamp with no recent coverage behind it means
 * the reading happened somewhere else in history.
 */
function readAt(meta: SyncMetadataRecord): number | null {
  const stamp = lastReadAt(meta);
  if (stamp === null) return null;
  if (!isWindowed(meta.entity_type)) return stamp;

  const edge = bounds(toCoverage(meta.synced_ranges))?.toMs;
  return edge === undefined ? null : Math.min(stamp, edge);
}

/**
 * Whether this one pair has an answer on disk.
 *
 * A snapshot entity holds one when a capture was taken; `rows` is consulted too,
 * so a record whose capture stamp was lost but whose rows survived still counts
 * as held. A windowed entity holds one when its coverage claims any period at
 * all — the rows inside it may legitimately be none, and a read that came back
 * with nothing for a covered fortnight is knowledge about that fortnight rather
 * than the absence of it.
 */
function holdsAnswer(meta: SyncMetadataRecord): boolean {
  if (isWindowed(meta.entity_type)) return meta.synced_ranges.length > 0;
  return meta.captured_at !== null || meta.rows > 0;
}

/** Whether any shop holds any part of a table — see `TableFreshness.held`. */
function anyHeld(
  perShop: readonly Readonly<Record<string, SyncMetadataRecord>>[],
  entities: readonly EntityType[],
): boolean {
  return perShop.some((records) =>
    entities.some((entity) => {
      const meta = records[entity];
      return meta !== undefined && holdsAnswer(meta);
    }),
  );
}

/** The oldest read across every shop and every entity a table is made of. */
function oldestRead(
  perShop: readonly Readonly<Record<string, SyncMetadataRecord>>[],
  entities: readonly EntityType[],
): number | null {
  if (perShop.length === 0) return null;

  let oldest: number | null = null;

  for (const records of perShop) {
    for (const entity of entities) {
      const meta = records[entity];
      if (meta === undefined) return null;

      const at = readAt(meta);
      /* One shop that has never read it makes the table unread, whatever the
         others hold — a consolidated answer is only as complete as its parts. */
      if (at === null) return null;

      oldest = oldest === null ? at : Math.min(oldest, at);
    }
  }

  return oldest;
}

/**
 * The freshness of every table, from metadata alone.
 *
 * One keyed transaction per shop, no request, no clock read the caller cannot
 * override. An empty shop list answers "never read" for everything, which is the
 * conservative claim about a scope that names nothing.
 */
export async function readDataFreshness(
  shopIds: readonly number[],
  now: number = Date.now(),
): Promise<DataFreshness> {
  const refreshMinutes = readDataSettings().freshnessMinutes;

  const perShop = await Promise.all(
    shopIds.map((shopId) => readShopMeta(shopId, NEEDED_ENTITIES)),
  );

  const tables = FRESHNESS_TABLES.map((table): TableFreshness => {
    const entities = TABLE_ENTITIES[table];

    return {
      table,
      syncedAt: oldestRead(perShop, entities),
      held: anyHeld(perShop, entities),
    };
  });

  return { now, refreshMinutes, tables };
}
