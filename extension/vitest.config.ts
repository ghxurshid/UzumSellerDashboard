import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { resolveCoreFromHost } from '../core/tooling/hostResolve';

/**
 * Node environment, like the site's. Core's own tests run from `frontend/`;
 * running them here too would only report the same files twice. A suite that
 * needs a DOM opts in per file, not globally.
 */
const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));

export default defineConfig({
  plugins: [resolveCoreFromHost(fileURLToPath(new URL('.', import.meta.url)), coreSrc)],
  resolve: {
    alias: {
      '@ext': fileURLToPath(new URL('./src', import.meta.url)),
      '@core': coreSrc,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'manifests/**/*.test.ts'],
    sequence: { shuffle: false },
  },
});
