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
 * Evidence is recorded traffic only, one card per route in
 * `docs/API-REQUEST-RESPONSE.md` (section 5.B). What was recorded of each REQUEST:
 *
 *   products.list         TWO requests (a 5-row call with no sort or search, and one that
 *                         reads as the cabinet's own product table, size 24)
 *   products.stats        one request, no parameters
 *   skus.list             one request, `page=0&size=20&search=<a 13-digit barcode>`; a request
 *                         without `search` was never recorded
 *   invoices.list         one request, `page=0&size=20`
 *   returns.list          one request, `page=0&size=20`
 *   reviews.list          one request, a POST: `page=0&size=20` in the query and the body
 *                         `{"filter":"NO_REPLY"}` (its 21 bytes are the recorded content-length);
 *                         four more filter values were REPORTED by the seller, without a
 *                         request or a response recorded for any of them
 *   shops.list            two requests, three days apart, no parameters
 *   contract.end          one request, `shopId` in the query
 *   notifications.unread  NO request: only its preflight was recorded, which asked to send
 *                         `authorization`; the path is the preflight's
 *   barcodes.types        one request, no parameters
 *
 * Nothing here describes a response shape; that is the panel side's business
 * (`products.ts` and the lookups in `@ext/tools`).
 *
 * Two kinds of route. A **shop** route is about one shop: it is refused before
 * any request unless that shop is the seller's and carries the route's
 * permission code. An **account** route names no shop (the shop list itself, a
 * notification counter, the reviews of every shop at once, the label sizes), so
 * there is no shop to check and only the sign-in is required. Which permission the API itself
 * asks for is recorded nowhere: the codes below are read off their names
 * (`PRODUCT_READ` for a product route) and are this table's own guard, never a
 * statement about the server.
 *
 * Every route is a read. All but one are GETs; the cabinet reads its reviews
 * with a POST whose body is a filter, and that route is a POST here too. Its
 * body is written by this table from validated params, exactly like a URL: the
 * panel names a route and one of this file's own filter values and never sends
 * a body, so a POST can carry nothing this file did not write. A route that
 * changes something at Uzum does not belong in this table.
 *
 * Adding an endpoint is adding one key to `UzumRouteParamsMap` and one entry to
 * `UZUM_ROUTES`; the compiler refuses either without the other.
 */

/** The only origin the token is ever attached to. */
export const UZUM_API_ORIGIN = 'https://api-seller.uzum.uz';

export type RouteCheck<P> =
  | { readonly ok: true; readonly value: P }
  | { readonly ok: false; readonly reason: string };

interface RouteCommon<P> {
  /** Human-readable template for an answer's source chip. */
  readonly source: string;
  /** Strict: unknown keys, missing keys and out-of-range values are all refused. */
  parse(input: unknown): RouteCheck<P>;
  /** Path and query, always starting with `/api/`; resolved against `UZUM_API_ORIGIN`. */
  target(params: P): string;
}

/** A plain read: nothing is sent but the URL. */
interface GetVerb {
  readonly method: 'GET';
}

/**
 * A read the cabinet itself makes with POST. The compiler refuses a POST route
 * without a `body`, and the content script sends no verb but these two.
 */
interface PostVerb<P> {
  readonly method: 'POST';
  /** The JSON text to send, written here from validated params and from nothing else. */
  body(params: P): string;
}

type RouteBase<P> = RouteCommon<P> & (GetVerb | PostVerb<P>);

/** A route about one shop. */
export type ShopRouteSpec<P> = RouteBase<P> & {
  readonly scope: 'shop';
  /** The permission code the seller needs on the shop, checked before any request. */
  readonly permission: string;
  /** The shop the call is made for — the caller's own, never read from a payload. */
  shopOf(params: P): number;
};

/** A route about the signed-in account as a whole: it names no shop, so only the sign-in is checked. */
export type AccountRouteSpec<P> = RouteBase<P> & {
  readonly scope: 'account';
};

export type RouteSpec<P> = ShopRouteSpec<P> | AccountRouteSpec<P>;

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

/** A shop route that takes nothing but its shop. */
export interface ShopParams {
  readonly shopId: number;
}

/** A shop route that pages: its shop, a zero-based page and a page size. */
export interface ShopPageParams {
  readonly shopId: number;
  readonly page: number;
  readonly size: number;
}

/** The lead's bound, like the product search's; the one recorded value is a 13-digit barcode. */
export const SKUS_SEARCH_MAX_LENGTH = 100;

/** The SKU list: its shop, a page, a size and, when asked, a search text. */
export interface SkusListParams extends ShopPageParams {
  /** Omitted means no `search` parameter at all, which is a request that was NOT recorded. */
  readonly search?: string;
}

/** A zero-based page and a page size: what every paged route puts in its query. */
export interface PageParams {
  readonly page: number;
  readonly size: number;
}

/**
 * The `filter` values of the reviews request, in the order the seller listed
 * them. Only `NO_REPLY` is recorded traffic: one request and one response. The
 * other four are the seller's own report (2026-11-17) of the bodies the
 * cabinet's reviews page sends, with nothing recorded of what comes back, so
 * what each selects is read off its name and `NEW` is not explained by anything
 * seen. Other values may exist; none is invented here.
 */
export const REVIEWS_FILTERS = ['ALL', 'NEW', 'NO_REPLY', 'WITH_REPLY', 'PINNED'] as const;
export type ReviewsFilter = (typeof REVIEWS_FILTERS)[number];
/** The one filter recorded as traffic, request and response: reviews the seller has not replied to. */
export const REVIEWS_FILTER_RECORDED: ReviewsFilter = 'NO_REPLY';
/**
 * The lead's choice (2026-11-17), not what the recording sent: a question that
 * names no filter is about every review. `ALL` is one of the four values no
 * response was recorded for, so a default read says so like any other.
 */
export const REVIEWS_FILTER_DEFAULT: ReviewsFilter = 'ALL';

/** The reviews route: a page, a size and one of the known filters, and no shop. */
export interface ReviewsListParams extends PageParams {
  /** Omitted means `REVIEWS_FILTER_DEFAULT`. */
  readonly filter?: ReviewsFilter;
}

/** An account route that takes nothing at all. */
export type NoParams = Readonly<Record<string, never>>;

/** One line per route; `UzumRouteId` and `UzumRouteParams` derive from it. */
export interface UzumRouteParamsMap {
  'products.list': ProductsListParams;
  'products.stats': ShopParams;
  'skus.list': SkusListParams;
  'invoices.list': ShopPageParams;
  'returns.list': ShopPageParams;
  'reviews.list': ReviewsListParams;
  'shops.list': NoParams;
  'contract.end': ShopParams;
  'notifications.unread': NoParams;
  'barcodes.types': NoParams;
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

function isReviewsFilter(value: unknown): value is ReviewsFilter {
  return typeof value === 'string' && (REVIEWS_FILTERS as readonly string[]).includes(value);
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

const productsList: ShopRouteSpec<ProductsListParams> = {
  scope: 'shop',
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

/** The first key the route does not take, or null. An ignored key would look like a working filter to the caller. */
function strayKey(input: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) return key;
  }
  return null;
}

function parseShopOnly(input: unknown): RouteCheck<ShopParams> {
  if (!isPlainRecord(input)) return fail('params must be an object');
  const stray = strayKey(input, ['shopId']);
  if (stray !== null) return fail(`unknown param "${stray}"`);
  const shopId = integerIn(input['shopId'], 1, Number.MAX_SAFE_INTEGER);
  if (shopId === null) return fail('shopId must be a positive integer');
  return { ok: true, value: { shopId } };
}

function parseNothing(input: unknown): RouteCheck<NoParams> {
  if (!isPlainRecord(input)) return fail('params must be an object');
  const stray = strayKey(input, []);
  if (stray !== null) return fail(`unknown param "${stray}"`);
  return { ok: true, value: {} };
}

/** The per-filter product counters of one shop. The recorded request carried no parameters. */
const productsStats: ShopRouteSpec<ShopParams> = {
  scope: 'shop',
  method: 'GET',
  permission: 'PRODUCT_READ',
  source: 'GET /api/seller/shop/{shopId}/product/products-statistic',
  parse: parseShopOnly,
  shopOf: (params) => params.shopId,
  target: (params) => `/api/seller/shop/${params.shopId}/product/products-statistic`,
};

/**
 * The bounds of a paged route. They are our own contract (the recorded size,
 * 20, fits), not something a response showed: every recorded request of these
 * routes sent `page=0&size=20` and nothing larger was ever seen.
 */
export const PAGE_MAX_SIZE = 100;
export const PAGE_MIN_SIZE = 1;
export const PAGE_MIN = 0;
export const PAGE_MAX = 100_000;

/** A shop, a page and a size, and nothing else: no filter the recordings did not show. */
function parseShopPage(input: unknown): RouteCheck<ShopPageParams> {
  if (!isPlainRecord(input)) return fail('params must be an object');
  const stray = strayKey(input, ['shopId', 'page', 'size']);
  if (stray !== null) return fail(`unknown param "${stray}"`);
  const shopId = integerIn(input['shopId'], 1, Number.MAX_SAFE_INTEGER);
  if (shopId === null) return fail('shopId must be a positive integer');
  const page = integerIn(input['page'], PAGE_MIN, PAGE_MAX);
  if (page === null) return fail('page must be an integer >= 0');
  const size = integerIn(input['size'], PAGE_MIN_SIZE, PAGE_MAX_SIZE);
  if (size === null) return fail(`size must be an integer from 1 to ${PAGE_MAX_SIZE}`);
  return { ok: true, value: { shopId, page, size } };
}

/**
 * A page, a size and at most one of the known filters: no shop, because the
 * route names none, and no filter value this file does not list — the value
 * ends up in a request body, so it is matched whole, never passed through.
 */
function parseReviews(input: unknown): RouteCheck<ReviewsListParams> {
  if (!isPlainRecord(input)) return fail('params must be an object');
  const stray = strayKey(input, ['page', 'size', 'filter']);
  if (stray !== null) return fail(`unknown param "${stray}"`);
  const page = integerIn(input['page'], PAGE_MIN, PAGE_MAX);
  if (page === null) return fail('page must be an integer >= 0');
  const size = integerIn(input['size'], PAGE_MIN_SIZE, PAGE_MAX_SIZE);
  if (size === null) return fail(`size must be an integer from 1 to ${PAGE_MAX_SIZE}`);
  let filter: ReviewsFilter = REVIEWS_FILTER_DEFAULT;
  if (input['filter'] !== undefined) {
    if (!isReviewsFilter(input['filter'])) {
      return fail(`filter must be one of ${REVIEWS_FILTERS.join(', ')}`);
    }
    filter = input['filter'];
  }
  return { ok: true, value: { page, size, filter } };
}

/** `page` then `size`, the order every recorded request used. */
const pageQuery = (params: PageParams): string =>
  new URLSearchParams({ page: String(params.page), size: String(params.size) }).toString();

/**
 * One shop's SKUs as the cabinet lists them when goods are sent to the
 * warehouse: barcode, statuses, what is in stock and what may be supplied. The
 * one recorded request searched for a barcode and got the one SKU that carries
 * it; how else `search` matches, and what the route answers without it, was not
 * recorded, so an absent search is sent as no parameter at all and said to be
 * unrecorded. `SKU_READ` is read off the permission's name.
 */
const skusList: ShopRouteSpec<SkusListParams> = {
  scope: 'shop',
  method: 'GET',
  permission: 'SKU_READ',
  source: 'GET /api/seller/shop/{shopId}/sku-list',

  parse(input): RouteCheck<SkusListParams> {
    if (!isPlainRecord(input)) return fail('params must be an object');
    const stray = strayKey(input, ['shopId', 'page', 'size', 'search']);
    if (stray !== null) return fail(`unknown param "${stray}"`);
    const shopId = integerIn(input['shopId'], 1, Number.MAX_SAFE_INTEGER);
    if (shopId === null) return fail('shopId must be a positive integer');
    const page = integerIn(input['page'], PAGE_MIN, PAGE_MAX);
    if (page === null) return fail('page must be an integer >= 0');
    const size = integerIn(input['size'], PAGE_MIN_SIZE, PAGE_MAX_SIZE);
    if (size === null) return fail(`size must be an integer from 1 to ${PAGE_MAX_SIZE}`);
    if (input['search'] === undefined) return { ok: true, value: { shopId, page, size } };

    const raw = input['search'];
    if (typeof raw !== 'string') return fail('search must be a string');
    /* Refused before trimming, as for the product search. */
    if (hasControlCharacter(raw)) return fail('search must not contain control characters');
    const search = raw.trim();
    /* `search=` with nothing after it was never recorded either: no search is no parameter. */
    if (search === '') return fail('search must not be empty: leave it out instead');
    if (search.length > SKUS_SEARCH_MAX_LENGTH) {
      return fail(`search must be at most ${SKUS_SEARCH_MAX_LENGTH} characters`);
    }
    return { ok: true, value: { shopId, page, size, search } };
  },

  shopOf: (params) => params.shopId,

  target(params) {
    /* `page`, `size`, `search`: the recorded order. The text goes through
       URLSearchParams only, so it is a query value and cannot reach the path. */
    const query = new URLSearchParams({ page: String(params.page), size: String(params.size) });
    if (params.search !== undefined) query.set('search', params.search);
    return `/api/seller/shop/${params.shopId}/sku-list?${query.toString()}`;
  },
};

/**
 * One shop's supply (FBO) invoices, a page per call. The one recorded request
 * sent `page` and `size` and nothing else: no status, date or sort parameter is
 * known, so none is offered.
 */
const invoicesList: ShopRouteSpec<ShopPageParams> = {
  scope: 'shop',
  method: 'GET',
  permission: 'INVOICE_READ',
  source: 'GET /api/seller/shop/{shopId}/invoice',
  parse: parseShopPage,
  shopOf: (params) => params.shopId,
  target: (params) => `/api/seller/shop/${params.shopId}/invoice?${pageQuery(params)}`,
};

/**
 * One shop's returns from the warehouse (goods Uzum sends back to the seller),
 * a page per call. Like the invoices, the one recorded request sent `page` and
 * `size` only. `SELLER_RETURN_READ` is read off the permission's name.
 */
const returnsList: ShopRouteSpec<ShopPageParams> = {
  scope: 'shop',
  method: 'GET',
  permission: 'SELLER_RETURN_READ',
  source: 'GET /api/seller/shop/{shopId}/return',
  parse: parseShopPage,
  shopOf: (params) => params.shopId,
  target: (params) => `/api/seller/shop/${params.shopId}/return?${pageQuery(params)}`,
};

/**
 * Customer reviews of the seller's products, a page per call, for every shop of
 * the account at once: the path names no shop and the one recorded response
 * mixed two. `PRODUCT_REVIEW_READ` exists as a permission code, but it is held
 * per shop and this route has no shop to hold it against, so only the sign-in
 * is checked.
 *
 * A POST, because that is what the cabinet sends: page and size travel in the
 * query, the filter in a JSON body. The answer is a list, which is why it is
 * treated as a read. One thing the recording cannot show: every recorded row
 * was already `read: true`, so whether listing reviews marks them read is not
 * known — under `NEW` least of all, if "new" means unread.
 */
const reviewsList: AccountRouteSpec<ReviewsListParams> = {
  scope: 'account',
  method: 'POST',
  source: 'POST /api/seller/product-reviews',
  parse: parseReviews,
  target: (params) => `/api/seller/product-reviews?${pageQuery(params)}`,
  /* One key and one of five constants. With `NO_REPLY` it is byte for byte the
     recorded body: those 21 bytes are its content-length. */
  body: (params) => JSON.stringify({ filter: params.filter ?? REVIEWS_FILTER_DEFAULT }),
};

/** The seller's shops. The trailing slash is the recorded path's own, in both recordings. */
const shopsList: AccountRouteSpec<NoParams> = {
  scope: 'account',
  method: 'GET',
  source: 'GET /api/seller/shop/',
  parse: parseNothing,
  target: () => '/api/seller/shop/',
};

/**
 * The end date of one shop's contract. The shop travels in the query, not the
 * path. No permission code is named after contracts; `SHOP_READ` is the closest
 * one in the recorded session and is our own choice of guard.
 */
const contractEnd: ShopRouteSpec<ShopParams> = {
  scope: 'shop',
  method: 'GET',
  permission: 'SHOP_READ',
  source: 'GET /api/seller/committent/contract/end-date',
  parse: parseShopOnly,
  shopOf: (params) => params.shopId,
  target(params) {
    const query = new URLSearchParams({ shopId: String(params.shopId) });
    return `/api/seller/committent/contract/end-date?${query.toString()}`;
  },
};

/** How many notifications are unread. The only cabinet path recorded under `/api/v1/`. */
const notificationsUnread: AccountRouteSpec<NoParams> = {
  scope: 'account',
  method: 'GET',
  source: 'GET /api/v1/seller/notification/unread-count',
  parse: parseNothing,
  target: () => '/api/v1/seller/notification/unread-count',
};

/**
 * The label sizes the cabinet offers for printing barcode stickers. The path
 * names no shop and the recorded request carried no parameters. `PRINTING_READ`
 * exists as a permission code, but like the review code it is held per shop and
 * there is no shop here to hold it against, so only the sign-in is checked.
 */
const barcodesTypes: AccountRouteSpec<NoParams> = {
  scope: 'account',
  method: 'GET',
  source: 'GET /api/seller/reports/barcodes/types',
  parse: parseNothing,
  target: () => '/api/seller/reports/barcodes/types',
};

export const UZUM_ROUTES = {
  'products.list': productsList,
  'products.stats': productsStats,
  'skus.list': skusList,
  'invoices.list': invoicesList,
  'returns.list': returnsList,
  'reviews.list': reviewsList,
  'shops.list': shopsList,
  'contract.end': contractEnd,
  'notifications.unread': notificationsUnread,
  'barcodes.types': barcodesTypes,
} as const satisfies { readonly [K in UzumRouteId]: RouteSpec<UzumRouteParamsMap[K]> };

/** `hasOwn`, not `in`: a route id of "constructor" must not find anything. */
export function isRouteId(value: unknown): value is UzumRouteId {
  return typeof value === 'string' && Object.hasOwn(UZUM_ROUTES, value);
}

/**
 * The shop a call is made for, taken from the caller's own params; null for an
 * account route, which is about no shop in particular.
 */
export function shopOfRoute<R extends UzumRouteId>(route: R, params: UzumRouteParams<R>): number | null {
  const spec: RouteSpec<unknown> = UZUM_ROUTES[route];
  return spec.scope === 'shop' ? spec.shopOf(params) : null;
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
