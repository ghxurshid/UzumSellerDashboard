/**
 * The frame's open/closed state as a pure reducer, so the rules are testable
 * without a DOM.
 *
 * `mounted` turns true on the first open and never back: the iframe is created
 * then and stays in the page, hidden, so a conversation outlives closing the
 * frame. `restore` is the remembered state arriving from storage; it must lose
 * to anything the seller did while the read was in flight.
 */
export interface FrameState {
  readonly open: boolean;
  readonly mounted: boolean;
  readonly touched: boolean;
}

export type FrameAction =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'toggle' }
  | { readonly type: 'restore'; readonly open: boolean };

export const INITIAL_FRAME_STATE: FrameState = { open: false, mounted: false, touched: false };

function withOpen(state: FrameState, open: boolean, touched: boolean): FrameState {
  return { open, mounted: state.mounted || open, touched: state.touched || touched };
}

export function reduceFrame(state: FrameState, action: FrameAction): FrameState {
  switch (action.type) {
    case 'open':
      return withOpen(state, true, true);
    case 'close':
      return withOpen(state, false, true);
    case 'toggle':
      return withOpen(state, !state.open, true);
    case 'restore':
      return state.touched ? state : withOpen(state, action.open, false);
  }
}
