import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import path from 'node:path';

import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The core boundary, as a rule.
 *
 * `core/src` is shared by two hosts, so it may import npm packages, `@core/…`
 * and relative paths that stay inside `core/src` — nothing that exists in only
 * one host. `@/` is the site's alias, `@ext/` the extension's, and a `../` that
 * climbs out of core/src would reach a host by path instead. Written as a local
 * rule because the stock `no-restricted-imports` cannot tell where a relative
 * path lands.
 */
const coreBoundary = {
  meta: { type: 'problem', schema: [], messages: { escape: '{{ why }}' } },
  create(context) {
    const coreSrc = path.resolve(context.cwd, 'core', 'src');
    const check = (node, source) => {
      if (typeof source !== 'string') return;
      let why = null;
      if (source.startsWith('@/') || source.startsWith('@ext/')) {
        why = `core/ must not import from a host ("${source}"); hosts import core, never the reverse.`;
      } else if (source.startsWith('.')) {
        const target = path.resolve(path.dirname(context.filename), source);
        if (path.relative(coreSrc, target).startsWith('..')) {
          why = `Relative import "${source}" leaves core/src; core/ may only reach npm packages, @core/ and its own files.`;
        }
      }
      if (why !== null) context.report({ node, messageId: 'escape', data: { why } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node, node.source.value),
    };
  },
};

export default tseslint.config(
  { ignores: ['dist', '_design', 'node_modules'] },
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
    },
  },  {
    /* Only matches when ESLint runs from the repo root (the second half of
       `npm run lint`); from frontend/ the core tree is outside the base path. */
    files: ['core/src/**/*.{ts,tsx}'],
    plugins: { savdo: { rules: { 'core-boundary': coreBoundary } } },
    rules: { 'savdo/core-boundary': 'error' },
  },
);
