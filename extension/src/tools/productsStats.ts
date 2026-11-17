import { z } from 'zod';

import type { ToolSpec } from '@core/tools/contract';
import { compose, header } from '@core/tools/plaintext';

import { refusalText, resolveShop, shopLabel } from './cabinet';
import { type Column, field, isRaw, printTable } from './columns';
import type { ExtToolContext } from './context';
import { asNumber, readCabinet, shopIdArg, statusPart, unrecognised } from './lookup';

/**
 * `products.stats` — how many products one shop has under each of the cabinet's
 * product filters.
 *
 * Evidence: ONE recorded response (one shop): an object holding
 * `statisticResultList`, eight entries of `{count, type, shopId}`. In it the
 * counters did not partition the catalogue (three of them summed to 36 beside
 * an `ALL` of 38), so nothing here adds them up or turns one into a share.
 */

export const PRODUCTS_STATS_ID = 'products.stats';

/** The eight counters fit many times over; the bound is only against a response that is not what was recorded. */
const MAX_CHARS = 4_000;

const COLUMNS: readonly Column[] = [field('type', 60), field('count'), field('shopId')];

const argsSchema = z.object({ shopId: shopIdArg });

export const productsStats: ToolSpec<ExtToolContext> = {
  route: 'GET /api/seller/shop/{shopId}/product/products-statistic',
  args: '{shopId?}',
  summary: [
    "How many products one shop has under each of the cabinet's product filters (ALL, IN_STOCK, OUT_OF_STOCK,",
    'ARCHIVED and others), read live. One small request: use it for "how many products do I have / are out of',
    'stock" instead of paging through products.list. The counters overlap and are not a breakdown of ALL.',
  ],
  schema: argsSchema,

  async run(args, context) {
    const choice = resolveShop(context.session, asNumber(args['shopId']));
    if (choice.kind !== 'shop') {
      return { trace: `${PRODUCTS_STATS_ID}: no request`, text: refusalText(PRODUCTS_STATS_ID, choice) ?? '' };
    }
    const { shopId } = choice;
    const asked = [shopLabel(choice)];

    const read = await readCabinet(PRODUCTS_STATS_ID, context.signal, asked, 'products.stats', { shopId });
    if (!read.ok) return read.result;
    const { response } = read;

    const list = isRaw(response.data) ? response.data['statisticResultList'] : undefined;
    if (!Array.isArray(list)) {
      return unrecognised(PRODUCTS_STATS_ID, asked, response, 'an object holding statisticResultList', {
        rowTag: { column: 'askedShopId', value: shopId },
      });
    }

    const rows = (list as unknown[]).filter(isRaw);
    const skipped = list.length - rows.length;
    const printed =
      rows.length === 0
        ? { text: '', shown: 0 }
        : printTable(COLUMNS, rows, () => [String(shopId)], ['askedShopId'], MAX_CHARS);

    return {
      routes: [response.route],
      trace: `${asked[0]} · ${rows.length} counters`,
      text: compose([
        header(PRODUCTS_STATS_ID, [
          ...asked,
          `${rows.length} ${rows.length === 1 ? 'counter' : 'counters'}`,
          skipped === 0 ? null : `unexpected: ${skipped} of ${list.length} statisticResultList entries are not objects and were skipped`,
          `live from ${response.route}`,
          statusPart(response),
          printed.shown < rows.length ? `TRUNCATED: ${printed.shown} of ${rows.length} rows shown` : null,
        ]),
        "count is the response's own number of products under that filter type, as of this call · the types overlap: the counters are not a breakdown, do not add them up · shopId is the response's own, askedShopId is this call's shop, added here",
        rows.length === 0 ? 'statisticResultList — 0 rows' : printed.text,
      ]),
    };
  },
};
