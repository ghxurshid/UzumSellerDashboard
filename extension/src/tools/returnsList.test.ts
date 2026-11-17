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
 * The rows are the masked sample of the request/response catalogue (card
 * 5.B.11): keys, order, nulls, codes and timestamps as recorded; return ids,
 * the slot id and the warehouse's external id invented. What the shared pieces
 * do (shop choice, failures, truncation) is pinned by `invoicesList.test.ts`;
 * this file holds what is particular to returns.
 */

const ROUTE = 'GET /api/seller/shop/{shopId}/return';

const STOCK = {
  id: 3,
  externalId: '00000000-0000-4000-8000-000000000003',
  title: 'Сергели',
  address: 'Ташкент, …',
  timeFrom: '06:00',
  timeTo: '23:59',
  poolSource: 'SERGELI',
  dimensionalGroups: [
    { group: 'MEDIUM', title: 'СГТ' },
    { group: 'UNKNOWN', title: 'Неопределенная' },
    { group: 'SMALL', title: 'МГТ' },
  ],
};

/** DEFECTED, with the one recorded time slot; paid storage ran past its start. */
const DEFECTED = {
  id: 1000000001,
  dateCreated: 1758865224083,
  status: 'COMPLETED',
  stock: STOCK,
  timeSlotReservation: {
    id: 7000004,
    timeSlots: [{ timeFrom: 1759910400000, timeTo: 1759917600000 }],
    status: 'RESERVED',
    timeFrom: 1759910400000,
    timeTo: 1759917600000,
  },
  paidStorage: { startDate: 1759734481210, endDate: 1763049003771, status: 'COMPLETED' },
  executionDate: 1763049003771,
  assembledDate: 1758870481210,
  completedDate: 1763049003771,
  canceledDate: null,
  externalNumber: null,
  type: 'DEFECTED',
  ettnInfo: null,
  returnDropInfo: null,
};

/** RETURN, no slot; completed BEFORE the paid period began (endDate < startDate). */
const EARLY = {
  ...DEFECTED,
  id: 100001,
  dateCreated: 1781691676419,
  timeSlotReservation: null,
  paidStorage: { startDate: 1782566841379, endDate: 1782483532662, status: 'COMPLETED' },
  executionDate: 1782483532662,
  assembledDate: 1781702841379,
  completedDate: 1782483532662,
  type: 'RETURN',
};

const TIMESTAMP = '2026-11-16T12:11:07.060963973';
const body = (payload: unknown, timestamp: unknown = TIMESTAMP) => ({ payload, timestamp });

const session = (over: Partial<SellerSession> = {}): SellerSession => ({
  signedIn: true,
  shopIds: [11, 12],
  currentShopId: 11,
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

const ok = (data: unknown, shopId = 11) => ({ status: 200, data, shopId, route: ROUTE });

const lookup = (args: unknown, ctx: ExtToolContext = context()): Promise<ToolResult> =>
  runLookup(EXT_TOOLS, 'returns.list', args, ctx);

/** The table of a result: its column names and each row as `column -> cell`. */
function tableOf(text: string): { readonly columns: string[]; readonly rows: Array<Record<string, string>> } {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('askedShopId|'));
  const columns = (lines[start] ?? '').split('|');
  const rows = lines.slice(start + 1).map((line) => {
    const cells = line.split('|');
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? '']));
  });
  return { columns, rows };
}

const headerOf = (text: string): string => text.split('\n')[0] ?? '';

beforeEach(() => {
  uzumRequest.mockReset();
  uzumRequest.mockResolvedValue(ok(body([DEFECTED, EARLY])));
});

describe('the request', () => {
  it('asks the recorded page of the shop on screen by default', async () => {
    await lookup({});

    expect(uzumRequest).toHaveBeenCalledTimes(1);
    expect(uzumRequest).toHaveBeenCalledWith('returns.list', { shopId: 11, page: 0, size: 20 }, expect.any(AbortSignal));
  });

  it('passes a page, a size and a shop the seller has', async () => {
    await lookup({ shopId: 12, page: 2, size: '50' });

    expect(uzumRequest.mock.calls[0]?.[1]).toEqual({ shopId: 12, page: 2, size: 50 });
  });

  it('rejects a filter it cannot send rather than ignoring a bound', async () => {
    for (const args of [{ size: 0 }, { size: 101 }, { page: -1 }]) {
      expect((await lookup(args)).text).toContain('[returns.list] arguments rejected');
    }
    expect(uzumRequest).not.toHaveBeenCalled();
  });

  it('makes no request until a shop is settled', async () => {
    const choose = await lookup({}, context({ session: session({ currentShopId: null }) }));
    const notTheirs = await lookup({ shopId: 999 });

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(choose.text).toContain('[returns.list] shop not chosen · no request was made');
    expect(notTheirs.text).toContain("shopId 999 is not this seller's");
  });
});

describe('a page of returns', () => {
  it('reads the rows out of payload and says what was read, with the response\'s own timestamp', async () => {
    const result = await lookup({});

    expect(headerOf(result.text)).toBe(
      '[returns.list] shop 11 (the one the cabinet page shows) · page 0 · size 20 · 2 returns on this page · ' +
        'fewer than the 20 asked for — the API may cap a page, so more may exist; ask page 1 to check; the response carries no total · ' +
        `response timestamp ${TIMESTAMP} (no zone stated) · live from ${ROUTE}`,
    );
    expect(result.routes).toEqual([ROUTE]);
    expect(result.trace).toBe('shop 11 (the one the cabinet page shows) · page 0 · 2 returns');
  });

  it('prints type, status and every date under the API\'s own names', async () => {
    const { columns, rows } = tableOf((await lookup({})).text);

    expect(columns).toEqual([
      'askedShopId',
      'id',
      'type',
      'status',
      'dateCreated',
      'dateCreated.utc',
      'assembledDate',
      'assembledDate.utc',
      'executionDate',
      'executionDate.utc',
      'completedDate',
      'completedDate.utc',
      'canceledDate',
      'canceledDate.utc',
      'paidStorage.status',
      'paidStorage.startDate',
      'paidStorage.startDate.utc',
      'paidStorage.endDate',
      'paidStorage.endDate.utc',
      'timeSlotReservation.timeFrom',
      'timeSlotReservation.timeFrom.utc',
      'timeSlotReservation.timeTo',
      'timeSlotReservation.timeTo.utc',
      'timeSlotReservation.status',
      'stock.id',
      'stock.title',
      'externalNumber',
      'ettnInfo',
      'returnDropInfo',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      askedShopId: '11',
      id: '1000000001',
      type: 'DEFECTED',
      status: 'COMPLETED',
      dateCreated: '1758865224083',
      'dateCreated.utc': '2025-09-26 05:40',
      assembledDate: '1758870481210',
      'assembledDate.utc': '2025-09-26 07:08',
      'completedDate.utc': '2025-11-13 15:50',
      'paidStorage.status': 'COMPLETED',
      'timeSlotReservation.timeFrom.utc': '2025-10-08 08:00',
      'timeSlotReservation.timeTo.utc': '2025-10-08 10:00',
      'timeSlotReservation.status': 'RESERVED',
      'stock.id': '3',
      'stock.title': 'Сергели',
    });
    expect(rows[1]).toMatchObject({ id: '100001', type: 'RETURN', status: 'COMPLETED' });
  });

  it('prints the paid-storage dates as received, even when the end is before the start', async () => {
    const { rows } = tableOf((await lookup({})).text);

    /* Completed before the paid period began: no row is "fixed", swapped or dropped. */
    expect(rows[1]).toMatchObject({
      'paidStorage.startDate': '1782566841379',
      'paidStorage.startDate.utc': '2026-06-27 13:27',
      'paidStorage.endDate': '1782483532662',
      'paidStorage.endDate.utc': '2026-06-26 14:18',
      'paidStorage.status': 'COMPLETED',
    });
    /* And the one where it ran past the start is printed the same way. */
    expect(rows[0]).toMatchObject({
      'paidStorage.startDate.utc': '2025-10-06 07:08',
      'paidStorage.endDate.utc': '2025-11-13 15:50',
    });
  });

  it('keeps null apart from a value: no slot, no cancellation, nothing invented', async () => {
    const { rows } = tableOf((await lookup({})).text);

    expect(rows[1]).toMatchObject({
      'timeSlotReservation.timeFrom': '',
      'timeSlotReservation.timeFrom.utc': '',
      'timeSlotReservation.status': '',
      canceledDate: '',
      'canceledDate.utc': '',
      externalNumber: '',
      ettnInfo: '',
      returnDropInfo: '',
    });
  });

  it('shows a field that arrives filled or in another type as it came', async () => {
    uzumRequest.mockResolvedValue(
      ok(
        body([
          {
            ...EARLY,
            dateCreated: '26.06.2026',
            canceledDate: 1782483532662,
            ettnInfo: { number: 'X-1', status: 'SIGNED' },
            paidStorage: null,
            externalNumber: 'EXT-9',
          },
        ]),
      ),
    );
    const { rows } = tableOf((await lookup({})).text);

    expect(rows[0]).toMatchObject({
      dateCreated: '26.06.2026',
      'dateCreated.utc': '',
      canceledDate: '1782483532662',
      'canceledDate.utc': '2026-06-26 14:18',
      ettnInfo: '{number,status}',
      'paidStorage.status': '',
      'paidStorage.startDate': '',
      externalNumber: 'EXT-9',
    });
  });

  it('says on every result what the response does not hold', async () => {
    const units = (await lookup({})).text.split('\n')[1] ?? '';

    expect(units).toContain('warehouse returns to the seller, not customer returns');
    expect(units).toContain('no products, quantities or amounts are in the response');
    expect(units).toContain('a .utc column is the epoch-millisecond column beside it as UTC text, added here');
    expect(units).toContain("never the shop's total");
  });

  it('leaves the warehouse address and hours out', async () => {
    const text = (await lookup({})).text;

    expect(text).not.toContain('Ташкент');
    expect(text).not.toContain('06:00');
    expect(text).not.toContain('SERGELI');
  });
});

describe('paging without a total', () => {
  const rowsOf = (count: number) => Array.from({ length: count }, (_, i) => ({ ...EARLY, id: 100_100 + i }));

  it('never calls a full page the last, and names the next one', async () => {
    uzumRequest.mockResolvedValue(ok(body(rowsOf(20))));
    const header = headerOf((await lookup({ page: 1 })).text);

    expect(header).toContain('20 returns on this page');
    expect(header).toContain('as many as asked — there may be more: next page 2; the response carries no total');
  });

  it('says an empty page is only empty at that number', async () => {
    uzumRequest.mockResolvedValue(ok(body([])));
    const result = await lookup({ page: 7 });

    expect(headerOf(result.text)).toContain('0 returns on this page · empty page — nothing at this page number');
    expect(result.text).toContain('returns — 0 rows');
  });

  it('marks a table cut for length as TRUNCATED', async () => {
    uzumRequest.mockResolvedValue(ok(body(rowsOf(100))));
    const result = await lookup({ size: 100 });
    const shown = tableOf(result.text).rows.length;

    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(100);
    expect(headerOf(result.text)).toContain(`TRUNCATED: ${shown} of 100 rows shown — ask for a smaller size`);
  });
});

describe('a response that is not the recorded envelope', () => {
  it('prints a bare array generically: the recorded answer wraps its rows in payload', async () => {
    uzumRequest.mockResolvedValue(ok([EARLY]));
    const result = await lookup({});

    expect(headerOf(result.text)).toContain(
      'shape not recognised (expected an object holding a payload array): printed generically',
    );
    expect(result.text).toContain('askedShopId|id|dateCreated|status');
    expect(result.trace).toBe('returns.list: shape not recognised');
  });

  it('prints a payload that is not a list generically', async () => {
    uzumRequest.mockResolvedValue(ok({ payload: null, timestamp: TIMESTAMP, errors: [{ code: 'x-1' }] }));
    const result = await lookup({});

    expect(headerOf(result.text)).toContain('shape not recognised');
    expect(result.text).toContain('code');
  });

  it('skips payload entries that are not objects and says how many', async () => {
    uzumRequest.mockResolvedValue(ok(body([DEFECTED, null, 'x'])));
    const header = headerOf((await lookup({ size: 3 })).text);

    expect(header).toContain('1 return on this page · unexpected: 2 of 3 payload entries are not objects and were skipped');
    expect(header).toContain('as many as asked');
  });

  it('says nothing about a timestamp the response did not send', async () => {
    uzumRequest.mockResolvedValue(ok({ payload: [EARLY] }));

    expect(headerOf((await lookup({})).text)).not.toContain('response timestamp');
  });
});

describe('a request that did not return', () => {
  it('repeats which permission the bridge found missing, with the question still in the header', async () => {
    uzumRequest.mockRejectedValue(new ApiError('The seller lacks SELLER_RETURN_READ on shop 11.', { kind: 'forbidden' }));
    const result = await lookup({ page: 1 });

    expect(headerOf(result.text)).toBe('[returns.list] shop 11 (the one the cabinet page shows) · page 1 · size 20 · FAILED');
    expect(result.text).toContain('No request was sent');
    expect(result.text).toContain('The seller lacks SELLER_RETURN_READ on shop 11.');
    expect(result.routes).toBeUndefined();
  });
});
