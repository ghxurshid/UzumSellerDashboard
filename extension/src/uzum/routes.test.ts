import { describe, expect, it } from 'vitest';

import {
  hasControlCharacter,
  isRouteId,
  PRODUCTS_MAX_PAGE,
  PRODUCTS_MAX_SIZE,
  PRODUCTS_FILTER_DEFAULT,
  PRODUCTS_FILTERS,
  PRODUCTS_SEARCH_MAX_LENGTH,
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

describe('route table', () => {
  it('knows only its own ids', () => {
    expect(isRouteId('products.list')).toBe(true);
    for (const id of ['constructor', 'toString', '__proto__', 'x', 5, null]) {
      expect(isRouteId(id)).toBe(false);
    }
  });

  it('never resolves a target off the API origin', () => {
    expect(toApiUrl('//evil.example/api/x')).toBeNull();
    expect(toApiUrl('https://evil.example/api/x')).toBeNull();
    expect(toApiUrl('/other')).toBeNull();
    expect(toApiUrl('/api/ok')).toBe(`${UZUM_API_ORIGIN}/api/ok`);
  });
});
