import type {
  AiConnection,
  AiProvider,
  AiProviderDefinition,
  AiSettings,
  AppSettings,
} from '@/types/settings';

/**
 * Every constant the settings layer needs, in one place.
 *
 * Storage key, schema version, value bounds and the provider registry live
 * here so that no component invents its own default and no two modules
 * disagree about what "valid" means. The registry is a catalogue of nine
 * adapters this app knows how to reach — a set of suggestions the settings
 * form builds its layout and its model list from, not a constraint on what a
 * seller may configure: every entry's `models` is a starting point, and the
 * form also loads the key's own list from the provider and accepts a typed
 * id.
 */

/** The single namespaced key the whole settings service reads and writes. */
export const SETTINGS_STORAGE_KEY = 'savdo.settings';

/**
 * v2 renamed two provider keys to the design's (`google` → `gemini`,
 * `anthropic` → `claude`), folded `modelTier` away and moved the request
 * timeout from the Uzum section to the provider section. v3 added the `data`
 * section, which governs the local buffer. v4 raised the default freshness
 * from fifteen minutes to sixty and migrates a stored fifteen forward. v5 gave
 * every AI provider its own complete configuration (a `providers` map keyed
 * by provider, with the active one named by `provider`), migrated from v4's
 * flat active-provider fields plus the `saved` side-table of the ones the
 * seller had switched away from. See `MIGRATIONS` in
 * `services/storage/settingsSchema.ts`.
 */
export const SETTINGS_SCHEMA_VERSION = 5;

/* ── Uzum seller API ────────────────────────────────────────────────────── */

/**
 * Where the seller API lives.
 *
 * The default is the dev-server proxy path (see `vite.config.ts`), because the
 * API sends no CORS headers and a browser cannot reach it from localhost
 * otherwise. A packaged build points `VITE_API_URL` at the origin directly, and
 * whatever the user saves in Settings wins over both.
 */
export const DEFAULT_API_BASE_URL: string =
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api/seller-openapi';

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/* ── capture freshness ──────────────────────────────────────────────────── */

/**
 * How long a snapshot capture stays servable before `sync: true` re-takes it.
 *
 * The choices are a spread rather than a free-text field, because the useful
 * range is narrow and bounded at both ends: below a minute the stored copy
 * stops being worth keeping and every screen change is a request, and above a
 * few hours a stock level is old enough to act on wrongly. An hour is the
 * default — a `sync: true` read that re-hit Uzum on every screen visit or every
 * Copilot question, as fifteen minutes did, spent the seller's hourly request
 * budget on rows that had not changed. The list still runs 1…720 for a seller
 * who wants it tighter or looser than that.
 */
export const FRESHNESS_OPTIONS = [1, 5, 15, 30, 60, 180, 720] as const;

export const DEFAULT_FRESHNESS_MINUTES = 60;

/* ── AI provider ────────────────────────────────────────────────────────── */

/** The design offers three fixed timeouts rather than a free-text field. */
export const AI_TIMEOUT_OPTIONS = [30_000, 60_000, 120_000] as const;

/** Sampling ranges, matching the design's slider `min`/`max`/`step`. */
export const TEMPERATURE_BOUNDS = { min: 0, max: 1 } as const;
export const TEMPERATURE_STEP = 0.05;
export const MAX_TOKENS_BOUNDS = { min: 1_024, max: 32_000 } as const;
export const MAX_TOKENS_STEP = 256;

/** Upper bounds for free-text fields, so a corrupt store cannot hold a novel. */
export const TEXT_LIMITS = { url: 512, secret: 1_024, identifier: 256 } as const;

/**
 * Provider registry.
 *
 * No provider here is a guess at what might work: every cloud endpoint below
 * was probed on 2026-09-27 with a CORS preflight from an https origin, and all
 * seven allow a browser to call them directly with the seller's own key;
 * `ollama` is a local OpenAI-compatible runtime, and `custom` covers any other
 * OpenAI-compatible gateway the seller points at.
 *
 * `models` is a suggested, ordered starting list, not a closed set — the
 * settings form also loads the key's own model list from the provider and
 * accepts a typed id, so an entry going stale never blocks a seller who knows
 * the current one. Whether a key is required at all is not decided here: that
 * is `requiresApiKey()` in `services/ai`.
 *
 * Evidence behind the suggested lists, so a stale entry can be told apart from
 * a wrong one — all checked 2026-09-27 unless stated otherwise:
 * - Claude ids: Anthropic's own API reference (model table cached 2026-06-24),
 *   and also listed in OpenRouter's public catalogue.
 * - OpenAI's gpt-6 ids: OpenAI's models page, which names `gpt-6-astra` as its
 *   own suggested starting model; also listed in OpenRouter's catalogue.
 * - `grok-4.7` / `grok-4.3`: xAI's own docs, also listed in OpenRouter's
 *   catalogue.
 * - `deepseek-v4-pro`: DeepSeek's API reference and OpenRouter's catalogue;
 *   `deepseek-flash`: DeepSeek's API reference only, not yet seen elsewhere.
 * - Mistral's `-latest` aliases are long-standing but were NOT reconfirmed
 *   today — carried forward, not freshly checked.
 * - `openrouter/auto`: OpenRouter's public `/models` listing, checked today.
 *
 * The three previous defaults this catalogue replaced — `gpt-5.1`,
 * `deepseek-chat`, `grok-4` — are no longer listed by their vendors.
 *
 * Evidence behind each provider's `params`, fetched 2026-09-28 from the
 * vendor's own docs; every optional header below was also confirmed reachable
 * from a browser with a CORS preflight:
 * - OpenAI: `OpenAI-Organization` and `OpenAI-Project` headers; Responses API
 *   `reasoning.effort` (GPT-6 Astra accepts low…max, no `none`; Sol and Luna
 *   accept none…max).
 * - Claude: the `anthropic-version` header is required on every request
 *   (2023-06-01 is the current stable value); `output_config.effort` accepts
 *   low, medium, high, xhigh, max.
 * - Gemini 3+: `thinkingConfig.thinkingLevel` — 3.7 and 3.8 accept low, medium,
 *   high; 3.5, 3.6 and 3-flash-preview also accept minimal.
 * - OpenRouter: `HTTP-Referer` and `X-OpenRouter-Title` attribution headers;
 *   `reasoning.effort`, same scale as OpenAI's.
 * - DeepSeek: `thinking.type`, enabled or disabled per DeepSeek's own API
 *   reference (fetched 2026-09-28), which also documents `max_tokens`
 *   defaulting to 64K once thinking is on. This transport has so far always
 *   sent `disabled` — that was a choice this app made, not a ceiling the API
 *   itself imposes — which is why the card's own default stays off.
 * - Grok: `reasoning_effort`, low, medium or high on 4.5 and 4.6, plus xhigh
 *   from 4.6 on.
 * - Mistral, Ollama and `custom` take nothing beyond the key, endpoint and
 *   model every provider already has.
 */
export const AI_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    icon: 'orbit',
    baseUrl: 'https://api.openai.com/v1',
    endpoint: 'fixed',
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ],
    defaultModel: 'gpt-6-astra',
    params: ['orgId', 'projectId', 'reasoningEffort'],
    // 'low' reproduces the effort the transport already sent before this
    // field was exposed on the card, so a migrated seller sees no change.
    defaults: { reasoningEffort: 'low' },
  },
  {
    id: 'claude',
    label: 'Claude',
    icon: 'asterisk',
    baseUrl: 'https://api.anthropic.com/v1',
    endpoint: 'fixed',
    keyPlaceholder: 'sk-ant-…',
    keyUrl: 'https://platform.claude.com/settings/keys',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    defaultModel: 'claude-opus-5',
    params: ['anthropicVersion', 'reasoningEffort'],
    // Both reproduce what the transport already sent: the required version
    // header, and low effort.
    defaults: { anthropicVersion: '2023-06-01', reasoningEffort: 'low' },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: 'diamond',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    endpoint: 'fixed',
    keyPlaceholder: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.6-flash',
    params: ['thinkingLevel'],
    // Reproduces the level the transport already sent for Gemini 3 models.
    defaults: { thinkingLevel: 'low' },
    /**
     * Every Gemini model that can hold a text chat through `generateContent`
     * on the free tier with a non-zero limit on all three axes, with the
     * limits AI Studio's rate-limit page stated as of `GEMINI_LIMITS_AS_OF`
     * below: a seller's own project, per model, free tier. TPM counts input
     * tokens only; RPD resets at midnight Pacific. Ids are checked against
     * ai.google.dev/gemini-api/docs/models.
     *
     * Left out on purpose: models whose free-tier limit is 0 on some axis (2
     * Flash, 2 Flash-Lite, 2.5 Pro, 3.1 Pro, and every image/video/music/Omni
     * model), and models with a real limit that still cannot hold a text chat
     * here — TTS, Live/Transcribe, embeddings, the Antigravity and Deep
     * Research agents, Robotics-ER, and Gemma 4 (also missing from Google's
     * own models page, and its 16K TPM would not survive two Copilot rounds).
     *
     * These are a snapshot, not a live read: if the project's tier changes, a
     * Gemini 429 overrides the axis it names at runtime — see `summarizeUsage`
     * in `services/ai/usage.ts`.
     */
    models: [
      {
        id: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        limits: { rpm: 5, tpm: 250_000, rpd: 20 },
      },
      {
        id: 'gemini-3.7-flash',
        label: 'Gemini 3.7 Flash',
        limits: { rpm: 5, tpm: 250_000, rpd: 20 },
      },
      {
        id: 'gemini-3.6-flash',
        label: 'Gemini 3.6 Flash',
        limits: { rpm: 5, tpm: 250_000, rpd: 20 },
      },
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        limits: { rpm: 5, tpm: 250_000, rpd: 20 },
      },
      {
        id: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash-Lite',
        limits: { rpm: 15, tpm: 250_000, rpd: 500 },
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash-Lite',
        limits: { rpm: 15, tpm: 250_000, rpd: 500 },
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash (preview)',
        limits: { rpm: 5, tpm: 250_000, rpd: 20 },
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        limits: { rpm: 5, tpm: 250_000, rpd: 20 },
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        limits: { rpm: 10, tpm: 250_000, rpd: 20 },
      },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    icon: 'shuffle',
    baseUrl: 'https://openrouter.ai/api/v1',
    endpoint: 'fixed',
    keyPlaceholder: 'sk-or-…',
    keyUrl: 'https://openrouter.ai/keys',
    models: [{ id: 'openrouter/auto', label: 'Auto (OpenRouter picks)' }],
    defaultModel: 'openrouter/auto',
    params: ['appUrl', 'appTitle', 'reasoningEffort'],
    // No default: '' already means "OpenRouter's own default" for effort,
    // and the attribution headers are opt-in, not something to guess at.
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    icon: 'waves',
    baseUrl: 'https://api.deepseek.com/v1',
    endpoint: 'fixed',
    keyPlaceholder: 'sk-…',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
    ],
    defaultModel: 'deepseek-v4-pro',
    params: ['thinking'],
    // Reproduces the transport's current, only supported value: disabled.
    defaults: { thinking: false },
  },
  {
    id: 'mistral',
    label: 'Mistral',
    icon: 'wind',
    baseUrl: 'https://api.mistral.ai/v1',
    endpoint: 'fixed',
    /* Mistral keys carry no vendor prefix, unlike every other adapter here. */
    keyPlaceholder: '',
    keyUrl: 'https://console.mistral.ai/api-keys',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
    ],
    defaultModel: 'mistral-large-latest',
    params: [],
  },
  {
    id: 'grok',
    label: 'Grok (xAI)',
    icon: 'square-x',
    baseUrl: 'https://api.x.ai/v1',
    endpoint: 'fixed',
    keyPlaceholder: 'xai-…',
    keyUrl: 'https://console.x.ai',
    models: [
      { id: 'grok-4.7', label: 'Grok 4.7' },
      { id: 'grok-4.3', label: 'Grok 4.3' },
    ],
    defaultModel: 'grok-4.7',
    params: ['reasoningEffort'],
    // No default: xAI's own default carries no cost surprise worth pinning.
  },
  {
    id: 'ollama',
    label: 'Ollama',
    icon: 'hard-drive',
    /* No vendor URL to fix on — the seller's own machine, adjusted here. */
    baseUrl: 'http://localhost:11434/v1',
    endpoint: 'editable',
    keyPlaceholder: '',
    keyUrl: null,
    models: [],
    defaultModel: '',
    params: [],
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: 'code',
    /* No vendor to default to — the seller supplies their own gateway. */
    baseUrl: '',
    endpoint: 'required',
    keyPlaceholder: '',
    keyUrl: null,
    models: [],
    defaultModel: '',
    params: [],
  },
] as const satisfies readonly AiProviderDefinition[];

export const AI_PROVIDER_IDS: readonly AiProvider[] = AI_PROVIDERS.map(
  (provider) => provider.id,
);

export const DEFAULT_AI_PROVIDER: AiProvider = 'gemini';

/**
 * The one date the Gemini `limits` below are checked against — named once so
 * the quota panel and the model picker can say it in the seller's own
 * language instead of it being typed into three dictionary strings that would
 * silently go stale the next time this catalogue is updated. Update this
 * alongside the `models` list, not instead of it.
 */
export const GEMINI_LIMITS_AS_OF = '2026-09-18';

/**
 * The catalogue entry for a provider; falls back to the default provider
 * (`DEFAULT_AI_PROVIDER`), looked up by id rather than assumed to sit at a
 * fixed position — the catalogue is edited often enough that an index would
 * silently point at the wrong entry the next time it is reordered.
 */
export function findProvider(id: AiProvider): AiProviderDefinition {
  return (
    AI_PROVIDERS.find((provider) => provider.id === id) ??
    AI_PROVIDERS.find((provider) => provider.id === DEFAULT_AI_PROVIDER) ??
    // Unreachable: DEFAULT_AI_PROVIDER always names an entry above. Kept so
    // the return type stays AiProviderDefinition, not AiProviderDefinition |
    // undefined, without a non-null assertion.
    AI_PROVIDERS[0]
  );
}

/**
 * Display name for the configured model — the catalogue label where one
 * exists, the raw id otherwise (free-text adapters name their own models).
 *
 * Narrowed to the two fields it reads rather than the whole `AiSettings`, so
 * a caller holding just a provider/model pair — a card being edited before
 * it is made active, say — never has to fabricate the rest of a connection
 * just to ask this.
 */
export function describeModel(ai: Pick<AiSettings, 'provider' | 'model'>): string {
  const provider = findProvider(ai.provider);
  const model = provider.models.find((entry) => entry.id === ai.model);
  if (model !== undefined) return model.label;
  return ai.model === '' ? provider.label : ai.model;
}

/* ── defaults ───────────────────────────────────────────────────────────── */

/**
 * App-wide defaults shared by every provider's connection, before that
 * provider's own overrides (`AiProviderDefinition.defaults`) are layered on.
 * Every provider-specific field defaults to '' or false — "not sent" — so a
 * field a provider does not use never reaches its transport.
 */
export const AI_CONNECTION_DEFAULTS: Omit<AiConnection, 'baseUrl' | 'apiKey' | 'model'> = {
  timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  temperature: 0.2,
  maxTokens: 4_096,
  orgId: '',
  projectId: '',
  reasoningEffort: '',
  anthropicVersion: '',
  thinkingLevel: '',
  appUrl: '',
  appTitle: '',
  thinking: false,
};

/**
 * A fresh, empty configuration for one provider: its own endpoint and model,
 * the app-wide defaults, and then that provider's own overrides where it has
 * any. The credential is always empty here — a key that ships in source is a
 * key that leaks, and this app has no server side to hold one, so there is
 * nothing this function could fill it with.
 */
export function defaultAiConnection(provider: AiProvider): AiConnection {
  const definition = findProvider(provider);
  return {
    baseUrl: definition.baseUrl,
    apiKey: '',
    model: definition.defaultModel,
    ...AI_CONNECTION_DEFAULTS,
    ...definition.defaults,
  };
}

/**
 * Every provider's own fresh configuration, keyed by provider. Written as a
 * `Record<AiProvider, AiConnection>` literal — not built by folding over
 * `AI_PROVIDERS` — so the compiler itself checks that all nine keys are
 * present: a provider added to the union without an entry here is a type
 * error, not a card that silently falls back to someone else's defaults.
 */
const DEFAULT_AI_CONNECTIONS: Readonly<Record<AiProvider, AiConnection>> = {
  openai: defaultAiConnection('openai'),
  claude: defaultAiConnection('claude'),
  gemini: defaultAiConnection('gemini'),
  openrouter: defaultAiConnection('openrouter'),
  deepseek: defaultAiConnection('deepseek'),
  mistral: defaultAiConnection('mistral'),
  grok: defaultAiConnection('grok'),
  ollama: defaultAiConnection('ollama'),
  custom: defaultAiConnection('custom'),
};

/**
 * What the transport reads on a fresh install: the default provider's own
 * configuration, flattened with its id the way `AiSettings` shapes it. Tests
 * and fixtures that need "some valid AI settings" should spread this rather
 * than reach into `DEFAULT_SETTINGS.ai`, whose shape is the multi-provider
 * `AiSection`, not the flat one a request is built from.
 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: DEFAULT_AI_PROVIDER,
  ...defaultAiConnection(DEFAULT_AI_PROVIDER),
};

/**
 * What a fresh install — and every reset — starts from.
 *
 * Credentials are empty by design: a key that ships in source is a key that
 * leaks, and this app has no server side to hold one. Every provider gets a
 * complete configuration up front, not only the active one, so a card always
 * has something to show and switching providers never needs a fallback.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  api: {
    baseUrl: DEFAULT_API_BASE_URL,
    token: '',
  },
  ai: {
    provider: DEFAULT_AI_PROVIDER,
    providers: DEFAULT_AI_CONNECTIONS,
  },
  features: {
    maskSecrets: true,
    autoDiagnostics: false,
  },
  data: {
    freshnessMinutes: DEFAULT_FRESHNESS_MINUTES,
  },
};
