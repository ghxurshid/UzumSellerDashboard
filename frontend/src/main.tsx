import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { bootstrap } from '@/app/bootstrap';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { router } from '@/app/routes/router';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { RootErrorFallback } from '@/app/RootErrorFallback';
import { notify } from '@/store/notifications.store';
import { watchBrowserConnectivity } from '@/store/session.store';

import './styles/globals.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Root container #root is missing from index.html');

/* Connectivity is a real signal, so it is listened for from startup rather
   than discovered the first time a request fails. */
watchBrowserConnectivity();

/**
 * Storage is opened, imported and read *before* the first render.
 *
 * The alternative — mount immediately and fill in from an effect — would paint
 * an application with no token, default settings and an empty archive, then
 * replace it a frame later. That is a flash of wrong content, not a loading
 * state, and it would be visible on every single startup.
 *
 * `bootstrap()` does not reject. A browser that cannot provide IndexedDB gets a
 * degraded in-memory session and a notification saying so, which is a better
 * outcome than a blank screen and strictly better than pretending the session
 * will be saved.
 */
void bootstrap().then((report) => {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary fallback={(error, reset) => <RootErrorFallback error={error} onReset={reset} />}>
        <ThemeProvider>
          <QueryProvider>
            <RouterProvider router={router} />
          </QueryProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

  /* Raised after mounting, so the notification store has a bell to appear in. */
  if (!report.storage) {
    notify('Local storage is unavailable — this session will not be saved', {
      icon: 'triangle-alert',
      tone: 'negative',
      dedupeKey: 'storage-unavailable',
    });
    return;
  }

  if (report.migrated) {
    notify(
      `Local archive upgraded — ${report.migratedRows.toLocaleString()} rows across ${report.migratedShops} store(s)`,
      { icon: 'database', tone: 'positive', dedupeKey: 'storage-migrated' },
    );
  }

  for (const failure of report.failures) {
    notify(failure, { icon: 'triangle-alert', tone: 'warning', dedupeKey: 'storage-failure' });
  }
});
