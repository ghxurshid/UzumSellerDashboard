/**
 * What the frame remembers between page loads, in `chrome.storage.local` under
 * the `savdo.ui.` prefix (the panel's own state shares the area under other
 * prefixes).
 *
 * Storage is a convenience here, never a dependency: every call resolves to a
 * default instead of throwing, so a missing API or a failed read cannot break
 * the launcher. The one failure that is reported is a dead extension context
 * (the extension was reloaded under an open tab), because the caller must then
 * tear the UI down.
 *
 * The area is resolved on every call, `browser` first (Firefox's promise API),
 * then `chrome` — the same order as the panel's storage module.
 */
import type { PanelPrefs } from './frameMessages';
import { parsePrefs } from './frameProtocol';

export const UI_OPEN_KEY = 'savdo.ui.open';
export const UI_PREFS_KEY = 'savdo.ui.prefs';

export interface UiStorageArea {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface Namespace {
  storage?: { local?: UiStorageArea };
}

export function isContextInvalidated(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /extension context invalidated/i.test(text);
}

/** `browser.storage.local` when present, otherwise `chrome.storage.local`; null if neither. */
export function defaultStorageArea(): UiStorageArea | null {
  const g = globalThis as unknown as { browser?: Namespace; chrome?: Namespace };
  return g.browser?.storage?.local ?? g.chrome?.storage?.local ?? null;
}

export interface UiStorage {
  loadOpen(): Promise<boolean>;
  saveOpen(open: boolean): Promise<void>;
  loadPrefs(): Promise<PanelPrefs | null>;
  savePrefs(prefs: PanelPrefs): Promise<void>;
}

export function createUiStorage(
  resolve: () => UiStorageArea | null,
  onInvalidated: () => void,
): UiStorage {
  async function read(key: string): Promise<unknown> {
    try {
      const area = resolve();
      if (!area) return undefined;
      return (await area.get(key))?.[key];
    } catch (error) {
      if (isContextInvalidated(error)) onInvalidated();
      return undefined;
    }
  }

  async function write(key: string, value: unknown): Promise<void> {
    try {
      await resolve()?.set({ [key]: value });
    } catch (error) {
      if (isContextInvalidated(error)) onInvalidated();
    }
  }

  return {
    async loadOpen() {
      return (await read(UI_OPEN_KEY)) === true;
    },
    saveOpen: (open) => write(UI_OPEN_KEY, open),
    async loadPrefs() {
      return parsePrefs(await read(UI_PREFS_KEY));
    },
    savePrefs: (prefs) => write(UI_PREFS_KEY, prefs),
  };
}
