import type { Tone } from '@core/types/common';

/**
 * A tone, as the two things a block paints with it.
 *
 * Every block that takes a `tone` means the same five things by it, so the
 * class a tone becomes is written once. Full class names rather than a template
 * string: Tailwind's scanner reads this file's literal text, and a name it
 * cannot find whole is a utility it never generates.
 *
 * Kept apart from the components that use them because a module that exports a
 * component cannot also export a constant without losing fast refresh.
 */

/** Ink: a figure, a paragraph, a change. */
export const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-pos',
  negative: 'text-neg',
  warning: 'text-warn',
  accent: 'text-acc-dim',
  neutral: 'text-dim',
};

/** Fill: the bar of a chart, a progress row, a ranking. */
export const TONE_BG: Record<Tone, string> = {
  positive: 'bg-pos',
  negative: 'bg-neg',
  warning: 'bg-warn',
  accent: 'bg-acc',
  neutral: 'bg-dim',
};
