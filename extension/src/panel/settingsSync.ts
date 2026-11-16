/**
 * Keeps this panel's settings snapshot current while other cabinet tabs run
 * their own panels against the same storage.
 *
 * Each panel holds a snapshot and saves by rewriting the whole slot, so a stale
 * panel saving any field would erase an API key typed in another tab. The cure
 * is to re-read before that can happen: `refreshSettings()` (which never writes,
 * and is a no-op on an echo of this panel's own write) runs when storage reports
 * the settings slot changed — as a signal only, the payload is not trusted — and
 * when this panel's document becomes visible or its window gains focus, which
 * are the moments a seller returns to it.
 */
import { CORE_KV_KEYS } from '@core/storage/kv';

export interface SettingsSyncDeps {
  readonly onKvChanged: (listener: (key: string) => void) => () => void;
  readonly refresh: () => Promise<boolean>;
  readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
}

/** Returns the teardown. */
export function wireSettingsRefresh(deps: SettingsSyncDeps): () => void {
  const refresh = (): void => {
    /* A failed re-read leaves the current snapshot; the next signal tries again. */
    void deps.refresh().catch(() => undefined);
  };
  const stopKv = deps.onKvChanged((key) => {
    if (key === CORE_KV_KEYS.settings) refresh();
  });
  const onVisibility = (): void => {
    if (deps.doc.visibilityState === 'visible') refresh();
  };
  deps.win.addEventListener('focus', refresh);
  deps.doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    stopKv();
    deps.win.removeEventListener('focus', refresh);
    deps.doc.removeEventListener('visibilitychange', onVisibility);
  };
}
