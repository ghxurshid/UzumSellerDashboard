/**
 * One generator, two manifests.
 *
 * Chrome and Edge share the chromium build; Firefox differs only where its MV3
 * dialect does (the add-on id, and no `minimum_chrome_version`). Everything a
 * reviewer cares about — permissions, hosts, what the page can load — is
 * written once below so the two targets cannot drift apart.
 *
 * Plain `.mjs` on purpose: `scripts/build.mjs` runs it with bare Node.
 */

/** The seller API, called with the seller's own token. */
export const UZUM_API_ORIGIN = 'https://api-seller.uzum.uz';

/**
 * API origin of every built-in LLM provider in `core/src/constants/settings.ts`
 * (`scripts/guard.mjs` fails the build if the catalogue gains one that is
 * missing here). Ollama's `http://localhost:11434` is deliberately not listed:
 * it is a loopback address most sellers never use, and listing it would put a
 * localhost warning on every install. It is covered by the optional pattern.
 */
export const LLM_ORIGINS = [
  'https://api.openai.com',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
  'https://api.deepseek.com',
  'https://api.mistral.ai',
  'https://api.x.ai',
];

/** Custom and self-hosted gateways: asked for at runtime, per origin the seller types. */
export const OPTIONAL_HOST_PERMISSIONS = ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];

export const SELLER_MATCH = 'https://seller.uzum.uz/*';

/** Firefox's id is a stable name, not a promise of a domain; confirm before the first AMO upload. */
export const GECKO_ID = 'savdo-copilot@savdo.app';

/** MV3 with `optional_host_permissions` needs Firefox 128. */
export const GECKO_MIN_VERSION = '128.0';

/**
 * Sizes of the PNGs in `manifests/icons/` (rendered from `icon.svg` there), which
 * the build copies to `icons/` in the output. The browser shows them on its
 * extensions page and in the toolbar menu; without them an installed extension
 * is a grey letter. There is still no `action`: the icon opens nothing.
 */
export const ICON_SIZES = [16, 32, 48, 128];

/**
 * @param {'chromium' | 'firefox'} target
 * @param {string} version taken from extension/package.json
 */
export function createManifest(target, version) {
  /** @type {Record<string, unknown>} */
  const manifest = {
    manifest_version: 3,
    default_locale: 'en',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version,
    icons: Object.fromEntries(ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`])),
    permissions: ['storage'],
    host_permissions: [`${UZUM_API_ORIGIN}/*`, ...LLM_ORIGINS.map((origin) => `${origin}/*`)],
    optional_host_permissions: OPTIONAL_HOST_PERMISSIONS,
    content_scripts: [
      {
        matches: [SELLER_MATCH],
        js: ['content.js'],
        run_at: 'document_idle',
      },
    ],
    /* `panel.html` is framed by the content script on the seller's page, so the
       page and everything it loads must be web-accessible — to that site only.
       Assets are hashed; the folder glob keeps the manifest build-independent. */
    web_accessible_resources: [
      {
        resources: ['panel.html', 'assets/*'],
        matches: [SELLER_MATCH],
      },
    ],
  };

  if (target === 'chromium') {
    /* `optional_host_permissions` and the rest above need Chrome/Edge 102+. */
    manifest.minimum_chrome_version = '102';
  } else {
    manifest.browser_specific_settings = {
      gecko: { id: GECKO_ID, strict_min_version: GECKO_MIN_VERSION },
    };
  }

  return manifest;
}
