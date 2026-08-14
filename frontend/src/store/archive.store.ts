import { create } from 'zustand';

import {
  archivedShops,
  readShopMeta,
  usage,
  type ShopUsage,
} from '@/services/storage/archive/archive.service';
import { bounds, density, span, type Coverage } from '@/services/storage/archive/coverage';
import { estimateStorage, type StorageEstimate } from '@/services/storage/idb/db';
import { toCoverage } from '@/services/storage/idb/metadata.repo';
import {
  ALL_ENTITY_TYPES,
  ENTITY_TYPES,
  type SyncMetadataRecord,
} from '@/services/storage/idb/schema';

/**
 * The archive, as the interface sees it.
 *
 * IndexedDB has no change events for writes made by this tab, so the coverage a
 * screen is drawing would otherwise go stale the moment a sync finished. This
 * store is the subscription: the sync engine calls `refresh` when a run lands,
 * and every panel reading coverage re-renders against the record that was
 * actually written.
 *
 * Reading is asynchronous now, which is the visible consequence of the storage
 * migration in this file. Under localStorage the whole view could be built
 * synchronously at module init, so the first render already had it. Here the
 * store starts empty and fills in — `loading` is a real state and the panels
 * that read it say so, rather than briefly claiming the archive is empty.
 *
 * Nothing is computed here that the archive does not already know. Each view is
 * a shop's own coverage record plus the arithmetic the UI would otherwise do
 * three times — how much time is held, whether it has holes, how many rows.
 */

export interface ShopArchiveView {
  readonly shopId: number;
  /** Coverage and backfill state, per entity. */
  readonly meta: Readonly<Record<string, SyncMetadataRecord>>;
  readonly usage: ShopUsage;
  /** The settled ledger's coverage, which is what the bar draws. */
  readonly ledgerRanges: Coverage;
  /** Outer bounds of the settled ledger, or null when nothing is stored. */
  readonly from: number | null;
  readonly to: number | null;
  /** Days of history actually held, holes excluded. */
  readonly days: number;
  /** Share of the outer bounds that is covered, 0–1. Under 1 means gaps. */
  readonly density: number;
  readonly backfillComplete: boolean;
  readonly catalogAt: number | null;
  readonly syncedAt: number | null;
}

interface ArchiveState {
  readonly shops: readonly ShopArchiveView[];
  readonly estimate: StorageEstimate | null;
  readonly refreshedAt: number | null;
  readonly loading: boolean;
  refresh: () => Promise<void>;
}

const DAY_MS = 86_400_000;

async function viewOf(shopId: number): Promise<ShopArchiveView> {
  const [meta, shopUsage] = await Promise.all([
    readShopMeta(shopId, ALL_ENTITY_TYPES),
    usage(shopId),
  ]);

  const ledger = meta[ENTITY_TYPES.orderItem];
  const catalog = meta[ENTITY_TYPES.catalogSku];
  const ranges = ledger === undefined ? [] : toCoverage(ledger.synced_ranges);
  const outer = bounds(ranges);

  return {
    shopId,
    meta,
    usage: shopUsage,
    ledgerRanges: ranges,
    from: outer?.fromMs ?? null,
    to: outer?.toMs ?? null,
    days: span(ranges) / DAY_MS,
    density: density(ranges),
    backfillComplete: ledger?.backfill_complete ?? false,
    catalogAt: catalog?.captured_at ?? null,
    syncedAt: ledger?.last_synced_at ?? null,
  };
}

/**
 * Guard against overlapping refreshes.
 *
 * A sync landing while the settings pane is already reloading would otherwise
 * let the older read resolve last and overwrite the newer figures. The counter
 * is compared on resolution and a stale result is dropped.
 */
let generation = 0;

export const useArchiveStore = create<ArchiveState>()((set) => ({
  shops: [],
  estimate: null,
  refreshedAt: null,
  loading: false,

  refresh: async () => {
    generation += 1;
    const mine = generation;

    set({ loading: true });

    try {
      const shopIds = await archivedShops();
      const [shops, estimate] = await Promise.all([
        Promise.all(shopIds.map(viewOf)),
        estimateStorage(),
      ]);

      if (mine !== generation) return;
      set({ shops, estimate, refreshedAt: Date.now(), loading: false });
    } catch {
      if (mine !== generation) return;
      /* Storage that cannot be read holds nothing, as far as this view is
         concerned. The panes draw their empty state. */
      set({ shops: [], refreshedAt: Date.now(), loading: false });
    }
  },
}));

/** One shop's view, or null when it holds nothing yet. */
export const selectShop =
  (shopId: number) =>
  (state: ArchiveState): ShopArchiveView | null =>
    state.shops.find((shop) => shop.shopId === shopId) ?? null;

/** Total rows the archive holds across every shop. */
export const selectTotalRows = (state: ArchiveState): number =>
  state.shops.reduce((sum, shop) => sum + shop.usage.totalRows, 0);
