import type { Shortcut } from '@core/ui/settings/KeyboardSettings';

/** Every shortcut the site binds, in the order a new user meets them. */
export const SITE_SHORTCUTS: readonly Shortcut[] = [
  { keys: ['⌘', 'K'], labelKey: 'palPh' },
  { keys: ['⌘', 'J'], labelKey: 'askCopilot' },
  { keys: ['↑', '↓'], labelKey: 'palNav' },
  { keys: ['↵'], labelKey: 'palOpen' },
  { keys: ['Esc'], labelKey: 'mClose' },
  { keys: ['Tab'], labelKey: 'gGo' },
  { keys: ['Space'], labelKey: 'selectedL' },
  { keys: ['⇧', 'F10'], labelKey: 'gAct' },
];
