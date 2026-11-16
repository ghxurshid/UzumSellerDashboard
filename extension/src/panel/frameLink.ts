/**
 * What the frame has told the panel, as a value React can read.
 *
 * The frame says `frame.visibility` on every change and once when the panel
 * connects. That first message can land before the app has mounted, so the
 * listener is attached at startup (`startFrameLink`), outside React, and the
 * components read the result through `useFrameLink` — a component that
 * subscribed in an effect would miss exactly the message it most needs.
 *
 * Two counters rather than one flag because the consumers want events, not a
 * level: `signals` ticks on every visibility message (the panel re-sends its
 * preferences, since the connect message is also its cue that the frame is
 * listening), `opens` ticks each time the frame is shown (refresh the cabinet
 * state, focus the composer).
 */
import { useSyncExternalStore } from 'react';

import { onFrameMessage } from '@ext/uzum/client';

import { parseVisibility } from './frame';

export interface FrameLinkState {
  /** Whether the frame is showing. Assumed so until told otherwise: the panel is only loaded when it is opened. */
  readonly open: boolean;
  readonly signals: number;
  readonly opens: number;
}

const INITIAL: FrameLinkState = { open: true, signals: 0, opens: 0 };

let state: FrameLinkState = INITIAL;
const listeners = new Set<() => void>();

/** Folds one validated visibility message into the state. */
export function applyVisibility(previous: FrameLinkState, open: boolean): FrameLinkState {
  return {
    open,
    signals: previous.signals + 1,
    opens: open ? previous.opens + 1 : previous.opens,
  };
}

/** Once, at startup. Returns the unsubscribe. */
export function startFrameLink(): () => void {
  return onFrameMessage((message) => {
    const open = parseVisibility(message);
    if (open === null) return;
    state = applyVisibility(state, open);
    for (const listener of [...listeners]) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFrameLink(): FrameLinkState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}
