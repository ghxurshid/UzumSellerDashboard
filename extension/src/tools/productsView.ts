import { clip, compose, isoMinute, table } from '@core/tools/plaintext';

/**
 * The product list as two curated tables, for a response `readProductsPage`
 * recognised.
 *
 * Every cell is read from the entry **as the response held it** (`raw`), never
 * from the typed view the reader builds for logic: a value that does not match
 * the recorded sample (a price that arrives as the string "120000") is printed
 * as it came, so the model never reads "the API gave no price" where the API
 * gave one in an unexpected type. What is left empty is therefore only `null`
 * or an absent key — the units line says exactly that.
 *
 * Columns carry the API's own field names (dot paths for nested ones) and values
 * exactly as returned: a number is printed as JSON held it — `plaintext.table`
 * would round a percentage to two decimals — and `null` is never a zero.
 *
 * Nothing here adds up a column. The only figures computed are the two counts
 * over one product's own SKU objects (`skuList.length`, `skuList.RUN_OUT`), which
 * are named after what they count and said to be ours. Timestamps additionally
 * appear as UTC text in a `.utc` column; the epoch value stays beside it.
 */

/** Roughly the size of the whole table text; a first row is always printed. */
const MAX_CHARS = 12_000;
const TITLE = 50;
const SHORT = 30;
/** Room for an image address; the recorded one is 65 characters. */
const IMAGE = 200;

export type Raw = Record<string, unknown>;

export const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a value too big for a cell is replaced by: its kind and size, never its content. */
function shape(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (isRaw(value)) {
    const keys = Object.keys(value);
    return `{${keys.slice(0, 3).join(',')}${keys.length > 3 ? `,+${keys.length - 3}` : ''}}`;
  }
  return '';
}

/** A scalar as the response held it, whatever its type; `null` and absent are the empty cell. */
function show(value: unknown, max: number): string {
  if (value === null || value === undefined) return '';
  switch (typeof value) {
    case 'string':
      return clip(value, max);
    case 'number':
      return Number.isFinite(value) ? String(value) : clip(String(value), max);
    case 'boolean':
      return String(value);
    case 'bigint':
      return String(value);
    default:
      return shape(value);
  }
}

/** Walks a dot path; a step through something that is not an object says what was there instead. */
function at(row: Raw, path: string, max = SHORT): string {
  let current: unknown = row;
  const seen: string[] = [];
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return '';
    if (!isRaw(current)) return `(${seen.join('.')}: ${show(current, 20) || shape(current)})`;
    seen.push(key);
    current = current[key];
  }
  return show(current, max);
}

const utc = (row: Raw, path: string): string => {
  let current: unknown = row;
  for (const key of path.split('.')) {
    if (!isRaw(current)) return '';
    current = current[key];
  }
  if (typeof current !== 'number' || !Number.isFinite(current)) return '';
  return Number.isNaN(new Date(current).getTime()) ? '' : isoMinute(current);
};

interface Column {
  readonly name: string;
  readonly get: (row: Raw) => string;
}

const field = (path: string, max = SHORT): Column => ({ name: path, get: (row) => at(row, path, max) });

/** SKU entries that are objects; anything else in `skuList` is not a SKU and is not counted as one. */
export const skusOf = (product: Raw): readonly Raw[] =>
  Array.isArray(product['skuList']) ? (product['skuList'] as unknown[]).filter(isRaw) : [];

const PRODUCT_COLUMNS: readonly Column[] = [
  field('productId'),
  field('title', TITLE),
  field('status.value'),
  field('moderationStatus.value'),
  field('quantityAvailable'),
  field('quantityAvailableByStockType.fbo'),
  field('quantityAvailableByStockType.fbs'),
  field('quantitySold'),
  field('quantityReturned'),
  field('returnedPercentage'),
  field('price'),
  field('rating'),
  field('feedbackQuantity'),
  field('viewers'),
  field('clicks'),
  field('conversion'),
  field('rankInfo.rank'),
  field('pstorage'),
  field('promotionStatus'),
  /* The small picture, whole: it is copied into a product card as it stands, and
     an address cut at thirty characters is not an address. */
  field('previewImg', IMAGE),
  { name: 'skuList.length', get: (p) => (Array.isArray(p['skuList']) ? String(skusOf(p).length) : '') },
  {
    name: 'skuList.RUN_OUT',
    get: (p) =>
      Array.isArray(p['skuList']) ? String(skusOf(p).filter((sku) => at(sku, 'status.value') === 'RUN_OUT').length) : '',
  },
];

const SKU_COLUMNS: readonly Column[] = [
  field('skuId'),
  field('skuTitle', 40),
  field('characteristics', 40),
  field('barcode'),
  field('status.value'),
  field('forecastOutOfStock'),
  field('quantityAvailable'),
  field('quantityAvailableByStockType.fbo'),
  field('quantityAvailableByStockType.fbs'),
  field('quantitySold'),
  field('quantityReturned'),
  field('returnedPercentage'),
  field('price'),
  field('commission'),
  field('pstorage'),
  field('paidStoragePriceItem'),
  field('paidStorageAmount'),
  field('avgdsales'),
  field('avgdquantity'),
  field('turnover'),
  field('rankInfo.rank'),
  field('hasActiveDiscount'),
  field('specialOffer.inOffer'),
  field('specialOffer.endDate'),
  { name: 'specialOffer.endDate.utc', get: (r) => utc(r, 'specialOffer.endDate') },
  field('blocked'),
  field('archived'),
];

const KEY_COLUMNS: readonly Column[] = [
  field('productId'),
  field('title', TITLE),
  { name: 'skuList.length', get: (p) => (Array.isArray(p['skuList']) ? String(skusOf(p).length) : '') },
];

export type ProductsView = 'products' | 'skus';

export interface ProductsRender {
  /** Tables only; the tool writes the header and the units line. */
  readonly text: string;
  /** Rows of the main table that were printed, of `available`. */
  readonly shown: number;
  readonly available: number;
  /** What was cut, in words; empty when everything fit. */
  readonly cuts: readonly string[];
  /** SKU objects on this page, for the header (a count over the page's own products). */
  readonly skuCount: number;
}

/** Rows that fit `budget` characters; the first always goes in. */
function fit(lines: readonly (readonly string[])[], used: number, budget: number): readonly (readonly string[])[] {
  const kept: (readonly string[])[] = [];
  let total = used;
  for (const line of lines) {
    const cost = line.join('|').length + 1;
    if (kept.length > 0 && total + cost > budget) break;
    kept.push(line);
    total += cost;
  }
  return kept;
}

function printTable(
  columns: readonly Column[],
  rows: readonly Raw[],
  lead: (index: number) => string[],
  leadNames: readonly string[],
  budget: number,
): { readonly text: string; readonly shown: number } {
  const names = [...leadNames, ...columns.map((column) => column.name)];
  const lines = rows.map((row, index) => [...lead(index), ...columns.map((column) => column.get(row))]);
  const kept = fit(lines, names.join('|').length + 1, budget);
  /* Strings only: `table` would round a number, and the values are already exact. */
  return { text: table(names, kept), shown: kept.length };
}

export function renderProductsPage(products: readonly Raw[], view: ProductsView, askedShopId: number): ProductsRender {
  const asked = String(askedShopId);
  const cuts: string[] = [];
  const skus: Array<{ readonly productId: string; readonly sku: Raw }> = products.flatMap((product) =>
    skusOf(product).map((sku) => ({ productId: at(product, 'productId'), sku })),
  );

  if (products.length === 0) {
    return { text: 'products — 0 rows', shown: 0, available: 0, cuts, skuCount: 0 };
  }

  if (view === 'skus') {
    const keys = printTable(KEY_COLUMNS, products, () => [asked], ['askedShopId'], MAX_CHARS / 4);
    if (keys.shown < products.length) cuts.push(`products: ${keys.shown} of ${products.length} rows shown`);
    if (skus.length === 0) {
      return {
        text: compose([
          keys.shown < products.length ? `products — ${keys.shown} of ${products.length} rows shown` : `products — ${products.length} rows`,
          keys.text,
          'skus — 0 rows (no SKU objects in these products)',
        ]),
        shown: 0,
        available: 0,
        cuts,
        skuCount: 0,
      };
    }
    const printed = printTable(
      SKU_COLUMNS,
      skus.map((entry) => entry.sku),
      (index) => [asked, skus[index]?.productId ?? ''],
      ['askedShopId', 'productId'],
      MAX_CHARS - keys.text.length,
    );
    if (printed.shown < skus.length) cuts.push(`skus: ${printed.shown} of ${skus.length} rows shown`);
    return {
      text: compose([
        keys.shown < products.length ? `products — ${keys.shown} of ${products.length} rows shown` : `products — ${products.length} rows`,
        keys.text,
        printed.shown < skus.length ? `skus — ${printed.shown} of ${skus.length} rows shown` : `skus — ${skus.length} rows`,
        printed.text,
      ]),
      shown: printed.shown,
      available: skus.length,
      cuts,
      skuCount: skus.length,
    };
  }

  const printed = printTable(PRODUCT_COLUMNS, products, () => [asked], ['askedShopId'], MAX_CHARS);
  if (printed.shown < products.length) cuts.push(`products: ${printed.shown} of ${products.length} rows shown`);
  return {
    text: compose([
      printed.shown < products.length ? `products — ${printed.shown} of ${products.length} rows shown` : `products — ${products.length} rows`,
      printed.text,
    ]),
    shown: printed.shown,
    available: products.length,
    cuts,
    skuCount: skus.length,
  };
}

/**
 * Where this page sits, from what the response itself says.
 *
 * `total` is the response's own `totalProductsAmount`. Positions assume the page
 * starts at `page × size`, which is how the request is built, not something the
 * response confirms; a page that does not fit that picture is said to disagree
 * rather than being smoothed over.
 *
 * When the read is **narrowed** (a search, or a filter other than ALL) it was not
 * recorded whether the total follows it, so the total is stated with exactly that
 * caveat and no conclusion is drawn from it — no "cap", no "rows remaining", no
 * advice to shrink the page. A full page may still be followed by another.
 * Without a total the wording falls back to what one page shows, and no page is
 * ever called the last.
 */
export function pagingText(total: number | null, page: number, size: number, count: number, narrowed: boolean): string {
  const offset = page * size;
  const next = page + 1;

  if (total === null) {
    if (count === 0) return 'empty page — nothing at this page number; the response carries no total';
    if (count > size) return `more products than size ${size} asked for — the API may not honour size; the response carries no total`;
    if (count === size) return `as many as asked — there may be more: next page ${next}; the response carries no total`;
    return `fewer than the ${size} asked for — the API may cap a page, so more may exist; ask page ${next} to check; the response carries no total`;
  }

  if (narrowed) {
    const stated = `totalProductsAmount ${total} (not recorded whether it follows this filter or search)`;
    if (count === 0) return `empty page — nothing at this page number; ${stated}`;
    if (count > size) return `more products than size ${size} asked for — the API may not honour size; ${stated}`;
    if (count === size) return `as many as asked — there may be more: next page ${next}; ${stated}`;
    return `fewer than the ${size} asked for; ${stated}`;
  }

  if (count === 0) {
    if (total === 0) return 'no products in this read — the response says totalProductsAmount 0';
    return offset >= total
      ? `page ${page} starts after the end: the response says totalProductsAmount ${total}, so this page begins past it`
      : `empty page although the response says totalProductsAmount ${total} — the page and the total disagree`;
  }

  const first = offset + 1;
  const last = offset + count;
  const where = `rows ${first}–${last} of ${total} (totalProductsAmount; positions computed from page × size)`;
  if (last > total) return `${where} — the page reaches past the total, so the total and the page disagree`;
  if (count > size) {
    return `${where} — more than size ${size} asked for, so the API may not honour size and page numbers may not line up`;
  }
  if (last === total) return `${where} — nothing further per the total`;

  /* More remain by the total. A page shorter than asked means the cabinet capped
     it, and the next page number then skips rows. */
  if (count < size) {
    return (
      `${where} — fewer than the ${size} asked for while ${total - last} more remain by the total: the API seems to cap a page. ` +
      `Page ${next} starts at row ${offset + size + 1}, skipping rows ${last + 1}–${offset + size}; ask size ${count} or less to page without gaps`
    );
  }
  return `${where} — ${total - last} more remain: next page ${next}`;
}
