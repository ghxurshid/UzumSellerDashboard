import type { ShopProduct, SkuAmount } from '@/services/uzum/types';

/**
 * The archive's domain model: what a catalogue row is, and what a change to one
 * is.
 *
 * This file used to be a *codec* in the literal sense — it packed rows into
 * positional tuples against a shared string table, because a raw finance order
 * item is about 1 900 characters and localStorage gave the whole origin five
 * megabytes. Packing bought roughly a twentyfold reduction, and the cost was
 * that position became contract: appending a field to a tuple was a schema
 * change that would silently misread every stored row if the version was not
 * bumped with it.
 *
 * That trade no longer exists. IndexedDB stores structured clones, so a number
 * occupies a number's worth of space rather than its decimal spelling, and — the
 * part that actually decided it — an index can only be built over a *named*
 * field. Tuples cannot be indexed, and indexing is the whole reason for the
 * migration. The packing is gone; see `idb/mappers.ts` for the flat records that
 * replaced it.
 *
 * What remains here is the part that was never about storage: the projection of
 * the seller API's catalogue into the SKU facts worth watching, and the
 * comparison of two captures into a change history the API does not publish.
 */

/* ── catalogue state ────────────────────────────────────────────────────── */

/**
 * A SKU's mutable facts.
 *
 * Exactly the fields worth noticing a change in — price, cost, stock, status,
 * rank, whether a discount is running — and nothing that is merely descriptive.
 * This is the row the change journal diffs against, so anything added here
 * becomes something the journal will start reporting moves in.
 */
export interface CatalogSku {
  readonly skuId: number;
  readonly productId: number;
  readonly title: string;
  readonly price: number;
  readonly purchasePrice: number;
  readonly quantityAvailable: number;
  readonly quantityActive: number;
  readonly quantityFbs: number;
  readonly quantitySold: number;
  readonly quantityReturned: number;
  readonly rank: string;
  /** Whether a discount or special offer was running when this was captured. */
  readonly discount: boolean;
  /** FBS warehouse amount from `/v3/fbs/sku/stocks`, −1 when the SKU is absent. */
  readonly fbsStock: number;
  readonly barcode: number;
}

/** Ranks are a short fixed alphabet; anything unrecognised sorts as −1. */
export const RANKS = ['A', 'B', 'C', 'D', 'E'] as const;

/** A rank's ordinal, for the numeric `from`/`to` a change event carries. */
export function rankIndex(rank: string): number {
  return RANKS.indexOf(rank as (typeof RANKS)[number]);
}

/**
 * The live payload carries several overlapping discount signals that the
 * published schema does not document. Any of them being set means the SKU was
 * not selling at its own price when this snapshot was taken, which is the only
 * distinction the journal draws.
 */
function hasDiscount(sku: Record<string, unknown>): boolean {
  if (sku['hasActiveDiscount'] === true) return true;
  if (sku['activeSale'] !== null && sku['activeSale'] !== undefined) return true;

  const offer = sku['specialOffer'];
  if (offer !== null && typeof offer === 'object') {
    const endDate = (offer as { endDate?: unknown }).endDate;
    if (typeof endDate === 'number' && endDate > Date.now()) return true;
  }

  return false;
}

/**
 * Flatten a shop's catalogue into the SKU rows the archive keeps.
 *
 * FBS amounts come from a different route than the catalogue, so they are
 * joined here by `skuId`. A SKU the stock route does not mention keeps −1
 * rather than 0: "not carried on FBS" and "carried, none left" are different
 * facts, and only the second one is a stockout.
 */
export function projectCatalog(
  products: readonly ShopProduct[],
  stocks: readonly SkuAmount[],
): readonly CatalogSku[] {
  const fbsBySku = new Map(stocks.map((stock) => [stock.skuId, stock.amount]));

  return products.flatMap((product) =>
    (product.skuList ?? []).map((sku): CatalogSku => {
      const loose = sku as unknown as Record<string, unknown>;
      const barcode = typeof sku.barcode === 'number' ? sku.barcode : Number(sku.barcode ?? 0);

      return {
        skuId: sku.skuId,
        productId: product.productId,
        title: sku.skuFullTitle ?? sku.skuTitle ?? product.title ?? '',
        price: sku.price ?? 0,
        purchasePrice: sku.purchasePrice ?? 0,
        quantityAvailable: sku.quantityAvailable ?? 0,
        quantityActive: sku.quantityActive ?? 0,
        quantityFbs: sku.quantityFbs ?? 0,
        quantitySold: sku.quantitySold ?? 0,
        quantityReturned: sku.quantityReturned ?? 0,
        rank: sku.rankInfo?.rank ?? '',
        discount: hasDiscount(loose),
        fbsStock: fbsBySku.get(sku.skuId) ?? -1,
        barcode: Number.isFinite(barcode) ? barcode : 0,
      };
    }),
  );
}

/* ── change journal ─────────────────────────────────────────────────────── */

/**
 * What the journal watches.
 *
 * Every one of these is a decision the seller (or Uzum) made about a SKU, and
 * every one of them plausibly moves demand — which is the point of recording
 * them. Quantities are watched only at the zero boundary; the raw number moves
 * on every sale and journaling that would be a sales log written badly.
 */
export const CHANGE_FIELDS = ['price', 'purchasePrice', 'stock', 'rank', 'discount'] as const;

export type ChangeField = (typeof CHANGE_FIELDS)[number];

export interface ChangeEvent {
  /** When the sync that noticed the change ran — not when Uzum applied it. */
  readonly at: number;
  readonly skuId: number;
  readonly productId: number;
  readonly field: ChangeField;
  readonly from: number;
  readonly to: number;
}

/**
 * Why a change history has to be derived rather than fetched.
 *
 * The seller OpenAPI has thirty-five routes and not one of them replays a
 * change: prices can be *written* and read as a current value, but no endpoint
 * answers "what was this SKU's price on 15 July", and no product or SKU field
 * carries a modification timestamp. So a change history cannot be fetched — it
 * can only be *observed*, by comparing one capture against the previous one.
 *
 * Two consequences worth stating plainly. The journal begins on the first sync
 * after this feature exists and cannot be backdated; and a change made between
 * two syncs is dated to the sync that noticed it rather than to the moment Uzum
 * applied it. Realised selling prices, by contrast, *are* recoverable
 * retroactively — every settled order item carries its own `sellPrice` and
 * `date` — so the price a shop actually sold at is derivable for the whole
 * archived period, while the journal explains the deliberate moves behind it
 * from here on.
 *
 * SKUs absent from `before` produce nothing: a SKU appearing for the first time
 * is a catalogue addition, not a price change, and emitting "price 0 → 75 000"
 * for every SKU on the first sync would bury the real changes under the whole
 * catalogue. The same reasoning applies to a SKU that disappears.
 */
export function diffCatalog(
  before: readonly CatalogSku[],
  after: readonly CatalogSku[],
  at: number,
): readonly ChangeEvent[] {
  const previous = new Map(before.map((sku) => [sku.skuId, sku]));
  const events: ChangeEvent[] = [];

  for (const sku of after) {
    const was = previous.get(sku.skuId);
    if (was === undefined) continue;

    const emit = (field: ChangeField, from: number, to: number): void => {
      if (from === to) return;
      events.push({ at, skuId: sku.skuId, productId: sku.productId, field, from, to });
    };

    emit('price', was.price, sku.price);
    emit('purchasePrice', was.purchasePrice, sku.purchasePrice);
    emit('discount', was.discount ? 1 : 0, sku.discount ? 1 : 0);
    emit('rank', rankIndex(was.rank), rankIndex(sku.rank));

    /* Stock is watched at the zero boundary only — see CHANGE_FIELDS. The
       recorded values are the real quantities either side of the crossing, so
       the event still says how deep the restock was. */
    const wasEmpty = was.quantityAvailable <= 0;
    const isEmpty = sku.quantityAvailable <= 0;
    if (wasEmpty !== isEmpty) emit('stock', was.quantityAvailable, sku.quantityAvailable);
  }

  return events;
}
