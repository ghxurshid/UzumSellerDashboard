import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '@core/ui/shell/ErrorBoundary';
import { ThemeProvider } from '@core/ui/shell/ThemeProvider';

import { App } from './App';
import { bootstrapPanel } from './bootstrap';
import { BridgeGate } from './BridgeGate';
import { isGated } from './gate';
import { PanelErrorFallback } from './PanelErrorFallback';

import './fonts.css';
import './panel.css';

const container = document.getElementById('root');
if (container === null) throw new Error('#root is missing from panel.html');

/**
 * Mounted only after storage has been read — see `bootstrap.ts`. If startup
 * itself failed in a way nobody planned for, the panel still renders: a frame
 * with default settings and a visible reason beats a blank one.
 *
 * `bootstrapPanel()` is called here, during module evaluation, and installs the
 * bridge's `message` listener before its first await. The page side posts the
 * handshake on the iframe's `load` event, which cannot fire before this module
 * script has finished evaluating, so the listener is guaranteed to exist.
 *
 * The app itself sits behind `BridgeGate`: inside an installed extension it is
 * shown only after a verified handshake; a failed startup (`startup` undefined)
 * is gated too, since nothing says it is a dev build.
 */
void bootstrapPanel()
  .catch((error: unknown) => {
    console.error('Panel startup failed', error);
  })
  .then((startup) => {
    for (const failure of startup?.failures ?? []) console.warn(failure);
    createRoot(container).render(
      <StrictMode>
        <ErrorBoundary fallback={(error) => <PanelErrorFallback error={error} />}>
          <ThemeProvider>
            {startup !== undefined && !isGated(startup.storage) ? (
              <App />
            ) : (
              <BridgeGate>
                <App />
              </BridgeGate>
            )}
          </ThemeProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  });
