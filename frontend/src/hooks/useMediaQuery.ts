import { useSyncExternalStore } from 'react';

/**
 * Viewport breakpoints, in px, matching `--breakpoint-*` in `globals.css`.
 *
 * They are exported as numbers because a few layout decisions cannot be made
 * in CSS — whether the icon rail renders at all, whether a drawer mounts as a
 * side panel or a sheet — and those have to read the same numbers the
 * stylesheet does, or the two will drift apart by a pixel and disagree at
 * exactly one width.
 */
export const BREAKPOINTS = {
  /** iPhone SE and the 320px floor sit below this. */
  xs: 375,
  sm: 425,
  /** The hinge: phone chrome below, desktop chrome at and above. */
  md: 768,
  lg: 1024,
} as const;

/**
 * `matchMedia`, as a subscription.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because the first
 * paint has to be right: a shell that renders the desktop rail and then swaps
 * to a bottom bar one frame later is a visible flash on every load, and on a
 * phone it is the *whole* layout that moves.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    /* No viewport during SSR/prerender: assume the desktop layout, which is
       the one the markup was authored against. */
    () => false,
  );
}

/** Phone: below the tablet breakpoint. Bottom bar, sheets, card rows. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`);
}

/** Tablet: the rail is back, but the side panels and insights rail are not. */
export function useIsTablet(): boolean {
  return useMediaQuery(
    `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg - 1}px)`,
  );
}

/**
 * A touch screen, which is a different question from a small one.
 *
 * A tablet in landscape is 1024px wide and still has no hover; a desktop
 * browser resized to 400px has a mouse. Hit-target sizing follows this, layout
 * follows the width.
 */
export function useIsTouch(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
