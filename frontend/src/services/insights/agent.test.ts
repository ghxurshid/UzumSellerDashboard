import { describe, expect, it } from 'vitest';

import { cacheKey, capabilityOf, readDirective } from './agent';
import { OPEN_TOOLKIT } from './toolkit';

/**
 * The protocol, on the path that has no provider to parse it for us.
 *
 * Where a provider carries tool calls natively this code does nothing. Where it
 * does not — a self-hosted Ollama, someone's own gateway — these three
 * functions are the whole of the agent's understanding of what the model asked
 * for, and a model that phrases a request slightly differently than the prompt
 * suggested must still be understood. Every tolerated spelling below is one a
 * model has a reason to produce.
 */

describe('readDirective', () => {
  it('reads a capability request', () => {
    expect(readDirective({ need: 'tools' })).toEqual({
      tool: OPEN_TOOLKIT,
      args: { capability: 'tools' },
      call: null,
    });
  });

  it('accepts the spellings a model actually reaches for', () => {
    for (const spelling of ['toolkit', 'TOOLS', ' tool ']) {
      expect(readDirective({ need: spelling })?.args).toEqual({ capability: 'tools' });
    }
    for (const spelling of ['widget', 'widgets', 'blocks']) {
      expect(readDirective({ need: spelling })?.args).toEqual({ capability: 'widgets' });
    }
  });

  it('refuses a capability that does not exist', () => {
    expect(readDirective({ need: 'database' })).toBeNull();
  });

  it('reads a lookup with its arguments', () => {
    expect(readDirective({ call: 'products.rank', args: { limit: 5 } })).toEqual({
      tool: 'products.rank',
      args: { limit: 5 },
      call: null,
    });
  });

  it('accepts the other two keys a model uses for a call', () => {
    expect(readDirective({ tool: 'window.totals' })?.tool).toBe('window.totals');
    expect(readDirective({ run: 'window.totals' })?.tool).toBe('window.totals');
  });

  it('defaults missing arguments to an empty object', () => {
    expect(readDirective({ call: 'shops.list' })?.args).toEqual({});
  });

  it('is not fooled by a block or by junk', () => {
    expect(readDirective({ kind: 'text', text: 'hello' })).toBeNull();
    expect(readDirective(null)).toBeNull();
    expect(readDirective('tools')).toBeNull();
    expect(readDirective({ call: '   ' })).toBeNull();
  });
});

describe('capabilityOf', () => {
  it('reads what a native open_toolkit call asked for', () => {
    expect(capabilityOf({ capability: 'widgets' })).toBe('widgets');
    expect(capabilityOf({ capability: ' Toolkit ' })).toBe('tools');
  });

  it('returns null when the argument is missing or unknown', () => {
    expect(capabilityOf({})).toBeNull();
    expect(capabilityOf({ capability: 'everything' })).toBeNull();
    expect(capabilityOf(null)).toBeNull();
  });
});

describe('cacheKey', () => {
  it('treats the same lookup asked twice as one question', () => {
    expect(cacheKey('products.rank', { limit: 10, by: 'revenue' })).toBe(
      cacheKey('products.rank', { by: 'revenue', limit: 10 }),
    );
  });

  it('treats a different window as a different question', () => {
    expect(cacheKey('window.totals', { from: '2026-08-01' })).not.toBe(
      cacheKey('window.totals', { from: '2026-07-01' }),
    );
  });

  it('treats no arguments and an empty object as the same', () => {
    expect(cacheKey('shops.list', undefined)).toBe(cacheKey('shops.list', {}));
  });

  it('separates two tools that took the same arguments', () => {
    expect(cacheKey('window.totals', {})).not.toBe(cacheKey('expenses.breakdown', {}));
  });
});
