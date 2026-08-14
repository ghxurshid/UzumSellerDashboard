import { useEffect, type ReactNode } from 'react';

import { usePreferencesStore } from '@/store/preferences.store';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies the theme to `<html data-theme>`.
 *
 * "system" is resolved here rather than in CSS so a single attribute drives the
 * whole token graph — the design's `[data-app][data-theme]` selectors have no
 * media-query branch, and duplicating one would let the two drift.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const theme = usePreferencesStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;

    const apply = (): void => {
      const resolved =
        theme === 'system'
          ? window.matchMedia(DARK_QUERY).matches
            ? 'dark'
            : 'light'
          : theme;
      root.dataset['theme'] = resolved;
    };

    apply();

    if (theme !== 'system') return;

    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return children;
}
