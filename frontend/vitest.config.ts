import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * The test runner, finally.
 *
 * Both specifications named the absence of one as this project's largest
 * technical debt, and the reason it stayed unpaid was that the interesting code
 * was hard to reach: everything went through IndexedDB, a worker, or the
 * network. The layers added since have changed that. Coverage algebra, the
 * plain-text envelope tool results travel in, the protocol the model speaks,
 * the alert rules and every financial formula are pure functions over plain
 * values — no browser, no fixtures, no mocking.
 *
 * So this config is deliberately small: node environment, the same `@` alias
 * the app uses, and the unit tests that need nothing else. Tests that do need a
 * database can be added later behind `fake-indexeddb`; nothing here waits on
 * that decision.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /* Deterministic order in a report someone has to read. */
    sequence: { shuffle: false },
  },
});
