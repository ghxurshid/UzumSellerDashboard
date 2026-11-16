import { z } from 'zod';

import type { ToolSpec } from '@core/tools/contract';
import { clip, compose, header } from '@core/tools/plaintext';
import { uzumRequest } from '@ext/uzum/client';
import { readProductsPage } from '@ext/uzum/products';
import {
  hasControlCharacter,
  PRODUCTS_FILTER_DEFAULT,
  PRODUCTS_FILTERS,
  PRODUCTS_MAX_PAGE,
  PRODUCTS_MAX_SIZE,
  PRODUCTS_SEARCH_MAX_LENGTH,
  type ProductsFilter,
} from '@ext/uzum/routes';

import { CABINET_DEADLINE_MS, explainFailure, refusalText, resolveShop, shopLabel, withDeadline } from './cabinet';
import type { ExtToolContext } from './context';
import { renderPayload } from './render';
import { pagingText, renderProductsPage } from './productsView';

/**
 * `products.list` — the seller's products, read live from the cabinet.
 *
 * One request per call, through the session the seller already has in the open
 * tab. Evidence: two recorded requests and ONE recorded response (trimmed to a
 * single product), so nothing below is called verified.
 *
 * Two renderings, chosen by what came back:
 *
 *   - **A response `readProductsPage` recognises** (a `productList` array) is
 *     printed as curated tables under the API's own field names — a product table
 *     or, on request, a SKU table, because most of the value (stock, sold,
 *     returned, paid storage) is per SKU — and the page is placed in the
 *     response's own `totalProductsAmount`.
 *   - **Anything else** goes to the shape-agnostic renderer exactly as before,
 *     with paging worded from what one page shows. One sample is not a contract,
 *     so a response the reader does not recognise must still be reported truthfully.
 *
 * No page is ever called the last on the strength of its length alone: the size
 * ceiling is our own contract and the API may cap a page lower.
 */

export const PRODUCTS_LIST_ID = 'products.list';

/** The cabinet's own product-table page size (its stored setting held 24 in the recording). */
export const DEFAULT_SIZE = 24;
export const MAX_SIZE = PRODUCTS_MAX_SIZE;

/** Names that make the largest list in an unrecognised body almost certainly not the products. */
const NOT_A_PRODUCT_LIST = /(^|\.)(errors?|warnings?|messages?|violations?|problems?|faults?)$/i;

/* `coerce` because a model sometimes quotes a number; the bounds still decide meaning. */
const argsSchema = z.object({
  shopId: z.coerce
    .number()
    .int()
    .positive()
    .describe("One of the seller's shop ids. Omit it to use the shop the cabinet page shows.")
    .optional(),
  page: z.coerce
    .number()
    .int()
    .min(0)
    .max(PRODUCTS_MAX_PAGE)
    .describe('Zero-based page number. Default 0.')
    .optional(),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_SIZE)
    .describe(`Products requested per page, 1-${MAX_SIZE}; the API may return fewer. Default ${DEFAULT_SIZE} (the cabinet's own page size).`)
    .optional(),
  filter: z
    .enum(PRODUCTS_FILTERS)
    .describe(
      `Default ${PRODUCTS_FILTER_DEFAULT}, what the cabinet's own product table sends. WITHOUT_REQUIRED_FILTERS is the only other value seen; what it selects is not documented, probably a narrower set.`,
    )
    .optional(),
  search: z
    .string()
    .describe(
      `Text (up to ${PRODUCTS_SEARCH_MAX_LENGTH} characters) passed as the cabinet's own search parameter. It was only ever recorded empty: it is not known that the server applies it or how it matches (title, SKU, barcode). Check that the rows returned actually match before presenting them as search results.`,
    )
    .optional(),
  view: z
    .enum(['products', 'skus'])
    .describe(
      'products (default): one row per product. skus: one row per SKU (size, colour, stock, price, paid storage) of the same page, in the same single request.',
    )
    .optional(),
});

const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const asFilter = (value: unknown): ProductsFilter =>
  PRODUCTS_FILTERS.find((entry) => entry === value) ?? PRODUCTS_FILTER_DEFAULT;

export const productsList: ToolSpec<ExtToolContext> = {
  route: 'GET /api/seller/shop/{shopId}/product/getProducts',
  args: `{shopId?, page?:0-based, size?:1-${MAX_SIZE} (default ${DEFAULT_SIZE}), filter?:ALL|WITHOUT_REQUIRED_FILTERS (default ALL), search?:text, view?:products|skus (default products)}`,
  summary: [
    "The seller's products, read live from the Uzum cabinet API, one page per call, requested sorted by id",
    'descending. view=products gives one row per product; view=skus gives one row per size/colour with its own',
    'stock, price and paid storage — ask for it when the question is about sizes, stock or storage. search',
    'passes text to the cabinet\'s search (its effect is not recorded: check the rows match). The result places',
    'the page in the response\'s own totalProductsAmount, where that is meaningful.',
    'Columns are the API\'s own field names; no unit is documented. The field legend in the toolkit says',
    'what the single recorded response showed about each ambiguous field, and nothing more.',
  ],
  schema: argsSchema,

  async run(args, context) {
    const page = asNumber(args['page']) ?? 0;
    const size = asNumber(args['size']) ?? DEFAULT_SIZE;
    const filter = asFilter(args['filter']);
    const rawSearch = asString(args['search']) ?? '';
    const search = rawSearch.trim();
    const narrowed = search !== '' || filter !== PRODUCTS_FILTER_DEFAULT;
    const view = args['view'] === 'skus' ? 'skus' : 'products';

    /* The route's own rule, applied to the text as the model wrote it: trimming first
       would send "kit\n" as "kit" and hide that the text was not plain. */
    if (hasControlCharacter(rawSearch)) {
      return {
        trace: `${PRODUCTS_LIST_ID}: no request`,
        text: compose([
          header(PRODUCTS_LIST_ID, ['search refused', 'no request was made']),
          'The search text contains a control character (a line break, tab or similar). Call again with plain text on one line.',
        ]),
      };
    }

    /* The bound counts the trimmed text, as the route does. */
    if (search.length > PRODUCTS_SEARCH_MAX_LENGTH) {
      return {
        trace: `${PRODUCTS_LIST_ID}: no request`,
        text: compose([
          header(PRODUCTS_LIST_ID, ['search refused', 'no request was made']),
          `The search text is ${search.length} characters; the limit is ${PRODUCTS_SEARCH_MAX_LENGTH}. Call again with a shorter text.`,
        ]),
      };
    }

    const choice = resolveShop(context.session, asNumber(args['shopId']));
    if (choice.kind !== 'shop') {
      return {
        trace: `${PRODUCTS_LIST_ID}: no request`,
        text: refusalText(PRODUCTS_LIST_ID, choice) ?? '',
      };
    }
    const { shopId } = choice;
    const asked = [
      shopLabel(choice),
      `page ${page}`,
      `size ${size}`,
      filter === 'ALL' ? 'filter ALL' : `filter ${filter} (meaning undocumented)`,
      search === '' ? null : `search "${clip(search, 40)}"`,
      view === 'skus' ? 'view skus' : null,
    ];

    let response;
    try {
      response = await withDeadline(context.signal, CABINET_DEADLINE_MS, (signal) =>
        uzumRequest(
          'products.list',
          { shopId, page, size, filter, ...(search === '' ? {} : { searchQuery: search }) },
          signal,
        ),
      );
    } catch (error) {
      /* A question the seller walked away from is not a failed lookup. */
      if (context.signal?.aborted === true) throw error;

      return {
        trace: `${PRODUCTS_LIST_ID} failed`,
        text: compose([
          header(PRODUCTS_LIST_ID, [...asked, 'FAILED']),
          `${explainFailure(error)} Say what you could not read rather than estimating it.`,
        ]),
      };
    }

    const status = response.status === 200 ? null : `HTTP ${response.status}`;
    const recognised = readProductsPage(response.data);

    if (recognised !== null) {
      /* Cells come from the entries as the response held them, not from the
         reader's typed view: a value of an unexpected type is shown as it came. */
      const data = response.data as Record<string, unknown>;
      const products = recognised.products.map((record) => record.raw);
      const view_ = renderProductsPage(products, view, shopId);
      const count = products.length;

      /* Anomaly notes appear only when there is an anomaly: what did not match the
         recorded sample, and how many entries could not be read at all. */
      const notes: string[] = [];
      if (recognised.unreadableProducts > 0) {
        notes.push(`${recognised.unreadableProducts} of ${recognised.entriesHeld} productList entries are not objects and were skipped`);
      }
      const junkSkus = recognised.products.reduce((sum, record) => sum + record.unreadableSkus, 0);
      if (junkSkus > 0) notes.push(`${junkSkus} skuList entries are not objects and were not counted as SKUs`);
      const mistyped = [...new Set(recognised.products.flatMap((record) => record.mistyped))];
      if (mistyped.length > 0) {
        const shown = mistyped.slice(0, 6).join(', ');
        notes.push(`fields of a type the recorded sample did not show, printed as received: ${shown}${mistyped.length > 6 ? `, +${mistyped.length - 6}` : ''}`);
      }
      if (recognised.total === null && data['totalProductsAmount'] !== undefined && data['totalProductsAmount'] !== null) {
        notes.push('totalProductsAmount is not a plain count and was not used');
      }

      /* The fallback path guards an `errors` list; a recognised page must too, or
         an empty productList beside errors would read as "no products". */
      const sideLists = Object.entries(data).filter(
        (entry): entry is [string, unknown[]] =>
          NOT_A_PRODUCT_LIST.test(entry[0]) && Array.isArray(entry[1]) && entry[1].length > 0,
      );
      const sideNotes = sideLists.map(([key, value]) => `the response also carries ${key} (${value.length} entries)`);
      const sideText =
        sideLists.length === 0
          ? ''
          : renderPayload(Object.fromEntries(sideLists), { limits: { maxRows: 10, maxChars: 2_000 } }).text;

      const cutPart =
        view_.cuts.length > 0
          ? `TRUNCATED: ${view_.cuts.join('; ')} — ask for a smaller size or use search to see every row (page numbers depend on size)`
          : null;

      return {
        routes: [response.route],
        trace: `${asked[0]} · page ${page} · ${count} products`,
        text: compose([
          header(PRODUCTS_LIST_ID, [
            ...asked,
            `${count} ${count === 1 ? 'product' : 'products'} on this page${view === 'skus' ? `, ${view_.skuCount} SKUs` : ''}`,
            notes.length === 0 ? null : `unexpected: ${notes.join('; ')}`,
            sideNotes.length === 0 ? null : `${sideNotes.join('; ')} — read them below`,
            pagingText(recognised.total, page, size, count, narrowed),
            recognised.totalWithoutWeightDimensional === null
              ? null
              : `totalProductsAmountWithoutWeightDimensional ${recognised.totalWithoutWeightDimensional}`,
            `live from ${response.route}`,
            status,
            cutPart,
          ]),
          "units unknown (price has no unit in the payload) · columns are the cabinet API's own field names, values as the response held them, an empty cell is null or absent · askedShopId is this call's shop, added here · from the response: field values and totalProductsAmount · computed here: row positions, \"more remain\", SKU counts, skuList.length, skuList.RUN_OUT · read the field legend before interpreting a column",
          view_.text,
          sideText,
        ]),
      };
    }

    /* Not the observed shape: say what is there without claiming it is products. */
    const rendered = renderPayload(response.data, {
      rowTag: { column: 'askedShopId', value: shopId },
    });
    const found = rendered.primary;

    /* The renderer picks the largest list in the body; nothing says that list is
       the products. A name that is plainly something else (an `errors` array on a
       200) is said not to be them. */
    const notProducts = found !== null && NOT_A_PRODUCT_LIST.test(found.path);
    const where = found === null || found.path === '' ? '' : ` in ${found.path}`;
    const rowsPart =
      found === null
        ? 'no list of items found in the response'
        : `largest list: ${found.count} ${found.count === 1 ? 'item' : 'items'}${where}${notProducts ? ' (named like an error or message list, not products)' : ''}`;

    const next = page + 1;
    const pagingPart =
      found === null || notProducts
        ? 'cannot tell whether more pages exist'
        : found.count === 0
          ? 'empty page — nothing at this page number'
          : found.count > size
            ? `more items than size ${size} asked for — the API may not honour size; page numbers may not line up`
            : found.count === size
              ? `as many as asked — there may be more: next page ${next}`
              : `fewer than the ${size} asked for — the API may cap a page, so more may exist; ask page ${next} to check`;

    const rowsCut = found !== null && found.shown < found.count;
    const cutPart = rendered.truncated
      ? `TRUNCATED: ${rendered.cuts.join('; ')}${rowsCut ? ' — ask for a smaller size to see every row (page numbers depend on size)' : ''}`
      : null;

    return {
      routes: [response.route],
      trace: `${asked[0]} · page ${page} · ${found === null ? 'no rows found' : `${found.count} rows`}`,
      text: compose([
        header(PRODUCTS_LIST_ID, [
          ...asked,
          'shape not recognised: printed generically',
          rowsPart,
          pagingPart,
          `live from ${response.route}`,
          status,
          cutPart,
        ]),
        "units unknown · a count here is items returned by this read, not products in the shop · columns are the cabinet API's own field names, values exactly as returned · askedShopId is the shop this call asked for, added here",
        rendered.text,
      ]),
    };
  },
};
