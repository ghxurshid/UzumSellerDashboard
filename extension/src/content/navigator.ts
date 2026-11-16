/**
 * Starting a frame load, in the one order that works: mint a nonce, record it
 * in extension storage, and only then give the frame a URL. The panel refuses a
 * handshake whose nonce is not on record, so a URL handed out before the record
 * resolves would race its own verification. The nonce is passed to `commit` for
 * the later `attachBridge` only; it is not part of the URL.
 *
 * A later `navigate()` supersedes an earlier one still waiting on storage: only
 * the newest may commit, so two concurrent starts cannot leave the frame on a
 * nonce that was already replaced. The registrations of superseded starts are
 * left to expire on their own.
 */
import { buildFrameUrl } from './nonce';

export interface NavigatorDeps {
  readonly mintNonce: () => string;
  readonly register: (nonce: string) => Promise<void>;
  readonly panelUrl: () => string;
  /** Registration succeeded: give the frame this URL (and expect its `load`). */
  readonly commit: (url: string, nonce: string) => void;
  /** Registration failed; the frame was not loaded. */
  readonly fail: (error: unknown) => void;
  readonly isStopped: () => boolean;
}

export function createNavigator(deps: NavigatorDeps): { navigate(): Promise<void> } {
  let latest = 0;
  let reload = 0;

  return {
    async navigate() {
      const mine = ++latest;
      const nonce = deps.mintNonce();
      try {
        await deps.register(nonce);
      } catch (error) {
        if (mine === latest && !deps.isStopped()) deps.fail(error);
        return;
      }
      if (mine !== latest || deps.isStopped()) return;
      try {
        deps.commit(buildFrameUrl(deps.panelUrl(), reload++), nonce);
      } catch (error) {
        deps.fail(error);
      }
    },
  };
}
