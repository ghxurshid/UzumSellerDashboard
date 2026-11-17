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
 * 5.B.10): keys, order, nulls, statuses, quantities and timestamps as recorded;
 * ids, invoice numbers, slot ids and amounts invented.
 */

const ROUTE = 'GET /api/seller/shop/{shopId}/invoice';

const STOCK = {
  id: 34,
  externalId: '00000000-0000-4000-8000-000000000034',
  title: 'Фулфилмент центр',
  address: 'Город Ташкент, …',
  timeFrom: '06:00',
  timeTo: '23:59',
  poolSource: 'FULLFILMENT',
  dimensionalGroups: [
    { group: 'SMALL', title: 'МГТ' },
    { group: 'MEDIUM', title: 'СГТ' },
    { group: 'UNKNOWN', title: 'Неопределенная' },
  ],
};

const CREATED = {
  id: 3000002,
  invoiceNumber: 1100030000021,
  deliveryCertificate: null,
  dateCreated: '07.10.2026',
  status: 'Создана',
  invoiceStatus: { text: 'Создана', color: '#000000', value: 'CREATED' },
  fullPrice: 2500000,
  timeSlotReservation: {
    id: 7000002,
    timeSlots: [{ timeFrom: 1791457200000, timeTo: 1791462600000 }],
    status: 'RESERVED',
    timeFrom: 1791457200000,
    timeTo: 1791462600000,
  },
  totalAccepted: 0,
  totalToStock: 36,
  remainingAmountOfUpdates: 1,
  dateAccepted: null,
  expressAcceptanceDate: null,
  stock: STOCK,
  hasIssue: false,
  externalNumber: null,
  invoiceEttn: { isEditable: true, warningFlag: true, slaEttnUpdate: null, ettn: null },
  fines: [],
  createdInvoiceCount: 0,
};

/** ACCEPTED, accepted short, and with no dateAccepted. */
const SHORT = {
  ...CREATED,
  id: 3000003,
  invoiceNumber: 1100030000038,
  dateCreated: '10.10.2026',
  status: 'Принята на складе',
  invoiceStatus: { text: 'Принята на складе', color: '#00c853', value: 'ACCEPTED' },
  fullPrice: 3000000,
  timeSlotReservation: {
    id: 7000003,
    timeSlots: [{ timeFrom: 1791700200000, timeTo: 1791703800000 }],
    status: 'RESERVED',
    timeFrom: 1791700200000,
    timeTo: 1791703800000,
  },
  totalAccepted: 50,
  totalToStock: 55,
  remainingAmountOfUpdates: 2,
  expressAcceptanceDate: 1791683727860,
  hasIssue: true,
  invoiceEttn: { isEditable: true, warningFlag: false, slaEttnUpdate: null, ettn: null },
};

/** ACCEPTED in full, booked over two consecutive slots. */
const TWO_SLOTS = {
  ...SHORT,
  id: 3000001,
  invoiceNumber: 1100030000014,
  dateCreated: '16.09.2026',
  fullPrice: 3500000,
  timeSlotReservation: {
    id: 7000001,
    timeSlots: [
      { timeFrom: 1789635600000, timeTo: 1789639200000 },
      { timeFrom: 1789639200000, timeTo: 1789642800000 },
    ],
    status: 'RESERVED',
    timeFrom: 1789635600000,
    timeTo: 1789642800000,
  },
  totalAccepted: 50,
  totalToStock: 50,
  remainingAmountOfUpdates: 1,
  dateAccepted: 1789709079164,
  expressAcceptanceDate: 1789648001225,
  hasIssue: false,
};

const PAGE = [CREATED, SHORT, TWO_SLOTS];

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
  runLookup(EXT_TOOLS, 'invoices.list', args, ctx);

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
  uzumRequest.mockResolvedValue(ok(PAGE));
});

describe('the request', () => {
  it('asks the recorded page of the shop on screen by default', async () => {
    await lookup({});

    expect(uzumRequest).toHaveBeenCalledTimes(1);
    expect(uzumRequest).toHaveBeenCalledWith('invoices.list', { shopId: 11, page: 0, size: 20 }, expect.any(AbortSignal));
  });

  it('passes the page, the size and a shop the seller has, quoted numbers included', async () => {
    await lookup({ shopId: '12', page: '3', size: '50' });

    expect(uzumRequest.mock.calls[0]?.[1]).toEqual({ shopId: 12, page: 3, size: 50 });
  });

  it('rejects a size or a page outside the bounds without a request', async () => {
    for (const args of [{ size: 0 }, { size: 101 }, { page: -1 }, { size: 1.5 }]) {
      const result = await lookup(args);
      expect(result.text).toContain('[invoices.list] arguments rejected');
    }
    expect(uzumRequest).not.toHaveBeenCalled();
  });

  it('makes no request until a shop is settled', async () => {
    const choose = await lookup({}, context({ session: session({ currentShopId: null }) }));
    const notTheirs = await lookup({ shopId: 999 });
    const signedOut = await lookup({}, context({ session: session({ signedIn: false, shopIds: [], currentShopId: null }) }));

    expect(uzumRequest).not.toHaveBeenCalled();
    expect(choose.text).toContain('[invoices.list] shop not chosen · no request was made');
    expect(notTheirs.text).toContain("shopId 999 is not this seller's");
    expect(signedOut.text).toContain('not signed in to the cabinet in this tab');
  });
});

describe('a page of invoices', () => {
  it('says what was read, that there is no total, and where it came from', async () => {
    const result = await lookup({});

    expect(headerOf(result.text)).toBe(
      '[invoices.list] shop 11 (the one the cabinet page shows) · page 0 · size 20 · 3 invoices on this page · ' +
        'fewer than the 20 asked for — the API may cap a page, so more may exist; ask page 1 to check; the response carries no total · ' +
        `live from ${ROUTE}`,
    );
    expect(result.routes).toEqual([ROUTE]);
    expect(result.trace).toBe('shop 11 (the one the cabinet page shows) · page 0 · 3 invoices');
  });

  it('prints the status code, the counts and the warehouse from inside their nested objects', async () => {
    const { columns, rows } = tableOf((await lookup({})).text);

    expect(columns).toEqual([
      'askedShopId',
      'id',
      'invoiceNumber',
      'dateCreated',
      'invoiceStatus.value',
      'status',
      'fullPrice',
      'totalToStock',
      'totalAccepted',
      'hasIssue',
      'dateAccepted',
      'dateAccepted.utc',
      'expressAcceptanceDate',
      'expressAcceptanceDate.utc',
      'timeSlotReservation.timeFrom',
      'timeSlotReservation.timeFrom.utc',
      'timeSlotReservation.timeTo',
      'timeSlotReservation.timeTo.utc',
      'timeSlotReservation.status',
      'timeSlotReservation.timeSlots.length',
      'stock.id',
      'stock.title',
      'remainingAmountOfUpdates',
      'invoiceEttn.warningFlag',
      'invoiceEttn.ettn',
      'externalNumber',
      'deliveryCertificate',
      'fines.length',
      'createdInvoiceCount',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      askedShopId: '11',
      id: '3000002',
      invoiceNumber: '1100030000021',
      dateCreated: '07.10.2026',
      'invoiceStatus.value': 'CREATED',
      status: 'Создана',
      fullPrice: '2500000',
      totalToStock: '36',
      totalAccepted: '0',
      hasIssue: 'false',
      'timeSlotReservation.status': 'RESERVED',
      'stock.id': '34',
      'stock.title': 'Фулфилмент центр',
      'invoiceEttn.warningFlag': 'true',
    });
    expect(rows[1]).toMatchObject({ 'invoiceStatus.value': 'ACCEPTED', totalToStock: '55', totalAccepted: '50', hasIssue: 'true' });
  });

  it('keeps null apart from zero: an accepted row without a date has an empty cell', async () => {
    const { rows } = tableOf((await lookup({})).text);

    /* CREATED: accepted 0 is a zero the response stated; the dates are null. */
    expect(rows[0]).toMatchObject({ totalAccepted: '0', dateAccepted: '', 'dateAccepted.utc': '', expressAcceptanceDate: '' });
    /* ACCEPTED with dateAccepted null (2 of 17 in the recording). */
    expect(rows[1]).toMatchObject({ dateAccepted: '', 'dateAccepted.utc': '', expressAcceptanceDate: '1791683727860' });
    /* Never-filled fields stay empty; an empty list is counted as 0 entries, which it is. */
    expect(rows[0]).toMatchObject({ 'invoiceEttn.ettn': '', externalNumber: '', deliveryCertificate: '', 'fines.length': '0' });
  });

  it('prints every epoch value as received with its UTC text beside it', async () => {
    const { rows } = tableOf((await lookup({})).text);

    expect(rows[0]).toMatchObject({
      'timeSlotReservation.timeFrom': '1791457200000',
      'timeSlotReservation.timeFrom.utc': '2026-10-08 11:00',
      'timeSlotReservation.timeTo': '1791462600000',
      'timeSlotReservation.timeTo.utc': '2026-10-08 12:30',
    });
    expect(rows[2]).toMatchObject({
      dateAccepted: '1789709079164',
      'dateAccepted.utc': '2026-09-18 05:24',
      'expressAcceptanceDate.utc': '2026-09-17 12:26',
      'timeSlotReservation.timeSlots.length': '2',
    });
  });

  it('prints a value of an unexpected type as it came, never as an empty cell', async () => {
    uzumRequest.mockResolvedValue(
      ok([{ ...CREATED, fullPrice: '2500000', dateAccepted: '2026-10-08', invoiceStatus: 'CREATED', fines: null }]),
    );
    const { rows } = tableOf((await lookup({})).text);

    expect(rows[0]).toMatchObject({
      fullPrice: '2500000',
      dateAccepted: '2026-10-08',
      'dateAccepted.utc': '',
      'invoiceStatus.value': '(invoiceStatus: CREATED)',
      'fines.length': '',
    });
  });

  it('states in the units line that amounts have no unit and what was added here', async () => {
    const units = (await lookup({})).text.split('\n')[1] ?? '';

    expect(units).toContain('fullPrice has no unit in the payload');
    expect(units).toContain('an empty cell is null or absent');
    expect(units).toContain('a .utc column is the epoch-millisecond column beside it as UTC text, added here');
    expect(units).toContain("never the shop's total");
  });

  it('leaves the warehouse address and hours out: they were the same on every row', async () => {
    const text = (await lookup({})).text;

    expect(text).not.toContain('Город Ташкент');
    expect(text).not.toContain('06:00');
    expect(text).not.toContain('МГТ');
  });
});

describe('paging without a total', () => {
  const rowsOf = (count: number) => Array.from({ length: count }, (_, i) => ({ ...CREATED, id: 3_000_100 + i }));

  it('never calls a full page the last', async () => {
    uzumRequest.mockResolvedValue(ok(rowsOf(20)));
    const header = headerOf((await lookup({})).text);

    expect(header).toContain('20 invoices on this page');
    expect(header).toContain('as many as asked — there may be more: next page 1; the response carries no total');
  });

  it('names the page after the one asked', async () => {
    uzumRequest.mockResolvedValue(ok(rowsOf(5)));

    expect(headerOf((await lookup({ page: 4, size: 5 })).text)).toContain('next page 5');
  });

  it('says an empty page is only empty at that number', async () => {
    uzumRequest.mockResolvedValue(ok([]));
    const result = await lookup({ page: 9 });

    expect(headerOf(result.text)).toContain('0 invoices on this page · empty page — nothing at this page number');
    expect(result.text).toContain('invoices — 0 rows');
  });

  it('says so when the API returns more than was asked', async () => {
    uzumRequest.mockResolvedValue(ok(rowsOf(7)));

    expect(headerOf((await lookup({ size: 5 })).text)).toContain('more invoices than size 5 asked for');
  });

  it('marks a table cut for length as TRUNCATED and says how many rows are shown', async () => {
    uzumRequest.mockResolvedValue(ok(rowsOf(100)));
    const result = await lookup({ size: 100 });
    const header = headerOf(result.text);
    const shown = tableOf(result.text).rows.length;

    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(100);
    expect(header).toContain('100 invoices on this page');
    expect(header).toContain(`TRUNCATED: ${shown} of 100 rows shown — ask for a smaller size`);
  });
});

describe('a response that is not the recorded shape', () => {
  it('prints an object generically and says an array was expected', async () => {
    uzumRequest.mockResolvedValue(ok({ content: [{ id: 1, total: 5 }], totalElements: 1 }));
    const result = await lookup({});

    expect(headerOf(result.text)).toContain('shape not recognised (expected an array of invoices): printed generically');
    expect(result.text).toContain('totalElements=1');
    expect(result.text).toContain('askedShopId|id|total');
    expect(result.trace).toBe('invoices.list: shape not recognised');
  });

  it('skips entries that are not objects and says how many, judging fullness by what the response held', async () => {
    uzumRequest.mockResolvedValue(ok([CREATED, 'x', null, SHORT]));
    const result = await lookup({ size: 4 });

    expect(headerOf(result.text)).toContain('2 invoices on this page · unexpected: 2 of 4 entries are not objects and were skipped');
    expect(headerOf(result.text)).toContain('as many as asked');
    expect(tableOf(result.text).rows).toHaveLength(2);
  });

  it('reports a success that is not a plain 200', async () => {
    uzumRequest.mockResolvedValue({ status: 206, data: PAGE, shopId: 11, route: ROUTE });

    expect(headerOf((await lookup({})).text)).toContain('· HTTP 206');
  });
});

describe('a request that did not return', () => {
  it('says what failed and that nothing was read, with the question still in the header', async () => {
    uzumRequest.mockRejectedValue(new ApiError('Too many', { kind: 'rateLimited', status: 429, retryAfterMs: 4_000 }));
    const result = await lookup({ page: 2 });

    expect(headerOf(result.text)).toBe('[invoices.list] shop 11 (the one the cabinet page shows) · page 2 · size 20 · FAILED');
    expect(result.text).toContain('it asked to wait about 4 s');
    expect(result.text).toContain('Say what you could not read rather than estimating it.');
    expect(result.routes).toBeUndefined();
  });

  it('repeats which permission the bridge found missing', async () => {
    uzumRequest.mockRejectedValue(new ApiError('The seller lacks INVOICE_READ on shop 11.', { kind: 'forbidden' }));
    const text = (await lookup({})).text;

    expect(text).toContain('No request was sent');
    expect(text).toContain('The seller lacks INVOICE_READ on shop 11.');
  });

  it('rethrows when the seller cancelled the question', async () => {
    const controller = new AbortController();
    uzumRequest.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new ApiError('Request cancelled', { kind: 'cancelled' }));
    });

    await expect(lookup({}, context({ signal: controller.signal }))).rejects.toBeInstanceOf(ApiError);
  });
});
