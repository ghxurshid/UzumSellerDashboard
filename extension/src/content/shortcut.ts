/** The site's own shortcut for the Copilot: Ctrl+J, or Cmd+J on macOS. */
export interface KeyLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Exactly one of Ctrl/Cmd, no Shift or Alt: Ctrl+Shift+J is the browser's
 * console and must stay the browser's. The physical key is accepted too so the
 * shortcut also works on a Cyrillic layout, where `key` is not "j".
 */
export function isToggleShortcut(e: KeyLike): boolean {
  if (e.ctrlKey === e.metaKey) return false;
  if (e.shiftKey || e.altKey) return false;
  return e.key.toLowerCase() === 'j' || e.code === 'KeyJ';
}
