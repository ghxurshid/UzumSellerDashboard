/**
 * The messages the Copilot frame (content script) and the panel exchange over
 * the private `FrameBridge` port, as `{ type, payload }` application messages.
 *
 * Types and string constants only, so the panel can import this file without
 * pulling any runtime. The content script validates every incoming message
 * (`frameProtocol.ts`); the panel must do the same for what it receives.
 *
 *   panel -> frame   frame.close, frame.toggle, panel.prefs
 *   frame -> panel   frame.visibility
 */

export const FRAME_CLOSE = 'frame.close';
export const FRAME_TOGGLE = 'frame.toggle';
export const PANEL_PREFS = 'panel.prefs';
export const FRAME_VISIBILITY = 'frame.visibility';

export type FrameTheme = 'dark' | 'light';
export type FrameLanguage = 'uz' | 'ru' | 'en';

export interface PanelPrefs {
  readonly theme: FrameTheme;
  readonly language: FrameLanguage;
}

/** Panel asks the page side to close the frame (its own close button, Escape). */
export interface FrameCloseMessage {
  readonly type: typeof FRAME_CLOSE;
}

/** The shortcut was pressed while focus is inside the panel, where the page cannot see it. */
export interface FrameToggleMessage {
  readonly type: typeof FRAME_TOGGLE;
}

/** The seller's current choices, so the launcher and frame chrome follow them. */
export interface PanelPrefsMessage {
  readonly type: typeof PANEL_PREFS;
  readonly payload: PanelPrefs;
}

/** Sent after every visibility change, and once when the panel connects. */
export interface FrameVisibilityMessage {
  readonly type: typeof FRAME_VISIBILITY;
  readonly payload: { readonly open: boolean };
}

export type PanelToFrameMessage = FrameCloseMessage | FrameToggleMessage | PanelPrefsMessage;
export type FrameToPanelMessage = FrameVisibilityMessage;
