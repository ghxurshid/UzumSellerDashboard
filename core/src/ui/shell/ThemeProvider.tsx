import { useEffect, type ReactNode } from 'react';

import { applyTheme, useResolvedTheme } from './theme';

/**
 * Applies the theme to `<html data-theme>`.
 *
 * "system" is resolved here rather than in CSS so a single attribute drives the
 * whole token graph — the design's `[data-app][data-theme]` selectors have no
 * media-query branch, and duplicating one would let the two drift.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const resolved = useResolvedTheme();

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  return children;
}
