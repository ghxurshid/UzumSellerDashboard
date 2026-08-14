import { isAvailable, requestPersistence } from '@/services/storage/idb/db';
import { migrateFromLocalStorage } from '@/services/storage/migration/migrate';
import { hydrateSettings } from '@/services/storage/settings.service';
import { useArchiveStore } from '@/store/archive.store';
import { restoreNotifications } from '@/store/notifications.store';
import { restoreSyncLog } from '@/store/sync.store';

/**
 * Everything that must happen before the first render.
 *
 * The storage engine is asynchronous, and three things in this application read
 * from it synchronously by design: the axios interceptor needs the API token
 * while a request is being built, the read-through layer needs the freshness
 * window inside a query function, and the settings store hands React a snapshot
 * rather than a promise.
 *
 * The resolution is to make *loading* asynchronous and everything afterwards
 * synchronous, which means loading has to finish first. That is what this does,
 * and why `main.tsx` awaits it before mounting rather than kicking it off in an
 * effect. A render that happened first would briefly show an unauthenticated,
 * default-settings, empty-archive application — and then replace it, which is a
 * flash of wrong content rather than a loading state.
 *
 * ## Order
 *
 * The steps are sequential because each depends on the last:
 *
 *   1. **Open the database.** Everything else needs it, and a browser that
 *      refuses gets an in-memory session rather than a blank screen.
 *   2. **Import from localStorage**, once ever. This adopts the previous
 *      engine's settings as part of its work, because the account fingerprint
 *      every stored row is keyed by is derived from the API token they carry.
 *   3. **Hydrate settings** — a no-op if the import already adopted them.
 *   4. **Restore the logs and the archive view**, which need the fingerprint
 *      from step 2 or 3 to know which account's data to read.
 *
 * Failure at any step is survivable and none of them throws. A session without
 * storage is degraded, not broken: it fetches everything it needs, holds it in
 * memory, and loses it on reload.
 */

export interface BootstrapReport {
  /** Whether IndexedDB could be opened at all. */
  readonly storage: boolean;
  /** Whether the browser promised not to evict this origin under pressure. */
  readonly persisted: boolean;
  /** Whether the one-shot localStorage import ran during this startup. */
  readonly migrated: boolean;
  readonly migratedShops: number;
  readonly migratedRows: number;
  readonly failures: readonly string[];
}

let started: Promise<BootstrapReport> | null = null;

async function run(): Promise<BootstrapReport> {
  const failures: string[] = [];

  const storage = await isAvailable();

  if (!storage) {
    /* No persistence. Settings still hydrate — into the defaults — so the rest
       of the application sees the same shapes it always does. */
    await hydrateSettings();
    return {
      storage: false,
      persisted: false,
      migrated: false,
      migratedShops: 0,
      migratedRows: 0,
      failures: ['Local storage is unavailable; this session will not be saved'],
    };
  }

  /**
   * Ask to be exempt from eviction.
   *
   * Worth asking once: a full backfill is hundreds of rate-limited requests, and
   * without the grant a browser reclaiming disk space may drop the archive
   * silently. A refusal is not an error — most browsers grant it only once a
   * site has been used a few times — so the answer is reported and the app
   * carries on either way.
   */
  const persisted = await requestPersistence();

  let migrated = false;
  let migratedShops = 0;
  let migratedRows = 0;

  try {
    const outcome = await migrateFromLocalStorage();
    migrated = outcome.ran;
    migratedShops = outcome.shops;
    migratedRows = outcome.rows;
    failures.push(...outcome.failures);
  } catch (error) {
    /* An import that throws leaves the old keys in place, so the next startup
       tries again. Nothing is lost by carrying on without it. */
    failures.push(
      error instanceof Error
        ? `Import from the previous storage failed: ${error.message}`
        : 'Import from the previous storage failed',
    );
  }

  await hydrateSettings();

  /* These three are independent of each other and all needed before paint. */
  await Promise.all([
    restoreSyncLog(),
    restoreNotifications(),
    useArchiveStore.getState().refresh(),
  ]);

  return { storage: true, persisted, migrated, migratedShops, migratedRows, failures };
}

/** Run the startup sequence once; later callers await the same result. */
export function bootstrap(): Promise<BootstrapReport> {
  started ??= run();
  return started;
}
