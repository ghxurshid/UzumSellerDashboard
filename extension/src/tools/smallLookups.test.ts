import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@core/errors/apiError';
import type { ToolResult } from '@core/tools/contract';
import { runLookup } from '@core/tools/createToolkit';
import type { SellerSession } from '@ext/uzum/session';

import type { ExtToolContext } from './context';

const { uzumRequest } = vi.hoisted(() => ({ uzumRequest: vi.fn() }));
vi.mock('@ext/uzum/client', () => ({ uzumRequest, BRIDGE_CLOSED_CODE: 'BRIDGE_CLOSED' }));

const { EXT_TOOLS } = await import('./index');

/**
 * The four lookups whose whole answer is a handful of values: `products.stats`,
 * `contract.end`, `notifications.unread` and `barcodes.types`. The bodies are
 * the masked samples of the request/response catalogue (cards 5.B.9, 5.B.7,
 * 5.B.5 and 5.B.14); shop ids are invented.
 */

const session = (over: Partial<SellerSession> = {}): SellerSession => ({
  signedIn: true,
  shopIds: [11, 12],
  currentShopId: 12,
  sellerId: 5,
  accountId: 6,
  permissions: {},
  ...over,
});

const context = (over: Partial<ExtToolContext> = {}): ExtToolContext => ({
  language: 'en',
  now: Date.UTC(2026, 10, 16),
  signal: undefined,
  session: session(),
  ...over,
});

const SIGNED_OUT = context({ session: session({ signedIn: false, shopIds: [], currentShopId: null }) });

const run = (id: string, args: unknown, ctx: ExtToolContext = context()): Promise<ToolResult> =>
  runLookup(EXT_TOOLS, id, args, ctx);

const headerOf = (text: string): string => text.split('\n')[0] ?? '';

beforeEach(() => {
  uzumRequest.mockReset();
});

describe('products.stats', () => {
  const ROUTE = 'GET /api/seller/shop/{shopId}/product/products-statistic';
  /* The eight counters of the recorded response, in its order. */
  const BODY = {
    statisticResultList: [
      { count: 5, type: 'OUT_OF_STOCK', shopId: 12 },
      { count: 7, type: 'INACTIVE', shopId: 12 },
      { count: 0, type: 'WARN', shopId: 12 },
      { count: 1, type: 'ARCHIVED', shopId: 12 },
      { count: 22, type: 'WITHOUT_REQUIRED_FILTERS', shopId: 12 },
      { count: 0, type: 'WITHOUT_WEIGHT_DIMENSIONAL', shopId: 12 },
      { count: 30, type: 'IN_STOCK', shopId: 12 },
      { count: 38, type: 'ALL', shopId: 12 },
    ],
  };
  const ok = (data: unknown) => ({ status: 200, data, shopId: 12, route: ROUTE });

  it('asks for the shop on screen and prints the counters as the response held them', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    const result = await run('products.stats', {});

    expect(uzumRequest).toHaveBeenCalledWith('products.stats', { shopId: 12 }, expect.any(AbortSignal));
    expect(headerOf(result.text)).toBe(
      `[products.stats] shop 12 (the one the cabinet page shows) · 8 counters · live from ${ROUTE}`,
    );
    expect(result.text.split('\n').slice(2)).toEqual([
      'askedShopId|type|count|shopId',
      '12|OUT_OF_STOCK|5|12',
      '12|INACTIVE|7|12',
      '12|WARN|0|12',
      '12|ARCHIVED|1|12',
      '12|WITHOUT_REQUIRED_FILTERS|22|12',
      '12|WITHOUT_WEIGHT_DIMENSIONAL|0|12',
      '12|IN_STOCK|30|12',
      '12|ALL|38|12',
    ]);
    expect(result.trace).toBe('shop 12 (the one the cabinet page shows) · 8 counters');
  });

  it('warns on every result that the counters are not a breakdown', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    const units = (await run('products.stats', {})).text.split('\n')[1] ?? '';

    expect(units).toContain('the types overlap: the counters are not a breakdown, do not add them up');
    expect(units).toContain("askedShopId is this call's shop, added here");
  });

  it('prints a zero as zero and a missing count as an empty cell', async () => {
    uzumRequest.mockResolvedValue(ok({ statisticResultList: [{ count: 0, type: 'WARN' }, { count: null, type: 'ALL' }, { type: 'NEW' }] }));
    const lines = (await run('products.stats', {})).text.split('\n').slice(3);

    expect(lines).toEqual(['12|WARN|0|', '12|ALL||', '12|NEW||']);
  });

  it('takes an explicit shop the seller has and refuses one they do not, without a request', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    await run('products.stats', { shopId: 11 });
    expect(uzumRequest.mock.calls[0]?.[1]).toEqual({ shopId: 11 });

    uzumRequest.mockClear();
    const refused = await run('products.stats', { shopId: 999 });
    expect(uzumRequest).not.toHaveBeenCalled();
    expect(refused.text).toContain("[products.stats] shopId 999 is not this seller's · no request was made");
  });

  it('says an empty list is empty, and prints anything else generically', async () => {
    uzumRequest.mockResolvedValue(ok({ statisticResultList: [] }));
    const empty = await run('products.stats', {});
    expect(headerOf(empty.text)).toContain('0 counters');
    expect(empty.text).toContain('statisticResultList — 0 rows');

    uzumRequest.mockResolvedValue(ok([{ count: 1, type: 'ALL' }]));
    const other = await run('products.stats', {});
    expect(headerOf(other.text)).toContain('shape not recognised (expected an object holding statisticResultList)');
    expect(other.text).toContain('askedShopId|count|type');
  });

  it('reports a failure with the shop still in the header', async () => {
    uzumRequest.mockRejectedValue(new ApiError('Server', { kind: 'server', status: 502 }));
    const result = await run('products.stats', {});

    expect(headerOf(result.text)).toBe('[products.stats] shop 12 (the one the cabinet page shows) · FAILED');
    expect(result.text).toContain('HTTP 502');
  });
});

describe('contract.end', () => {
  const ROUTE = 'GET /api/seller/committent/contract/end-date';
  const BODY = { payload: '2031-01-10', timestamp: '2026-11-13T03:01:48.81889819' };
  const ok = (data: unknown) => ({ status: 200, data, shopId: 12, route: ROUTE });

  it('prints the date as received, beside the shop that was asked', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    const result = await run('contract.end', {});

    expect(uzumRequest).toHaveBeenCalledWith('contract.end', { shopId: 12 }, expect.any(AbortSignal));
    expect(headerOf(result.text)).toBe(`[contract.end] shop 12 (the one the cabinet page shows) · live from ${ROUTE}`);
    expect(result.text.split('\n')[2]).toBe('askedShopId=12 payload=2031-01-10 timestamp=2026-11-13T03:01:48.81889819');
    expect(result.trace).toBe('shop 12 (the one the cabinet page shows) · 2031-01-10');
    expect(result.routes).toEqual([ROUTE]);
  });

  it('says on every result that the meaning comes from the route\'s name', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    const units = (await run('contract.end', {})).text.split('\n')[1] ?? '';

    expect(units).toContain("that it is the contract's end date is read from the route's name");
    expect(units).toContain('no zone stated');
  });

  it('says a null payload states no date, rather than printing an empty value alone', async () => {
    uzumRequest.mockResolvedValue(ok({ payload: null, timestamp: '2026-11-13T03:01:48.8' }));
    const result = await run('contract.end', {});

    expect(headerOf(result.text)).toContain('payload is null: the response states no date');
    expect(result.trace).toContain('no date');
    expect(result.text).toContain('askedShopId=12 payload= timestamp=');
  });

  it('prints a payload of another type as it came', async () => {
    uzumRequest.mockResolvedValue(ok({ payload: 1925683200000 }));

    expect((await run('contract.end', {})).text).toContain('payload=1925683200000 timestamp=');
  });

  it('prints a body without payload generically', async () => {
    uzumRequest.mockResolvedValue(ok({ endDate: '2031-01-10' }));
    const result = await run('contract.end', {});

    expect(headerOf(result.text)).toContain('shape not recognised (expected an object holding payload)');
    expect(result.text).toContain('endDate=2031-01-10');
  });

  it('asks which shop when none is settled, and repeats a missing permission', async () => {
    const choose = await run('contract.end', {}, context({ session: session({ currentShopId: null }) }));
    expect(uzumRequest).not.toHaveBeenCalled();
    expect(choose.text).toContain('[contract.end] shop not chosen · no request was made');

    uzumRequest.mockRejectedValue(new ApiError('The seller lacks SHOP_READ on shop 12.', { kind: 'forbidden' }));
    const denied = await run('contract.end', {});
    expect(denied.text).toContain('The seller lacks SHOP_READ on shop 12.');
  });
});

describe('notifications.unread', () => {
  const ROUTE = 'GET /api/v1/seller/notification/unread-count';
  const ok = (data: unknown) => ({ status: 200, data, shopId: null, route: ROUTE });

  it('asks for no shop and prints the one number', async () => {
    uzumRequest.mockResolvedValue(ok({ unreadCount: 1 }));
    const result = await run('notifications.unread', {}, context({ session: session({ currentShopId: null }) }));

    expect(uzumRequest).toHaveBeenCalledWith('notifications.unread', {}, expect.any(AbortSignal));
    expect(headerOf(result.text)).toBe(`[notifications.unread] live from ${ROUTE}`);
    expect(result.text.split('\n')[2]).toBe('unreadCount=1');
    expect(result.trace).toBe('unreadCount 1');
  });

  it('prints zero as zero and a quoted number as it came', async () => {
    uzumRequest.mockResolvedValue(ok({ unreadCount: 0 }));
    expect((await run('notifications.unread', {})).text).toContain('unreadCount=0');

    uzumRequest.mockResolvedValue(ok({ unreadCount: '3' }));
    expect((await run('notifications.unread', {})).text).toContain('unreadCount=3');
  });

  it('says a null count states no number, never zero', async () => {
    uzumRequest.mockResolvedValue(ok({ unreadCount: null }));
    const result = await run('notifications.unread', {});

    expect(headerOf(result.text)).toContain('unreadCount is null: the response states no number');
    expect(result.trace).toBe('unreadCount not stated');
    expect(result.text).not.toContain('unreadCount=0');
  });

  it('says on every result what cannot be told from it', async () => {
    uzumRequest.mockResolvedValue(ok({ unreadCount: 1 }));
    const units = (await run('notifications.unread', {})).text.split('\n')[1] ?? '';

    expect(units).toContain('whether it counts the whole account or one shop is not recorded');
    expect(units).toContain('the notifications themselves cannot be read');
  });

  it('prints an empty or foreign body generically', async () => {
    uzumRequest.mockResolvedValue(ok(null));
    const empty = await run('notifications.unread', {});
    expect(headerOf(empty.text)).toContain('shape not recognised (expected an object holding unreadCount)');
    expect(empty.text).toContain('the response body is empty (null)');

    uzumRequest.mockResolvedValue(ok({ count: 4 }));
    expect((await run('notifications.unread', {})).text).toContain('count=4');
  });

  it('makes no request in a tab that is not signed in', async () => {
    const result = await run('notifications.unread', {}, SIGNED_OUT);

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('[notifications.unread] not signed in · no request was made');
  });
});

describe('barcodes.types', () => {
  const ROUTE = 'GET /api/seller/reports/barcodes/types';
  /* The five label sizes of the recorded response, in its order. The first title's
     separator is the Cyrillic letter the recording held; the other four are Latin. */
  const BODY = {
    barcodeLabelTypes: [
      { id: 5, title: '43 \u0445 25', printType: 'ThermalPrinter', length: 43, width: 25 },
      { id: 4, title: '70 x 37', printType: 'A4', length: 70, width: 37 },
      { id: 3, title: '48.5 x 25.4', printType: 'A4', length: 48.5, width: 25.4 },
      { id: 2, title: '38 x 21.2', printType: 'A4', length: 38, width: 21.2 },
      { id: 1, title: '30 x 20', printType: 'ThermalPrinter', length: 30, width: 20 },
    ],
  };
  const ok = (data: unknown) => ({ status: 200, data, shopId: null, route: ROUTE });

  it('asks for no shop and prints the sizes as the response held them', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    const result = await run('barcodes.types', {}, context({ session: session({ currentShopId: null }) }));

    expect(uzumRequest).toHaveBeenCalledWith('barcodes.types', {}, expect.any(AbortSignal));
    expect(headerOf(result.text)).toBe(`[barcodes.types] 5 label sizes · live from ${ROUTE}`);
    expect(result.text.split('\n').slice(2)).toEqual([
      'id|title|printType|length|width',
      '5|43 \u0445 25|ThermalPrinter|43|25',
      '4|70 x 37|A4|70|37',
      '3|48.5 x 25.4|A4|48.5|25.4',
      '2|38 x 21.2|A4|38|21.2',
      '1|30 x 20|ThermalPrinter|30|20',
    ]);
    expect(result.routes).toEqual([ROUTE]);
    expect(result.trace).toBe('5 label sizes');
  });

  it('ignores a shop the model adds: the route takes none', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    await run('barcodes.types', { shopId: 11 });

    expect(uzumRequest).toHaveBeenCalledWith('barcodes.types', {}, expect.any(AbortSignal));
  });

  it('says on every result that the unit is a guess and that nothing is printed', async () => {
    uzumRequest.mockResolvedValue(ok(BODY));
    const units = (await run('barcodes.types', {})).text.split('\n')[1] ?? '';

    expect(units).toContain('no unit is stated');
    expect(units).toContain('probably millimetres');
    expect(units).toContain('sizes only: nothing is printed from here');
  });

  it('counts one size as one, skips what is not an object and prints an empty list as empty', async () => {
    uzumRequest.mockResolvedValue(ok({ barcodeLabelTypes: [BODY.barcodeLabelTypes[0], null, 'x'] }));
    const some = await run('barcodes.types', {});
    expect(headerOf(some.text)).toContain(
      '1 label size · unexpected: 2 of 3 barcodeLabelTypes entries are not objects and were skipped',
    );
    expect(some.trace).toBe('1 label size');

    uzumRequest.mockResolvedValue(ok({ barcodeLabelTypes: [] }));
    const none = await run('barcodes.types', {});
    expect(headerOf(none.text)).toContain('0 label sizes');
    expect(none.text).toContain('barcodeLabelTypes — 0 rows');
  });

  it('prints a body that is not the recorded envelope generically', async () => {
    uzumRequest.mockResolvedValue(ok(BODY.barcodeLabelTypes));
    const bare = await run('barcodes.types', {});
    expect(headerOf(bare.text)).toContain(
      'shape not recognised (expected an object holding barcodeLabelTypes): printed generically',
    );
    expect(bare.text).toContain('ThermalPrinter');
    expect(bare.trace).toBe('barcodes.types: shape not recognised');

    uzumRequest.mockResolvedValue(ok({ barcodeLabelTypes: null }));
    expect(headerOf((await run('barcodes.types', {})).text)).toContain('shape not recognised');
  });

  it('says what the API answered when the request fails', async () => {
    uzumRequest.mockRejectedValue(new ApiError('The cabinet API answered HTTP 403.', { kind: 'forbidden', status: 403 }));
    const result = await run('barcodes.types', {});

    expect(headerOf(result.text)).toBe('[barcodes.types] FAILED');
    expect(result.text).toContain('The Uzum API answered HTTP 403');
    expect(result.routes).toBeUndefined();
  });

  it('makes no request in a tab that is not signed in', async () => {
    const result = await run('barcodes.types', {}, SIGNED_OUT);

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('[barcodes.types] not signed in · no request was made');
  });
});
