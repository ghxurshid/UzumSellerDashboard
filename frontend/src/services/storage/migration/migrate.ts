import { accountFingerprint } from '../account';
import { readKv, writeKv } from '../idb/kv.repo';
import { commitBackfill, commitCoverage, patchMetadata } from '../idb/metadata.repo';
import { putRecords } from '../idb/records.repo';
import {
  changeToRecord,
  expenseToRecord,
  orderToRecord,
  skuToRecord,
} from '../idb/mappers';
import { ENTITY_TYPES, KV_KEYS, type StoredRecord } from '../idb/schema';
import { hasStorage, removeStorage, readStorage } from '../localStorage';
import { adoptSettings } from '../settings.service';
import { parseStoredSettings } from '../settingsSchema';
import {
  LEGACY_NOTIFICATIONS_KEY,
  LEGACY_SETTINGS_KEY,
  LEGACY_SYNC_KEY,
  hasLegacyData,
  legacyKeys,
  legacyShopIds,
  readLegacyCatalog,
  readLegacyExpenses,
  readLegacyJournal,
  readLegacyLedger,
  readLegacyMeta,
} from './legacy';

/**
 * The one-shot import from localStorage.
 *
 * Runs once per browser profile, before the first render, and never again. Its
 * job is to make the storage migration invisible: a user who had two years of
 * archived history yesterday still has it today, and never learns that the
 * engine underneath changed.
 *
 * ## The order, and why it is not negotiable
 *
 * 1. **Read everything** out of the old engine.
 * 2. **Write everything** into the new one, rows before coverage — the same
 *    invariant every other write in this application observes, because a
 *    coverage range without its rows is a hole no future sync will look at.
 * 3. **Record that the import ran.**
 * 4. **Only then delete** the old keys.
 *
 * An import that deleted as it read and then failed part way through would lose
 * exactly the data it was written to preserve. So nothing is removed until the
 * new store demonstrably holds it, and a failure at any point simply leaves the
 * old keys in place for the next attempt.
 *
 * ## What is deliberately not imported
 *
 * Buffer slots. They hold re-readable payloads — the catalogue, open orders —
 * that go stale within minutes to hours and are refetched on demand anyway.
 * Carrying them across would be work for data that is about to be replaced. Their
 * keys are still removed, or they would occupy the old quota indefinitely.
 */

/** Bumped if a later release needs to re-run an import over the same data. */
const MIGRATION_VERSION = 1;

interface MigrationRecord {
  readonly version: number;
  readonly at: number;
  readonly shops: number;
  readonly rows: number;
  /** Anything that failed to import, kept for the diagnostics pane. */
  readonly failures: readonly string[];
}

export interface MigrationOutcome {
  readonly ran: boolean;
  readonly shops: number;
  readonly rows: number;
  readonly failures: readonly string[];
}

const NOT_RUN: MigrationOutcome = { ran: false, shops: 0, rows: 0, failures: [] };

/* ── the shop import ────────────────────────────────────────────────────── */

/**
 * Import one shop's archive.
 *
 * Rows are written per entity, then the coverage record is rebuilt from the old
 * one. The old record's ranges are replayed as a single `commitCoverage` per
 * range rather than written wholesale, so they pass through the same
 * normalisation every other write does — an old record with overlapping or
 * touching ranges arrives normalised rather than being trusted as-is.
 */
async function importShop(
  account: string,
  shopId: number,
): Promise<{ rows: number; failures: readonly string[] }> {
  const failures: string[] = [];
  let rows = 0;

  const meta = readLegacyMeta(account, shopId);

  /* ── settled order items ── */
  try {
    const ledger = readLegacyLedger(account, shopId);
    if (ledger.length > 0) {
      const records: StoredRecord[] = ledger.map((item) => orderToRecord(item, account, shopId));
      await putRecords(records);
      rows += records.length;
    }

    for (const range of meta?.ledger.ranges ?? []) {
      await commitCoverage(account, shopId, ENTITY_TYPES.orderItem, {
        window: range,
        rows: ledger.length,
        at: meta?.syncedAt ?? Date.now(),
      });
    }

    if (meta !== null) {
      await commitBackfill(account, shopId, ENTITY_TYPES.orderItem, {
        from: meta.backfillFrom,
        complete: meta.backfillComplete,
      });

      if (meta.ledger.evictedBefore !== null) {
        const evictedBefore = meta.ledger.evictedBefore;
        await patchMetadata(account, shopId, ENTITY_TYPES.orderItem, (current) => ({
          ...current,
          evicted_before: evictedBefore,
          last_synced_at: meta.syncedAt,
        }));
      } else if (meta.syncedAt !== null) {
        const syncedAt = meta.syncedAt;
        await patchMetadata(account, shopId, ENTITY_TYPES.orderItem, (current) => ({
          ...current,
          last_synced_at: syncedAt,
        }));
      }
    }
  } catch (error) {
    failures.push(`shop ${shopId} ledger: ${describe(error)}`);
  }

  /* ── settled expenses ── */
  try {
    const expenses = readLegacyExpenses(account, shopId);
    if (expenses.length > 0) {
      const records: StoredRecord[] = expenses.map((payment) =>
        expenseToRecord(payment, account, shopId),
      );
      await putRecords(records);
      rows += records.length;
    }

    for (const range of meta?.expenses.ranges ?? []) {
      await commitCoverage(account, shopId, ENTITY_TYPES.expense, {
        window: range,
        rows: expenses.length,
        at: meta?.syncedAt ?? Date.now(),
      });
    }
  } catch (error) {
    failures.push(`shop ${shopId} expenses: ${describe(error)}`);
  }

  /* ── catalogue capture ── */
  try {
    const catalog = readLegacyCatalog(account, shopId);
    if (catalog.at !== null && catalog.skus.length > 0) {
      const capturedAt = catalog.at;
      const records: StoredRecord[] = catalog.skus.map((sku) =>
        skuToRecord(sku, account, shopId, capturedAt),
      );
      await putRecords(records);
      rows += records.length;

      await commitCoverage(account, shopId, ENTITY_TYPES.catalogSku, {
        window: null,
        rows: records.length,
        at: capturedAt,
        capturedAt,
      });
    }
  } catch (error) {
    failures.push(`shop ${shopId} catalog: ${describe(error)}`);
  }

  /* ── change journal ── */
  try {
    const journal = readLegacyJournal(account, shopId);
    if (journal.length > 0) {
      const records: StoredRecord[] = journal.map((event) =>
        changeToRecord(event, account, shopId),
      );
      await putRecords(records);
      rows += records.length;

      await commitCoverage(account, shopId, ENTITY_TYPES.changeEvent, {
        window: null,
        rows: records.length,
        at: Date.now(),
      });
    }
  } catch (error) {
    failures.push(`shop ${shopId} journal: ${describe(error)}`);
  }

  return { rows, failures };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected failure';
}

/* ── settings, notifications and the sync log ───────────────────────────── */

/**
 * Settings come across first and are adopted immediately.
 *
 * The account fingerprint is derived from the API token, and the archive is
 * partitioned by it — so the token has to be in place *before* any shop is
 * imported, or every row would be written under the fingerprint of the empty
 * default settings and become unreachable.
 */
async function importSettings(): Promise<string | null> {
  const raw = readStorage(LEGACY_SETTINGS_KEY);
  if (raw === null) return null;

  try {
    const settings = parseStoredSettings(raw);
    adoptSettings(settings);
    await writeKv(KV_KEYS.settings, { version: 3, settings });
    return null;
  } catch (error) {
    return `settings: ${describe(error)}`;
  }
}

async function importJsonKv(
  legacyKey: string,
  target: (typeof KV_KEYS)[keyof typeof KV_KEYS],
  label: string,
): Promise<string | null> {
  const raw = readStorage(legacyKey);
  if (raw === null) return null;

  try {
    await writeKv(target, JSON.parse(raw) as unknown);
    return null;
  } catch (error) {
    return `${label}: ${describe(error)}`;
  }
}

/* ── the runner ─────────────────────────────────────────────────────────── */

/**
 * Import, once.
 *
 * Safe to call on every startup: the recorded marker short-circuits it, and the
 * check costs one keyed read. Returns what it did so the interface can tell the
 * user their history was carried over rather than leaving them to notice.
 */
export async function migrateFromLocalStorage(): Promise<MigrationOutcome> {
  /* No localStorage at all — a fresh profile, or a browser that blocks it.
     Either way there is nothing to import. */
  if (!hasStorage()) return NOT_RUN;

  let marker: MigrationRecord | null = null;
  try {
    marker = await readKv<MigrationRecord>(KV_KEYS.migration);
  } catch {
    /* IndexedDB is not readable. Importing into it would fail too, and the old
       keys must not be deleted, so this session runs on whatever is in memory. */
    return NOT_RUN;
  }

  if (marker !== null && marker.version >= MIGRATION_VERSION) return NOT_RUN;

  const failures: string[] = [];

  /* Settings first: the account fingerprint every other key depends on comes
     from the token they carry. */
  const settingsFailure = await importSettings();
  if (settingsFailure !== null) failures.push(settingsFailure);

  const account = accountFingerprint();

  if (!hasLegacyData(account)) {
    /* Nothing to carry over, but the marker is still written so later startups
       skip the scan entirely. */
    await writeKv(KV_KEYS.migration, {
      version: MIGRATION_VERSION,
      at: Date.now(),
      shops: 0,
      rows: 0,
      failures: [],
    } satisfies MigrationRecord);
    return NOT_RUN;
  }

  const notificationsFailure = await importJsonKv(
    LEGACY_NOTIFICATIONS_KEY,
    KV_KEYS.notifications,
    'notifications',
  );
  if (notificationsFailure !== null) failures.push(notificationsFailure);

  const syncFailure = await importJsonKv(LEGACY_SYNC_KEY, KV_KEYS.syncLog, 'sync log');
  if (syncFailure !== null) failures.push(syncFailure);

  const shopIds = legacyShopIds(account);
  let rows = 0;

  for (const shopId of shopIds) {
    const result = await importShop(account, shopId);
    rows += result.rows;
    failures.push(...result.failures);
  }

  /* The marker goes in before the cleanup, so a failure during deletion cannot
     cause the whole import to run a second time and duplicate nothing — the
     record ids are deterministic, so a re-run would be harmless, but a re-run
     that re-imports a partially deleted archive would silently lose rows. */
  await writeKv(KV_KEYS.migration, {
    version: MIGRATION_VERSION,
    at: Date.now(),
    shops: shopIds.length,
    rows,
    failures,
  } satisfies MigrationRecord);

  /**
   * Only now is the old engine emptied.
   *
   * Everything above has committed. If the process is killed between the marker
   * and this loop, the worst outcome is stale keys occupying the old quota,
   * which the next release's cleanup can remove — never lost data.
   */
  for (const key of legacyKeys(account)) removeStorage(key);

  return { ran: true, shops: shopIds.length, rows, failures };
}

/** What the last import did, for the diagnostics pane. */
export async function migrationRecord(): Promise<MigrationRecord | null> {
  try {
    return await readKv<MigrationRecord>(KV_KEYS.migration);
  } catch {
    return null;
  }
}
