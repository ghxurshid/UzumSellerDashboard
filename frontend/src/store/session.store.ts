import { create } from 'zustand';

import type { NetworkState, SessionState } from '@/types/domain';

/**
 * Connectivity and authorisation, as observed — never as configured.
 *
 * There is no login screen: the Uzum seller token *is* the session, and it is
 * held in Settings. What this store tracks is what the network actually did.
 *
 *   • `network`  — the browser's online flag, corrected by real request
 *                  outcomes. A laptop can be "online" and still unable to
 *                  reach Uzum, and that reads as offline to the user.
 *   • `session`  — `expired` only after the API answered 401 with the token
 *                  we hold. Saving a new token clears it.
 *   • `deniedAt` — the last 403, so a screen the account may not read renders
 *                  `forbidden` instead of an empty table.
 *
 * Nothing here is settable from the UI for demonstration purposes; every
 * transition is caused by a real event.
 */
interface SessionState_ {
  readonly session: SessionState;
  readonly network: NetworkState;
  /** When the API last answered 403, in epoch ms. */
  readonly deniedAt: number | null;
  /** When the API last answered successfully, in epoch ms. */
  readonly lastContactAt: number | null;
  /** When the token was last rejected, in epoch ms. */
  readonly unauthorizedAt: number | null;

  markUnauthorized: () => void;
  markForbidden: () => void;
  markUnreachable: () => void;
  markReachable: () => void;
  /** A new token was saved — give it a clean slate to prove itself against. */
  resetAuthorization: () => void;
  setBrowserOnline: (online: boolean) => void;
}

const browserOnline = (): NetworkState =>
  typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline';

export const useSessionStore = create<SessionState_>()((set, get) => ({
  session: 'ok',
  network: browserOnline(),
  deniedAt: null,
  lastContactAt: null,
  unauthorizedAt: null,

  markUnauthorized: () => set({ session: 'expired', unauthorizedAt: Date.now() }),
  markForbidden: () => set({ deniedAt: Date.now() }),

  markUnreachable: () => {
    if (get().network !== 'offline') set({ network: 'offline' });
  },

  markReachable: () => {
    const state = get();
    /* A successful call is proof of both reachability and a valid token. */
    set({
      lastContactAt: Date.now(),
      ...(state.network !== 'online' ? { network: 'online' as const } : {}),
      ...(state.session !== 'ok' ? { session: 'ok' as const } : {}),
    });
  },

  resetAuthorization: () => set({ session: 'ok', unauthorizedAt: null, deniedAt: null }),

  setBrowserOnline: (online) => {
    if (online) {
      /* The browser regaining a link is not proof Uzum is reachable — let the
         next real request decide. Only the pessimistic direction is trusted. */
      if (get().network === 'offline') set({ network: 'online' });
      return;
    }
    set({ network: 'offline' });
  },
}));

/** Subscribe to the browser's own connectivity events, once, at startup. */
export function watchBrowserConnectivity(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const online = (): void => useSessionStore.getState().setBrowserOnline(true);
  const offline = (): void => useSessionStore.getState().setBrowserOnline(false);

  window.addEventListener('online', online);
  window.addEventListener('offline', offline);

  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
}
