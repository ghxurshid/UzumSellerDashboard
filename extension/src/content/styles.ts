/**
 * The stylesheets of the launcher and the frame, as strings for constructable
 * stylesheets (`adoptedStyleSheets`): a `<style>` element or a `style=""`
 * attribute would depend on the cabinet's `style-src`, CSSOM does not.
 *
 * Colour values are copied from `core/src/styles/theme.css` (the `--s-*`
 * variables of the dark and light themes: chrome, panel, line, acc, acc-dim,
 * text, shadow-float), because that CSS cannot be imported into the page. If
 * the site's palette changes, this is the one place to follow it.
 *
 * ## Two hosts, and no animation inside a shadow root
 *
 * The launcher and the frame live in separate closed shadow roots, and nothing
 * inside either of them is ever transitioned or animated. `document.getAnimations()`
 * lists the running animations of the whole document, shadow trees included, and
 * each one hands the page its `effect.target`: from an element inside a closed
 * root, `getRootNode()` returns the root and `querySelector('iframe')` returns
 * the panel's frame. The frame's fade is therefore a transition on the frame's
 * *host element* (set from script through CSSOM in `mount.ts`), whose target the
 * page already knows and whose shadow root it cannot read. The launcher has no
 * transitions at all.
 *
 * Geometry: the frame is 433px wide (the Copilot panel's width on the site),
 * 80% of the viewport tall (`dvh` where supported so a mobile browser's own
 * bars do not clip it), and on a narrow viewport it takes almost the whole
 * width. It is `position: fixed`, so the cabinet's layout never moves.
 */
export const FRAME_WIDTH_PX = 433;
export const NARROW_BREAKPOINT_PX = 520;
export const MOTION_MS = 200;
const MARGIN_PX = 16;
const MARGIN_NARROW_PX = 8;
const LAUNCHER_PX = 52;
const CLOSE_PX = 40;

const THEME = `
.root {
  --chrome: #0f1119; --panel: #1b1d2a; --line: rgba(233, 233, 237, 0.17);
  --text: #e9e9ed; --acc: #9184d9; --acc-dim: #b5abfc; --on-acc: #0f1119;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
  color-scheme: dark;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text);
}
.root[data-theme="light"] {
  --chrome: #e3e5f0; --panel: #f8f9fd; --line: rgba(41, 43, 49, 0.2);
  --text: #22242c; --acc: #6d61ad; --acc-dim: #5d5294; --on-acc: #ffffff;
  --shadow: 0 18px 50px rgba(41, 43, 49, 0.2);
  color-scheme: light;
}
*, *::before, *::after { box-sizing: border-box; }
`;

export const LAUNCHER_CSS = `
:host { all: initial; }
${THEME}
.root { pointer-events: none; }

.launcher {
  all: unset;
  position: fixed;
  right: ${MARGIN_PX}px;
  bottom: ${MARGIN_PX}px;
  width: ${LAUNCHER_PX}px;
  height: ${LAUNCHER_PX}px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  pointer-events: auto;
  background: var(--acc);
  color: var(--on-acc);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.launcher:hover { filter: brightness(1.08); }
.launcher:active { filter: brightness(0.95); }
.launcher:focus-visible { outline: 2px solid var(--acc-dim); outline-offset: 3px; }
.launcher svg { width: 24px; height: 24px; grid-area: 1 / 1; }
.launcher .i-close { display: none; }
.root[data-open="true"] .launcher .i-open { display: none; }
.root[data-open="true"] .launcher .i-close { display: block; }

/* Open: the frame covers the corner, so the launcher becomes a smaller close
   button just above it, always reachable even if the panel never loads. */
.root[data-open="true"] .launcher {
  width: ${CLOSE_PX}px;
  height: ${CLOSE_PX}px;
  transform: translateY(calc(-80vh - ${MARGIN_PX / 2}px));
  transform: translateY(calc(-80dvh - ${MARGIN_PX / 2}px));
}

@media (max-width: ${NARROW_BREAKPOINT_PX}px) {
  .launcher { right: ${MARGIN_NARROW_PX}px; bottom: ${MARGIN_NARROW_PX}px; }
}
`;

/* The frame host's own box. Position, margin, z-index and the animated
   properties are set inline through CSSOM with `!important` where it matters;
   the responsive geometry lives here. */
export const FRAME_CSS = `
:host {
  all: initial;
  position: fixed;
  right: ${MARGIN_PX}px;
  bottom: ${MARGIN_PX}px;
  width: ${FRAME_WIDTH_PX}px;
  max-width: calc(100vw - ${MARGIN_PX * 2}px);
  height: 80vh;
  height: 80dvh;
  display: block;
}
${THEME}
.root {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.root iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--panel);
}

/* Honest failure state: shown instead of the iframe when the panel could not be
   started, so the seller never faces a frame that silently does nothing. */
.fallback {
  display: none;
  position: absolute;
  inset: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  text-align: center;
  background: var(--panel);
}
.fallback p { margin: 0; }
.root[data-state="failed"] .fallback { display: flex; }
.root[data-state="failed"] iframe { display: none; }
.retry {
  all: unset;
  cursor: pointer;
  padding: 9px 16px;
  border-radius: 10px;
  background: var(--acc);
  color: var(--on-acc);
  font-weight: 500;
}
.retry:hover { filter: brightness(1.08); }
.retry:focus-visible { outline: 2px solid var(--acc-dim); outline-offset: 3px; }

@media (max-width: ${NARROW_BREAKPOINT_PX}px) {
  :host {
    right: ${MARGIN_NARROW_PX}px;
    bottom: ${MARGIN_NARROW_PX}px;
    width: calc(100vw - ${MARGIN_NARROW_PX * 2}px);
    max-width: none;
  }
}
`;
