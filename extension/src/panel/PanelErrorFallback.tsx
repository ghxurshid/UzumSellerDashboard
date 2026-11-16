import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { translate } from '@core/i18n/dictionary';
import { usePreferencesStore } from '@core/state/preferences.store';
import type { Language } from '@core/types/common';
import { Button } from '@core/ui/kit/Button';

/** The seller's language if the store can still say it; never a second throw while reporting the first. */
function languageNow(): Language {
  try {
    return usePreferencesStore.getState().language;
  } catch {
    return 'en';
  }
}

/**
 * What the frame shows when the app threw while rendering: a sentence, the
 * technical message for a bug report, and a reload — never a blank frame.
 * Reloading the panel is safe: nothing the Copilot does writes to the shop.
 */
export function PanelErrorFallback({ error }: { readonly error: Error }): ReactNode {
  const language = languageNow();
  return (
    <div role="alert" className="flex h-full items-center justify-center bg-chrome p-20 text-text">
      <div className="flex max-w-320 flex-col items-start gap-11">
        <span className="flex size-36 items-center justify-center rounded-10 border border-neg-line bg-neg-soft text-neg">
          <TriangleAlert aria-hidden className="size-18" />
        </span>
        <h1 className="m-0 text-lg font-medium">{translate('extErrTitle', language)}</h1>
        <p className="m-0 text-xs-plus leading-[1.6] text-dim">{translate('extErrBody', language)}</p>
        <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
          {translate('extReload', language)}
        </Button>
        <p className="m-0 w-full break-words border-t border-line pt-9 font-mono text-mini text-faint">
          {error.message}
        </p>
      </div>
    </div>
  );
}
