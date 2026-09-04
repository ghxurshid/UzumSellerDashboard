import { describe, expect, it } from 'vitest';

import { ACTION_IDS, explainRejection, INSIGHT_ACTIONS, resolveAction } from './actions';
import { pinnableBlocks } from './pins';
import { statesRawNumber } from './blocks';
import type { Block } from './blocks';

/**
 * The gate between a model's suggestion and a request to a marketplace.
 *
 * Everything here is about what the application refuses. A registry that
 * accepts a malformed price write turns a language model's guess into a change
 * in what a buyer is charged, and no amount of prompt wording is a substitute
 * for the schema saying no.
 */

describe('the registry', () => {
  it('lists every action exactly once', () => {
    expect([...ACTION_IDS].sort()).toEqual(Object.keys(INSIGHT_ACTIONS).sort());
  });

  it('gives every action the documentation the toolkit is generated from', () => {
    for (const id of ACTION_IDS) {
      const definition = INSIGHT_ACTIONS[id];
      expect(definition.summary.length).toBeGreaterThan(10);
      expect(definition.argsDoc.length).toBeGreaterThan(1);
    }
  });

  it('lets nothing that reaches Uzum run without a press', () => {
    /* `none` is the licence to run unattended, so it must belong only to the
       actions that touch no network at all. */
    for (const id of ACTION_IDS) {
      const definition = INSIGHT_ACTIONS[id];
      if (definition.risk === 'none') expect(definition.endpoint).toBeNull();
      else expect(definition.endpoint).not.toBeNull();
    }
  });
});

describe('resolveAction', () => {
  it('accepts a well-formed price write', () => {
    const resolved = resolveAction('product.price', {
      shopId: 1,
      entries: [{ skuId: 11, fullPrice: 120_000, sellPrice: 99_000 }],
    });

    expect(resolved?.actionId).toBe('product.price');
  });

  it('refuses an action that does not exist', () => {
    expect(resolveAction('product.rename', { name: 'x' })).toBeNull();
    expect(explainRejection('product.rename', {})).toContain('no action named');
  });

  it('refuses a price write with no entries', () => {
    expect(resolveAction('product.price', { shopId: 1, entries: [] })).toBeNull();
  });

  it('refuses a stock write with no barcode', () => {
    /* The route rejects it too, but after the seller has pressed the button. */
    expect(resolveAction('stock.update', { entries: [{ skuId: 11, amount: 4 }] })).toBeNull();
    expect(explainRejection('stock.update', { entries: [{ skuId: 11, amount: 4 }] })).toContain(
      'barcode',
    );
  });

  it('refuses a cancellation reason the marketplace does not know', () => {
    expect(resolveAction('order.cancel', { orderId: 4, reason: 'CHANGED_MY_MIND' })).toBeNull();
  });

  it('refuses a negative price', () => {
    expect(
      resolveAction('product.price', {
        shopId: 1,
        entries: [{ skuId: 11, fullPrice: -1, sellPrice: 10 }],
      }),
    ).toBeNull();
  });

  it('caps a bulk write at what the route accepts', () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({
      skuId: index + 1,
      fullPrice: 100,
      sellPrice: 90,
    }));

    expect(resolveAction('product.price', { shopId: 1, entries })).toBeNull();
  });

  it('explains itself in terms the model can act on', () => {
    const why = explainRejection('order.confirm', { orderIds: [] });
    expect(why).toContain('orderIds');
  });
});

describe('statesRawNumber', () => {
  it('catches money, percentages and grouped thousands', () => {
    expect(statesRawNumber('Net profit is 457924 so‘m')).toBe(true);
    expect(statesRawNumber('Margin fell to 9.2%')).toBe(true);
    expect(statesRawNumber('Revenue was 4 966 180')).toBe(true);
  });

  it('allows a year and a small count', () => {
    expect(statesRawNumber('Abaya 2024 sold in three sizes')).toBe(false);
    expect(statesRawNumber('7 SKUs are empty')).toBe(false);
  });

  it('ignores what the application will resolve', () => {
    /* A placeholder is the sanctioned way to put a figure in a sentence, so a
       template full of them must not be mistaken for a model typing numbers. */
    expect(statesRawNumber('Net profit is {{totals.netProfit}} ({{totals.netMargin}})')).toBe(
      false,
    );
  });
});

describe('pinnableBlocks', () => {
  const blocks: readonly Block[] = [
    { kind: 'trace', tool: 'window.totals', detail: '' },
    { kind: 'text', text: 'Margin is thin.' },
    { kind: 'action', actionId: 'product.price', params: { shopId: 1, entries: [] } },
    {
      kind: 'callout',
      tone: 'warning',
      title: 'Do this',
      blocks: [
        { kind: 'text', text: 'Raise the price.' },
        { kind: 'action', actionId: 'nav.open', params: { screen: 'products' } },
      ],
    },
  ];

  it('drops the trace and every button, however deeply nested', () => {
    const kept = pinnableBlocks(blocks);

    expect(kept.map((block) => block.kind)).toEqual(['text', 'callout']);
    const callout = kept[1];
    expect(callout?.kind === 'callout' && callout.blocks.map((block) => block.kind)).toEqual([
      'text',
    ]);
  });

  it('drops a callout that held nothing but buttons', () => {
    const kept = pinnableBlocks([
      {
        kind: 'callout',
        tone: 'accent',
        title: 'Act',
        blocks: [{ kind: 'action', actionId: 'nav.open', params: { screen: 'products' } }],
      },
    ]);

    expect(kept).toEqual([]);
  });
});
