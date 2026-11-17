import { z } from 'zod';

import type { ToolSpec } from '@core/tools/contract';
import { compose, header } from '@core/tools/plaintext';
import { PAGE_MAX, PAGE_MAX_SIZE } from '@ext/uzum/routes';

import { refusalText, resolveShop, shopLabel } from './cabinet';
import { type Column, field, isRaw, lengthField, printTable, utcField } from './columns';
import type { ExtToolContext } from './context';
import { asNumber, pageWithoutTotal, readCabinet, shopIdArg, statusPart, unrecognised } from './lookup';

/**
 * `invoices.list` — one shop's supply invoices (goods sent to Uzum's warehouse),
 * read live from the cabinet, a page per call.
 *
 * Evidence: ONE recorded response, a full page of 20 invoices from one shop, one
 * warehouse and two statuses; nothing below is called verified. The response is
 * a bare array with no total anywhere, so a page is never called the last.
 *
 * The status code, the reserved time slot and the warehouse sit inside nested
 * objects, which the shape-agnostic renderer would print as `{text,color,value}`.
 * So a response that is an array goes through curated columns, under the API's
 * own dot paths; anything else is printed generically and said to be
 * unrecognised.
 *
 * The warehouse object was identical on all twenty rows, so only its id and
 * title are printed per row: its address, opening hours and size groups would
 * be the same line twenty times.
 */

export const INVOICES_LIST_ID = 'invoices.list';

/** What the one recorded request sent. */
export const DEFAULT_SIZE = 20;
export const MAX_SIZE = PAGE_MAX_SIZE;

/** Roughly the size of the whole table text; a first row is always printed. */
const MAX_CHARS = 12_000;

const COLUMNS: readonly Column[] = [
  field('id'),
  field('invoiceNumber'),
  field('dateCreated'),
  field('invoiceStatus.value'),
  field('status', 40),
  field('fullPrice'),
  field('totalToStock'),
  field('totalAccepted'),
  field('hasIssue'),
  field('dateAccepted'),
  utcField('dateAccepted'),
  field('expressAcceptanceDate'),
  utcField('expressAcceptanceDate'),
  field('timeSlotReservation.timeFrom'),
  utcField('timeSlotReservation.timeFrom'),
  field('timeSlotReservation.timeTo'),
  utcField('timeSlotReservation.timeTo'),
  field('timeSlotReservation.status'),
  lengthField('timeSlotReservation.timeSlots'),
  field('stock.id'),
  field('stock.title', 40),
  field('remainingAmountOfUpdates'),
  field('invoiceEttn.warningFlag'),
  field('invoiceEttn.ettn'),
  field('externalNumber'),
  field('deliveryCertificate'),
  lengthField('fines'),
  field('createdInvoiceCount'),
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
    .describe(`Invoices requested per page, 1-${MAX_SIZE}; the API may return fewer. Default ${DEFAULT_SIZE} (what the cabinet's own page sends).`)
    .optional(),
});

export const invoicesList: ToolSpec<ExtToolContext> = {
  route: 'GET /api/seller/shop/{shopId}/invoice',
  args: `{shopId?, page?:0-based, size?:1-${MAX_SIZE} (default ${DEFAULT_SIZE})}`,
  summary: [
    "One shop's supply invoices — goods the seller sent to Uzum's warehouse — read live from the cabinet, one",
    'page per call: status, amount, units planned and accepted, the reserved delivery slot and when the',
    'warehouse accepted them. The response carries no total and takes no status or date filter, so a page is',
    'never known to be the last and a count is only what this read returned. No contents: which products an',
    'invoice holds cannot be read.',
  ],
  schema: argsSchema,

  async run(args, context) {
    const page = asNumber(args['page']) ?? 0;
    const size = asNumber(args['size']) ?? DEFAULT_SIZE;

    const choice = resolveShop(context.session, asNumber(args['shopId']));
    if (choice.kind !== 'shop') {
      return { trace: `${INVOICES_LIST_ID}: no request`, text: refusalText(INVOICES_LIST_ID, choice) ?? '' };
    }
    const { shopId } = choice;
    const asked = [shopLabel(choice), `page ${page}`, `size ${size}`];

    const read = await readCabinet(INVOICES_LIST_ID, context.signal, asked, 'invoices.list', { shopId, page, size });
    if (!read.ok) return read.result;
    const { response } = read;

    if (!Array.isArray(response.data)) {
      return unrecognised(INVOICES_LIST_ID, asked, response, 'an array of invoices', {
        rowTag: { column: 'askedShopId', value: shopId },
      });
    }

    const held = response.data.length;
    const rows = (response.data as unknown[]).filter(isRaw);
    const skipped = held - rows.length;
    const printed =
      rows.length === 0
        ? { text: '', shown: 0 }
        : printTable(COLUMNS, rows, () => [String(shopId)], ['askedShopId'], MAX_CHARS);

    return {
      routes: [response.route],
      trace: `${asked[0]} · page ${page} · ${rows.length} invoices`,
      text: compose([
        header(INVOICES_LIST_ID, [
          ...asked,
          `${rows.length} ${rows.length === 1 ? 'invoice' : 'invoices'} on this page`,
          skipped === 0 ? null : `unexpected: ${skipped} of ${held} entries are not objects and were skipped`,
          /* Fullness is judged by what the response held, readable or not. */
          pageWithoutTotal('invoices', page, size, held),
          `live from ${response.route}`,
          statusPart(response),
          printed.shown < rows.length
            ? `TRUNCATED: ${printed.shown} of ${rows.length} rows shown — ask for a smaller size to see every row (page numbers depend on size)`
            : null,
        ]),
        "units unknown (fullPrice has no unit in the payload) · columns are the cabinet API's own field names, values as the response held them, an empty cell is null or absent · a .utc column is the epoch-millisecond column beside it as UTC text, added here · a .length column counts the entries of that list, computed here · askedShopId is this call's shop, added here · a count is invoices returned by this read, never the shop's total · read the field legend before interpreting a column",
        rows.length === 0 ? 'invoices — 0 rows' : printed.text,
      ]),
    };
  },
};
