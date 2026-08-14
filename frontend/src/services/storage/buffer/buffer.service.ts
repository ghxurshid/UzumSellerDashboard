import type { Scope } from '@/services/api/queryKeys';
import { readDataSettings } from '@/services/storage/settings.service';
import type { DateWindow } from '@/services/uzum/endpoints';

import { accountFingerprint } from '../account';
import {
  bufferUsage as readUsage,
  clearSlots,
  dropAccountSlots,
  dropSlot,
  readSlot,
  writeSlot,
  type BufferUsage,
} from '../idb/buffer.repo';
import type { PackedTable } from './columnar';
import { isTable } from './columnar';
import type { StoredPayload } from './sourceCodecs';

/**
 * The buffer: IndexedDB sitting between Uzum and the screens.
 *
 * The data path is `Uzum API → IndexedDB → UI`, in that order and with no
 * shortcuts. Screens never call the API; they ask this module for a payload, and
 * it either has one that is still good or it goes and gets one. That single rule
 * is what makes the application's behaviour predictable — the numbers on screen
 * are always exactly what is on disk, so what a user sees after a reload is what
 * they saw before it.
 *
 * Freshness is decided differently for the two kinds of data:
 *
 *   • **Re-readable state** — the catalogue, stock, open orders, invoices. It
 *     has no period and can never be "complete", so the only question is how
 *     old it may be. That is the N-minute window from Settings, and until it
 *     expires the stored copy is served without a request.
 *
 *   • **Settled history** — order items and expense rows. Those belong to a
 *     period, so the question is not age but *coverage*: has this window been
 *     fetched at all? That is the archive's job, not this module's, and it is
 *     why finance does not appear here.
 *
 * Both are partitioned the same way the archive is: **one slot per shop**, never
 * one per selection. A payload that answered "shops 1, 2 and 3" could not answer
 * "shop 2", so every change of the store chip used to cost a full refetch of
 * data already on disk. See `slotKey`.
 *
 * What changed with the storage engine is the accounting. The localStorage
 * version had to maintain its own index of every slot — the engine could not be
 * searched by prefix — and its own byte budget, because the origin's real
 * ceiling could only be discovered by a write that threw. Both are gone: the
 * slot store is indexed by account and by fetch time, so eviction is a bounded
 * cursor walk, and there is no budget to model because the browser reports the
 * quota directly.
 */

/* ── keys ───────────────────────────────────────────────────────────────── */

/**
 * What one stored payload answers: one shop (or the whole account), and
 * optionally one window.
 *
 * **A slot never describes a set of shops.** That is the difference that makes
 * the store chip cheap: keying the catalogue by `1-2-3` meant that selecting
 * shop 2 on its own asked a question no slot had ever answered, and the whole
 * catalogue was fetched again for rows already on disk. One slot per shop means
 * any selection — one shop, or all of them — is answered by the slots that are
 * already there, and only the shops genuinely missing cost a request.
 *
 * Sources with no shop of their own (`/v3/fbs/sku/stocks`, `/v1/invoice`) are
 * account-wide: the route takes no shop id, so its answer is the same whichever
 * chip is selected, and it gets one slot rather than one per selection.
 *
 * The window is left out entirely for sources that do not depend on it — the
 * catalogue is the same catalogue whichever period is showing, and keying it by
 * window would refetch the lot every time someone switched from 7 to 30 days.
 * Where it is included it is rounded to the minute, so two reads a few seconds
 * apart share a slot instead of each filling one.
 */
export interface SlotScope {
  /** The shop the payload belongs to, or null when the source is account-wide. */
  readonly shopId: number | null;
  /** The period it answers, or null when the payload has no period. */
  readonly window: DateWindow | null;
}

export function slotKey(slot: SlotScope): string {
  const partition = slot.shopId === null ? 'acc' : `sh${slot.shopId}`;
  if (slot.window === null) return partition;

  const minute = 60_000;
  const from = Math.floor(slot.window.fromMs / minute);
  const to = Math.floor(slot.window.toMs / minute);
  return `${partition}.w${from}-${to}`;
}

/** The window a source is keyed by, or null when it does not depend on one. */
export function scopeWindow(scope: Scope, periodic: boolean): DateWindow | null {
  return periodic ? { fromMs: scope.fromMs, toMs: scope.toMs } : null;
}

/* ── read ───────────────────────────────────────────────────────────────── */

export interface BufferHit {
  readonly stored: StoredPayload;
  /** When Uzum was last asked. */
  readonly at: number;
  /** Whether the freshness window has passed and a refetch is due. */
  readonly stale: boolean;
}

/** The configured freshness window, in milliseconds. */
export function freshnessMs(): number {
  return readDataSettings().freshnessMinutes * 60_000;
}

/**
 * Whether a stored payload still looks like something this build can read.
 *
 * Positional storage is unforgiving: a table whose header is missing would be
 * read as a table of empty rows rather than failing, so every table is
 * shape-checked before any of it is handed out.
 */
function soundTables(value: unknown): Readonly<Record<string, PackedTable>> | null {
  if (typeof value !== 'object' || value === null) return null;

  for (const table of Object.values(value as Record<string, unknown>)) {
    if (!isTable(table)) return null;
  }

  return value as Readonly<Record<string, PackedTable>>;
}

/**
 * What the buffer holds for this source and scope, or null.
 *
 * A hit is returned even when it is stale, and says so. That distinction is the
 * whole point of a buffer: a caller that cannot reach the network can still
 * render last night's numbers and label them, rather than showing nothing.
 */
export async function readBuffer(source: string, scope: string): Promise<BufferHit | null> {
  const account = accountFingerprint();

  let slot: Awaited<ReturnType<typeof readSlot>>;
  try {
    slot = await readSlot(account, source, scope);
  } catch {
    /* Storage that cannot be read is storage that holds nothing, as far as
       every caller is concerned. The app degrades to fetching. */
    return null;
  }

  if (slot === null) return null;

  const tables = soundTables(slot.tables);
  if (tables === null) {
    await dropSlot(account, source, scope);
    return null;
  }

  return {
    stored: { meta: slot.meta, tables },
    at: slot.at,
    stale: Date.now() - slot.at >= freshnessMs(),
  };
}

/* ── write ──────────────────────────────────────────────────────────────── */

/**
 * Store a payload.
 *
 * Returns whether it was persisted. A payload that would not fit is served in
 * full this once and simply will not be there next time — worth saying, not
 * worth failing, which is why every caller treats `false` as a note rather than
 * an error.
 */
export function writeBuffer(
  source: string,
  scope: string,
  stored: StoredPayload,
): Promise<boolean> {
  return writeSlot(accountFingerprint(), source, scope, {
    meta: stored.meta,
    tables: stored.tables,
  });
}

/* ── housekeeping ───────────────────────────────────────────────────────── */

export function drop(source: string, scope: string): Promise<void> {
  return dropSlot(accountFingerprint(), source, scope);
}

/** Forget everything this account has buffered — on sign-out or token change. */
export async function clearBuffer(): Promise<void> {
  await dropAccountSlots(accountFingerprint());
}

/** Forget every account's slots. Used by the "delete all local data" path. */
export async function clearAllBuffers(): Promise<void> {
  await clearSlots();
}

export function bufferUsage(): Promise<BufferUsage> {
  return readUsage(accountFingerprint());
}

export type { BufferUsage };
