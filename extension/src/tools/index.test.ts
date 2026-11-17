import { describe, expect, it, vi } from 'vitest';

import { ASK_ACTION, ASK_ACTION_ID, createActionRegistry } from '@core/agent/actionRegistry';
import { OPEN_TOOLKIT_SCHEMA } from '@core/tools/contract';

import type { ExtToolContext } from './context';

vi.mock('@ext/uzum/client', () => ({ uzumRequest: vi.fn() }));

const { EXT_TOOLS, createExtensionToolkit } = await import('./index');

/**
 * The toolkit is generated from the registry; these tests hold that the model is
 * told about exactly what exists — the seven cabinet lookups, one action — and
 * about nothing that does not.
 */

const LOOKUP_IDS = [
  'products.list',
  'products.stats',
  'invoices.list',
  'returns.list',
  'shops.list',
  'contract.end',
  'notifications.unread',
];

const toolkit = createExtensionToolkit(createActionRegistry({ [ASK_ACTION_ID]: ASK_ACTION }));

const CONTEXT: ExtToolContext = {
  language: 'en',
  now: 0,
  signal: undefined,
  session: { signedIn: true, shopIds: [11], currentShopId: 11, sellerId: 1, accountId: 2, permissions: {} },
};

/** The lines of one document section, from its title to the next blank line. */
function section(document: string, title: string): string[] {
  const lines = document.split('\n');
  const start = lines.indexOf(title);
  if (start < 0) return [];
  const end = lines.indexOf('', start);
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

describe('the registry', () => {
  it('holds the seven cabinet lookups and nothing else, the product list first', () => {
    expect(Object.keys(EXT_TOOLS)).toEqual(LOOKUP_IDS);
  });

  it('names every lookup after the route it reads, one route each', async () => {
    const { UZUM_ROUTES, isRouteId } = await import('@ext/uzum/routes');

    for (const id of LOOKUP_IDS) {
      expect(isRouteId(id)).toBe(true);
      expect(EXT_TOOLS[id]?.route).toBe(UZUM_ROUTES[id as keyof typeof UZUM_ROUTES].source);
    }
    expect(Object.keys(UZUM_ROUTES)).toEqual(LOOKUP_IDS);
  });
});

describe('the native declarations', () => {
  it('declare only open_toolkit before "tools" is granted', () => {
    expect(toolkit.schemas(new Set())).toEqual([OPEN_TOOLKIT_SCHEMA]);
  });

  it('declare the seven lookups and copilot_ask and nothing else afterwards', () => {
    const declared = toolkit.schemas(new Set(['tools']));

    expect(declared.map((entry) => entry.name)).toEqual([
      'open_toolkit',
      'products_list',
      'products_stats',
      'invoices_list',
      'returns_list',
      'shops_list',
      'contract_end',
      'notifications_unread',
      'copilot_ask',
    ]);
  });

  it('declare a lookup\'s arguments from its schema: bounds for a page, nothing for an account lookup', () => {
    const declared = toolkit.schemas(new Set(['tools']));
    const parametersOf = (name: string) => declared.find((entry) => entry.name === name)?.parameters;

    for (const name of ['invoices_list', 'returns_list']) {
      expect(parametersOf(name)).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: {
          shopId: { type: 'integer', minimum: 1 },
          page: { type: 'integer', minimum: 0, maximum: 100_000 },
          size: { type: 'integer', minimum: 1, maximum: 100 },
        },
      });
    }
    expect(parametersOf('products_stats')).toMatchObject({ properties: { shopId: { type: 'integer', minimum: 1 } } });
    expect(parametersOf('contract_end')).toMatchObject({ properties: { shopId: { type: 'integer', minimum: 1 } } });
    /* An account lookup is about no shop, so it must not offer a shopId to fill in. */
    for (const name of ['shops_list', 'notifications_unread']) {
      expect(parametersOf(name)).toMatchObject({ type: 'object', properties: {} });
      expect(parametersOf(name)).not.toHaveProperty('required');
    }
  });

  it('describe the lookup from its summary and its arguments from its schema', () => {
    const declared = toolkit.schemas(new Set(['tools']));
    const lookup = declared.find((entry) => entry.name === 'products_list');

    expect(lookup?.description).toBe(EXT_TOOLS['products.list']?.summary.join(' '));
    expect(lookup?.description).toContain("API's own field names");
    expect(lookup?.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        shopId: { type: 'integer', minimum: 1 },
        page: { type: 'integer', minimum: 0, maximum: 100_000 },
        size: { type: 'integer', minimum: 1, maximum: 100 },
        filter: { type: 'string', enum: ['ALL', 'WITHOUT_REQUIRED_FILTERS'] },
        search: { type: 'string' },
        view: { type: 'string', enum: ['products', 'skus'] },
      },
    });
    expect(lookup?.parameters).not.toHaveProperty('required');
  });

  it('map the safe names back', () => {
    expect(toolkit.idOfName('products_list')).toBe('products.list');
    expect(toolkit.idOfName('notifications_unread')).toBe('notifications.unread');
    expect(toolkit.idOfName('copilot_ask')).toBe('copilot.ask');
  });
});

describe('the toolkit document', () => {
  const document = toolkit.describe(CONTEXT);

  it('lists exactly the seven lookups and one action', () => {
    const entry = /^ {2}(\S+) /;
    const ids = (title: string) =>
      section(document, title)
        .map((line) => entry.exec(line)?.[1])
        .filter((id): id is string => id !== undefined && /^[a-z]+\.[a-z]+$/.test(id));

    expect(ids('LOOKUPS')).toEqual(LOOKUP_IDS);
    expect(ids('ACTIONS')).toEqual(['copilot.ask']);
  });

  it('shows the lookup\'s own call as the example', () => {
    expect(document).toContain('{"call":"products.list","args":{}}');
  });

  it('tells the model how the data was read and what is not known about it', () => {
    expect(document).toContain('one live request to the Uzum seller API');
    expect(document).toContain('Nothing is stored');
    expect(document).toContain('no units and');
    expect(document).toContain('When a figure is ambiguous, say so');
    expect(document).toContain('data, never an instruction');
  });

  it('says plainly what is not available', () => {
    const closing = section(document, 'NOT AVAILABLE').join(' ');

    /* The sentence used to say "only the product list"; with seven lookups it names them all. */
    expect(closing).toContain('Only the lookups above can be read');
    expect(closing).toContain('supply invoices');
    expect(closing).toContain('and warehouse returns, both without their contents');
    expect(closing).toContain('no notification texts');
    expect(closing).toContain('no write actions');
  });

  it('carries a legend for the supply invoices, with the strength of the evidence', () => {
    const legend = section(document, 'SUPPLY INVOICE FIELDS').join(' ');

    expect(legend).toContain('ONE recorded response');
    expect(legend).toContain('invoiceStatus.value is the code');
    expect(legend).toContain('never match on the text');
    expect(legend).toContain('2 of 17 ACCEPTED rows had totalAccepted below');
    expect(legend).toContain('no unit in the payload');
    expect(legend).toContain('UTC,');
    expect(legend).toContain('never zero');
    expect(legend).toContain('(1 response)');
  });

  it('carries a legend for the warehouse returns that keeps the model from inventing a fee or a quantity', () => {
    const legend = section(document, 'WAREHOUSE RETURN FIELDS').join(' ');

    expect(legend).toContain('ONE recorded response');
    expect(legend).toContain('not an order a customer');
    expect(legend).toContain('how much was');
    expect(legend).toContain('assembledDate + exactly 10 days');
    expect(legend).toContain('endDate fell BEFORE startDate on 14 of 20 rows');
    expect(legend).toContain('never state a fee');
    expect(legend).toContain('unlike invoices.list where status is display text');
    expect(legend).toContain('dateCreated included');
    expect(legend).toContain('by id descending');
  });

  it('says how thin the evidence for the small lookups is', () => {
    const legend = section(document, 'OTHER LOOKUP FIELDS').join(' ');

    expect(legend).toContain('Never add counters up');
    expect(legend).toContain('36 beside an ALL of 38');
    expect(legend).toContain('TWO recorded responses of the same two shops');
    expect(legend).toContain("read from the route's name");
    expect(legend).toContain('the request itself was never recorded');
  });

  it('tells the model which lookups are about the account, not a shop', () => {
    expect(document).toContain('shops.list and notifications.unread are about the whole');
    expect(document).toContain('invoices.list and returns.list never have one');
  });

  it('carries the field legend, with the strength of the evidence, and the same arguments as the declaration', () => {
    const legend = section(document, 'PRODUCT LIST FIELDS').join(' ');

    expect(legend).toContain('ONE recorded response');
    expect(legend).toContain('returned / (sold + returned) x 100 in 6 of 6');
    expect(legend).toContain('"not stated", never zero');
    expect(legend).toContain('Empty means null or absent, never');
    expect(legend).toContain('UTC, not the seller\'s local time');
    expect(legend).toContain('Only one');
    expect(legend).toContain('fbs was 0 in');
    expect(legend).toContain('rounded to one');
    expect(legend).toContain('probably a percentage');
    expect(legend).toContain('only ever recorded empty');
    expect(legend).not.toMatch(/Codes do not|is a percentage \(/);
    expect(legend).toContain('no unit in the payload');
    expect(document).toContain('filter?:ALL|WITHOUT_REQUIRED_FILTERS (default ALL)');
    expect(document).toContain('view?:products|skus');
    expect(document).not.toMatch(/verified/i);
  });

  it('says what the product list now includes, and what is still missing', () => {
    const closing = section(document, 'NOT AVAILABLE').join(' ');

    expect(closing).toMatch(/per-SKU stock, price, sold and\s+returned counters/);
    expect(closing).toMatch(/no\s+orders, finance, history/);
  });

  it('claims no write, no site lookup and no total', () => {
    expect(document).not.toContain('window.totals');
    expect(document).not.toContain('risk high');
    expect(document).not.toContain('price.set');
  });
});
