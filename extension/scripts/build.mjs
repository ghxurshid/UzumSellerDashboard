/**
 * Builds the extension for each target.
 *
 *   node scripts/build.mjs [--target=chromium|firefox] [--watch]
 *
 * Output is `dist/chromium/` (Chrome and Edge) and `dist/firefox/`. Per target:
 * the panel app (Vite, hashed assets), the content script (a separate IIFE
 * build), the manifest, the icons and the locale folders. The two outputs
 * differ only in `manifest.json`. The folder is emptied here, once, because the
 * two Vite builds write into the same directory and must not erase each other.
 *
 * With `--watch` the process stays up and rewrites the folder on every source
 * change. Nothing reloads the browser: a panel change shows after the cabinet
 * tab is reloaded, a content-script or manifest change only after the extension
 * itself is reloaded on the browser's extensions page (and then the tab).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { createManifest } from '../manifests/manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const only = args.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
const targets = only === undefined ? ['chromium', 'firefox'] : [only];

for (const target of targets) {
  if (target !== 'chromium' && target !== 'firefox') {
    console.error(`Unknown target "${target}" (expected chromium or firefox).`);
    process.exit(1);
  }
}

const guard = spawnSync(process.execPath, [resolve(root, 'scripts/guard.mjs')], { stdio: 'inherit' });
if (guard.status !== 0) process.exit(guard.status ?? 1);

const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** Everything in the output that no Vite build writes. */
function writeStatic(target, outDir) {
  writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(createManifest(target, version), null, 2)}\n`);
  cpSync(resolve(root, '_locales'), resolve(outDir, '_locales'), { recursive: true });
  cpSync(resolve(root, 'manifests/icons'), resolve(outDir, 'icons'), {
    recursive: true,
    /* The PNGs are what the manifest names; the SVG beside them is their source. */
    filter: (source) => !source.endsWith('.svg'),
  });
}

/**
 * One Vite build. A one-shot build resolves when its files are written. A watch
 * build resolves with a watcher before anything is on disk, so this waits for
 * the first pass to end — the folder is then complete when "built" is printed —
 * and afterwards reports each rebuild, since nothing else tells the developer
 * that the output changed.
 */
async function run(label, target, config) {
  const output = await build(config);
  if (!watch) return;
  await new Promise((done) => {
    let first = true;
    output.on('event', (event) => {
      /* A failed pass also ends; Vite has printed why, and the watcher lives on. */
      if (event.code !== 'END') return;
      if (first) {
        first = false;
        done();
      } else {
        console.log(`rebuilt dist/${target} (${label}) at ${new Date().toLocaleTimeString()}`);
      }
    });
  });
}

for (const target of targets) {
  const outDir = resolve(root, 'dist', target);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const common = { logLevel: 'warn', build: { outDir, watch: watch ? {} : null, sourcemap: watch } };

  /* The page is written as `panel.html` by the panel config itself (see
     `emitAsPanelHtml` in vite.config.ts), so there is nothing to rename here. */
  await run('panel', target, { ...common, configFile: resolve(root, 'vite.config.ts') });
  await run('content script', target, { ...common, configFile: resolve(root, 'vite.content.config.ts') });
  writeStatic(target, outDir);
  console.log(`built dist/${target}`);
}

if (watch) console.log('watching for changes — Ctrl+C to stop');
