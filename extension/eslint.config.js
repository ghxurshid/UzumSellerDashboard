import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SITE_ALIAS = { group: ['@/*'], message: '"@/" is the site alias; use "@ext/" or "@core/".' };

/* Same rules as the site's config: one house style in both hosts. Core is
   linted by `frontend/` (see its `lint` script), not here. */
export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-restricted-imports': ['error', { patterns: [SITE_ALIAS] }],
    },
  },
  {
    /* Build-time files run in Node, not in a page. */
    files: ['*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    /* The content script ships on every seller.uzum.uz page: it may not pull in
       React or the shared UI, however indirectly. */
    files: ['src/content/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            SITE_ALIAS,
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@core/ui/*'],
              message: 'The content script must stay small and React-free.',
            },
          ],
        },
      ],
    },
  },  {
    /* The content half of the Uzum bridge is bundled into `content.js`, so it
       carries the same promise as `src/content/`: it may import only its own
       siblings — no React, zod, axios, `@core/*` or `@ext/*`. Everything the
       pattern below does not name is refused, including bare packages. */
    files: [
      'src/uzum/bridge.content.ts',
      'src/uzum/protocol.ts',
      'src/uzum/queue.ts',
      'src/uzum/routes.ts',
      'src/uzum/session.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\./(bridge\.content|protocol|queue|routes|session)$)',
              message:
                'The content half of the bridge is bundled into content.js: import only its sibling files (bridge.content, protocol, queue, routes, session).',
            },
          ],
        },
      ],
    },
  },
);
