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
    }
  });
});

describe('the account routes', () => {
  it('build the recorded paths: the trailing slash of the shop list, the v1 prefix of the counter', () => {
    expect(toApiUrl(UZUM_ROUTES['shops.list'].target({}))).toBe(`${UZUM_API_ORIGIN}/api/seller/shop/`);
    expect(toApiUrl(UZUM_ROUTES['notifications.unread'].target({}))).toBe(
      `${UZUM_API_ORIGIN}/api/v1/seller/notification/unread-count`,
    );
  });

  it('name no shop and no permission', () => {
    for (const id of ['shops.list', 'notifications.unread'] as const) {
      expect(UZUM_ROUTES[id].scope).toBe('account');
      expect(UZUM_ROUTES[id].method).toBe('GET');
      expect(UZUM_ROUTES[id]).not.toHaveProperty('permission');
      expect(UZUM_ROUTES[id]).not.toHaveProperty('shopOf');
    }
  });

  it('take nothing at all', () => {
    for (const id of ['shops.list', 'notifications.unread'] as const) {
      expect(UZUM_ROUTES[id].parse({})).toEqual({ ok: true, value: {} });
      for (const input of [null, undefined, [], 'x', { shopId: 1 }, { page: 0 }, { key: 'ONBOARDING' }]) {
        expect(UZUM_ROUTES[id].parse(input).ok).toBe(false);
      }
    }
  });
});

describe('route table', () => {
  it('knows only its own ids', () => {
    for (const id of ['products.list', 'products.stats', 'invoices.list', 'returns.list', 'shops.list', 'contract.end', 'notifications.unread']) {
      expect(isRouteId(id)).toBe(true);
    }
    for (const id of ['constructor', 'toString', '__proto__', 'x', 5, null, 'account', 'check_token', 'notifications.list']) {
      expect(isRouteId(id)).toBe(false);
    }
  });

  it('holds only GET routes under /api/ on the API origin', () => {
    const samples: Record<string, unknown> = {
      'products.list': { shopId: 1, page: 0, size: 5 },
      'products.stats': { shopId: 1 },
      'invoices.list': { shopId: 1, page: 0, size: 20 },
      'returns.list': { shopId: 1, page: 0, size: 20 },
      'shops.list': {},
      'contract.end': { shopId: 1 },
      'notifications.unread': {},
    };
    expect(Object.keys(UZUM_ROUTES).sort()).toEqual(Object.keys(samples).sort());
    for (const [id, spec] of Object.entries(UZUM_ROUTES)) {
      expect(spec.method).toBe('GET');
      expect(spec.source.startsWith('GET /api/')).toBe(true);
      const url = toApiUrl((spec as { target(p: unknown): string }).target(samples[id]));
      expect(url?.startsWith(`${UZUM_API_ORIGIN}/api/`)).toBe(true);
    }
  });

  it('says which shop a call is for, and none for an account route', () => {
    expect(shopOfRoute('products.list', { shopId: 5, page: 0, size: 5 })).toBe(5);
    expect(shopOfRoute('invoices.list', { shopId: 6, page: 0, size: 20 })).toBe(6);
    expect(shopOfRoute('returns.list', { shopId: 8, page: 0, size: 20 })).toBe(8);
    expect(shopOfRoute('contract.end', { shopId: 7 })).toBe(7);
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
