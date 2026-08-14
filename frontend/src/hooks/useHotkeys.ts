import { useEffect } from 'react';

type Handler = (event: KeyboardEvent) => void;

interface Hotkey {
  /** Lowercase `event.key`, e.g. "k". */
  readonly key: string;
  /** ⌘ on macOS, Ctrl elsewhere — matched as "either". */
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly handler: Handler;
}

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return EDITABLE.has(target.tagName) || target.isContentEditable;
}

/**
 * Global shortcuts.
 *
 * Modifier-less keys are ignored while the user is typing so a search field
 * never swallows a character into a navigation command; ⌘-combinations still
 * fire, which is what makes ⌘K work from inside the palette's own input.
 */
export function useHotkeys(hotkeys: readonly Hotkey[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const usesMeta = event.metaKey || event.ctrlKey;

      for (const hotkey of hotkeys) {
        if (event.key.toLowerCase() !== hotkey.key) continue;
        if ((hotkey.meta ?? false) !== usesMeta) continue;
        if ((hotkey.shift ?? false) !== event.shiftKey) continue;
        if (!(hotkey.meta ?? false) && isTypingTarget(event.target)) continue;

        event.preventDefault();
        hotkey.handler(event);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkeys]);
}
