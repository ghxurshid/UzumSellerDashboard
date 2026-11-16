import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { resolveCoreFromHost } from '../core/tooling/hostResolve';

/**
 * The panel app — a normal Vite React app, built once per target.
 *
 * The root is `src/panel` so the HTML lands at the top of the output folder
 * with its assets beside it; `emitAsPanelHtml` below writes it as `panel.html`,
 * the name the manifest and the content script refer to. `base: './'` keeps
 * every URL relative because the page is served from `chrome-extension://<id>/`,
 * not from a domain root. Nothing here emits an inline script: an extension
 * page's CSP is `script-src 'self'`.
 *
 * The content script is a separate build (`vite.content.config.ts`) because it
 * must be one classic file with no imports, which an app build cannot promise.
 */
const extSrc = fileURLToPath(new URL('./src', import.meta.url));
const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));

/**
 * Vite names the page after its source file, `index.html`. It is renamed inside
 * the bundle rather than on disk afterwards, so every write — a watch rebuild
 * included — produces `panel.html`: a rename step after the build ran before a
 * watch build had written anything, and never again for the rebuilds. Asset
 * URLs are relative and the page stays in the same folder, so they survive.
 */
function emitAsPanelHtml(): Plugin {
  return {
    name: 'savdo:panel-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = bundle['index.html'];
      if (page !== undefined) page.fileName = 'panel.html';
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./src/panel', import.meta.url)),
  base: './',
  publicDir: false,
  /* `resolveCoreFromHost` first: files under core/ have no node_modules of
     their own and must find react, zod, clsx… in this host's. */
  plugins: [
    resolveCoreFromHost(fileURLToPath(new URL('.', import.meta.url)), coreSrc),
    react(),
    tailwindcss(),
    emitAsPanelHtml(),
  ],
  resolve: {
    alias: {
      '@ext': extSrc,
      '@core': coreSrc,
    },
  },
  server: {
    /* core/ lives next to this package, outside the Vite root. */
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
  build: {
    target: 'es2022',
    /* `scripts/build.mjs` empties the target folder itself, once, so a watch
       rebuild of the panel cannot delete the content script beside it. */
    emptyOutDir: false,
    modulePreload: false,
  },
});
