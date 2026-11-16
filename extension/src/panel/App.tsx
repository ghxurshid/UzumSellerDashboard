import { Settings2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';

import { useTranslation } from '@core/i18n/useTranslation';
import { useResolvedTheme } from '@core/ui/shell/theme';
import { CopilotPanel } from '@core/ui/chat/CopilotPanel';
import { IconButton } from '@core/ui/kit/IconButton';
import { Toaster } from '@core/ui/kit/Toaster';
import { sendToFrame } from '@ext/uzum/client';

import { CabinetNotice } from './CabinetNotice';
import { createExtensionHost } from './copilotHost';
import { closeMessage, prefsMessage, toggleMessage } from './frame';
import { useFrameLink } from './frameLink';
import { SettingsView } from './SettingsView';
import { useCabinetStatus } from './useCabinetStatus';
import { escapeAction, isToggleKey, OPEN_LAYER_SELECTOR } from './shortcuts';
import { INITIAL_VIEW, reduceView } from './view';

/**
 * The panel: one always-mounted chat and a settings view that replaces it.
 *
 * The chat stays mounted while settings are open (`open={false}` draws nothing
 * but keeps the component), so an answer that is streaming keeps streaming and
 * its transcript is there on return. Everything the shared panel may not know —
 * the cabinet session, how to reach settings, the frame around it — is wired
 * here.
 */
export function App(): ReactNode {
  const { t, language } = useTranslation();
  const theme = useResolvedTheme();
  const frame = useFrameLink();
  const [view, dispatch] = useReducer(reduceView, INITIAL_VIEW);
  const { status, recheck } = useCabinetStatus(frame.opens);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /* The key handler is attached once; it reads the view through a ref instead of
     being torn down and re-attached on every change. */
  const viewRef = useRef(view.view);
  useEffect(() => {
    viewRef.current = view.view;
  }, [view.view]);

  /* `host.openSettings` is how the "not configured" banner reaches the AI key. */
  const host = useMemo(
    () => createExtensionHost({ openSettings: () => dispatch({ type: 'openSettings', tab: 'ai' }) }),
    [],
  );

  /* The seller's language is the document's, for screen readers and hyphenation. */
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  /* The launcher and frame chrome follow the seller's choice. `signals` is in the
     list because the frame's connect message is also the first moment it is
     listening — anything sent before that went nowhere. */
  useEffect(() => {
    sendToFrame(prefsMessage(theme, language));
  }, [theme, language, frame.signals]);

  /* Shown again: the composer is where a returning seller wants to type. After a
     frame so the iframe is laid out and can take focus. */
  useEffect(() => {
    if (frame.opens === 0) return;
    const id = requestAnimationFrame(() => {
      if (viewRef.current === 'chat') composerRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [frame.opens]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      /* The page cannot see this key while focus is inside the iframe. */
      if (isToggleKey(event)) {
        event.preventDefault();
        sendToFrame(toggleMessage());
        return;
      }
      const action = escapeAction({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        layerOpen: document.querySelector(OPEN_LAYER_SELECTOR) !== null,
        view: viewRef.current,
      });
      if (action === 'ignore') return;
      event.preventDefault();
      if (action === 'back') dispatch({ type: 'back' });
      else sendToFrame(closeMessage());
    };
    /* Bubble phase: a Radix layer or a menu handles Escape in the capture phase
       and marks it prevented, which is how it keeps its own Escape. */
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const close = useCallback(() => sendToFrame(closeMessage()), []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-chrome text-text">
      <main className="relative flex min-h-0 flex-1 flex-col">
        <CopilotPanel
          host={host}
          layout="fill"
          open={view.view === 'chat'}
          onClose={close}
          composerRef={composerRef}
          notice={<CabinetNotice status={status} onRecheck={recheck} />}
          headerActions={
            <IconButton
              label={t('settings')}
              size="md"
              className="md:size-22 md:rounded-5"
              onClick={() => dispatch({ type: 'openSettings' })}
            >
              <Settings2 aria-hidden className="size-14 md:size-12" />
            </IconButton>
          }
        />
        {view.view === 'settings' && (
          <SettingsView
            tab={view.tab}
            onTab={(tab) => dispatch({ type: 'selectTab', tab })}
            onBack={() => dispatch({ type: 'back' })}
          />
        )}
      </main>
      <Toaster />
    </div>
  );
}
