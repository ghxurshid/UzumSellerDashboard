/**
 * Drift guards between the two hosts, run by `npm run lint` and `npm run build`.
 *
 * `core/` is compiled by both `frontend/` and `extension/` against their own
 * node_modules. That is only safe while both resolve the same library versions
 * and the same compiler strictness, so this script fails loudly the moment they
 * stop doing so — a silent difference would surface as a bug in one host only.
 *
 * Three checks:
 *  1. every package present in both lockfiles has the same version;
 *  2. the strictness-relevant compiler options of frontend, extension and core agree;
 *  3. every built-in LLM provider origin in the site's catalogue is granted by the manifest.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LLM_ORIGINS, UZUM_API_ORIGIN } from '../manifests/manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

const problems = [];

/* 1 — lockfile versions */
const siteLock = readJson('frontend/package-lock.json').packages;
const extLock = readJson('extension/package-lock.json').packages;
for (const [key, entry] of Object.entries(extLock)) {
  if (!key.startsWith('node_modules/')) continue;
  const other = siteLock[key];
  if (other === undefined || entry.version === other.version) continue;
  problems.push(
    `${key.replace(/^node_modules\//, '')}: frontend ${other.version}, extension ${entry.version}`,
  );
}
const drift = problems.length;

/* 2 — compiler options */
const OPTIONS = [
  'target', 'module', 'moduleResolution', 'jsx', 'useDefineForClassFields', 'verbatimModuleSyntax',
  'strict', 'noUnusedLocals', 'noUnusedParameters', 'noFallthroughCasesInSwitch',
  'noUncheckedSideEffectImports', 'noImplicitOverride', 'noImplicitReturns',
  'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess',
];
const site = readJson('frontend/tsconfig.app.json').compilerOptions;
for (const file of ['extension/tsconfig.app.json', 'core/tsconfig.json']) {
  const options = readJson(file).compilerOptions;
  for (const option of OPTIONS) {
    if (JSON.stringify(options[option]) !== JSON.stringify(site[option])) {
      problems.push(`${file}: "${option}" is ${JSON.stringify(options[option])}, frontend has ${JSON.stringify(site[option])}`);
    }
  }
}

/* 3 — provider origins */
const catalogue = readFileSync(resolve(root, 'core/src/constants/settings.ts'), 'utf8');
const granted = new Set([UZUM_API_ORIGIN, ...LLM_ORIGINS]);
/* Loopback providers (Ollama) are covered by the optional patterns. */
const LOOPBACK = new Set(['localhost', '127.0.0.1']);
for (const [, baseUrl] of catalogue.matchAll(/baseUrl:\s*'(https?:\/\/[^']+)'/g)) {
  const { origin, hostname } = new URL(baseUrl);
  if (!granted.has(origin) && !LOOPBACK.has(hostname)) {
    problems.push(`provider origin ${origin} (core/src/constants/settings.ts) is not in the manifest's host permissions`);
  }
}

if (problems.length > 0) {
  console.error('\nHost drift detected — core/ would compile differently in the two hosts:\n');
  for (const [index, problem] of problems.entries()) {
    console.error(`  ${index < drift ? 'version' : 'config '}  ${problem}`);
  }
  console.error(
    '\nFix: align extension/package.json (and re-install) with frontend/package-lock.json, or update the manifest/tsconfig.\n',
  );
  process.exit(1);
}
console.log('guard: lockfiles, compiler options and provider origins agree across frontend, extension and core.');
