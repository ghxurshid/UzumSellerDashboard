import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@core/errors/apiError';
import { translate } from '@core/i18n/dictionary';
import { EXTENSION_TOOLKIT } from '@ext/host';
import { getSellerSession } from '@ext/uzum/client';
import type { SellerSession } from '@ext/uzum/session';

import { useChatStore } from '@core/state/chat.store';
import { usePreferencesStore } from '@core/state/preferences.store';
import { createExtensionHost, EXTENSION_SUGGESTIONS, prepareRun, sessionFailure } from './copilotHost';

vi.mock('@ext/uzum/client', () => ({
  BRIDGE_CLOSED_CODE: 'BRIDGE_CLOSED',
  getSellerSession: vi.fn(),
  uzumRequest: vi.fn(),
}));

const read = vi.mocked(getSellerSession);

const SIGNED_IN: SellerSession = {
  signedIn: true,
  shopIds: [11, 22],
  currentShopId: 22,
  sellerId: 5,
  accountId: 6,
  permissions: { 11: ['read'], 22: ['read'] },
};

const SIGNED_OUT: SellerSession = {
  signedIn: false,
  shopIds: [],
  currentShopId: null,
  sellerId: null,
  accountId: null,
  permissions: {},
};

const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);

function input(signal: AbortSignal = new AbortController().signal, language: 'en' | 'ru' | 'uz' = 'en') {
  return { language, now: NOW, native: true, signal } as const;
}

beforeEach(() => {
  read.mockReset();
});

describe('prepareRun', () => {
  it('reads the session once and feeds the same object to the prompt and the context', async () => {
    read.mockResolvedValue(SIGNED_IN);
    const signal = new AbortController().signal;

    const run = await prepareRun(input(signal));

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(signal);
    /* The prompt was built from the shops this very session holds… */
    expect(run.system).toContain('Shops: 11, 22');
    expect(run.system).toContain('On screen: shop 22.');
    /* …and the lookups are checked against that same object, not a copy. */
    expect(run.context.session).toBe(SIGNED_IN);
    expect(run.context.signal).toBe(signal);
    expect(run.context.language).toBe('en');
    expect(run.context.now).toBe(NOW);
  });

  it('tells the model the time zone the seller chose under General', async () => {
    read.mockResolvedValue(SIGNED_IN);
    try {
      usePreferencesStore.getState().patchGeneral({ timezone: 'UTC' });
      expect((await prepareRun(input())).system).toContain('Today: 2026-11-12 in UTC');

      usePreferencesStore.getState().patchGeneral({ timezone: 'Asia/Tashkent' });
      expect((await prepareRun(input())).system).toContain('Today: 2026-11-12 in Asia/Tashkent');
    } finally {
      usePreferencesStore.getState().resetGeneral();
    }
  });

  it('proceeds when the cabinet tab is signed out, and the prompt says so', async () => {
    read.mockResolvedValue(SIGNED_OUT);
    const run = await prepareRun(input());
    expect(run.system).toContain('NOT signed in');
    expect(run.context.session.signedIn).toBe(false);
  });

  it('stops outside the cabinet frame with a sentence in the seller\'s language', async () => {
    read.mockRejectedValue(new ApiError('The Copilot panel is not running inside the seller cabinet.', { kind: 'unconfigured' }));

    for (const language of ['en', 'ru', 'uz'] as const) {
      const error = await prepareRun(input(undefined, language)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).kind).toBe('unconfigured');
      expect((error as ApiError).message).toBe(translate('extNotInCabinet', language));
    }
  });

  it('words an unanswered bridge or an unexpected failure the same way, not as the AI being slow', async () => {
    read.mockRejectedValueOnce(new ApiError('The cabinet bridge did not answer in time.', { kind: 'timeout' }));
    const timeout = await prepareRun(input(undefined, 'ru')).catch((e: unknown) => e);
    expect((timeout as ApiError).kind).toBe('client');
    expect((timeout as ApiError).message).toBe(translate('extBridgeDown', 'ru'));

    read.mockRejectedValueOnce(new TypeError('boom'));
    const odd = await prepareRun(input()).catch((e: unknown) => e);
    expect((odd as ApiError).message).toBe(translate('extBridgeDown', 'en'));
  });

  it('lets a cancellation through unchanged, so the loop treats it as a cancel', async () => {
    const cancelled = new ApiError('Request cancelled', { kind: 'cancelled', code: 'ERR_CANCELED' });
    read.mockRejectedValue(cancelled);
    await expect(prepareRun(input())).rejects.toBe(cancelled);
  });
});

describe('sessionFailure', () => {
  it('says the connection was lost, not that the panel is outside the cabinet', () => {
    const closed = new ApiError('x', { kind: 'unconfigured', code: 'BRIDGE_CLOSED' });
    const failure = sessionFailure(closed, 'en');
    expect(failure.message).toBe(translate('extBridgeLost', 'en'));
    expect(failure.kind).toBe('client');
  });

  it('keeps a cancellation and rewords everything else', () => {
    const cancelled = new ApiError('x', { kind: 'cancelled' });
    expect(sessionFailure(cancelled, 'en')).toBe(cancelled);
    expect(sessionFailure('nope', 'uz').message).toBe(translate('extBridgeDown', 'uz'));
  });
});

describe('createExtensionHost', () => {
  it('wires the extension toolkit, the settings opener and the starter questions', () => {
    const openSettings = vi.fn();
    const host = createExtensionHost({ openSettings });
    expect(host.toolkit).toBe(EXTENSION_TOOLKIT);
    expect(host.suggestions).toBe(EXTENSION_SUGGESTIONS);
    expect(host.pins).toBeUndefined();
    host.openSettings();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('queues the question of a copilot.ask action, as the site does', () => {
    useChatStore.setState({ queued: null });
    const host = createExtensionHost({ openSettings: vi.fn() });
    const definition = host.toolkit.actions.get('copilot.ask');
    expect(definition).toBeDefined();
    host.runAction({ actionId: 'copilot.ask', definition: definition!, params: { question: ' Nega? ' } });
    expect(useChatStore.getState().queued).toBe('Nega?');
  });

  it('ignores an unknown id and an unusable question', () => {
    useChatStore.setState({ queued: null });
    const host = createExtensionHost({ openSettings: vi.fn() });
    const definition = host.toolkit.actions.get('copilot.ask')!;
    host.runAction({ actionId: 'product.price' as never, definition, params: { question: 'x' } });
    host.runAction({ actionId: 'copilot.ask', definition, params: {} });
    host.runAction({ actionId: 'copilot.ask', definition, params: { question: '   ' } });
    host.runAction({ actionId: 'copilot.ask', definition, params: { question: 7 } });
    expect(useChatStore.getState().queued).toBeNull();
  });

  it('offers starter questions in all three languages, three of them', () => {
    expect(EXTENSION_SUGGESTIONS).toEqual(['extQStockList', 'extQOutOfStock', 'extQReturns']);
    for (const key of EXTENSION_SUGGESTIONS) {
      for (const language of ['en', 'ru', 'uz'] as const) {
        expect(translate(key, language).trim()).not.toBe('');
      }
    }
  });
});
