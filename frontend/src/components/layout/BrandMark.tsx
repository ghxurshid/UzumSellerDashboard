import type { ReactNode } from 'react';

/**
 * The hexagon brand mark — an accent gradient tile with a hairline accent
 * border, drawn inline so it inherits the theme's accent in both palettes.
 */
export function BrandMark({ size = 19 }: { readonly size?: number }): ReactNode {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.58 }}
      className="flex shrink-0 items-center justify-center rounded-5 border border-acc-line bg-linear-[140deg,var(--s-acc),transparent_130%] text-white"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="size-[0.62em]">
        <path d="M8 0.8 14.2 4.4v7.2L8 15.2 1.8 11.6V4.4z" />
      </svg>
    </span>
  );
}
