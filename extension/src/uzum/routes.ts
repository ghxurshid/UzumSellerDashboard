/**
 * The closed table of cabinet routes the extension may call.
 *
 * Shared by both sides of the bridge, so it imports nothing: the content script
 * is one small classic script and must not pull a validator library in. The
 * panel asks for a route id plus params; the content script builds the URL from
 * this table itself and refuses anything else. That is the whole security
 * argument — the seller's token can only ever travel to a URL this file can
 * produce, so a compromised panel or a prompt-injected model cannot aim it at
 * an arbitrary address.
 *
 * Evidence: TWO recorded requests for `products.list` (a 5-row call with no sort or search, and
 * one that reads as the cabinet's own product table, size 24), ONE recorded response (for the
 * second). Nothing here describes a response shape; that lives in
 * `products.ts`, on the panel side.
 *
 * Adding an endpoint is adding one key to `UzumRouteParamsMap` and one entry to
 * `UZUM_ROUTES`; the compiler refuses either without the other.
 */

/** The only origin the token is ever attached to. */
export const UZUM_API_ORIGIN = 'https://api-seller.uzum.uz';

export type RouteCheck<P> =
  | { readonly ok: true; readonly value: P }
  | { readonly ok: false; readonly reason: string };

export interface RouteSpec<P> {
  /** GET only for now; the content script refuses any other verb. */
  readonly method: 'GET';
  /** The permission code the seller needs on the shop, checked before any request. */
  readonly permission: string;
  /** Human-readable template for an answer's source chip. */
  readonly source: string;
  /** Strict: unknown keys, missing keys and out-of-range values are all refused. */
  parse(input: unknown): RouteCheck<P>;
  /** The shop the call is made for — the caller's own, never read from a payload. */
  shopOf(params: P): number;
  /** Path and query, always starting with `/api/`; resolved against `UZUM_API_ORIGIN`. */
  target(params: P): string;
}

/**
 * The two `filter` values recorded, one per request: `ALL` came with the
 * cabinet's product table, `WITHOUT_REQUIRED_FILTERS` with a small widget call.
 * What the second selects is NOT documented; the response carries the flags
 * `skusHasAllRequiredFilters` / `allFiltersFilled`, so it very likely selects a
 * subset. Other values may exist; none is invented here.
 */
export const PRODUCTS_FILTERS = ['ALL', 'WITHOUT_REQUIRED_FILTERS'] as const;
export type ProductsFilter = (typeof PRODUCTS_FILTERS)[number];
/** What recorded request B sent; it reads as the cabinet product table's own call (the cabinet's stored page size equals its size, 24). */
export const PRODUCTS_FILTER_DEFAULT: ProductsFilter = 'ALL';
/** The lead's bound, not something the API showed; the only recorded value is empty. */
export const PRODUCTS_SEARCH_MAX_LENGTH = 100;

export interface ProductsListParams {
  readonly shopId: number;
  readonly page: number;
  readonly size: number;
  /** Omitted means `PRODUCTS_FILTER_DEFAULT`. */
  readonly filter?: ProductsFilter;
  /** Omitted means empty (the only recorded value). How the cabinet matches is NOT recorded. */
  readonly searchQuery?: string;
}

/** One line per route; `UzumRouteId` and `UzumRouteParams` derive from it. */
export interface UzumRouteParamsMap {
  'products.list': ProductsListParams;
}

export type UzumRouteId = keyof UzumRouteParamsMap;
export type UzumRouteParams<R extends UzumRouteId> = UzumRouteParamsMap[R];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

/** Whole numbers only: a float or a numeric string would build a different URL than the caller meant. */
function integerIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function isProductsFilter(value: unknown): value is ProductsFilter {
  return typeof value === 'string' && (PRODUCTS_FILTERS as readonly string[]).includes(value);
}

/** C0, DEL and C1 (U+0000-001F, U+007F-009F). Shared with the lookup so both refuse the same text. A code-unit scan: the source holds no control characters and no regex the linter objects to. */
export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

const PRODUCTS_PARAM_KEYS: readonly string[] = ['shopId', 'page', 'size', 'filter', 'searchQuery'];
/** The bounds are the lead's contract (the cabinet's own size, 24, fits), not something a response showed. */
export const PRODUCTS_MAX_SIZE = 100;
export const PRODUCTS_MIN_SIZE = 1;
export const PRODUCTS_MIN_PAGE = 0;
export const PRODUCTS_MAX_PAGE = 100_000;

const productsList: RouteSpec<ProductsListParams> = {
  method: 'GET',
  permission: 'PRODUCT_READ',
  source: 'GET /api/seller/shop/{shopId}/product/getProducts',

  parse(input): RouteCheck<ProductsListParams> {
    if (!isPlainRecord(input)) return fail('params must be an object');
    for (const key of Object.keys(input)) {
      /* An ignored key would look like a working filter to the caller. */
      if (!PRODUCTS_PARAM_KEYS.includes(key)) return fail(`unknown param "${key}"`);
    }
    const shopId = integerIn(input['shopId'], 1, Number.MAX_SAFE_INTEGER);
    if (shopId === null) return fail('shopId must be a positive integer');
    const page = integerIn(input['page'], PRODUCTS_MIN_PAGE, PRODUCTS_MAX_PAGE);
    if (page === null) return fail('page must be an integer >= 0');
    const size = integerIn(input['size'], PRODUCTS_MIN_SIZE, PRODUCTS_MAX_SIZE);
    if (size === null) return fail(`size must be an integer from 1 to ${PRODUCTS_MAX_SIZE}`);
    let filter: ProductsFilter = PRODUCTS_FILTER_DEFAULT;
    if (input['filter'] !== undefined) {
      if (!isProductsFilter(input['filter'])) {
        return fail(`filter must be one of ${PRODUCTS_FILTERS.join(', ')}`);
      }
      filter = input['filter'];
    }
    let searchQuery = '';
    if (input['searchQuery'] !== undefined) {
      const raw = input['searchQuery'];
      if (typeof raw !== 'string') return fail('searchQuery must be a string');
      /* Refused before trimming: trim would otherwise quietly eat a trailing
         newline and hide that the text was not typed. */
      if (hasControlCharacter(raw)) return fail('searchQuery must not contain control characters');
      searchQuery = raw.trim();
      if (searchQuery.length > PRODUCTS_SEARCH_MAX_LENGTH) {
        return fail(`searchQuery must be at most ${PRODUCTS_SEARCH_MAX_LENGTH} characters`);
      }
    }
    return { ok: true, value: { shopId, page, size, filter, searchQuery } };
  },

  shopOf: (params) => params.shopId,

  target(params) {
    /* Same parameter order as recorded request B. `sortBy` and `order` are the
       only values ever recorded, so they are fixed, not parameters; the order is
       REQUESTED, and one product cannot show that the API honours it. The search
       text goes through URLSearchParams only: it is a query value and cannot
       reach the path or the origin. */
    const query = new URLSearchParams({
      page: String(params.page),
      size: String(params.size),
      filter: params.filter ?? PRODUCTS_FILTER_DEFAULT,
      sortBy: 'id',
      searchQuery: params.searchQuery ?? '',
      order: 'descending',
    });
    return `/api/seller/shop/${params.shopId}/product/getProducts?${query.toString()}`;
  },
};

export const UZUM_ROUTES = {
  'products.list': productsList,
} as const satisfies { readonly [K in UzumRouteId]: RouteSpec<UzumRouteParamsMap[K]> };

/** `hasOwn`, not `in`: a route id of "constructor" must not find anything. */
export function isRouteId(value: unknown): value is UzumRouteId {
  return typeof value === 'string' && Object.hasOwn(UZUM_ROUTES, value);
}

/**
 * Resolve a route target to an absolute URL, or `null` when it would leave the
 * API origin. The token is attached only to a URL that passed through here.
 */
export function toApiUrl(target: string): string | null {
  if (!target.startsWith('/api/')) return null;
  let url: URL;
  try {
    url = new URL(target, UZUM_API_ORIGIN);
  } catch {
    return null;
  }
  return url.origin === UZUM_API_ORIGIN && url.protocol === 'https:' ? url.href : null;
}
