import { deleteWhere, request, walk, withStore } from './db';
import {
  BUFFER_VERSION,
  INDEXES,
  STORES,
  bufferKey,
  type BufferRecord,
} from './schema';

/**
 * The read-through slot store.
 *
 * One slot is one endpoint's whole answer for one scope — the catalogue for
 * these shops, the open orders for this window. They are payloads rather than
 * facts: replaced wholesale, valid only for a while, and worth nothing once
 * superseded. That is why they live apart from `records`, which holds rows that
 * are permanent and are merged rather than replaced.
 *
 * Eviction here is by count and age, not by byte budget. Under localStorage the
 * buffer had to model a ~5 MB ceiling it could not query, and a good deal of the
 * old implementation was machinery for discovering that ceiling by writing into
 * it until something threw. IndexedDB gives an origin orders of magnitude more
 * room and reports what it has, so the policy that remains is simply "keep the
 * slots that are being used, drop the ones that are not".
 */

/**
 * Slots kept before the least recently fetched are dropped.
 *
 * Sized for the partitioning rather than for the sources: a payload is stored
 * per shop, so an account with a dozen shops holds a dozen catalogue slots and
 * a dozen more per window of open orders. A ceiling tight enough to evict those
 * would undo the thing they are for — the shop selected a moment ago would have
 * been dropped by the time it is selected again.
 */
const MAX_SLOTS = 256;

/**
 * A slot older than this is dropped rather than served, whatever the freshness
 * setting says.
 *
 * The setting governs *when to refetch*; this governs when a slot stops being
 * worth keeping at all. A window nobody has opened in a fortnight is occupying
 * space the window they are opening now could use.
 */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

export interface BufferSlot {
  readonly meta: Record<string, unknown>;
  readonly tables: Readonly<Record<string, unknown>>;
  readonly at: number;
}

/**
 * A rough byte count for a stored payload.
 *
 * Only ever used for the usage read-out, never for a decision — which is why an
 * estimate is enough. `JSON.stringify` on a large packed table is not free, so
 * it is measured once at write time and stored, rather than recomputed whenever
 * Settings is opened.
 */
function estimateBytes(value: unknown): number {
  try {
    /* UTF-16 in memory, but the figure is for a human, so bytes-as-characters
       is the more honest of the two approximations available cheaply. */
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/* ── read ───────────────────────────────────────────────────────────────── */

export async function readSlot(
  account: string,
  source: string,
  scope: string,
): Promise<BufferSlot | null> {
  const key = bufferKey(account, source, scope);

  const record = await withStore(STORES.buffer, 'readonly', (store) =>
    request<BufferRecord | undefined>(store.get(key) as IDBRequest<BufferRecord | undefined>),
  );

  if (record === undefined) return null;
  if (record.version !== BUFFER_VERSION) {
    await dropSlot(account, source, scope);
    return null;
  }

  if (Date.now() - record.at > MAX_AGE_MS) {
    await dropSlot(account, source, scope);
    return null;
  }

  return { meta: record.meta, tables: record.tables, at: record.at };
}

/* ── write ──────────────────────────────────────────────────────────────── */

/**
 * Store a payload, evicting the least recently fetched slots if the store is
 * over its slot count.
 *
 * Eviction and write happen in one transaction so a quota failure rolls back
 * both: the old design could evict four usable slots and then still fail to
 * store the fifth, leaving the buffer worse off than before it was asked.
 */
export async function writeSlot(
  account: string,
  source: string,
  scope: string,
  payload: { readonly meta: Record<string, unknown>; readonly tables: Readonly<Record<string, unknown>> },
): Promise<boolean> {
  const key = bufferKey(account, source, scope);
  const record: BufferRecord = {
    key,
    account,
    source,
    scope,
    at: Date.now(),
    bytes: estimateBytes(payload.tables) + estimateBytes(payload.meta),
    meta: payload.meta,
    tables: payload.tables,
    version: BUFFER_VERSION,
  };

  try {
    await withStore(STORES.buffer, 'readwrite', async (store) => {
      store.put(record);

      const total = await request(store.count());
      if (total <= MAX_SLOTS) return;

      /* Oldest first on the `at` index, stopping as soon as enough have gone.
         The slot just written is the newest, so it can never be the one
         evicted — which is the property the old character-budget version had
         to argue for explicitly. */
      let excess = total - MAX_SLOTS;
      await walk<BufferRecord>(store.index('at'), null, 'next', (slot) => {
        if (excess <= 0) return false;
        if (slot.key !== key) {
          store.delete(slot.key);
          excess -= 1;
        }
        return excess > 0;
      });
    });

    return true;
  } catch {
    /* A quota failure is not an error the caller should have to handle: the
       payload is still served this once, it simply will not be there next time. */
    return false;
  }
}

/* ── housekeeping ───────────────────────────────────────────────────────── */

export async function dropSlot(account: string, source: string, scope: string): Promise<void> {
  await withStore(STORES.buffer, 'readwrite', (store) => {
    store.delete(bufferKey(account, source, scope));
  });
}

export function dropAccountSlots(account: string): Promise<number> {
  return withStore(STORES.buffer, 'readwrite', (store) =>
    deleteWhere(store.index(INDEXES.account), IDBKeyRange.only(account)),
  );
}

export function clearSlots(): Promise<number> {
  return withStore(STORES.buffer, 'readwrite', (store) => deleteWhere(store, null));
}

export interface BufferUsage {
  readonly slots: number;
  readonly maxSlots: number;
  readonly bytes: number;
  /** Share of the slot allowance in use, 0–1. */
  readonly saturation: number;
  readonly oldestAt: number | null;
  readonly newestAt: number | null;
}

export async function bufferUsage(account: string): Promise<BufferUsage> {
  let slots = 0;
  let bytes = 0;
  let oldestAt: number | null = null;
  let newestAt: number | null = null;

  await withStore(STORES.buffer, 'readonly', (store) =>
    walk<BufferRecord>(store.index(INDEXES.account), IDBKeyRange.only(account), 'next', (slot) => {
      slots += 1;
      bytes += slot.bytes;
      oldestAt = oldestAt === null ? slot.at : Math.min(oldestAt, slot.at);
      newestAt = newestAt === null ? slot.at : Math.max(newestAt, slot.at);
    }),
  );

  return {
    slots,
    maxSlots: MAX_SLOTS,
    bytes,
    saturation: Math.min(1, slots / MAX_SLOTS),
    oldestAt,
    newestAt,
  };
}
