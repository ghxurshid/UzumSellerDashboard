import { isAvailable, requestPersistence } from '@/services/storage/idb/db';
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
 *      refuses gets an in-memory session rather than a blank screen. Opening is
 *      also where a v1 database is discarded and the v2 stores are built — see
 *      `idb/db.ts`, which is why the first start after an upgrade finds an empty
 *      archive and the next sync backfills it.
 *   2. **Hydrate settings**, which carry the API token the account fingerprint
 *      every stored row is keyed by is derived from.
 *   3. **Restore the logs and the archive view**, which need that fingerprint to
 *      know which account's data to read.
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

  await hydrateSettings();

  /* These three are independent of each other and all needed before paint. */
  await Promise.all([
    restoreSyncLog(),
    restoreNotifications(),
    useArchiveStore.getState().refresh(),
  ]);

  return { storage: true, persisted, failures };
}

/** Run the startup sequence once; later callers await the same result. */
export function bootstrap(): Promise<BootstrapReport> {
  started ??= run();
  return started;
}
