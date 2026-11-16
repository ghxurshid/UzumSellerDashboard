import { describe, expect, it } from 'vitest';

import { parseCabinetState, readCabinetState } from './session';

/* Invented values; the shape follows the one recorded localStorage sample. */
const TOKEN = 'tok-INVENTED-123';
const state = (user: unknown): string => JSON.stringify({ user });
const full = state({
  tokens: { accessExpiration: 1, access: TOKEN, refresh: 'ref-INVENTED' },
  permissions: { '2002': ['PRODUCT_READ', 'SKU_READ'], '1001': ['FINANCE_READ'] },
  authorities: ['ROLE_SELLER'],
  accountId: 77,
  sellerId: 88,
});

describe('parseCabinetState', () => {
  it('reads shops, permissions and ids, and keeps the token apart from the session', () => {
    const { session, token } = parseCabinetState(full, '/');
    expect(token).toBe(TOKEN);
    expect(session).toMatchObject({
      signedIn: true,
      shopIds: [1001, 2002],
      sellerId: 88,
      accountId: 77,
      currentShopId: null,
    });
    expect(session.permissions[2002]).toEqual(['PRODUCT_READ', 'SKU_READ']);
    expect(JSON.stringify(session)).not.toContain(TOKEN);
  });

  it('names the current shop only when the path holds one of the account shops', () => {
    expect(parseCabinetState(full, '/seller/2002/products').session.currentShopId).toBe(2002);
    expect(parseCabinetState(full, '/seller/9999/products').session.currentShopId).toBeNull();
  });

  it('treats a missing key, bad JSON and a missing token as signed out', () => {
    for (const raw of [null, '', '{not json', '[]', state(null), state({ tokens: {} }), state({ tokens: { access: 5 } })]) {
      const parsed = parseCabinetState(raw, '/');
      expect(parsed.session.signedIn).toBe(false);
      expect(parsed.token).toBeNull();
    }
  });

  it('refuses a token that is not a single visible-ASCII word', () => {
    expect(parseCabinetState(state({ tokens: { access: 'two words' } }), '/').token).toBeNull();
    expect(parseCabinetState(state({ tokens: { access: 'a\nb' } }), '/').token).toBeNull();
  });

  it('ignores non-numeric permission keys and non-string codes', () => {
    const { session } = parseCabinetState(
      state({
        tokens: { access: TOKEN },
        permissions: { abc: ['X'], '0': ['X'], '12.5': ['X'], '5': ['OK', 3, null] },
      }),
      '/',
    );
    expect(session.shopIds).toEqual([5]);
    expect(session.permissions[5]).toEqual(['OK']);
  });

  it('reports unknown ids as null, not zero', () => {
    const { session } = parseCabinetState(state({ tokens: { access: TOKEN } }), '/');
    expect(session.sellerId).toBeNull();
    expect(session.accountId).toBeNull();
    expect(session.shopIds).toEqual([]);
  });
});

describe('readCabinetState', () => {
  it('reads the "state" key and survives storage that throws', () => {
    expect(readCabinetState({ getItem: (k) => (k === 'state' ? full : null) }, '/').token).toBe(TOKEN);
    const throwing = {
      getItem: (): string => {
        throw new Error('blocked');
      },
    };
    expect(readCabinetState(throwing, '/').session.signedIn).toBe(false);
  });
});
