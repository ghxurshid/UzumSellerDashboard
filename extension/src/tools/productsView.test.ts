import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '@core/tools/contract';
import { runLookup } from '@core/tools/createToolkit';
import type { SellerSession } from '@ext/uzum/session';

import type { ExtToolContext } from './context';

const { uzumRequest } = vi.hoisted(() => ({ uzumRequest: vi.fn() }));
vi.mock('@ext/uzum/client', () => ({ uzumRequest, BRIDGE_CLOSED_CODE: 'BRIDGE_CLOSED' }));

const { EXT_TOOLS } = await import('./index');

/**
 * The masked recording (ids, titles, barcodes and prices invented; structure,
 * nulls, enum codes and numeric relationships as recorded) drives the product
 * and SKU views. It is ONE product of a page whose total says 38, so paging
 * cases build longer pages by repeating that product under new ids.
 */

const ROUTE = 'GET /api/seller/shop/{shopId}/product/getProducts';

interface Sample {
  productList: Array<Record<string, unknown>>;
  totalProductsAmount: number;
  totalProductsAmountWithoutWeightDimensional: number;
}

const sample = JSON.parse(
  readFileSync(new URL('../uzum/getProducts.response.masked.json', import.meta.url), 'utf8'),
) as Sample;

const session: SellerSession = {
  signedIn: true,
  shopIds: [11, 12],
  currentShopId: 11,
  sellerId: 5,
  accountId: 6,
  permissions: {},
};

const context: ExtToolContext = { language: 'en', now: Date.UTC(2026, 10, 12), signal: undefined, session };

const ok = (data: unknown) => ({ status: 200, data, shopId: 11, route: ROUTE });
const lookup = (args: unknown): Promise<ToolResult> => runLookup(EXT_TOOLS, 'products.list', args, context);
const headOf = (result: ToolResult): string => result.text.split('\n')[0] ?? '';

/** `count` copies of the recorded product, a response total, and stray entries the reader will drop. */
function pageOf(count: number, total: number | null, strays: unknown[] = []): unknown {
  return {
    productList: [
      ...Array.from({ length: count }, (_, i) => ({ ...sample.productList[0], productId: 4_000_001 + i })),
      ...strays,
    ],
    ...(total === null ? {} : { totalProductsAmount: total }),
  };
}

beforeEach(() => {
  uzumRequest.mockReset();
  uzumRequest.mockResolvedValue(ok(sample));
});

describe('the product view', () => {
  it('prints curated columns under the API names, values exactly as returned', async () => {
    const result = await lookup({});
    const lines = result.text.split('\n');

    expect(lines[0]).toBe(
      `[products.list] shop 11 (the one the cabinet page shows) · page 0 · size 24 · filter ALL · 1 product on this page · rows 1–1 of 38 (totalProductsAmount; positions computed from page × size) — fewer than the 24 asked for while 37 more remain by the total: the API seems to cap a page. Page 1 starts at row 25, skipping rows 2–24; ask size 1 or less to page without gaps · totalProductsAmountWithoutWeightDimensional 0 · live from ${ROUTE}`,
    );
    expect(lines[1]).toContain('units unknown (price has no unit in the payload)');
    expect(lines[1]).toContain('an empty cell is null or absent');
    expect(lines[1]).toContain('computed here: row positions');
    expect(lines[2]).toBe('products — 1 rows');
    expect(lines[3]).toBe(
      'askedShopId|productId|title|status.value|moderationStatus.value|quantityAvailable|quantityAvailableByStockType.fbo|quantityAvailableByStockType.fbs|quantitySold|quantityReturned|returnedPercentage|price|rating|feedbackQuantity|viewers|clicks|conversion|rankInfo.rank|pstorage|promotionStatus|previewImg|skuList.length|skuList.RUN_OUT',
    );
    /* clicks is null in the recording: an empty cell, not 0; rating stays the string it was.
       previewImg is printed whole — it is copied into a product card as it stands. */
    expect(lines[4]).toBe(
      '11|4000001|Спортивный комплект «Образец» – футболка и шорты|IN_STOCK|MODERATED|15|15|0|8|9|52.9|120000|5.0|2|774||1.16|A|true|PROMOTION_AVAILABLE|https://images.uzum.uz/yyyyyyyyyyyyyyyyyyyy/t_product_80_low.jpg|5|1',
    );
    expect(result.trace).toBe('shop 11 (the one the cabinet page shows) · page 0 · 1 products');
  });

  it('keeps askedShopId from the shop asked', async () => {
    const result = await lookup({ shopId: 12 });

    expect(result.text).toContain('\n12|4000001|');
  });

  it('prints a page of 24 within the character budget', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(24, 38)));
    const result = await lookup({});

    expect(result.text).toContain('products — 24 rows');
    expect(result.text).not.toContain('TRUNCATED');
    expect(result.text.length).toBeLessThan(12_000);
  });
});

describe('the sku view', () => {
  it('prints one row per SKU in the same request, nulls empty, dates beside their ISO text', async () => {
    const result = await lookup({ view: 'skus' });
    const lines = result.text.split('\n');

    expect(uzumRequest).toHaveBeenCalledTimes(1);
    expect(lines[0]).toContain('view skus');
    expect(lines[0]).toContain('1 product on this page, 5 SKUs');
    expect(result.text).toContain('skus — 5 rows');

    /* The empty SKU: RUN_OUT, forecast true, and every paid-storage field empty, not 0. */
    const empty = lines.find((line) => line.includes('|50000005|')) ?? '';
    expect(empty).toBe(
      '11|4000001|50000005|КРАСН-M|M, Красный|2000000000055|RUN_OUT|true|0|0|0|4|2|33.333333333333336|120000|25.5|||||||A|false|true|1796324340000|2026-12-03 18:59|false|false',
    );
    const stocked = lines.find((line) => line.includes('|50000002|')) ?? '';
    expect(stocked).toContain('|true|96|480|0|5||');
  });
});

describe('paging against the response total', () => {
  it.each([
    [0, 24, 24, 38, '1–24 of 38', '14 more remain: next page 1'],
    [1, 24, 14, 38, '25–38 of 38', 'nothing further per the total'],
    [1, 10, 10, 38, '11–20 of 38', '18 more remain: next page 2'],
  ])('page %i size %i with %i products', async (page, size, count, total, range, tail) => {
    uzumRequest.mockResolvedValue(ok(pageOf(count, total)));
    const head = headOf(await lookup({ page, size }));

    expect(head).toContain(`rows ${range} (totalProductsAmount; positions computed from page × size) — ${tail}`);
  });

  it('says a capped page skips rows at the next page number', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(24, 130)));
    const head = headOf(await lookup({ size: 50 }));

    expect(head).toContain('fewer than the 50 asked for while 106 more remain by the total: the API seems to cap a page');
    expect(head).toContain('Page 1 starts at row 51, skipping rows 25–50; ask size 24 or less to page without gaps');
  });

  it('falls back to the no-total wording, and never calls a page the last', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(5, null)));
    const head = headOf(await lookup({ size: 10 }));

    expect(head).toContain('fewer than the 10 asked for — the API may cap a page, so more may exist; ask page 1 to check; the response carries no total');
    expect(head).not.toMatch(/last page|nothing further/);
  });

  it('says when the page and the total disagree', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(3, 2)));

    expect(headOf(await lookup({ size: 10 }))).toContain('the page reaches past the total');
  });

  it('tells an empty page past the end from an empty read', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(0, 38)));
    expect(headOf(await lookup({ page: 5 }))).toContain('page 5 starts after the end');

    uzumRequest.mockResolvedValue(ok(pageOf(0, 0)));
    expect(headOf(await lookup({}))).toContain('no products in this read — the response says totalProductsAmount 0');
  });

  it('says how many entries of the list could not be read', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(2, 38, ['stray', 7])));

    expect(headOf(await lookup({}))).toContain('unexpected: 2 of 4 productList entries are not objects and were skipped');
  });
});

describe('filter and search', () => {
  it('sends ALL by default, and names the other recorded value as undocumented', async () => {
    expect(headOf(await lookup({}))).toContain('filter ALL ·');
    expect(uzumRequest.mock.calls[0]?.[1]).toMatchObject({ filter: 'ALL' });

    const head = headOf(await lookup({ filter: 'WITHOUT_REQUIRED_FILTERS' }));
    expect(uzumRequest.mock.calls[1]?.[1]).toMatchObject({ filter: 'WITHOUT_REQUIRED_FILTERS' });
    expect(head).toContain('filter WITHOUT_REQUIRED_FILTERS (meaning undocumented)');
  });

  it('rejects a filter that was never recorded', async () => {
    const result = await lookup({ filter: 'ACTIVE' });

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('arguments rejected');
  });

  it('passes a trimmed search as searchQuery and names it in the header', async () => {
    const result = await lookup({ search: '  sharf  ' });

    expect(uzumRequest.mock.calls[0]?.[1]).toEqual({ shopId: 11, page: 0, size: 24, filter: 'ALL', searchQuery: 'sharf' });
    expect(headOf(result)).toContain('search "sharf"');
  });

  it('sends nothing for blank text, and refuses control characters without a request', async () => {
    await lookup({ search: '   ' });
    expect(uzumRequest.mock.calls[0]?.[1]).not.toHaveProperty('searchQuery');

    uzumRequest.mockClear();
    const refused = await lookup({ search: 'a\nb' });
    expect(uzumRequest).not.toHaveBeenCalled();
    expect(refused.text).toContain('search refused · no request was made');
  });

  it('rejects a search over the bound', async () => {
    const result = await lookup({ search: 'x'.repeat(101) });

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('search refused · no request was made');
  });

  it('describes the arguments and the field legend honestly', () => {
    const tool = EXT_TOOLS['products.list'];
    const { shape } = tool?.schema as unknown as { shape: Record<string, { description?: string }> };
    const schema = `${shape['search']?.description} ${shape['filter']?.description}`;

    expect(tool?.args).toContain('search?:text');
    expect(tool?.args).toContain('view?:products|skus');
    expect(schema).toContain('only ever recorded empty');
    expect(schema).toContain('Check that the rows returned actually match');
    expect(schema).toContain('not documented');
  });
});

describe('an unrecognised shape', () => {
  it('uses the generic renderer and says so', async () => {
    uzumRequest.mockResolvedValue(ok({ items: [{ id: 1 }, { id: 2 }] }));
    const result = await lookup({});

    expect(headOf(result)).toContain('shape not recognised: printed generically');
    expect(result.text).toContain('items — 2 rows');
    expect(result.text).not.toContain('totalProductsAmount');
  });
});

describe('values of an unexpected type are shown as they came', () => {
  it('prints a price that arrived as a string, and names no field empty that was not', async () => {
    const entry = { ...sample.productList[0], price: '120000', viewers: { n: 774 }, skuList: [{ ...(sample.productList[0]?.['skuList'] as unknown[])[0] as object, price: '95000' }] };
    uzumRequest.mockResolvedValue(ok({ productList: [entry], totalProductsAmount: 38 }));
    const products = (await lookup({})).text.split('\n');
    const row = (products[4] ?? '').split('|');

    expect(row[11]).toBe('120000');
    expect(row[14]).toBe('{n}');

    const skus = (await lookup({ view: 'skus' })).text;
    expect(skus).toContain('|95000|');
  });

  it('shows what a step through a non-object held', async () => {
    const entry = { ...sample.productList[0], status: 'IN_STOCK' };
    uzumRequest.mockResolvedValue(ok({ productList: [entry], totalProductsAmount: 1 }));

    expect((await lookup({})).text).toContain('(status: IN_STOCK)');
  });

  it('does not count a non-object skuList entry as a SKU, and says so', async () => {
    const skus = sample.productList[0]?.['skuList'] as unknown[];
    const entry = { ...sample.productList[0], skuList: [skus[0], 'junk', 7, null] };
    uzumRequest.mockResolvedValue(ok({ productList: [entry], totalProductsAmount: 1 }));

    const products = await lookup({});
    expect(headOf(products)).toContain('unexpected: 3 skuList entries are not objects and were not counted as SKUs');
    expect(products.text).toContain('|1|0\n'.replace('\n', '')); // skuList.length 1, RUN_OUT 0

    const view = await lookup({ view: 'skus' });
    expect(view.text).toContain('skus — 1 rows');
    expect(headOf(view)).toContain('1 product on this page, 1 SKUs');
  });

  it('says when totalProductsAmount is not a plain count', async () => {
    uzumRequest.mockResolvedValue(ok({ productList: [sample.productList[0]], totalProductsAmount: '38' }));
    const head = headOf(await lookup({}));

    expect(head).toContain('totalProductsAmount is not a plain count and was not used');
    expect(head).toContain('the response carries no total');
  });

  it('adds no anomaly note for the clean sample', async () => {
    expect(headOf(await lookup({}))).not.toContain('unexpected');
  });
});

describe('a narrowed read draws nothing from the total', () => {
  const caveat = '(not recorded whether it follows this filter or search)';

  it('with a search: states the total with the caveat, no cap, no rows remaining', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(2, 38)));
    const head = headOf(await lookup({ search: 'sharf' }));

    expect(head).toContain(`fewer than the 24 asked for; totalProductsAmount 38 ${caveat}`);
    expect(head).not.toMatch(/cap a page|remain|skipping|ask size/);
  });

  it('with the second filter: the same, and a full page still names the next one', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(2, 38)));
    expect(headOf(await lookup({ filter: 'WITHOUT_REQUIRED_FILTERS' }))).toContain(`fewer than the 24 asked for; totalProductsAmount 38 ${caveat}`);

    uzumRequest.mockResolvedValue(ok(pageOf(5, 38)));
    const full = headOf(await lookup({ filter: 'WITHOUT_REQUIRED_FILTERS', size: 5 }));
    expect(full).toContain(`as many as asked — there may be more: next page 1; totalProductsAmount 38 ${caveat}`);
    expect(full).not.toMatch(/remain|skipping/);
  });

  it('an empty narrowed page is not called past the end', async () => {
    uzumRequest.mockResolvedValue(ok(pageOf(0, 38)));

    const head = headOf(await lookup({ search: 'zzz' }));
    expect(head).toContain(`empty page — nothing at this page number; totalProductsAmount 38 ${caveat}`);
    expect(head).not.toContain('starts after the end');
  });
});

describe('errors beside the product list', () => {
  it('says so in the header and prints them, instead of reading an empty list as "no products"', async () => {
    uzumRequest.mockResolvedValue(ok({ productList: [], totalProductsAmount: 0, errors: [{ code: 'E7', text: 'shop blocked' }] }));
    const result = await lookup({});

    expect(headOf(result)).toContain('the response also carries errors (1 entries) — read them below');
    expect(result.text).toContain('errors — 1 rows');
    expect(result.text).toContain('shop blocked');
  });

  it('adds nothing when there are no such lists, or they are empty', async () => {
    uzumRequest.mockResolvedValue(ok({ ...(sample as object), errors: [] }));

    expect(headOf(await lookup({}))).not.toContain('also carries');
  });
});

describe('search is checked as the model wrote it', () => {
  it.each([['kit\n'], ['a\u0085b'], ['tab\there'], ['\u007fx']])('refuses %j without a request', async (search) => {
    const result = await lookup({ search });

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('search refused · no request was made');
    expect(result.text).toContain('plain text on one line');
  });
});

describe('bounded output', () => {
  const skuOf = (id: number) => ({ ...(sample.productList[0]?.['skuList'] as object[])[0], skuId: id });

  it('keeps the sku view bounded for 10 000 SKUs and says how many rows are shown', async () => {
    const product = { ...sample.productList[0], skuList: Array.from({ length: 10_000 }, (_, i) => skuOf(i)) };
    uzumRequest.mockResolvedValue(ok({ productList: [product], totalProductsAmount: 1 }));
    const result = await lookup({ view: 'skus' });
    const head = headOf(result);

    expect(result.text.length).toBeLessThan(14_000);
    expect(head).toMatch(/TRUNCATED: skus: \d+ of 10000 rows shown/);
    expect(head).toContain('10000 SKUs');
    expect(result.text).toMatch(/skus — \d+ of 10000 rows shown/);
  });

  it('keeps the product view bounded for a very wide page and says how many rows are shown', async () => {
    const wide = Array.from({ length: 100 }, (_, i) => ({ ...sample.productList[0], productId: i, title: `${i}${'y'.repeat(200)}`, skuList: [] }));
    uzumRequest.mockResolvedValue(ok({ productList: wide, totalProductsAmount: 100 }));
    const result = await lookup({ size: 100 });
    const head = headOf(result);

    expect(result.text.length).toBeLessThan(14_000);
    expect(head).toMatch(/TRUNCATED: products: \d+ of 100 rows shown/);
    expect(result.text).toMatch(/products — \d+ of 100 rows shown/);
  });
});

describe('what did not match the sample is named in the header', () => {
  it('lists mistyped field paths while printing the values as received', async () => {
    const skus = sample.productList[0]?.['skuList'] as object[];
    const entry = { ...sample.productList[0], price: '120000', skuList: [{ ...skus[0], rating: 5 }] };
    uzumRequest.mockResolvedValue(ok({ productList: [entry], totalProductsAmount: 1 }));
    const result = await lookup({});

    expect(headOf(result)).toContain('fields of a type the recorded sample did not show, printed as received: price');
    expect(result.text).toContain('|120000|');
  });

  it('measures the search bound after trimming, as the route does', async () => {
    await lookup({ search: `${'x'.repeat(100)}   ` });
    expect(uzumRequest).toHaveBeenCalledTimes(1);

    uzumRequest.mockClear();
    const refused = await lookup({ search: 'x'.repeat(101) });
    expect(uzumRequest).not.toHaveBeenCalled();
    expect(refused.text).toContain('limit is 100');
  });
});
