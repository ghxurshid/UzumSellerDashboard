import { useSyncExternalStore } from 'react';

import { usePreferencesStore } from '@core/state/preferences.store';
import type { ThemeMode } from '@core/types/common';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export type ResolvedTheme = 'dark' | 'light';

/** "system" settled into one of the two themes the token graph has. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * Writes the resolved theme to `<html data-theme>`.
 *
 * A function of its own so a host can call it before the first render: the
 * attribute is what `theme.css` keys both the colours and `color-scheme` on,
 * and an effect runs a frame too late to stop a light theme painting dark first.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = resolved;
}

/** Reads the preference and the system setting at this moment. */
export function currentResolvedTheme(): ResolvedTheme {
  return resolveTheme(
    usePreferencesStore.getState().theme,
    window.matchMedia(DARK_QUERY).matches,
  );
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * The theme the screen is actually showing, as a value a component can react
 * to — a host that has to tell something outside the page (the extension tells
 * its frame) needs the resolved colour, not the "system" the seller picked.
 */
export function useResolvedTheme(): ResolvedTheme {
  const mode = usePreferencesStore((state) => state.theme);
  const systemDark = useSyncExternalStore(
    subscribeToSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => true,
  );
  return resolveTheme(mode, systemDark);
}
