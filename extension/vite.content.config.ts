import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

/**
 * The content script: one classic script, no imports at runtime.
 *
 * It is injected into seller.uzum.uz on every page load, so it stays tiny and
 * self-contained — IIFE, no code splitting, no CSS, and no route to React or
 * `core/src/ui` (the lint config forbids those imports in this folder too).
 * Everything heavy lives in the panel, which the script only opens.
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: { '@ext': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/content/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'SavdoContent',
      fileName: () => 'content.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
