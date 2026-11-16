/**
 * The DOM half of the content script: two host elements, each with its own
 * closed shadow root — one for the launcher, one for the frame. The rules
 * (state, prefs, storage, shortcut, nonce, load tracking) live in the pure
 * sibling modules; this file only wires them to elements.
 *
 * ## Isolation
 *
 * The shadow roots are `closed`, so page scripts cannot reach the iframe or its
 * `contentWindow`. The nonce is not stored anywhere the page can read: it is not
 * in the iframe URL, an attribute, an id or a global; it exists only in this
 * closure, in extension storage, and in the handshake message.
 *
 * Why two hosts: `document.getAnimations()` reports running transitions across
 * shadow trees, and each reports its `effect.target`; from an element inside a
 * closed root, `getRootNode()` returns the root and the iframe is one query
 * away. So nothing inside a root is ever animated. The frame's fade runs on the
 * frame's *host* (set through CSSOM below), which the page already knows and
 * whose root it cannot read; the launcher has no transitions.
 *
 * The hosts' own properties are set through CSSOM with `!important` where a page
 * rule matching them (a `*` reset, say) would otherwise move them; CSSOM, unlike
 * `style=""` markup, is not subject to the cabinet's `style-src`.
 *
 * ## Lifetime
 *
 * The iframe is created on the first open and then only hidden, so the
 * conversation survives closing and the cabinet's client-side navigation. If
 * the extension is reloaded under an open tab, runtime and storage calls throw
 * "Extension context invalidated"; the first such failure removes everything
 * and stops, instead of leaving a dead launcher and a stream of console errors.
 *
 * "Attached" means the panel said so: after `attachBridge` the frame is trusted
 * only once `whenReady` confirms the panel accepted the handshake. A silence is
 * treated like a load nobody started (see `loadTracker.ts`).
 */
import { attachBridge, type FrameBridge, registerFrameNonce } from '../uzum/bridge.content';
import {
  FRAME_CLOSE,
  FRAME_TOGGLE,
  FRAME_VISIBILITY,
  PANEL_PREFS,
  type PanelPrefs,
} from './frameMessages';
import { parsePanelMessage } from './frameProtocol';
import {
  type FrameAction,
  type FrameState,
  INITIAL_FRAME_STATE,
  reduceFrame,
} from './frameState';
import { ACK_TIMEOUT_MS, createLoadTracker } from './loadTracker';
import { createNavigator } from './navigator';
import { createNonce } from './nonce';
import { resolvePrefs, stringsFor } from './prefs';
import { isToggleShortcut } from './shortcut';
import { FRAME_CSS, LAUNCHER_CSS, MOTION_MS } from './styles';
import {
  createUiStorage,
  defaultStorageArea,
  isContextInvalidated,
} from './uiStorage';

export const MARK_ATTRIBUTE = 'savdoCopilot';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface RuntimeLike {
  readonly id?: string;
  getURL(path: string): string;
}

/** `browser.runtime` first (Firefox), then `chrome.runtime`, like the storage lookup. */
function runtime(): RuntimeLike | null {
  const g = globalThis as unknown as {
    browser?: { runtime?: RuntimeLike };
    chrome?: { runtime?: RuntimeLike };
  };
  return g.browser?.runtime ?? g.chrome?.runtime ?? null;
}

function svgIcon(className: string, ...paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const TOP_Z_INDEX = '2147483647';

function setImportant(host: HTMLElement, rules: ReadonlyArray<readonly [string, string]>): void {
  for (const [name, value] of rules) host.style.setProperty(name, value, 'important');
}

/** The launcher's host is a zero-size anchor; the button is fixed inside it. */
function styleLauncherHost(host: HTMLElement): void {
  /* Order matters: `all` first, then the longhands it would otherwise reset. */
  setImportant(host, [
    ['all', 'initial'],
    ['position', 'fixed'],
    ['inset', '0'],
    ['width', '0'],
    ['height', '0'],
    ['overflow', 'visible'],
    ['pointer-events', 'none'],
    ['z-index', TOP_Z_INDEX],
    ['display', 'block'],
  ]);
}

/** The frame's host is the box itself; its size comes from `:host` rules (media queries). */
function styleFrameHost(host: HTMLElement): void {
  setImportant(host, [
    ['position', 'fixed'],
    ['margin', '0'],
    ['padding', '0'],
    ['z-index', TOP_Z_INDEX],
    ['display', 'block'],
  ]);
  host.style.setProperty('transform-origin', 'bottom right');
}

function attachRoot(host: HTMLElement, css: string): ShadowRoot {
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];
  return shadow;
}

export function mount(): void {
  const doc = document;
  if (doc.documentElement.dataset[MARK_ATTRIBUTE] === 'ready') return;
  doc.documentElement.dataset[MARK_ATTRIBUTE] = 'ready';

  const launcherHost = doc.createElement('savdo-copilot');
  styleLauncherHost(launcherHost);
  const launcherShadow = attachRoot(launcherHost, LAUNCHER_CSS);
  const frameHost = doc.createElement('savdo-copilot-frame');
  styleFrameHost(frameHost);
  const frameShadow = attachRoot(frameHost, FRAME_CSS);

  const root = doc.createElement('div');
  root.className = 'root';
  const launcher = doc.createElement('button');
  launcher.type = 'button';
  launcher.className = 'launcher';
  launcher.append(
    /* A speech bubble with a spark, and a cross; CSS swaps them. */
    svgIcon(
      'i-open',
      'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
      'M12 8.5v5M9.5 11h5',
    ),
    svgIcon('i-close', 'M6 6l12 12M18 6L6 18'),
  );
  root.append(launcher);
  launcherShadow.append(root);

  /* `frame` is the box inside the frame host: border, radius, the iframe, and the
     failure fallback. */
  const frame = doc.createElement('div');
  frame.className = 'root';
  const fallback = doc.createElement('div');
  fallback.className = 'fallback';
  const fallbackText = doc.createElement('p');
  fallbackText.setAttribute('role', 'status');
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.className = 'retry';
  fallback.append(fallbackText, retry);
  frame.append(fallback);
  frameShadow.append(frame);

  let state: FrameState = INITIAL_FRAME_STATE;
  let prefs: PanelPrefs = resolvePrefs(null, {
    languages: navigator.languages?.length ? navigator.languages : [navigator.language],
    prefersDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  });
  let prefsFromPanel = false;
  let lastSavedPrefs = '';
  let iframe: HTMLIFrameElement | null = null;
  let nonce = '';
  let bridge: FrameBridge | null = null;
  /* The seller opened the frame before the iframe existed; focus it once it does. */
  let wantFocus = false;
  const tracker = createLoadTracker();
  let started = false;
  let stopped = false;

  function teardown(): void {
    if (stopped) return;
    stopped = true;
    bridge?.dispose();
    bridge = null;
    window.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    launcherHost.remove();
    frameHost.remove();
    delete doc.documentElement.dataset[MARK_ATTRIBUTE];
  }

  /** Run something that touches extension APIs; a dead context stops the script quietly. */
  function guarded<T>(fn: () => T): T | undefined {
    try {
      if (!runtime()?.id) throw new Error('Extension context invalidated.');
      return fn();
    } catch (error) {
      if (isContextInvalidated(error)) teardown();
      return undefined;
    }
  }

  const storage = createUiStorage(defaultStorageArea, teardown);

  /* The fade runs on the frame host (see the header): `visibility` is delayed on
     close so the fade-out is seen, and immediate on open. Reduced motion: no fade. */
  function applyFrameVisibility(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const ms = reduce ? 0 : MOTION_MS;
    const s = frameHost.style;
    const fade = `opacity ${ms}ms ease, transform ${ms}ms ease`;
    if (state.open) {
      s.setProperty('transition', `${fade}, visibility 0s`);
      s.setProperty('visibility', 'visible');
      s.setProperty('opacity', '1');
      s.setProperty('transform', 'none');
    } else {
      s.setProperty('transition', `${fade}, visibility 0s linear ${ms}ms`);
      s.setProperty('visibility', 'hidden');
      s.setProperty('opacity', '0');
      s.setProperty('transform', 'translateY(12px) scale(0.98)');
    }
  }

  function applyChrome(): void {
    const strings = stringsFor(prefs.language);
    root.dataset.theme = prefs.theme;
    frame.dataset.theme = prefs.theme;
    root.dataset.open = String(state.open);
    applyFrameVisibility();
    const label = state.open ? strings.closeLabel : strings.openLabel;
    launcher.setAttribute('aria-label', label);
    launcher.title = label;
    launcher.setAttribute('aria-expanded', String(state.open));
    if (iframe) iframe.title = strings.frameTitle;
    fallbackText.textContent = strings.loadFailed;
    retry.textContent = strings.retry;
  }

  function applyPrefs(next: PanelPrefs): void {
    prefs = next;
    applyChrome();
  }

  function sendVisibility(): void {
    bridge?.send({ type: FRAME_VISIBILITY, payload: { open: state.open } });
  }

  function connect(): void {
    if (!iframe || stopped) return;
    bridge?.dispose();
    bridge = null;
    guarded(() => {
      if (!iframe) return;
      const attached = attachBridge(iframe, nonce);
      attached.onMessage((message) => {
        const parsed = parsePanelMessage(message);
        if (!parsed) return;
        if (parsed.type === FRAME_CLOSE) dispatch({ type: 'close' });
        else if (parsed.type === FRAME_TOGGLE) dispatch({ type: 'toggle' });
        else if (parsed.type === PANEL_PREFS) {
          prefsFromPanel = true;
          applyPrefs(parsed.payload);
          const serialized = JSON.stringify(parsed.payload);
          if (serialized !== lastSavedPrefs) {
            lastSavedPrefs = serialized;
            void storage.savePrefs(parsed.payload);
          }
        }
      });
      bridge = attached;
      sendVisibility();
      void attached.whenReady(ACK_TIMEOUT_MS).then((confirmed) => {
        if (stopped) return;
        /* False for a bridge we replaced or disposed says nothing about the frame. */
        const outcome = confirmed ? 'confirmed' : bridge === attached ? 'timeout' : 'disposed';
        onAck(tracker.onAck(Date.now(), outcome));
      });
    });
  }

  /* A frame that attached but never confirmed holds a document that is not the
     panel we started (a page navigated it away, or it never came up): same cure
     as a load nobody started — fresh registered nonce, full navigation — under
     the same bound. */
  function onAck(verdict: ReturnType<typeof tracker.onAck>): void {
    if (verdict === 'confirmed' || verdict === 'ignore') return;
    bridge?.dispose();
    bridge = null;
    if (verdict === 'unexpected') void loader.navigate();
    else showFailed();
  }

  function showFailed(): void {
    bridge?.dispose();
    bridge = null;
    frame.dataset.state = 'failed';
    if (wantFocus && state.open) {
      wantFocus = false;
      retry.focus();
    }
  }

  /* A dead extension context stops everything; any other failure is shown to the
     seller with a way to try again, never a launcher that silently does nothing. */
  function onNavigationFailure(error: unknown): void {
    if (isContextInvalidated(error)) teardown();
    else showFailed();
  }

  function onFrameLoad(): void {
    const verdict = tracker.onLoad(Date.now());
    if (verdict === 'expected') {
      connect();
      return;
    }
    /* Not a load we started (the panel's own reload, a page script, the browser):
       its nonce is spent or foreign, so it can never handshake. */
    bridge?.dispose();
    bridge = null;
    if (verdict === 'unexpected') void loader.navigate();
    else showFailed();
  }

  /* The order is the point: the nonce is on record in extension storage before the
     frame has a URL, and every load is a full navigation (query differs). The
     nonce itself is never part of the URL. */
  const loader = createNavigator({
    mintNonce: () => createNonce(),
    register: async (value) => {
      if (!runtime()?.id) throw new Error('Extension context invalidated.');
      await registerFrameNonce(value);
    },
    panelUrl: () => {
      const rt = runtime();
      if (!rt?.id) throw new Error('Extension context invalidated.');
      return rt.getURL('panel.html');
    },
    commit: (url, issued) => {
      nonce = issued;
      if (!iframe) {
        const el = doc.createElement('iframe');
        el.setAttribute('allow', '');
        el.addEventListener('load', onFrameLoad);
        iframe = el;
        applyChrome();
      }
      delete frame.dataset.state;
      tracker.expectLoad();
      iframe.src = url;
      /* Appended only now: an iframe added without a URL fires a spurious `load`. */
      if (!iframe.isConnected) frame.append(iframe);
      if (wantFocus && state.open) {
        wantFocus = false;
        iframe.focus();
      }
    },
    fail: onNavigationFailure,
    isStopped: () => stopped,
  });

  function startNavigation(): void {
    bridge?.dispose();
    bridge = null;
    void loader.navigate();
  }

  function focusFrame(): void {
    if (frame.dataset.state === 'failed') retry.focus();
    else if (iframe?.isConnected) iframe.focus();
    else wantFocus = true;
  }

  function dispatch(action: FrameAction, userInitiated = true): void {
    if (stopped) return;
    const before = state;
    state = reduceFrame(state, action);
    if (state.mounted && !started) {
      started = true;
      startNavigation();
    }
    applyChrome();
    if (state.open === before.open) return;
    sendVisibility();
    if (action.type !== 'restore') void storage.saveOpen(state.open);
    if (!userInitiated) return;
    /* Focus follows the seller's own action only; a restored state must not steal focus on page load. */
    if (state.open) focusFrame();
    else launcher.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!event.isTrusted || !isToggleShortcut(event)) return;
    event.preventDefault();
    if (!event.repeat) dispatch({ type: 'toggle' });
  }

  /* Trusted events only: a page script dispatching `pagehide` must not be able to
     dispose the bridge and make the panel report a state it never observed. */
  function onPageHide(event: PageTransitionEvent): void {
    if (!event.isTrusted) return;
    bridge?.dispose();
    bridge = null;
  }

  /* Coming back from the back/forward cache the old port is gone: load a fresh
     panel (new registered nonce, full navigation) rather than leave a dead one on
     screen. Trusted events only: a page script can dispatch a synthetic pageshow. */
  function onPageShow(event: PageTransitionEvent): void {
    if (!event.isTrusted || !event.persisted || !started) return;
    startNavigation();
  }

  launcher.addEventListener('click', () => dispatch({ type: 'toggle' }));
  retry.addEventListener('click', () => {
    tracker.reset();
    wantFocus = state.open;
    startNavigation();
  });
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  applyChrome();
  doc.documentElement.append(frameHost, launcherHost);

  void storage.loadPrefs().then((stored) => {
    if (stored && !prefsFromPanel && !stopped) {
      lastSavedPrefs = JSON.stringify(stored);
      applyPrefs(stored);
    }
  });
  void storage.loadOpen().then((open) => {
    if (open && !stopped) dispatch({ type: 'restore', open }, false);
  });
}
