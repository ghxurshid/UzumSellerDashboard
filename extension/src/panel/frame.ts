/**
 * The panel's half of the frame protocol: building what it sends and checking
 * what it receives. Pure, so the shapes can be tested without a port.
 *
 * The port is private, but the frame is another script's output and the panel
 * treats it like every other border: a message is acted on only if its shape is
 * exactly what `frameMessages.ts` says it is.
 */
import {
  FRAME_CLOSE,
  FRAME_TOGGLE,
  FRAME_VISIBILITY,
  PANEL_PREFS,
  type FrameLanguage,
  type FrameTheme,
} from '@ext/content/frameMessages';
import type { AppMessage } from '@ext/uzum/protocol';

export function closeMessage(): AppMessage {
  return { type: FRAME_CLOSE };
}

export function toggleMessage(): AppMessage {
  return { type: FRAME_TOGGLE };
}

export function prefsMessage(theme: FrameTheme, language: FrameLanguage): AppMessage {
  return { type: PANEL_PREFS, payload: { theme, language } };
}

/**
 * `true` / `false` for a well-formed `frame.visibility`, `null` for anything
 * else — another type, a missing payload, or an `open` that is not a boolean.
 */
export function parseVisibility(message: AppMessage): boolean | null {
  if (message.type !== FRAME_VISIBILITY) return null;
  const payload = message.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const open = (payload as { open?: unknown }).open;
  return typeof open === 'boolean' ? open : null;
}
