import { describe, expect, it } from 'vitest';

import { ASK_ACTION_ID } from '@core/agent/actionRegistry';

import { EXT_ACTIONS } from './actions';

/**
 * The extension's closed registry: the follow-up chip and nothing else.
 *
 * The gate in the loop (`checkActions`) refuses whatever this registry does not
 * resolve, so these are the cases that decide what can ever be drawn as a
 * button in the panel.
 */

describe('EXT_ACTIONS', () => {
  it('holds the follow-up chip and nothing else', () => {
    expect(EXT_ACTIONS.ids).toEqual([ASK_ACTION_ID]);
  });

  it('resolves copilot.ask with a question', () => {
    const resolved = EXT_ACTIONS.resolve('copilot.ask', { question: '  Qaysi mahsulot tugayapti?  ' });

    expect(resolved?.actionId).toBe('copilot.ask');
    expect(resolved?.params).toEqual({ question: 'Qaysi mahsulot tugayapti?' });
    expect(resolved?.definition.risk).toBe('none');
  });

  it('refuses copilot.ask without a usable question, and says which param failed', () => {
    expect(EXT_ACTIONS.resolve('copilot.ask', {})).toBeNull();
    expect(EXT_ACTIONS.resolve('copilot.ask', { question: '   ' })).toBeNull();
    expect(EXT_ACTIONS.explain('copilot.ask', {})).toContain('question');
  });

  it('refuses an id it does not hold', () => {
    expect(EXT_ACTIONS.get('shop.delete')).toBeUndefined();
    expect(EXT_ACTIONS.resolve('shop.delete', {})).toBeNull();
    expect(EXT_ACTIONS.explain('shop.delete', {})).toBe('no action named "shop.delete"');
  });

  it('refuses the site’s actions — this panel performs none of them', () => {
    for (const id of ['product.price', 'stock.update', 'order.cancel', 'nav.open', 'ui.range']) {
      expect(EXT_ACTIONS.get(id)).toBeUndefined();
      expect(EXT_ACTIONS.resolve(id, { productId: 1, price: 1000 })).toBeNull();
    }
  });

  it('finds nothing on the prototype', () => {
    for (const id of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(EXT_ACTIONS.get(id)).toBeUndefined();
    }
  });
});
