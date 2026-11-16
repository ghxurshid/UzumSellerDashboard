import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ASK_ACTION, ASK_ACTION_ID, createActionRegistry } from './actionRegistry';
import { checkActions } from './agent';
import type { Block } from './blocks';
import { blockLineSchema } from './blocks';

/**
 * The gate, on a host that is not the site.
 *
 * A second host brings its own, much smaller table. Everything the site relies
 * on — an unknown id refused, a malformed parameter explained, a prototype name
 * not mistaken for an entry — has to hold for any table, because the block
 * schema no longer knows which ids exist.
 */

const registry = createActionRegistry({
  [ASK_ACTION_ID]: ASK_ACTION,
  'tab.open': {
    labelKey: 'openRows',
    endpoint: null,
    risk: 'none',
    params: z.object({ tab: z.enum(['orders', 'products']) }),
    argsDoc: '{tab:"orders|products"}',
    summary: 'Open a tab of the cabinet.',
  },
});

describe('createActionRegistry', () => {
  it('lists the table it was built from', () => {
    expect(registry.ids).toEqual(['copilot.ask', 'tab.open']);
    expect(registry.get('tab.open')?.argsDoc).toBe('{tab:"orders|products"}');
  });

  it('resolves a well-formed action with the params its schema produced', () => {
    expect(registry.resolve('copilot.ask', { question: '  Nega?  ' })).toMatchObject({
      actionId: 'copilot.ask',
      params: { question: 'Nega?' },
    });
  });

  it('refuses an id it does not hold, prototype names included', () => {
    for (const id of ['product.price', 'toString', 'constructor', '__proto__']) {
      expect(registry.get(id)).toBeUndefined();
      expect(registry.resolve(id, {})).toBeNull();
      expect(registry.explain(id, {})).toBe(`no action named "${id}"`);
    }
  });

  it('explains which param failed', () => {
    expect(registry.resolve('tab.open', { tab: 'finance' })).toBeNull();
    expect(registry.explain('tab.open', { tab: 'finance' })).toContain('tab:');
  });
});

describe('checkActions', () => {
  const run = (blocks: readonly Block[]) => {
    const reasons: string[] = [];
    const kept = checkActions(blocks, registry, (_line, reason) => reasons.push(reason));
    return { kept, reasons };
  };

  it('keeps a button the registry accepts', () => {
    const { kept, reasons } = run([{ kind: 'action', actionId: 'tab.open', params: { tab: 'orders' } }]);
    expect(kept).toHaveLength(1);
    expect(reasons).toEqual([]);
  });

  it('refuses an id another host has, naming the ones this host offers', () => {
    const { kept, reasons } = run([
      { kind: 'text', text: 'Narx past.' },
      { kind: 'action', actionId: 'product.price', params: {} },
    ]);

    expect(kept).toEqual([{ kind: 'text', text: 'Narx past.' }]);
    expect(reasons).toEqual([
      'actionId: no action named "product.price" — use one the toolkit lists: copilot.ask, tab.open',
    ]);
  });

  it('refuses params the entry rejects, with the shape it expected', () => {
    const { reasons } = run([{ kind: 'action', actionId: 'tab.open', params: { tab: 'x' } }]);
    expect(reasons[0]).toMatch(/^params: tab: .* — expected \{tab:"orders\|products"\}$/);
  });

  it('drops a callout left with nothing but refused buttons', () => {
    const { kept } = run([
      {
        kind: 'callout',
        tone: 'accent',
        title: 'Qiling',
        blocks: [{ kind: 'action', actionId: 'nope', params: {} }],
      },
    ]);
    expect(kept).toEqual([]);
  });
});

describe('the wire schema', () => {
  it('accepts any well-formed id and leaves the verdict to the registry', () => {
    expect(blockLineSchema.safeParse({ kind: 'action', actionId: 'tab.open' }).success).toBe(true);
    expect(blockLineSchema.safeParse({ kind: 'action', actionId: 'print.orderLabel' }).success).toBe(true);
  });

  it('refuses text that could never be an id', () => {
    for (const actionId of ['', 'open the tab', 'a..b', 'x'.repeat(65), '{"a":1}']) {
      expect(blockLineSchema.safeParse({ kind: 'action', actionId }).success).toBe(false);
    }
  });
});
