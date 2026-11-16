/**
 * The keys the panel binds, in one place.
 *
 * The Keyboard pane is drawn from `shortcutList`, and the handlers in the app
 * decide with `isToggleKey` / `escapeAction` from this same file, so a key
 * cannot be listed that nothing answers, nor answered that is not listed. Enter
 * and Shift+Enter belong to the shared composer in core and are listed because
 * the panel's composer is the shared one.
 *
 * The page cannot see keys while focus is inside the iframe, which is why the
 * toggle is bound here as well as by the content script. The matcher is the
 * content script's own, so both sides agree on what the shortcut is — including
 * that Ctrl+Shift+J stays the browser's console.
 */
import type { Shortcut } from '@core/ui/settings/KeyboardSettings';
import { isToggleShortcut, type KeyLike } from '@ext/content/shortcut';

import type { PanelView } from './view';

export const TOGGLE_KEY = 'J';
export const ESCAPE_KEY = 'Escape';

/** Whether this keydown is the Copilot toggle (Ctrl+J, or ⌘J on a Mac). */
export function isToggleKey(event: KeyLike): boolean {
  return isToggleShortcut(event);
}

/** Apple platforms write the modifier as ⌘; everything else as Ctrl. */
export function isApplePlatform(platform: string): boolean {
  return /^(mac|iphone|ipad|ipod)/i.test(platform);
}

export function shortcutList(apple: boolean): readonly Shortcut[] {
  return [
    { keys: [apple ? '⌘' : 'Ctrl', TOGGLE_KEY], labelKey: 'kbToggle' },
    { keys: ['↵'], labelKey: 'copilotSend' },
    { keys: ['⇧', '↵'], labelKey: 'kbNewLine' },
    { keys: ['Esc'], labelKey: 'kbEsc' },
  ];
}

export interface EscapeInput {
  readonly key: string;
  /** A component (a Radix layer, a menu) already took this Escape. */
  readonly defaultPrevented: boolean;
  /** An input method is composing text; Escape cancels the composition. */
  readonly isComposing: boolean;
  /** A dialog, menu or listbox is open in the document. */
  readonly layerOpen: boolean;
  readonly view: PanelView['view'];
}

/**
 * What Escape does. Anything inside the panel with a better claim keeps it: an
 * open select, menu or dialog closes itself first and the frame stays. From
 * settings it is one step back, from the chat it closes the frame.
 */
export function escapeAction(input: EscapeInput): 'close' | 'back' | 'ignore' {
  if (input.key !== ESCAPE_KEY) return 'ignore';
  if (input.defaultPrevented || input.isComposing || input.layerOpen) return 'ignore';
  return input.view === 'settings' ? 'back' : 'close';
}

/** Selector for the layers whose own Escape must win. */
export const OPEN_LAYER_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
