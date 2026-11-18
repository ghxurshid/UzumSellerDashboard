import { describe, expect, it } from 'vitest';

import {
  hasControlCharacter,
  isRouteId,
  PAGE_MAX,
  PAGE_MAX_SIZE,
  PRODUCTS_MAX_PAGE,
  PRODUCTS_MAX_SIZE,
  PRODUCTS_FILTER_DEFAULT,
  PRODUCTS_FILTERS,
  PRODUCTS_SEARCH_MAX_LENGTH,
  REVIEWS_FILTER_DEFAULT,
  REVIEWS_FILTER_RECORDED,
  REVIEWS_FILTERS,
  type ReviewsListParams,
  SKUS_SEARCH_MAX_LENGTH,
  shopOfRoute,
  toApiUrl,
  UZUM_API_ORIGIN,
  UZUM_ROUTES,
} from './routes';

const route = UZUM_ROUTES['products.list'];

/* Recorded request B (the cabinet's product table), shop id invented. */
const RECORDED_B = 'page=0&size=24&filter=ALL&sortBy=id&searchQuery=&order=descending';

function urlOf(params: Record<string, unknown>): string {
  const parsed = route.parse(params);
  if (!parsed.ok) throw new Error(parsed.reason);
  const url = toApiUrl(route.target(parsed.value));
  if (url === null) throw new Error('left the origin');
  return url;
}

describe('products.list', () => {
  it('builds recorded request B character for character by default', () => {
    const expected = `${UZUM_API_ORIGIN}/api/seller/shop/42/product/getProducts?${RECORDED_B}`;
    expect(urlOf({ shopId: 42, page: 0, size: 24 })).toBe(expected);
    /* Params that skipped parse() (typed callers) build the same URL. */
    expect(toApiUrl(route.target({ shopId: 42, page: 0, size: 24 }))).toBe(expected);
  });

  it('accepts both recorded filters and keeps the recorded parameter order', () => {
    expect(PRODUCTS_FILTER_DEFAULT).toBe('ALL');
    expect([...PRODUCTS_FILTERS]).toEqual(['ALL', 'WITHOUT_REQUIRED_FILTERS']);
    expect(urlOf({ shopId: 1, page: 2, size: 5, filter: 'WITHOUT_REQUIRED_FILTERS' })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/shop/1/product/getProducts?page=2&size=5&filter=WITHOUT_REQUIRED_FILTERS&sortBy=id&searchQuery=&order=descending`,
    );
    expect(urlOf({ shopId: 1, page: 0, size: 5, filter: 'ALL' })).toContain('filter=ALL&');
  });

  it('encodes the search text as a query value', () => {
    expect(urlOf({ shopId: 1, page: 0, size: 5, searchQuery: 'a b' })).toContain('searchQuery=a+b&order=');
    expect(urlOf({ shopId: 1, page: 0, size: 5, searchQuery: 'футболка' })).toContain(
      'searchQuery=%D1%84%D1%83%D1%82%D0%B1%D0%BE%D0%BB%D0%BA%D0%B0&order=',
    );
    expect(urlOf({ shopId: 1, page: 0, size: 5, searchQuery: 'a&b#c%d' })).toContain(
      'searchQuery=a%26b%23c%25d&order=descending',
    );
  });

  it('trims the search text and bounds its length', () => {
    expect(urlOf({ shopId: 1, page: 0, size: 5, searchQuery: '  kit  ' })).toContain('searchQuery=kit&');
    expect(urlOf({ shopId: 1, page: 0, size: 5, searchQuery: '   ' })).toContain('searchQuery=&');
    const max = 'x'.repeat(PRODUCTS_SEARCH_MAX_LENGTH);
    expect(route.parse({ shopId: 1, page: 0, size: 5, searchQuery: max }).ok).toBe(true);
    expect(route.parse({ shopId: 1, page: 0, size: 5, searchQuery: `${max}x` }).ok).toBe(false);
    /* Padding does not count against the bound once trimmed. */
    expect(route.parse({ shopId: 1, page: 0, size: 5, searchQuery: ` ${max} ` }).ok).toBe(true);
  });

  it('normalises omitted optional params to their defaults', () => {
    const parsed = route.parse({ shopId: 3, page: 1, size: 10 });
    expect(parsed).toEqual({
      ok: true,
      value: { shopId: 3, page: 1, size: 10, filter: 'ALL', searchQuery: '' },
    });
  });

  it('can never let a search value change the path, the origin or the fixed parameters', () => {
    const hostile = [
      '../../x',
      '/../../admin',
      '?a=1',
      '//evil.example',
      'https://evil.example/',
      '\\\\evil',
      '@evil.example',
      '&sortBy=price&order=ascending',
    ];
    for (const searchQuery of hostile) {
      const url = new URL(urlOf({ shopId: 7, page: 0, size: 5, searchQuery }));
      expect(url.origin).toBe(UZUM_API_ORIGIN);
      expect(url.pathname).toBe('/api/seller/shop/7/product/getProducts');
      expect([...url.searchParams.keys()]).toEqual(['page', 'size', 'filter', 'sortBy', 'searchQuery', 'order']);
      expect(url.searchParams.get('searchQuery')).toBe(searchQuery);
      expect(url.searchParams.get('sortBy')).toBe('id');
      expect(url.searchParams.get('order')).toBe('descending');
    }
  });

  it('requires PRODUCT_READ and only GET', () => {
    expect(route.permission).toBe('PRODUCT_READ');
    expect(route.method).toBe('GET');
  });

  it('refuses bad params', () => {
    const base = { shopId: 1, page: 0, size: 5 };
    const bad: unknown[] = [
      null,
      [],
      { shopId: 1, page: 0 },
      { shopId: '1', page: 0, size: 5 },
      { shopId: 0, page: 0, size: 5 },
      { shopId: 1.5, page: 0, size: 5 },
      { shopId: 1, page: -1, size: 5 },
      { shopId: 1, page: 0, size: 0 },
      { shopId: 1, page: 0, size: 101 },
      { ...base, filter: 'SOMETHING_ELSE' },
      { ...base, filter: 'all' },
      { ...base, filter: 1 },
      { ...base, filter: null },
      { ...base, sortBy: 'price' },
      { ...base, order: 'ascending' },
      { ...base, searchQuery: 5 },
      { ...base, searchQuery: null },
      { ...base, searchQuery: ['a'] },
      { ...base, searchQuery: 'a\nb' },
      { ...base, searchQuery: 'a\u0000b' },
      { ...base, searchQuery: 'a\u007fb' },
      { ...base, searchQuery: 'a\tb' },
      { ...base, searchQuery: 'a\n' },
    ];
    for (const input of bad) expect(route.parse(input).ok).toBe(false);
    expect(route.parse({ shopId: 1, page: 0, size: 100 }).ok).toBe(true);
  });
});

describe('shared validation exports', () => {
  it('refuses every C0, DEL and C1 character, and nothing printable', () => {
    for (let c = 0; c <= 0x1f; c += 1) expect(hasControlCharacter(`a${String.fromCharCode(c)}`)).toBe(true);
    for (let c = 0x7f; c <= 0x9f; c += 1) {
      const text = `a${String.fromCharCode(c)}b`;
      expect(hasControlCharacter(text)).toBe(true);
      expect(route.parse({ shopId: 1, page: 0, size: 5, searchQuery: text }).ok).toBe(false);
    }
    expect(hasControlCharacter('футболка' + String.fromCharCode(0xa0) + 'ok')).toBe(false);
    expect(hasControlCharacter('')).toBe(false);
  });

  it('checks before trimming: a trailing newline is refused, not silently dropped', () => {
    const nl = String.fromCharCode(10);
    const nel = String.fromCharCode(0x85);
    expect(route.parse({ shopId: 1, page: 0, size: 5, searchQuery: `kit${nl}` }).ok).toBe(false);
    expect(route.parse({ shopId: 1, page: 0, size: 5, searchQuery: `kit${nel}` }).ok).toBe(false);
  });

  it('exports the bounds the route enforces', () => {
    expect(route.parse({ shopId: 1, page: PRODUCTS_MAX_PAGE, size: PRODUCTS_MAX_SIZE }).ok).toBe(true);
    expect(route.parse({ shopId: 1, page: PRODUCTS_MAX_PAGE + 1, size: 5 }).ok).toBe(false);
    expect(route.parse({ shopId: 1, page: 0, size: PRODUCTS_MAX_SIZE + 1 }).ok).toBe(false);
  });
});

/* The recorded paths, with invented shop ids. */
describe('the other shop routes', () => {
  const target = (
    id: 'products.stats' | 'invoices.list' | 'returns.list' | 'contract.end',
    params: Record<string, unknown>,
  ): string => {
    const spec = UZUM_ROUTES[id];
    const parsed = spec.parse(params);
    if (!parsed.ok) throw new Error(parsed.reason);
    const url = toApiUrl(spec.target(parsed.value as never));
    if (url === null) throw new Error('left the origin');
    return url;
  };

  it('builds the recorded product-statistic path, with no query', () => {
    expect(target('products.stats', { shopId: 42 })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/shop/42/product/products-statistic`,
    );
  });

  it('builds the recorded invoice request character for character', () => {
    expect(target('invoices.list', { shopId: 42, page: 0, size: 20 })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/shop/42/invoice?page=0&size=20`,
    );
  });

  it('builds the recorded return request character for character', () => {
    expect(target('returns.list', { shopId: 42, page: 0, size: 20 })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/shop/42/return?page=0&size=20`,
    );
    expect(target('returns.list', { shopId: 42, page: 3, size: 50 })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/shop/42/return?page=3&size=50`,
    );
  });

  it('puts the shop of a contract request in the query, as recorded', () => {
    expect(target('contract.end', { shopId: 42 })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/committent/contract/end-date?shopId=42`,
    );
  });

  it('names the shop the call is for and a permission of its own', () => {
    expect(UZUM_ROUTES['products.stats']).toMatchObject({ scope: 'shop', method: 'GET', permission: 'PRODUCT_READ' });
    expect(UZUM_ROUTES['invoices.list']).toMatchObject({ scope: 'shop', method: 'GET', permission: 'INVOICE_READ' });
    expect(UZUM_ROUTES['returns.list']).toMatchObject({ scope: 'shop', method: 'GET', permission: 'SELLER_RETURN_READ' });
    expect(UZUM_ROUTES['contract.end']).toMatchObject({ scope: 'shop', method: 'GET', permission: 'SHOP_READ' });
    expect(UZUM_ROUTES['returns.list'].shopOf({ shopId: 4, page: 0, size: 20 })).toBe(4);
    expect(UZUM_ROUTES['products.stats'].shopOf({ shopId: 7 })).toBe(7);
    expect(UZUM_ROUTES['invoices.list'].shopOf({ shopId: 8, page: 0, size: 20 })).toBe(8);
    expect(UZUM_ROUTES['contract.end'].shopOf({ shopId: 9 })).toBe(9);
  });

  it('refuses a missing or malformed shop and every key it does not take', () => {
    for (const id of ['products.stats', 'contract.end'] as const) {
      const bad: unknown[] = [
        null,
        [],
        {},
        { shopId: '1' },
        { shopId: 0 },
        { shopId: 1.5 },
        { shopId: -1 },
        { shopId: 1, page: 0 },
        { shopId: 1, filter: 'ALL' },
      ];
      for (const input of bad) expect(UZUM_ROUTES[id].parse(input).ok).toBe(false);
      expect(UZUM_ROUTES[id].parse({ shopId: 1 })).toEqual({ ok: true, value: { shopId: 1 } });
    }
  });

  it.each(['invoices.list', 'returns.list'] as const)('bounds a page of %s and offers no filter the recording did not show', (id) => {
    const route = UZUM_ROUTES[id];
    const base = { shopId: 1, page: 0, size: 20 };
    const bad: unknown[] = [
      null,
      { shopId: 1, page: 0 },
      { shopId: 1, size: 20 },
      { ...base, page: -1 },
      { ...base, page: 1.5 },
      { ...base, size: 0 },
      { ...base, size: PAGE_MAX_SIZE + 1 },
      { ...base, page: PAGE_MAX + 1 },
      { ...base, size: '20' },
      { ...base, status: 'CREATED' },
      { ...base, type: 'DEFECTED' },
      { ...base, dateFrom: 1 },
      { ...base, sortBy: 'id' },
    ];
    for (const input of bad) expect(route.parse(input).ok).toBe(false);
    expect(route.parse({ shopId: 1, page: PAGE_MAX, size: PAGE_MAX_SIZE }).ok).toBe(true);
    expect(route.parse(base)).toEqual({ ok: true, value: base });
  });

  it('cannot be steered off its path by a shop id', () => {
    for (const shopId of ['../../x', '1/../admin', '1?x=1', '1#x', ' 1']) {
      expect(UZUM_ROUTES['invoices.list'].parse({ shopId, page: 0, size: 20 }).ok).toBe(false);
      expect(UZUM_ROUTES['returns.list'].parse({ shopId, page: 0, size: 20 }).ok).toBe(false);
      expect(UZUM_ROUTES['products.stats'].parse({ shopId }).ok).toBe(false);
      expect(UZUM_ROUTES['contract.end'].parse({ shopId }).ok).toBe(false);
      expect(UZUM_ROUTES['skus.list'].parse({ shopId, page: 0, size: 20 }).ok).toBe(false);
    }
  });
});

/* One recorded request: a page, a size and a barcode to search for. */
describe('skus.list', () => {
  const spec = UZUM_ROUTES['skus.list'];
  const base = { shopId: 1001, page: 0, size: 20 };
  const urlOf = (params: unknown): string => {
    const parsed = spec.parse(params);
    if (!parsed.ok) throw new Error(parsed.reason);
    const url = toApiUrl(spec.target(parsed.value));
    if (url === null) throw new Error('left the origin');
    return url;
  };

  it('builds the recorded request: page, size and the barcode searched, in that order', () => {
    expect(urlOf({ ...base, search: '1000060000018' })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/shop/1001/sku-list?page=0&size=20&search=1000060000018`,
    );
    expect(spec).toMatchObject({
      scope: 'shop',
      method: 'GET',
      permission: 'SKU_READ',
      source: 'GET /api/seller/shop/{shopId}/sku-list',
    });
    expect(spec.shopOf(base)).toBe(1001);
    expect(spec).not.toHaveProperty('body');
  });

  it('sends no search parameter at all when none is asked: an empty one was never recorded', () => {
    expect(urlOf({ shopId: 1001, page: 2, size: 50 })).toBe(
      `${UZUM_API_ORIGIN}/api/seller/shop/1001/sku-list?page=2&size=50`,
    );
    expect(spec.parse({ ...base, search: undefined })).toEqual({ ok: true, value: base });
    for (const search of ['', '   ']) {
      expect(spec.parse({ ...base, search })).toEqual({
        ok: false,
        reason: 'search must not be empty: leave it out instead',
      });
    }
  });

  it('keeps a search text inside the query: trimmed, bounded, and unable to reach the path', () => {
    expect(new URL(urlOf({ ...base, search: '  кофта 146  ' })).searchParams.get('search')).toBe('кофта 146');
    for (const search of ['x&shopId=2', '../../admin', 'a#b', 'a?b=c', '%2e%2e/x', 'a b+c']) {
      const url = new URL(urlOf({ ...base, search }));
      expect(url.pathname).toBe('/api/seller/shop/1001/sku-list');
      expect([...url.searchParams.keys()]).toEqual(['page', 'size', 'search']);
      expect(url.searchParams.get('search')).toBe(search);
      expect(url.hash).toBe('');
    }
    const bad: unknown[] = [1000060000018, null, ['a'], { q: 'a' }, 'a\nb', 'a\tb', 'x'.repeat(SKUS_SEARCH_MAX_LENGTH + 1)];
    for (const search of bad) expect(spec.parse({ ...base, search }).ok).toBe(false);
    expect(spec.parse({ ...base, search: 'x'.repeat(SKUS_SEARCH_MAX_LENGTH) }).ok).toBe(true);
  });

  it('bounds the page and refuses every key the recording did not show', () => {
    const bad: unknown[] = [
      null,
      [],
      {},
      { shopId: 1001, page: 0 },
      { shopId: 1001, size: 20 },
      { page: 0, size: 20 },
      { ...base, shopId: 0 },
      { ...base, shopId: '1001' },
      { ...base, page: -1 },
      { ...base, page: PAGE_MAX + 1 },
      { ...base, size: 0 },
      { ...base, size: PAGE_MAX_SIZE + 1 },
      { ...base, searchQuery: 'x' },
      { ...base, barcode: '1000060000018' },
      { ...base, filter: 'ALL' },
      { ...base, sortBy: 'id' },
    ];
    for (const input of bad) expect(spec.parse(input).ok).toBe(false);
    expect(spec.parse({ shopId: 1001, page: PAGE_MAX, size: PAGE_MAX_SIZE }).ok).toBe(true);
    expect(spec.parse(base)).toEqual({ ok: true, value: base });
  });
});

describe('the account routes', () => {
  it('build the recorded paths: the trailing slash of the shop list, the v1 prefix of the counter', () => {
    expect(toApiUrl(UZUM_ROUTES['shops.list'].target({}))).toBe(`${UZUM_API_ORIGIN}/api/seller/shop/`);
    expect(toApiUrl(UZUM_ROUTES['notifications.unread'].target({}))).toBe(
      `${UZUM_API_ORIGIN}/api/v1/seller/notification/unread-count`,
    );
    expect(toApiUrl(UZUM_ROUTES['barcodes.types'].target({}))).toBe(
      `${UZUM_API_ORIGIN}/api/seller/reports/barcodes/types`,
    );
    expect(UZUM_ROUTES['barcodes.types'].source).toBe('GET /api/seller/reports/barcodes/types');
  });

  it('name no shop and no permission', () => {
    for (const id of ['shops.list', 'notifications.unread', 'barcodes.types'] as const) {
      expect(UZUM_ROUTES[id].scope).toBe('account');
      expect(UZUM_ROUTES[id].method).toBe('GET');
      expect(UZUM_ROUTES[id]).not.toHaveProperty('permission');
      expect(UZUM_ROUTES[id]).not.toHaveProperty('shopOf');
    }
  });

  it('take nothing at all', () => {
    for (const id of ['shops.list', 'notifications.unread', 'barcodes.types'] as const) {
      expect(UZUM_ROUTES[id].parse({})).toEqual({ ok: true, value: {} });
      for (const input of [null, undefined, [], 'x', { shopId: 1 }, { page: 0 }, { key: 'ONBOARDING' }]) {
        expect(UZUM_ROUTES[id].parse(input).ok).toBe(false);
      }
    }
  });
});

/* The one recorded POST: page and size in the query, the filter in a JSON body. */
describe('reviews.list', () => {
  const spec = UZUM_ROUTES['reviews.list'];
  const bodyOf = (params: ReviewsListParams): string | undefined =>
    spec.method === 'POST' ? spec.body(params) : undefined;
  /** The body as the bridge gets it: written from what `parse` let through. */
  const sentFor = (input: unknown): string | undefined => {
    const parsed = spec.parse(input);
    return parsed.ok ? bodyOf(parsed.value) : undefined;
  };

  it('builds the recorded request: the path and query, and a body of the recorded 21 bytes', () => {
    expect(toApiUrl(spec.target({ page: 0, size: 20 }))).toBe(
      `${UZUM_API_ORIGIN}/api/seller/product-reviews?page=0&size=20`,
    );
    expect(spec.method).toBe('POST');
    expect(spec.source).toBe('POST /api/seller/product-reviews');
    const recorded = { page: 0, size: 20, filter: REVIEWS_FILTER_RECORDED };
    expect(REVIEWS_FILTER_RECORDED).toBe('NO_REPLY');
    expect(bodyOf(recorded)).toBe('{"filter":"NO_REPLY"}');
    expect(sentFor(recorded)).toBe('{"filter":"NO_REPLY"}');
    /* The recorded request's content-length. */
    expect(new TextEncoder().encode(bodyOf(recorded))).toHaveLength(21);
  });

  it('asks for every review when no filter is named: the default is not the recorded filter', () => {
    expect(REVIEWS_FILTER_DEFAULT).toBe('ALL');
    expect(REVIEWS_FILTER_DEFAULT).not.toBe(REVIEWS_FILTER_RECORDED);
    expect(bodyOf({ page: 0, size: 20 })).toBe('{"filter":"ALL"}');
    expect(sentFor({ page: 0, size: 20 })).toBe('{"filter":"ALL"}');
  });

  it('knows the five filters the seller reported, the recorded one among them, and no other', () => {
    expect(REVIEWS_FILTERS).toEqual(['ALL', 'NEW', 'NO_REPLY', 'WITH_REPLY', 'PINNED']);
    expect(REVIEWS_FILTERS).toContain(REVIEWS_FILTER_DEFAULT);
    expect(REVIEWS_FILTERS).toContain(REVIEWS_FILTER_RECORDED);
  });

  it('writes a body of one key holding the filter asked, and the same query whatever the filter', () => {
    for (const filter of REVIEWS_FILTERS) {
      const parsed = spec.parse({ page: 0, size: 20, filter });

      expect(parsed).toEqual({ ok: true, value: { page: 0, size: 20, filter } });
      expect(sentFor({ page: 0, size: 20, filter })).toBe(`{"filter":"${filter}"}`);
      expect(toApiUrl(spec.target({ page: 0, size: 20, filter }))).toBe(
        `${UZUM_API_ORIGIN}/api/seller/product-reviews?page=0&size=20`,
      );
    }
  });

  it('writes the same body for any page: only the query follows page and size', () => {
    expect(toApiUrl(spec.target({ page: 3, size: 50, filter: 'PINNED' }))).toBe(
      `${UZUM_API_ORIGIN}/api/seller/product-reviews?page=3&size=50`,
    );
    expect(bodyOf({ page: 3, size: 50 })).toBe('{"filter":"ALL"}');
    expect(bodyOf({ page: 3, size: 50, filter: 'PINNED' })).toBe('{"filter":"PINNED"}');
  });

  it('is about the account: no shop and no permission', () => {
    expect(spec.scope).toBe('account');
    expect(spec).not.toHaveProperty('permission');
    expect(spec).not.toHaveProperty('shopOf');
    expect(shopOfRoute('reviews.list', { page: 0, size: 20 })).toBeNull();
  });

  it('refuses a filter that is not one of the five, whole and as spelled: nothing else can reach the body', () => {
    const base = { page: 0, size: 20 };
    const bad: unknown[] = [
      'UNANSWERED',
      'no_reply',
      'NO_REPLY ',
      '',
      null,
      0,
      true,
      ['ALL'],
      { filter: 'ALL' },
      'ALL","shopId":1,"x":"',
      'toString',
      '__proto__',
    ];
    for (const filter of bad) {
      const parsed = spec.parse({ ...base, filter });
      expect(parsed).toEqual({ ok: false, reason: 'filter must be one of ALL, NEW, NO_REPLY, WITH_REPLY, PINNED' });
    }
    /* Left out is the default; `undefined` is the same as left out. */
    expect(spec.parse({ ...base, filter: undefined })).toEqual({ ok: true, value: { ...base, filter: 'ALL' } });
    expect(spec.parse(base)).toEqual({ ok: true, value: { ...base, filter: 'ALL' } });
  });

  it('takes a page, a size and a filter and nothing else: no shop, no body of the caller\'s', () => {
    const base = { page: 0, size: 20 };
    const bad: unknown[] = [
      null,
      [],
      {},
      { page: 0 },
      { size: 20 },
      { filter: 'ALL' },
      { ...base, page: -1 },
      { ...base, page: 1.5 },
      { ...base, page: '0' },
      { ...base, page: PAGE_MAX + 1 },
      { ...base, size: 0 },
      { ...base, size: PAGE_MAX_SIZE + 1 },
      { ...base, shopId: 1 },
      { ...base, filter: 'ALL', shopId: 1 },
      { ...base, body: '{"filter":"ALL"}' },
      { ...base, rating: 1 },
      { ...base, filters: ['ALL'] },
    ];
    for (const input of bad) expect(spec.parse(input).ok).toBe(false);
    expect(spec.parse({ page: PAGE_MAX, size: PAGE_MAX_SIZE }).ok).toBe(true);
  });
});

describe('route table', () => {
  it('knows only its own ids', () => {
    for (const id of ['products.list', 'products.stats', 'skus.list', 'invoices.list', 'returns.list', 'reviews.list', 'shops.list', 'contract.end', 'notifications.unread', 'barcodes.types']) {
      expect(isRouteId(id)).toBe(true);
    }
    for (const id of ['constructor', 'toString', '__proto__', 'x', 5, null, 'account', 'check_token', 'notifications.list', 'reviews.reply', 'skus.update', 'barcodes.print', 'invoices.create']) {
      expect(isRouteId(id)).toBe(false);
    }
  });

  it('holds only reads under /api/ on the API origin: GET everywhere but the one recorded POST', () => {
    const samples: Record<string, unknown> = {
      'products.list': { shopId: 1, page: 0, size: 5 },
      'products.stats': { shopId: 1 },
      'skus.list': { shopId: 1, page: 0, size: 20, search: 'x' },
      'invoices.list': { shopId: 1, page: 0, size: 20 },
      'returns.list': { shopId: 1, page: 0, size: 20 },
      'reviews.list': { page: 0, size: 20 },
      'shops.list': {},
      'contract.end': { shopId: 1 },
      'notifications.unread': {},
      'barcodes.types': {},
    };
    expect(Object.keys(UZUM_ROUTES).sort()).toEqual(Object.keys(samples).sort());
    const posts: string[] = [];
    for (const [id, spec] of Object.entries(UZUM_ROUTES)) {
      expect(['GET', 'POST']).toContain(spec.method);
      expect(spec.source.startsWith(`${spec.method} /api/`)).toBe(true);
      /* A body exists exactly where the verb is POST, and nowhere else. */
      if (spec.method === 'POST') posts.push(id);
      else expect(spec).not.toHaveProperty('body');
      const url = toApiUrl((spec as { target(p: unknown): string }).target(samples[id]));
      expect(url?.startsWith(`${UZUM_API_ORIGIN}/api/`)).toBe(true);
    }
    expect(posts).toEqual(['reviews.list']);
  });

  it('says which shop a call is for, and none for an account route', () => {
    expect(shopOfRoute('products.list', { shopId: 5, page: 0, size: 5 })).toBe(5);
    expect(shopOfRoute('invoices.list', { shopId: 6, page: 0, size: 20 })).toBe(6);
    expect(shopOfRoute('returns.list', { shopId: 8, page: 0, size: 20 })).toBe(8);
    expect(shopOfRoute('contract.end', { shopId: 7 })).toBe(7);
    expect(shopOfRoute('skus.list', { shopId: 9, page: 0, size: 20 })).toBe(9);
    expect(shopOfRoute('barcodes.types', {})).toBeNull();
    expect(shopOfRoute('shops.list', {})).toBeNull();
    expect(shopOfRoute('notifications.unread', {})).toBeNull();
  });

  it('never resolves a target off the API origin', () => {
    expect(toApiUrl('//evil.example/api/x')).toBeNull();
    expect(toApiUrl('https://evil.example/api/x')).toBeNull();
    expect(toApiUrl('/other')).toBeNull();
    expect(toApiUrl('/api/ok')).toBe(`${UZUM_API_ORIGIN}/api/ok`);
  });
});
