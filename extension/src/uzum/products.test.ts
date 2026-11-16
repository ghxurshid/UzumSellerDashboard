import { describe, expect, it } from 'vitest';

import sample from './getProducts.response.masked.json';
import { readProductsPage } from './products';

/* The fixture is the MASKED form of one recorded response (ids, titles,
   barcodes, prices invented). One response is the whole evidence. */

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;
}

function firstProduct(data: Record<string, unknown>): Record<string, unknown> {
  return (data['productList'] as Record<string, unknown>[])[0] as Record<string, unknown>;
}

describe('readProductsPage', () => {
  it('reads the masked sample: 1 product, 5 SKUs, total 38, nothing mistyped', () => {
    const page = readProductsPage(sample);
    expect(page).not.toBeNull();
    expect(page?.products).toHaveLength(1);
    expect(page?.entriesHeld).toBe(1);
    expect(page?.unreadableProducts).toBe(0);
    const record = page?.products[0];
    expect(record?.skus).toHaveLength(5);
    expect(record?.skuEntriesHeld).toBe(5);
    expect(record?.unreadableSkus).toBe(0);
    expect(record?.mistyped).toEqual([]);
    expect(page?.total).toBe(38);
    expect(page?.totalWithoutWeightDimensional).toBe(0);
  });

  it('keeps the wire types: string rating/roi, millisecond timestamps, nulls as null', () => {
    const record = readProductsPage(sample)?.products[0];
    expect(record?.fields.rating).toBe('5.0');
    expect(record?.fields.roi).toBe('-100.0');
    expect(record?.fields.rankInfo?.dateUpdated).toBe(1794452671174);
    expect(record?.fields.commission).toBeNull();
    expect(record?.skus[0]?.fields.specialOffer?.endDate).toBe(1796324340000);
    expect(record?.skus[0]?.fields.characteristicsList?.[0]?.characteristicTitle?.uz).toBe('Kiyim oʻlchami');
    expect(record?.skus[1]?.fields.paidStorageAmount).toBeNull();
    expect(record?.raw['rating']).toBe('5.0');
  });

  it('returns null unless data is an object holding a productList array', () => {
    for (const bad of [null, undefined, 5, 'x', true, [], [{ productList: [] }], {}, { productList: null }, { productList: {} }, { productList: 'x' }]) {
      expect(readProductsPage(bad)).toBeNull();
    }
    expect(readProductsPage({ productList: [] })).toEqual({
      products: [],
      total: null,
      totalWithoutWeightDimensional: null,
      entriesHeld: 0,
      unreadableProducts: 0,
    });
  });

  it('reads totals as null unless finite and non-negative', () => {
    for (const bad of ['38', -1, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      const page = readProductsPage({
        productList: [],
        totalProductsAmount: bad,
        totalProductsAmountWithoutWeightDimensional: bad,
      });
      expect(page?.total).toBeNull();
      expect(page?.totalWithoutWeightDimensional).toBeNull();
    }
    expect(readProductsPage({ productList: [], totalProductsAmount: 0 })?.total).toBe(0);
  });

  it('keeps a mistyped scalar in raw exactly as returned and lists its path', () => {
    const data = clone();
    const product = firstProduct(data);
    product['price'] = '120000';
    product['rating'] = 5;
    product['viewers'] = { n: 774 };
    (product['skuList'] as Record<string, unknown>[])[1]!['quantityAvailable'] = '3';
    (product['skuList'] as Record<string, unknown>[])[0]!['rankInfo'] = { rank: 'A', dateUpdated: '1794472997270' };
    const record = readProductsPage(data)?.products[0];
    expect(record?.fields.price).toBeUndefined();
    expect(record?.raw['price']).toBe('120000');
    expect(record?.raw['rating']).toBe(5);
    expect(record?.raw['viewers']).toEqual({ n: 774 });
    expect(record?.skus[1]?.raw['quantityAvailable']).toBe('3');
    expect(record?.skus[1]?.fields.quantityAvailable).toBeUndefined();
    expect([...(record?.mistyped ?? [])].sort()).toEqual(
      ['price', 'rating', 'skuList[].quantityAvailable', 'skuList[].rankInfo.dateUpdated', 'viewers'].sort(),
    );
    /* A neighbouring field of the same entry still reads. */
    expect(record?.fields.title).toBe('Спортивный комплект «Образец» – футболка и шорты');
  });

  it('does not list null or absent values as mistyped', () => {
    const data = clone();
    const product = firstProduct(data);
    product['price'] = null;
    delete product['viewers'];
    expect(readProductsPage(data)?.products[0]?.mistyped).toEqual([]);
  });

  it('counts non-object SKU entries and excludes them', () => {
    const data = clone();
    const product = firstProduct(data);
    product['skuList'] = [{ skuId: 1 }, 'junk', 7, null, [], { skuId: 2 }];
    const record = readProductsPage(data)?.products[0];
    expect(record?.skus.map((s) => s.fields.skuId)).toEqual([1, 2]);
    expect(record?.skuEntriesHeld).toBe(6);
    expect(record?.unreadableSkus).toBe(4);
  });

  it('keeps a missing or non-array skuList apart from an empty one', () => {
    const data = clone();
    const product = firstProduct(data);
    product['skuList'] = [];
    expect(readProductsPage(data)?.products[0]?.skuEntriesHeld).toBe(0);
    delete product['skuList'];
    expect(readProductsPage(data)?.products[0]?.skuEntriesHeld).toBeNull();
    product['skuList'] = null;
    expect(readProductsPage(data)?.products[0]?.skuEntriesHeld).toBeNull();
    product['skuList'] = 'nope';
    const record = readProductsPage(data)?.products[0];
    expect(record?.skuEntriesHeld).toBeNull();
    expect(record?.mistyped).toContain('skuList');
  });

  it('counts unreadable products and excludes them', () => {
    const page = readProductsPage({ productList: [{ productId: 1 }, null, 3, 'x', [], { productId: 2 }] });
    expect(page?.entriesHeld).toBe(6);
    expect(page?.unreadableProducts).toBe(4);
    expect(page?.products.map((p) => p.fields.productId)).toEqual([1, 2]);
  });

  it('ignores unknown fields in the typed view but keeps them in raw', () => {
    const data = clone();
    data['newTopLevel'] = 1;
    firstProduct(data)['somethingNew'] = { a: 1 };
    const record = readProductsPage(data)?.products[0];
    expect(record?.fields).not.toHaveProperty('somethingNew');
    expect(record?.raw['somethingNew']).toEqual({ a: 1 });
    expect(record?.mistyped).toEqual([]);
  });

  it('bounds the mistyped list', () => {
    const wrong: Record<string, unknown> = {};
    for (const key of ['productId', 'category', 'rating', 'feedbackQuantity', 'commission', 'price', 'clicks', 'viewers', 'conversion', 'roi']) {
      wrong[key] = [];
    }
    const skuList = Array.from({ length: 200 }, (_, i) => ({ [`x${i}`]: 1, skuId: 'a', price: 'b', barcode: 'c' }));
    const record = readProductsPage({ productList: [{ ...wrong, skuList }] })?.products[0];
    expect(record?.mistyped.length).toBeLessThanOrEqual(50);
    expect(record?.mistyped).toContain('productId');
  });

  it('never throws on hostile input', () => {
    const cyclic: Record<string, unknown> = { productList: [] };
    (cyclic['productList'] as unknown[]).push(cyclic);
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
        getPrototypeOf() {
          throw new Error('trap');
        },
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    const inputs: unknown[] = [
      cyclic,
      trap,
      { productList: [trap, null, 1, 'x', [], cyclic] },
      { productList: [{ skuList: trap, status: trap }] },
      { productList: [{ skuList: [trap, { skuId: 1 }] }] },
      { productList: new Array<unknown>(3) },
      { productList: Array.from({ length: 50_000 }, () => ({})) },
      { productList: [{ skuList: Array.from({ length: 50_000 }, () => 7) }] },
      Object.create(null),
    ];
    for (const input of inputs) expect(() => readProductsPage(input)).not.toThrow();
    const sparse = readProductsPage({ productList: new Array<unknown>(3) });
    expect(sparse?.entriesHeld).toBe(3);
    expect(sparse?.unreadableProducts).toBe(3);
  });
});
