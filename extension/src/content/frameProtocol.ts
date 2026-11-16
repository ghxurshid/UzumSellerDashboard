/**
 * Validation of what the panel sends the frame. The port is private, but the
 * panel is a page of rich, model-driven UI: its messages are checked by shape
 * before they move anything, like every other border in the project.
 */
import {
  FRAME_CLOSE,
  FRAME_TOGGLE,
  type FrameLanguage,
  type FrameTheme,
  PANEL_PREFS,
  type PanelPrefs,
  type PanelToFrameMessage,
} from './frameMessages';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTheme(value: unknown): value is FrameTheme {
  return value === 'dark' || value === 'light';
}

export function isLanguage(value: unknown): value is FrameLanguage {
  return value === 'uz' || value === 'ru' || value === 'en';
}

/** A complete, well-typed prefs object, or null. Extra fields are dropped. */
export function parsePrefs(value: unknown): PanelPrefs | null {
  if (!isRecord(value)) return null;
  const { theme, language } = value;
  return isTheme(theme) && isLanguage(language) ? { theme, language } : null;
}

/** The message if it is one the frame understands, otherwise null (unknown types are ignored). */
export function parsePanelMessage(message: {
  type: string;
  payload?: unknown;
}): PanelToFrameMessage | null {
  if (!isRecord(message) || typeof message.type !== 'string') return null;
  switch (message.type) {
    case FRAME_CLOSE:
      return { type: FRAME_CLOSE };
    case FRAME_TOGGLE:
      return { type: FRAME_TOGGLE };
    case PANEL_PREFS: {
      const prefs = parsePrefs(message.payload);
      return prefs ? { type: PANEL_PREFS, payload: prefs } : null;
    }
    default:
      return null;
  }
}
