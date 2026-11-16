/**
 * A tolerant reader for the cabinet's `getProducts` response.
 *
 * Panel side only (never import it from the content script). It describes the
 * wire and computes nothing: no sums, no conversions, no unit. The lookup
 * decides what to show.
 *
 * EVIDENCE: ONE recorded response (request B: `filter=ALL`, size 24), trimmed by
 * the person who captured it to ONE product of the 24 its page would carry. Every
 * field below is typed optional and nullable because one response cannot tell
 * which are always present or of which type. The comments on the types state
 * what that response showed, as observation, never as a contract.
 *
 * Two views of every entry, because a mistyped value must not turn into "null":
 *  - `raw`: the entry exactly as the response held it. This is what is printed.
 *  - `fields`: a typed view for logic only; a field of a type the recorded
 *    response did not show is absent there, and its path is listed in `mistyped`.
 * Nothing throws; unknown fields stay in `raw` and are ignored in `fields`.
 */

/** The wire type a field showed in the one recorded response. */
type Spec =
  | 'number'
  | 'string'
  | 'boolean'
  | 'numbers'
  | 'skus'
  | { readonly obj: Readonly<Record<string, Spec>> }
  | { readonly arr: Readonly<Record<string, Spec>> };

type SpecMap = Readonly<Record<string, Spec>>;

const MISTYPED_LIMIT = 50;

const LOCALISED: Spec = { obj: { uz: 'string', ru: 'string' } };
const SPLIT: Spec = { obj: { fbo: 'number', fbs: 'number' } };
const RANK: Spec = { obj: { rank: 'string', rankValue: 'string', dateUpdated: 'number' } };

const SKU_SPEC: SpecMap = {
  skuTitle: 'string', skuFullTitle: 'string', productTitle: 'string', skuId: 'number',
  quantityCreated: 'number', quantityAvailable: 'number', quantityAvailableByStockType: SPLIT,
  quantityActive: 'number', quantityFbs: 'number', quantityAdditional: 'number',
  quantityOnPhotoStudio: 'number', quantityArchived: 'number', quantitySold: 'number',
  quantityReturned: 'number', quantityMissing: 'number', quantityDefected: 'number',
  quantityPending: 'number', returnedPercentage: 'number', barcode: 'number',
  archived: 'boolean', commission: 'number', characteristics: 'string', previewImage: 'string',
  ikpu: 'string', price: 'number', purchasePrice: 'number', recommendedTotalPrice: 'number',
  blockingReason: 'string', blocked: 'boolean', rankInfo: RANK, article: 'string',
  turnover: 'number', dimensionalGroup: 'string', paidStorageDimensionalGroup: 'string',
  paidStoragePriceItem: 'number', paidStorageAmount: 'number', actualDimensionalGroup: 'string',
  hasStudioPhoto: 'boolean', forecastOutOfStock: 'boolean', activeSale: 'boolean',
  switchbackActive: 'boolean', marketPrice: 'number',
  characteristicsList: {
    arr: { characteristicTitle: LOCALISED, definedType: 'boolean', characteristicValue: LOCALISED },
  },
  status: { obj: { value: 'string', title: 'string', color: 'string' } },
  skuDimension: { obj: { length: 'number', width: 'number', height: 'number', weight: 'number' } },
  updatedFromWms: 'boolean', hasActiveDiscount: 'boolean', sellerItemCode: 'string',
  specialOffer: {
    obj: {
      inOffer: 'boolean', hasRecommendation: 'boolean', mechanicType: 'string',
      mechanicPrice: 'number', endDate: 'number', promoName: 'string', selfExit: 'boolean',
      promoIds: 'numbers',
    },
  },
  isWithoutWeightDimensional: 'boolean', avgdsales: 'number', avgdquantity: 'number',
  pstorage: 'boolean',
};

const PRODUCT_SPEC: SpecMap = {
  productId: 'number', category: 'string', rating: 'string', feedbackQuantity: 'number',
  status: { obj: { id: 'number', title: 'string', value: 'string', description: 'string', color: 'string' } },
  moderationStatus: { obj: { title: 'string', color: 'string', value: 'string', hasAnySkuBlocked: 'boolean' } },
  commission: 'number',
  commissionDto: { obj: { minCommission: 'number', maxCommission: 'number' } },
  skuList: 'skus',
  skuTitle: 'string', image: 'string', previewImg: 'string', title: 'string',
  quantityAvailable: 'number', quantityAvailableByStockType: SPLIT, quantityReserved: 'number',
  quantityActive: 'number', quantityFbs: 'number', quantityAdditional: 'number',
  quantityOnPhotoStudio: 'number', quantityCreated: 'number', quantitySold: 'number',
  quantityReturned: 'number', quantityMissing: 'number', quantityDefected: 'number',
  quantityPending: 'number', quantityArchived: 'number', returnedPercentage: 'number',
  newYearStatus: { obj: { title: 'string', color: 'string', value: 'string' } },
  price: 'number', clicks: 'number', viewers: 'number', conversion: 'number', roi: 'string',
  rankInfo: RANK, blockReason: 'string', blockComment: 'string', dateModerated: 'number',
  volumeDiscount: 'number', skusHasAllRequiredFilters: 'boolean', allFiltersFilled: 'boolean',
  auctionMember: 'boolean', isEditable: 'boolean', isEditableSku: 'boolean', isActive: 'boolean',
  isDeletable: 'boolean', isIlliquid: 'boolean', switchbackActive: 'boolean',
  promotionStatus: 'string', createdByFlowB: 'boolean', isWithoutWeightDimensional: 'boolean',
  cpoAdvertisementsDetails: {
    obj: {
      advCpoId: 'string', productId: 'number', commissionPercentage: 'number',
      minCommissionPercentage: 'number', maxCommissionPercentage: 'number', status: 'string',
      cpoVersion: 'number',
    },
  },
  pstorage: 'boolean',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bounded, so a hostile page cannot grow the list without limit. */
class Mistyped {
  readonly paths = new Set<string>();
  add(path: string): void {
    if (this.paths.size < MISTYPED_LIMIT) this.paths.add(path);
  }
}

/** null and absent are never "mistyped": null is a value the sample itself showed. */
function readValue(raw: unknown, spec: Spec, path: string, bad: Mistyped): unknown {
  if (raw === null || raw === undefined) return raw;
  if (spec === 'skus') return undefined; // read by `readProductsPage`, never here
  if (spec === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  } else if (spec === 'string') {
    if (typeof raw === 'string') return raw;
  } else if (spec === 'boolean') {
    if (typeof raw === 'boolean') return raw;
  } else if (spec === 'numbers') {
    if (Array.isArray(raw) && raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return raw as number[];
    }
  } else if ('obj' in spec) {
    if (isObject(raw)) return readObject(raw, spec.obj, path, bad);
  } else if (Array.isArray(raw)) {
    const out: unknown[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const entry: unknown = raw[i];
      if (isObject(entry)) out.push(readObject(entry, spec.arr, `${path}[]`, bad));
      else bad.add(`${path}[]`);
    }
    return out;
  }
  bad.add(path);
  return undefined;
}

function readObject(raw: Record<string, unknown>, spec: SpecMap, path: string, bad: Mistyped): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec)) {
    const fieldSpec = spec[key];
    if (fieldSpec === undefined || fieldSpec === 'skus') continue;
    if (!(key in raw)) continue;
    const value = readValue(raw[key], fieldSpec, path === '' ? key : `${path}.${key}`, bad);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

type Opt<T> = T | null | undefined;

/** `{ uz, ru }` text pair, as in `characteristicsList` (both languages were present in 2 of 2 entries of the one recorded SKU list). */
export interface CabinetLocalised {
  readonly uz?: Opt<string>;
  readonly ru?: Opt<string>;
}

/** `{ fbo, fbs }`: sample showed fbo equal to quantityAvailable and fbs 0 on 5 of 5 SKUs and on the product. */
export interface CabinetStockSplit {
  readonly fbo?: Opt<number>;
  readonly fbs?: Opt<number>;
}

/** Rank letters seen: A, C. `dateUpdated` is epoch MILLISECONDS (13 digits, 6 of 6 instances). */
export interface CabinetRankInfo {
  readonly rank?: Opt<string>;
  readonly rankValue?: Opt<string>;
  readonly dateUpdated?: Opt<number>;
}

export interface CabinetCharacteristic {
  readonly characteristicTitle?: Opt<CabinetLocalised>;
  readonly definedType?: Opt<boolean>;
  readonly characteristicValue?: Opt<CabinetLocalised>;
}

/**
 * Special offer. `endDate` is epoch MILLISECONDS (5 of 5 SKUs, all the same
 * instant); `unit` of `mechanicPrice` unknown (null in the sample, 5 of 5).
 */
export interface CabinetSpecialOffer {
  readonly inOffer?: Opt<boolean>;
  readonly hasRecommendation?: Opt<boolean>;
  /** Seen: UZUM_PROMO (5 of 5). */
  readonly mechanicType?: Opt<string>;
  readonly mechanicPrice?: Opt<number>;
  readonly endDate?: Opt<number>;
  readonly promoName?: Opt<string>;
  readonly selfExit?: Opt<boolean>;
  readonly promoIds?: Opt<readonly number[]>;
}

/**
 * One SKU as the single recorded response showed it (5 SKUs, one product).
 * Observations, none confirmed by a second response:
 *  - `quantityActive` equalled `quantityAvailable` (5 of 5 SKUs, one recorded response).
 *  - `price` equalled `marketPrice` (5 of 5 SKUs, one recorded response). The UNIT is not in the payload.
 *  - `returnedPercentage` is fractional and unrounded (e.g. 33.333333333333336).
 *  - `paidStorageAmount` and `paidStoragePriceItem` were null together on 1 SKU
 *    (no stock); `paidStorageAmount` was null with a price set where `pstorage`
 *    was false (1 SKU). `turnover` was set on 1 SKU, null on 4.
 *  - `barcode` was a number (5 of 5 SKUs, one recorded response; masked, 13 digits).
 *  - `sellerItemCode`, `article`, `photo`, `purchasePrice`, `recommendedTotalPrice`
 *    were null on 5 of 5, so their real type is unobserved.
 */
export interface CabinetSku {
  readonly skuTitle?: Opt<string>;
  readonly skuFullTitle?: Opt<string>;
  readonly productTitle?: Opt<string>;
  readonly skuId?: Opt<number>;
  readonly quantityCreated?: Opt<number>;
  readonly quantityAvailable?: Opt<number>;
  readonly quantityAvailableByStockType?: Opt<CabinetStockSplit>;
  readonly quantityActive?: Opt<number>;
  readonly quantityFbs?: Opt<number>;
  readonly quantityAdditional?: Opt<number>;
  readonly quantityOnPhotoStudio?: Opt<number>;
  readonly quantityArchived?: Opt<number>;
  readonly quantitySold?: Opt<number>;
  readonly quantityReturned?: Opt<number>;
  readonly quantityMissing?: Opt<number>;
  readonly quantityDefected?: Opt<number>;
  readonly quantityPending?: Opt<number>;
  readonly returnedPercentage?: Opt<number>;
  readonly barcode?: Opt<number>;
  readonly archived?: Opt<boolean>;
  readonly commission?: Opt<number>;
  /** Display text such as "L, <colour>"; localised by the request's accept-language. */
  readonly characteristics?: Opt<string>;
  readonly previewImage?: Opt<string>;
  readonly ikpu?: Opt<string>;
  readonly price?: Opt<number>;
  readonly purchasePrice?: Opt<number>;
  readonly recommendedTotalPrice?: Opt<number>;
  readonly blockingReason?: Opt<string>;
  readonly blocked?: Opt<boolean>;
  readonly rankInfo?: Opt<CabinetRankInfo>;
  readonly article?: Opt<string>;
  readonly turnover?: Opt<number>;
  /** Seen: a Russian group label on 4 SKUs, null on 1. */
  readonly dimensionalGroup?: Opt<string>;
  readonly paidStorageDimensionalGroup?: Opt<string>;
  readonly paidStoragePriceItem?: Opt<number>;
  readonly paidStorageAmount?: Opt<number>;
  readonly actualDimensionalGroup?: Opt<string>;
  readonly hasStudioPhoto?: Opt<boolean>;
  readonly forecastOutOfStock?: Opt<boolean>;
  readonly activeSale?: Opt<boolean>;
  readonly switchbackActive?: Opt<boolean>;
  readonly marketPrice?: Opt<number>;
  readonly characteristicsList?: Opt<readonly CabinetCharacteristic[]>;
  /** `value` seen: IN_STOCK (4), RUN_OUT (1). `title` is localised. */
  readonly status?: Opt<{
    readonly value?: Opt<string>;
    readonly title?: Opt<string>;
    readonly color?: Opt<string>;
  }>;
  /** Dimension unit is not in the payload. */
  readonly skuDimension?: Opt<{
    readonly length?: Opt<number>;
    readonly width?: Opt<number>;
    readonly height?: Opt<number>;
    readonly weight?: Opt<number>;
  }>;
  readonly updatedFromWms?: Opt<boolean>;
  readonly hasActiveDiscount?: Opt<boolean>;
  readonly sellerItemCode?: Opt<string>;
  readonly specialOffer?: Opt<CabinetSpecialOffer>;
  readonly isWithoutWeightDimensional?: Opt<boolean>;
  readonly avgdsales?: Opt<number>;
  readonly avgdquantity?: Opt<number>;
  readonly pstorage?: Opt<boolean>;
}

/**
 * One product as the single recorded response showed it (1 product).
 * Observations, none confirmed by a second response:
 *  - Quantities equalled the sum over its `skuList` (1 product in the one recorded response: available 15, sold 8,
 *    returned 9 on 1 product).
 *  - `rating` and `roi` were STRINGS ("5.0", "-100.0"), not numbers (1 product, one recorded response).
 *  - `commission` was null while the SKUs carried 25.5 (1 product).
 *  - `conversion` (1.16) and `viewers` (774) were present, `clicks` null; the
 *    formula behind `conversion` is not known from the sample.
 *  - Texts such as `category` and the status titles were Russian; the
 *    request carried `accept-language: ru-RU` (1 product).
 *  - `skusHasAllRequiredFilters` was true and `allFiltersFilled` false: the
 *    nearest thing in the payload to the request filter `WITHOUT_REQUIRED_FILTERS`.
 *  - `price` equalled the SKUs' price (1 product, 5 SKUs); its UNIT is not in the payload.
 *  - `moderationStatus.value` seen: MODERATED; `promotionStatus`: PROMOTION_AVAILABLE;
 *    `newYearStatus.value`: NONE; `cpoAdvertisementsDetails.status`: ACTIVE.
 */
export interface CabinetProduct {
  readonly productId?: Opt<number>;
  readonly category?: Opt<string>;
  readonly rating?: Opt<string>;
  readonly feedbackQuantity?: Opt<number>;
  readonly status?: Opt<{
    readonly id?: Opt<number>;
    readonly title?: Opt<string>;
    readonly value?: Opt<string>;
    readonly description?: Opt<string>;
    readonly color?: Opt<string>;
  }>;
  readonly moderationStatus?: Opt<{
    readonly title?: Opt<string>;
    readonly color?: Opt<string>;
    readonly value?: Opt<string>;
    readonly hasAnySkuBlocked?: Opt<boolean>;
  }>;
  readonly commission?: Opt<number>;
  readonly commissionDto?: Opt<{
    readonly minCommission?: Opt<number>;
    readonly maxCommission?: Opt<number>;
  }>;
  readonly skuList?: Opt<readonly CabinetSku[]>;
  readonly skuTitle?: Opt<string>;
  readonly image?: Opt<string>;
  readonly previewImg?: Opt<string>;
  readonly title?: Opt<string>;
  readonly quantityAvailable?: Opt<number>;
  readonly quantityAvailableByStockType?: Opt<CabinetStockSplit>;
  readonly quantityReserved?: Opt<number>;
  readonly quantityActive?: Opt<number>;
  readonly quantityFbs?: Opt<number>;
  readonly quantityAdditional?: Opt<number>;
  readonly quantityOnPhotoStudio?: Opt<number>;
  readonly quantityCreated?: Opt<number>;
  readonly quantitySold?: Opt<number>;
  readonly quantityReturned?: Opt<number>;
  readonly quantityMissing?: Opt<number>;
  readonly quantityDefected?: Opt<number>;
  readonly quantityPending?: Opt<number>;
  readonly quantityArchived?: Opt<number>;
  readonly returnedPercentage?: Opt<number>;
  readonly newYearStatus?: Opt<{
    readonly title?: Opt<string>;
    readonly color?: Opt<string>;
    readonly value?: Opt<string>;
  }>;
  readonly price?: Opt<number>;
  readonly clicks?: Opt<number>;
  readonly viewers?: Opt<number>;
  readonly conversion?: Opt<number>;
  readonly roi?: Opt<string>;
  readonly rankInfo?: Opt<CabinetRankInfo>;
  readonly blockReason?: Opt<string>;
  readonly blockComment?: Opt<string>;
  /** Null in the sample (1 of 1); if set, expected to be epoch milliseconds like the other timestamps, UNOBSERVED. */
  readonly dateModerated?: Opt<number>;
  readonly volumeDiscount?: Opt<number>;
  readonly skusHasAllRequiredFilters?: Opt<boolean>;
  readonly allFiltersFilled?: Opt<boolean>;
  readonly auctionMember?: Opt<boolean>;
  readonly isEditable?: Opt<boolean>;
  readonly isEditableSku?: Opt<boolean>;
  readonly isActive?: Opt<boolean>;
  readonly isDeletable?: Opt<boolean>;
  readonly isIlliquid?: Opt<boolean>;
  readonly switchbackActive?: Opt<boolean>;
  readonly promotionStatus?: Opt<string>;
  readonly createdByFlowB?: Opt<boolean>;
  readonly isWithoutWeightDimensional?: Opt<boolean>;
  readonly cpoAdvertisementsDetails?: Opt<{
    readonly advCpoId?: Opt<string>;
    readonly productId?: Opt<number>;
    readonly commissionPercentage?: Opt<number>;
    readonly minCommissionPercentage?: Opt<number>;
    readonly maxCommissionPercentage?: Opt<number>;
    readonly status?: Opt<string>;
    readonly cpoVersion?: Opt<number>;
  }>;
  readonly pstorage?: Opt<boolean>;
}

export interface CabinetSkuRecord {
  /** The typed, lenient view, for logic only (a mistyped field is absent here). */
  readonly fields: CabinetSku;
  /** The SKU as the response held it; what the lookup prints. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface CabinetProductRecord {
  /** The typed, lenient view, for logic only (a mistyped field is absent here). Its `skuList` is not filled; use `skus`. */
  readonly fields: CabinetProduct;
  /** The entry as the response held it; what the lookup prints. */
  readonly raw: Readonly<Record<string, unknown>>;
  /** `skuList` entries that were objects, in order. */
  readonly skus: readonly CabinetSkuRecord[];
  /**
   * How many entries `skuList` held (objects or not); null when `skuList` was
   * missing, null or not an array. Keeps "no list" apart from "an empty list".
   */
  readonly skuEntriesHeld: number | null;
  /** `skuList` entries that were not objects; they are not in `skus`. */
  readonly unreadableSkus: number;
  /**
   * Distinct paths of fields present with a type the recorded response did not
   * show, e.g. "price", "skuList[].rating". Null and absent values are not
   * listed. At most 50 paths are kept.
   */
  readonly mistyped: readonly string[];
}

export interface CabinetProductsPage {
  /** `productList` entries that were objects, in order. */
  readonly products: readonly CabinetProductRecord[];
  /** `totalProductsAmount` when it is a finite, non-negative number; otherwise null. Sample: 38 beside a one-product trimmed list. */
  readonly total: number | null;
  /** `totalProductsAmountWithoutWeightDimensional` under the same rule. Sample: 0. */
  readonly totalWithoutWeightDimensional: number | null;
  /** Entries `productList` held, readable or not. */
  readonly entriesHeld: number;
  /** `productList` entries that were not objects; they are not in `products`. */
  readonly unreadableProducts: number;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readProduct(entry: Record<string, unknown>): CabinetProductRecord {
  const bad = new Mistyped();
  const fields = readObject(entry, PRODUCT_SPEC, '', bad);
  const skus: CabinetSkuRecord[] = [];
  let unreadableSkus = 0;
  let skuEntriesHeld: number | null = null;
  const list: unknown = entry['skuList'];
  if (Array.isArray(list)) {
    skuEntriesHeld = list.length;
    for (let i = 0; i < list.length; i += 1) {
      const sku: unknown = list[i];
      if (isObject(sku)) {
        skus.push({ fields: readObject(sku, SKU_SPEC, 'skuList[]', bad) as CabinetSku, raw: sku });
      } else {
        unreadableSkus += 1;
      }
    }
  } else if (list !== null && list !== undefined) {
    bad.add('skuList');
  }
  return {
    fields: fields as CabinetProduct,
    raw: entry,
    skus,
    skuEntriesHeld,
    unreadableSkus,
    mistyped: [...bad.paths],
  };
}

/**
 * Reads the one observed shape. `null` when `data` is not an object holding a
 * `productList` array. Never throws: an entry that is not an object, or that
 * cannot be read at all, is counted in `unreadableProducts` and left out; a
 * field of an unexpected type stays in `raw`, is absent from `fields` and is
 * listed in `mistyped`; unknown fields are ignored in `fields`.
 */
export function readProductsPage(data: unknown): CabinetProductsPage | null {
  try {
    if (!isObject(data)) return null;
    const list = data['productList'];
    if (!Array.isArray(list)) return null;
    const products: CabinetProductRecord[] = [];
    const held = list.length;
    for (let i = 0; i < held; i += 1) {
      try {
        const entry: unknown = list[i];
        if (isObject(entry)) products.push(readProduct(entry));
      } catch {
        /* An entry that throws on access is unreadable, not a reason to lose the page. */
      }
    }
    return {
      products,
      total: count(data['totalProductsAmount']),
      totalWithoutWeightDimensional: count(data['totalProductsAmountWithoutWeightDimensional']),
      entriesHeld: held,
      unreadableProducts: held - products.length,
    };
  } catch {
    return null;
  }
}
