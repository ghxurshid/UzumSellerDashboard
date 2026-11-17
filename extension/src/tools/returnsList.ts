import { z } from 'zod';

import type { ToolSpec } from '@core/tools/contract';
import { compose, header } from '@core/tools/plaintext';
import { PAGE_MAX, PAGE_MAX_SIZE } from '@ext/uzum/routes';

import { refusalText, resolveShop, shopLabel } from './cabinet';
import { type Column, field, isRaw, printTable, show, utcField } from './columns';
import type { ExtToolContext } from './context';
import { asNumber, pageWithoutTotal, readCabinet, shopIdArg, statusPart, unrecognised } from './lookup';

/**
 * `returns.list` — one shop's returns from Uzum's warehouse: goods the warehouse
 * sends back to the seller (defective and other), read live, a page per call.
 * Not orders a customer returned.
 *
 * Evidence: ONE recorded response, a full page of 20 returns from one shop, one
 * warehouse, one status (`COMPLETED`) and two types; nothing below is called
 * verified. The response is `{payload, timestamp}` with the rows in `payload`
 * and no total anywhere, so a page is never called the last.
 *
 * Three things the response does NOT hold, which the result and the legend say
 * rather than leave the model to assume: what was returned (no products,
 * quantities or amounts), whether paid storage was actually charged
 * (`paidStorage` carries two dates and a status, no sum, and its end fell before
 * its start on most recorded rows), and what a return in progress looks like.
 *
 * Every date here is epoch milliseconds, `dateCreated` included, which in the
 * invoice list is a text; each is printed as received with its UTC text beside
 * it. As with the invoices, only the warehouse's id and title are printed per
 * row: the object was identical on all twenty.
 */

export const RETURNS_LIST_ID = 'returns.list';

/** What the one recorded request sent. */
export const DEFAULT_SIZE = 20;
export const MAX_SIZE = PAGE_MAX_SIZE;

/** Roughly the size of the whole table text; a first row is always printed. */
const MAX_CHARS = 12_000;

const COLUMNS: readonly Column[] = [
  field('id'),
  field('type'),
  field('status'),
  field('dateCreated'),
  utcField('dateCreated'),
  field('assembledDate'),
  utcField('assembledDate'),
  field('executionDate'),
  utcField('executionDate'),
  field('completedDate'),
  utcField('completedDate'),
  field('canceledDate'),
  utcField('canceledDate'),
  field('paidStorage.status'),
  field('paidStorage.startDate'),
  utcField('paidStorage.startDate'),
  field('paidStorage.endDate'),
  utcField('paidStorage.endDate'),
  field('timeSlotReservation.timeFrom'),
  utcField('timeSlotReservation.timeFrom'),
  field('timeSlotReservation.timeTo'),
  utcField('timeSlotReservation.timeTo'),
  field('timeSlotReservation.status'),
  field('stock.id'),
  field('stock.title', 40),
  field('externalNumber'),
  field('ettnInfo'),
  field('returnDropInfo'),
];

const argsSchema = z.object({
  shopId: shopIdArg,
  page: z.coerce
    .number()
    .int()
    .min(0)
    .max(PAGE_MAX)
    .describe('Zero-based page number. Default 0.')
    .optional(),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_SIZE)
    .describe(`Returns requested per page, 1-${MAX_SIZE}; the API may return fewer. Default ${DEFAULT_SIZE} (what the cabinet's own page sends).`)
    .optional(),
});

export const returnsList: ToolSpec<ExtToolContext> = {
  route: 'GET /api/seller/shop/{shopId}/return',
  args: `{shopId?, page?:0-based, size?:1-${MAX_SIZE} (default ${DEFAULT_SIZE})}`,
  summary: [
    "One shop's returns from Uzum's warehouse — goods the warehouse sends back to the seller, defective and",
    'other — read live from the cabinet, one page per call: type, status, when each was created, assembled',
    'and completed, and the paid-storage dates. These are not orders a customer returned. The response holds',
    'no products, quantities or amounts, carries no total and takes no status, type or date filter.',
  ],
  schema: argsSchema,

  async run(args, context) {
    const page = asNumber(args['page']) ?? 0;
    const size = asNumber(args['size']) ?? DEFAULT_SIZE;

    const choice = resolveShop(context.session, asNumber(args['shopId']));
    if (choice.kind !== 'shop') {
      return { trace: `${RETURNS_LIST_ID}: no request`, text: refusalText(RETURNS_LIST_ID, choice) ?? '' };
    }
    const { shopId } = choice;
    const asked = [shopLabel(choice), `page ${page}`, `size ${size}`];

    const read = await readCabinet(RETURNS_LIST_ID, context.signal, asked, 'returns.list', { shopId, page, size });
    if (!read.ok) return read.result;
    const { response } = read;

    const list = isRaw(response.data) ? response.data['payload'] : undefined;
    if (!isRaw(response.data) || !Array.isArray(list)) {
      return unrecognised(RETURNS_LIST_ID, asked, response, 'an object holding a payload array', {
        rowTag: { column: 'askedShopId', value: shopId },
      });
    }

    const held = list.length;
    const rows = (list as unknown[]).filter(isRaw);
    const skipped = held - rows.length;
    const printed =
      rows.length === 0
        ? { text: '', shown: 0 }
        : printTable(COLUMNS, rows, () => [String(shopId)], ['askedShopId'], MAX_CHARS);
    /* The server's own clock for this answer, when it sent one. */
    const stamp = show(response.data['timestamp'], 40);

    return {
      routes: [response.route],
      trace: `${asked[0]} · page ${page} · ${rows.length} returns`,
      text: compose([
        header(RETURNS_LIST_ID, [
          ...asked,
          `${rows.length} ${rows.length === 1 ? 'return' : 'returns'} on this page`,
          skipped === 0 ? null : `unexpected: ${skipped} of ${held} payload entries are not objects and were skipped`,
          /* Fullness is judged by what the response held, readable or not. */
          pageWithoutTotal('returns', page, size, held),
          stamp === '' ? null : `response timestamp ${stamp} (no zone stated)`,
          `live from ${response.route}`,
          statusPart(response),
          printed.shown < rows.length
            ? `TRUNCATED: ${printed.shown} of ${rows.length} rows shown — ask for a smaller size to see every row (page numbers depend on size)`
            : null,
        ]),
        "warehouse returns to the seller, not customer returns · no products, quantities or amounts are in the response · columns are the cabinet API's own field names, values as the response held them, an empty cell is null or absent · a .utc column is the epoch-millisecond column beside it as UTC text, added here · askedShopId is this call's shop, added here · a count is returns returned by this read, never the shop's total · read the field legend before interpreting a column",
        rows.length === 0 ? 'returns — 0 rows' : printed.text,
      ]),
    };
  },
};
