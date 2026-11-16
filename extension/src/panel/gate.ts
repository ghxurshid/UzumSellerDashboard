/**
 * Whether the interactive app may be shown yet.
 *
 * `panel.html` is web-accessible to the cabinet site, so a page script can frame
 * it. Such a frame never completes a verified handshake (the nonce is not on
 * record), and it must not be a surface over the seller's AI settings. Inside an
 * installed extension the app therefore renders only after a verified handshake;
 * until then the view is inert — nothing that changes state.
 *
 * Only a dev build served outside an extension (no extension storage at all)
 * skips the gate, so the panel can be worked on from the dev server.
 */
import type { PanelStartup } from './bootstrap';

/** `waiting`: themed background only. `failed`: the wait ran out. `connected`: the app. */
export type GatePhase = 'waiting' | 'failed' | 'connected';

export type GateEvent = 'connected' | 'timedOut';

export function isGated(storage: PanelStartup['storage']): boolean {
  return storage !== 'dev';
}

/** `connected` is final: a late timeout verdict must not take the app away again. */
export function reduceGate(phase: GatePhase, event: GateEvent): GatePhase {
  if (phase === 'connected') return phase;
  return event === 'connected' ? 'connected' : 'failed';
}
