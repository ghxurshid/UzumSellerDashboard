import { z } from 'zod';

import type { ToolSpec } from '@core/tools/contract';
import { compose, header } from '@core/tools/plaintext';

import { type Column, field, isRaw, printTable } from './columns';
import type { ExtToolContext } from './context';
import { readCabinet, signedOutResult, statusPart, unrecognised } from './lookup';

/**
 * `barcodes.types` — the label sizes the cabinet offers for printing barcode
 * stickers.
 *
 * An account lookup: the path names no shop and the recorded request carried no
 * parameters, so it asks for nothing and needs only the sign-in.
 *
 * Evidence: ONE recorded response: an object holding `barcodeLabelTypes`, five
 * entries of `{id, title, printType, length, width}`. No unit is stated. Each
 * title reads as its own length and width ("48.5 x 25.4"), which is why the
 * numbers are taken for the label's two sides; that they are millimetres is a
 * guess from their size and is said as one.
 *
 * It lists sizes and nothing more: no label is made or printed from here.
 */

export const BARCODES_TYPES_ID = 'barcodes.types';

/** Five rows fit many times over; the bound is only against a response that is not what was recorded. */
const MAX_CHARS = 4_000;

const COLUMNS: readonly Column[] = [
  field('id'),
  field('title', 60),
  field('printType', 40),
  field('length'),
  field('width'),
];

export const barcodesTypes: ToolSpec<ExtToolContext> = {
  route: 'GET /api/seller/reports/barcodes/types',
  args: '{}',
  summary: [
    'The label sizes the cabinet offers for printing barcode stickers, read live: id, title, the kind of',
    'printer (ThermalPrinter or A4 were seen) and the two sides of the label. It takes no arguments and is',
    'about the whole account, not one shop. It lists sizes only: a label cannot be made or printed from here.',
  ],
  schema: z.object({}),

  async run(_args, context) {
    if (!context.session.signedIn) return signedOutResult(BARCODES_TYPES_ID);

    const read = await readCabinet(BARCODES_TYPES_ID, context.signal, [], 'barcodes.types', {});
    if (!read.ok) return read.result;
    const { response } = read;

    const list = isRaw(response.data) ? response.data['barcodeLabelTypes'] : undefined;
    if (!Array.isArray(list)) {
      return unrecognised(BARCODES_TYPES_ID, [], response, 'an object holding barcodeLabelTypes');
    }

    const rows = (list as unknown[]).filter(isRaw);
    const skipped = list.length - rows.length;
    const printed = rows.length === 0 ? { text: '', shown: 0 } : printTable(COLUMNS, rows, () => [], [], MAX_CHARS);

    return {
      routes: [response.route],
      trace: `${rows.length} label ${rows.length === 1 ? 'size' : 'sizes'}`,
      text: compose([
        header(BARCODES_TYPES_ID, [
          `${rows.length} label ${rows.length === 1 ? 'size' : 'sizes'}`,
          skipped === 0 ? null : `unexpected: ${skipped} of ${list.length} barcodeLabelTypes entries are not objects and were skipped`,
          `live from ${response.route}`,
          statusPart(response),
          printed.shown < rows.length ? `TRUNCATED: ${printed.shown} of ${rows.length} rows shown` : null,
        ]),
        "length and width are the response's own numbers and no unit is stated; the titles repeat them, so they read as the label's two sides, probably millimetres · printType is the response's own word for the printer · columns are the cabinet API's own field names, values as the response held them · sizes only: nothing is printed from here",
        rows.length === 0 ? 'barcodeLabelTypes — 0 rows' : printed.text,
      ]),
    };
  },
};
