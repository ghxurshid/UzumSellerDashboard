import type { DateWindow } from '@/services/uzum/endpoints';
import type { FinanceOrderItem, SellerPayment } from '@/services/uzum/types';

import type { CatalogSku, ChangeEvent, ChangeField } from '../archive/codec';
import { CHANGE_FIELDS } from '../archive/codec';
import { readStorage } from '../localStorage';

/**
 * Readers for the previous storage engine.
 *
 * Everything in this file describes a format the application no longer writes.
 * It exists for one purpose: an installed copy of this app holds a user's
 * archive in localStorage — potentially two years of settled history that cost
 * hundreds of rate-limited requests to build — and throwing it away because the
 * storage engine changed underneath would be the worst possible outcome of an
 * improvement. So the old format is read once, imported, and then deleted.
 *
 * ## What the old format was, and why
 *
 * Rows were stored as **positional tuples against a shared string table**,
 * because localStorage charges per UTF-16 code unit and gives an origin about
 * five megabytes. A finance order item as the API sends it is roughly 1 900
 * characters; packed like this it is closer to ninety. That compression is the
 * only reason the archive could hold more than a fortnight.
 *
 * Position was therefore contract, and it still is *here*: these unpackers must
 * keep reading the column order that was written, whatever the current code
 * does. That is why they are frozen copies rather than imports — a change to
 * today's model must not silently change how yesterday's bytes are read.
 *
 * This module is expected to be deleted once no installation can still be
 * carrying a localStorage archive.
 */

/* ── frozen constants from the retired codec ────────────────────────────── */

const LEGACY_ARCHIVE_VERSION = 1;
const LEGACY_CODEC_VERSION = 1;

const LEGACY_PREFIX = 'savdo.arc';
const LEGACY_BUFFER_PREFIX = 'savdo.buf';

export const LEGACY_SETTINGS_KEY = 'savdo.settings';
export const LEGACY_NOTIFICATIONS_KEY = 'savdo.notifications';
export const LEGACY_SYNC_KEY = 'savdo.sync';

const LEGACY_ARCHIVE_PARTS = ['meta', 'ledger', 'expenses', 'catalog', 'journal'] as const;
type LegacyPart = (typeof LEGACY_ARCHIVE_PARTS)[number];

/** Column order of a packed order item, exactly as it was written. */
const ORDER_STATUSES = ['TO_WITHDRAW', 'PROCESSING', 'CANCELED', 'PARTIALLY_CANCELLED'] as const;
const EXPENSE_TYPES = ['OUTCOME', 'INCOME'] as const;
const RANKS = ['A', 'B', 'C', 'D', 'E'] as const;

/* ── the retired string table ───────────────────────────────────────────── */

function stringAt(table: readonly string[], position: number): string {
  return table[position] ?? '';
}

/* ── key layout ─────────────────────────────────────────────────────────── */

function legacyKey(account: string, shopId: number, part: LegacyPart): string {
  return `${LEGACY_PREFIX}.${account}.${shopId}.${part}`;
}

function legacyIndexKey(account: string): string {
  return `${LEGACY_PREFIX}.${account}.index`;
}

function legacyBufferIndexKey(account: string): string {
  return `${LEGACY_BUFFER_PREFIX}.${account}.#index`;
}

/* ── block parsing ──────────────────────────────────────────────────────── */

interface LegacyBlock {
  readonly v: number;
  readonly c: number;
  readonly shop: number;
  readonly t?: readonly string[];
  readonly at?: number;
  readonly r: readonly (readonly number[])[];
}

/**
 * Validate and parse a stored block.
 *
 * Both versions must match exactly. A packed row is positional, so a block
 * written by a different codec is not merely stale — read with the wrong column
 * order it would report one month's commission as another's profit. Refusing to
 * import it is the only safe answer.
 */
function parseBlock(raw: string | null, shopId: number): LegacyBlock | null {
  if (raw === null || raw === '') return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed['v'] !== LEGACY_ARCHIVE_VERSION) return null;
    if (parsed['c'] !== LEGACY_CODEC_VERSION) return null;
    if (parsed['shop'] !== shopId) return null;
    if (!Array.isArray(parsed['r'])) return null;
    return parsed as unknown as LegacyBlock;
  } catch {
    return null;
  }
}

/* ── the retired shop index ─────────────────────────────────────────────── */

/** Shops the previous engine stored anything for. */
export function legacyShopIds(account: string): readonly number[] {
  const raw = readStorage(legacyIndexKey(account));
  if (raw === null) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
  } catch {
    return [];
  }
}

/** Whether anything at all is waiting to be imported for this account. */
export function hasLegacyData(account: string): boolean {
  if (legacyShopIds(account).length > 0) return true;
  if (readStorage(LEGACY_SETTINGS_KEY) !== null) return true;
  if (readStorage(LEGACY_NOTIFICATIONS_KEY) !== null) return true;
  if (readStorage(LEGACY_SYNC_KEY) !== null) return true;
  return false;
}

/* ── coverage ───────────────────────────────────────────────────────────── */

export interface LegacyPartCoverage {
  readonly ranges: readonly DateWindow[];
  readonly rows: number;
  readonly evictedBefore: number | null;
}

export interface LegacyShopMeta {
  readonly shopId: number;
  readonly ledger: LegacyPartCoverage;
  readonly expenses: LegacyPartCoverage;
  readonly catalogAt: number | null;
  readonly journalSince: number | null;
  readonly syncedAt: number | null;
  readonly backfillComplete: boolean;
  readonly backfillFrom: number | null;
}

const EMPTY_PART: LegacyPartCoverage = { ranges: [], rows: 0, evictedBefore: null };

function parseRanges(value: unknown): readonly DateWindow[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): DateWindow[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const range = entry as Record<string, unknown>;
    const fromMs = range['fromMs'];
    const toMs = range['toMs'];
    if (typeof fromMs !== 'number' || !Number.isFinite(fromMs)) return [];
    if (typeof toMs !== 'number' || !Number.isFinite(toMs)) return [];
    return [{ fromMs, toMs }];
  });
}

function parsePart(value: unknown): LegacyPartCoverage {
  if (typeof value !== 'object' || value === null) return EMPTY_PART;
  const part = value as Record<string, unknown>;
  const evicted = part['evictedBefore'];

  return {
    ranges: parseRanges(part['ranges']),
    rows: typeof part['rows'] === 'number' ? part['rows'] : 0,
    evictedBefore: typeof evicted === 'number' ? evicted : null,
  };
}

function stamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The old coverage record.
 *
 * This is the most valuable thing in the whole import — more valuable than the
 * rows. The rows can, in principle, be re-fetched; the record of *which periods
 * have already been fetched* is what stops the next sync from re-fetching two
 * years of history at fifty rows per request. Losing it would turn a working
 * installation into a first-run backfill.
 */
export function readLegacyMeta(account: string, shopId: number): LegacyShopMeta | null {
  const raw = readStorage(legacyKey(account, shopId, 'meta'));
  if (raw === null || raw === '') return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed['version'] !== LEGACY_ARCHIVE_VERSION) return null;
    if (parsed['shopId'] !== shopId) return null;

    return {
      shopId,
      ledger: parsePart(parsed['ledger']),
      expenses: parsePart(parsed['expenses']),
      catalogAt: stamp(parsed['catalogAt']),
      journalSince: stamp(parsed['journalSince']),
      syncedAt: stamp(parsed['syncedAt']),
      backfillComplete: parsed['backfillComplete'] === true,
      backfillFrom: stamp(parsed['backfillFrom']),
    };
  } catch {
    return null;
  }
}

/* ── row unpacking ──────────────────────────────────────────────────────── */

/** Settled order items, in the wire shape the rest of the app understands. */
export function readLegacyLedger(account: string, shopId: number): readonly FinanceOrderItem[] {
  const block = parseBlock(readStorage(legacyKey(account, shopId, 'ledger')), shopId);
  if (block === null) return [];

  const titles = block.t ?? [];

  return block.r.map((row): FinanceOrderItem => {
    const status = ORDER_STATUSES[row[2] ?? -1] ?? '';
    const returnCause = row[15] === -1 ? null : stringAt(titles, row[15] ?? -1);

    return {
      id: row[0] ?? 0,
      date: row[1] ?? 0,
      status,
      orderId: row[3] ?? 0,
      productId: row[4] ?? 0,
      skuTitle: stringAt(titles, row[5] ?? -1),
      productTitle: stringAt(titles, row[6] ?? -1),
      shopId,
      sellPrice: row[7] ?? 0,
      amount: row[8] ?? 0,
      amountReturns: row[9] ?? 0,
      commission: row[10] ?? 0,
      sellerProfit: row[11] ?? 0,
      purchasePrice: row[12] ?? 0,
      logisticDeliveryFee: row[13] ?? 0,
      withdrawnProfit: row[14] ?? 0,
      returnCause,
      cancelled: status === 'CANCELED' ? true : null,
      dateIssued: null,
      comment: null,
    };
  });
}

export function readLegacyExpenses(account: string, shopId: number): readonly SellerPayment[] {
  const block = parseBlock(readStorage(legacyKey(account, shopId, 'expenses')), shopId);
  if (block === null) return [];

  const titles = block.t ?? [];

  return block.r.map((row): SellerPayment => ({
    id: row[0] ?? 0,
    dateCreated: row[1] ?? 0,
    dateUpdated: null,
    name: stringAt(titles, row[2] ?? -1),
    source: stringAt(titles, row[3] ?? -1),
    shopId,
    sellerId: 0,
    paymentPrice: row[4] ?? 0,
    amount: row[5] ?? 0,
    type: EXPENSE_TYPES[row[6] ?? -1] ?? '',
    status: '',
    externalId: null,
    code: stringAt(titles, row[7] ?? -1),
    dateService: null,
  }));
}

export interface LegacyCatalog {
  readonly at: number | null;
  readonly skus: readonly CatalogSku[];
}

export function readLegacyCatalog(account: string, shopId: number): LegacyCatalog {
  const block = parseBlock(readStorage(legacyKey(account, shopId, 'catalog')), shopId);
  if (block === null) return { at: null, skus: [] };
  if (typeof block.at !== 'number' || !Number.isFinite(block.at)) return { at: null, skus: [] };

  const titles = block.t ?? [];

  return {
    at: block.at,
    skus: block.r.map((row): CatalogSku => ({
      skuId: row[0] ?? 0,
      productId: row[1] ?? 0,
      title: stringAt(titles, row[2] ?? -1),
      price: row[3] ?? 0,
      purchasePrice: row[4] ?? 0,
      quantityAvailable: row[5] ?? 0,
      quantityActive: row[6] ?? 0,
      quantityFbs: row[7] ?? 0,
      quantitySold: row[8] ?? 0,
      quantityReturned: row[9] ?? 0,
      rank: RANKS[row[10] ?? -1] ?? '',
      discount: row[11] === 1,
      fbsStock: row[12] ?? 0,
      barcode: row[13] ?? 0,
    })),
  };
}

export function readLegacyJournal(account: string, shopId: number): readonly ChangeEvent[] {
  const block = parseBlock(readStorage(legacyKey(account, shopId, 'journal')), shopId);
  if (block === null) return [];

  return block.r.flatMap((row): ChangeEvent[] => {
    const field = CHANGE_FIELDS[row[3] ?? -1];
    if (field === undefined) return [];

    return [
      {
        at: row[0] ?? 0,
        skuId: row[1] ?? 0,
        productId: row[2] ?? 0,
        field: field as ChangeField,
        from: row[4] ?? 0,
        to: row[5] ?? 0,
      },
    ];
  });
}

/* ── the keys to remove afterwards ──────────────────────────────────────── */

/**
 * Every localStorage key this account's data occupies.
 *
 * Returned rather than deleted here, so the import can commit everything first
 * and delete only once the new store holds it. An import that removed as it read
 * and then failed half way would lose the half it had already consumed.
 *
 * Buffer slots are included and are deliberately *not* imported: they hold
 * re-readable payloads that expire within minutes to hours, so carrying them
 * across is work for data that is about to be refetched anyway. Their keys still
 * have to go, or they would occupy the old origin's quota forever.
 */
export function legacyKeys(account: string): readonly string[] {
  const keys: string[] = [
    LEGACY_SETTINGS_KEY,
    LEGACY_NOTIFICATIONS_KEY,
    LEGACY_SYNC_KEY,
    legacyIndexKey(account),
    legacyBufferIndexKey(account),
  ];

  for (const shopId of legacyShopIds(account)) {
    for (const part of LEGACY_ARCHIVE_PARTS) keys.push(legacyKey(account, shopId, part));
  }

  /* Buffer slots are keyed by source and scope, which the index knew and the
     key layout does not encode discoverably. The index itself lists them. */
  const bufferIndex = readStorage(legacyBufferIndexKey(account));
  if (bufferIndex !== null) {
    try {
      const parsed = JSON.parse(bufferIndex) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'object' && entry !== null) {
            const key = (entry as { key?: unknown }).key;
            if (typeof key === 'string') keys.push(key);
          }
        }
      }
    } catch {
      /* An unreadable index leaves its slots behind; they expire on their own
         and are bounded by the old five-megabyte ceiling. */
    }
  }

  return keys;
}

export { LEGACY_ARCHIVE_PARTS };
