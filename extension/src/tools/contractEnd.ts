import { z } from 'zod';

import type { ToolSpec } from '@core/tools/contract';
import { compose, header, pairs } from '@core/tools/plaintext';

import { refusalText, resolveShop, shopLabel } from './cabinet';
import { isRaw, show } from './columns';
import type { ExtToolContext } from './context';
import { asNumber, readCabinet, shopIdArg, statusPart, unrecognised } from './lookup';

/**
 * `contract.end` — the date the cabinet's contract route returns for one shop.
 *
 * Evidence: ONE recorded response, for one shop: `{payload, timestamp}` where
 * `payload` was a date with no time (`2031-01-10`) and `timestamp` the server's
 * clock without a zone. That `payload` is the END of the seller's contract is
 * read from the route's name (`committent/contract/end-date`), nothing in the
 * body says so; the result states it with that strength. What the route returns
 * for a shop without a contract was not recorded.
 */

export const CONTRACT_END_ID = 'contract.end';

const argsSchema = z.object({ shopId: shopIdArg });

export const contractEnd: ToolSpec<ExtToolContext> = {
  route: 'GET /api/seller/committent/contract/end-date',
  args: '{shopId?}',
  summary: [
    "The end date of one shop's contract with Uzum, as the cabinet returns it: a single date. That it is the",
    "contract's end is read from the route's name, not stated in the response; one sample was recorded.",
  ],
  schema: argsSchema,

  async run(args, context) {
    const choice = resolveShop(context.session, asNumber(args['shopId']));
    if (choice.kind !== 'shop') {
      return { trace: `${CONTRACT_END_ID}: no request`, text: refusalText(CONTRACT_END_ID, choice) ?? '' };
    }
    const { shopId } = choice;
    const asked = [shopLabel(choice)];

    const read = await readCabinet(CONTRACT_END_ID, context.signal, asked, 'contract.end', { shopId });
    if (!read.ok) return read.result;
    const { response } = read;

    const data = response.data;
    if (!isRaw(data) || !Object.hasOwn(data, 'payload')) {
      return unrecognised(CONTRACT_END_ID, asked, response, 'an object holding payload');
    }

    const payload = data['payload'];
    /* Null is an answer the model must not read as a date that failed to print. */
    const stated = payload === null ? 'payload is null: the response states no date' : null;

    return {
      routes: [response.route],
      trace: `${asked[0]} · ${payload === null ? 'no date' : show(payload, 40)}`,
      text: compose([
        header(CONTRACT_END_ID, [...asked, stated, `live from ${response.route}`, statusPart(response)]),
        "payload is the response's own value, printed as received: a date with no time or zone in the one recorded response; that it is the contract's end date is read from the route's name · timestamp is the server's clock with no zone stated (it matched UTC in that response) · askedShopId is this call's shop, added here",
        pairs([
          ['askedShopId', String(shopId)],
          ['payload', show(payload, 80)],
          ['timestamp', show(data['timestamp'], 80)],
        ]),
      ]),
    };
  },
};
