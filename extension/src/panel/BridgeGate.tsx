import { useEffect, useReducer, type ReactNode } from 'react';

import { useTranslation } from '@core/i18n/useTranslation';
import { Button } from '@core/ui/kit/Button';
import { onBridgeConnected, whenBridgeConnected } from '@ext/uzum/client';

import { reduceGate } from './gate';

/**
 * Renders `children` (the app) only once the content script's verified handshake
 * has been accepted. Until then: the themed background and nothing to click.
 * After the wait runs out: one sentence and a Reload that only reloads this
 * document — harmless in a hostile frame, and in the real frame the content
 * script sees an unexpected load and starts a fresh, registered one. A handshake
 * that arrives late still turns the view into the app.
 */
export function BridgeGate({ children }: { readonly children: ReactNode }): ReactNode {
  const { t } = useTranslation();
  const [phase, send] = useReducer(reduceGate, 'waiting');

  useEffect(() => {
    const abort = new AbortController();
    const off = onBridgeConnected(() => send('connected'));
    whenBridgeConnected(abort.signal).then(
      (ok) => send(ok ? 'connected' : 'timedOut'),
      () => undefined, // aborted on unmount
    );
    return () => {
      off();
      abort.abort();
    };
  }, []);

  if (phase === 'connected') return children;

  return (
    <div className="flex h-full items-center justify-center bg-chrome p-20 text-text">
      {phase === 'failed' && (
        <div role="alert" className="flex max-w-320 flex-col items-start gap-11">
          <p className="m-0 text-xs-plus leading-[1.6] text-dim">{t('extNotConnected')}</p>
          <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
            {t('extReload')}
          </Button>
        </div>
      )}
    </div>
  );
}
