import { describe, expect, it } from 'vitest';

import { ApiError } from '@core/errors/apiError';
import { translate } from '@core/i18n/dictionary';
import type { SellerSession } from '@ext/uzum/session';

import { canRecheck, NOTICE_TEXT, statusOfError, statusOfSession } from './cabinetStatus';

const session = (over: Partial<SellerSession>): SellerSession => ({
  signedIn: true,
  shopIds: [1],
  currentShopId: 1,
  sellerId: 1,
  accountId: 1,
  permissions: {},
  ...over,
});

describe('statusOfSession', () => {
  it('is ready only when signed in with a shop', () => {
    expect(statusOfSession(session({}))).toBe('ready');
    expect(statusOfSession(session({ signedIn: false }))).toBe('signedOut');
    expect(statusOfSession(session({ shopIds: [] }))).toBe('noShops');
    expect(statusOfSession(session({ signedIn: false, shopIds: [] }))).toBe('signedOut');
  });
});

describe('statusOfError', () => {
  it('maps the bridge failures to states and ignores a cancelled read', () => {
    expect(statusOfError(new ApiError('x', { kind: 'unconfigured' }))).toBe('outside');
    expect(statusOfError(new ApiError('x', { kind: 'timeout' }))).toBe('unreachable');
    expect(statusOfError(new Error('x'))).toBe('unreachable');
    expect(statusOfError(new ApiError('x', { kind: 'cancelled' }))).toBeNull();
  });

  it('tells a closed connection from one that was never there', () => {
    const closed = new ApiError('x', { kind: 'unconfigured', code: 'BRIDGE_CLOSED' });
    expect(statusOfError(closed)).toBe('closed');
    expect(canRecheck('closed')).toBe(false);
    expect(NOTICE_TEXT.closed).toBe('extBridgeLost');
  });
});

describe('notices', () => {
  it('has a sentence in every language for each state that shows one', () => {
    for (const key of Object.values(NOTICE_TEXT)) {
      if (key === null) continue;
      for (const language of ['en', 'ru', 'uz'] as const) {
        expect(translate(key, language).trim()).not.toBe('');
      }
    }
  });

  it('says nothing while checking or when ready, and offers a re-check only where it can help', () => {
    expect(NOTICE_TEXT.checking).toBeNull();
    expect(NOTICE_TEXT.ready).toBeNull();
    expect(canRecheck('signedOut')).toBe(true);
    expect(canRecheck('outside')).toBe(false);
    expect(canRecheck('ready')).toBe(false);
  });
});
