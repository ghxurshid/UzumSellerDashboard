import { join, relative, isAbsolute, sep } from 'node:path';

import type { Plugin } from 'vite';

/**
 * Lets `core/` import npm packages without owning a node_modules.
 *
 * `core/` is source-only: it is compiled by whichever host imports it, against
 * that host's dependencies. A bare `import { z } from 'zod'` in `core/src/x.ts`
 * would otherwise be looked up in `core/node_modules` and then every parent
 * directory — none of which exists — and fail. This plugin catches exactly those
 * imports (bare specifier, importer under `core/`) and resolves them as if the
 * importer sat in the host root. Resolving from one place also means each of
 * react / react-dom / zustand / zod ends up in a bundle exactly once, which is
 * why this is a resolver and not a copy of the dependencies.
 *
 * Aliases (`@core/…`, `@/…`) are rewritten by Vite's alias plugin before this
 * one runs, so what reaches here is either a package name or a path.
 */
export function resolveCoreFromHost(hostRoot: string, coreRoot: string): Plugin {
  /* Any real file in the host root works as the importer; resolution only uses
     its directory to start the node_modules walk. */
  const hostAnchor = join(hostRoot, 'package.json');

  const isInsideCore = (file: string): boolean => {
    const rel = relative(coreRoot, file);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };

  const isBare = (source: string): boolean =>
    !source.startsWith('.') &&
    !source.startsWith('/') &&
    !source.startsWith('\0') &&
    !source.startsWith('node:') &&
    !source.startsWith('virtual:') &&
    !/^[a-zA-Z]:[/\\]/.test(source);

  return {
    name: 'savdo:resolve-core-from-host',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer === undefined || !isBare(source)) return null;
      const file = (importer.split('?')[0] ?? importer).split('/').join(sep);
      if (!isInsideCore(file)) return null;
      const resolved = await this.resolve(source, hostAnchor, { ...options, skipSelf: true });
      return resolved;
    },
  };
}
