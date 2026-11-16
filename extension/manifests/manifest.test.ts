import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createManifest, ICON_SIZES } from './manifest.mjs';

const TARGETS = ['chromium', 'firefox'] as const;

describe('createManifest', () => {
  it.each(TARGETS)('%s: MV3 with the agreed fields', (target) => {
    const m = createManifest(target, '1.2.3');
    expect(m.manifest_version).toBe(3);
    expect(m.default_locale).toBe('en');
    expect(m.version).toBe('1.2.3');
    expect(m.permissions).toEqual(['storage']);
    expect(m.background).toBeUndefined();
    expect(m.action).toBeUndefined();
  });

  it.each(TARGETS)('%s: never asks for every site up front', (target) => {
    const m = createManifest(target, '1.0.0');
    expect(JSON.stringify(m.host_permissions)).not.toContain('<all_urls>');
    expect(m.host_permissions).toContain('https://api-seller.uzum.uz/*');
    expect(m.optional_host_permissions).toEqual(['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  });

  it.each(TARGETS)('%s: panel is exposed to the seller site only', (target) => {
    const m = createManifest(target, '1.0.0');
    expect(m.web_accessible_resources).toEqual([
      { resources: ['panel.html', 'assets/*'], matches: ['https://seller.uzum.uz/*'] },
    ]);
    expect(m.content_scripts).toEqual([
      { matches: ['https://seller.uzum.uz/*'], js: ['content.js'], run_at: 'document_idle' },
    ]);
  });

  it.each(TARGETS)('%s: every icon the manifest names is a file the build copies', (target) => {
    const icons = createManifest(target, '1.0.0').icons as Record<string, string>;
    expect(Object.keys(icons)).toEqual(ICON_SIZES.map(String));
    for (const [size, path] of Object.entries(icons)) {
      /* The build copies `manifests/icons/` to `icons/` in the output. */
      expect(path).toBe(`icons/icon-${size}.png`);
      const source = fileURLToPath(new URL(`./icons/icon-${size}.png`, import.meta.url));
      expect(existsSync(source), `${source} is missing`).toBe(true);
    }
  });

  it('the targets differ only in their browser-specific keys', () => {
    const chromium = { ...createManifest('chromium', '1.0.0') };
    const firefox = { ...createManifest('firefox', '1.0.0') };
    delete chromium.minimum_chrome_version;
    delete firefox.browser_specific_settings;
    expect(chromium).toEqual(firefox);
    expect(createManifest('firefox', '1.0.0').browser_specific_settings).toMatchObject({
      gecko: { id: expect.stringContaining('@') as string, strict_min_version: '128.0' },
    });
  });
});
