import type {
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
 * disagree about what "valid" means. The registry mirrors the design's
 * `provDefs` — nine adapters, each with the card metadata it draws.
 */

/** The single namespaced key the whole settings service reads and writes. */
export const SETTINGS_STORAGE_KEY = 'savdo.settings';

/**
 * v2 renamed two provider keys to the design's (`google` → `gemini`,
 * `anthropic` → `claude`), folded `modelTier` away and moved the request
 * timeout from the Uzum section to the provider section. v3 added the `data`
 * section, which governs the local buffer. See `MIGRATIONS` in
 * `services/storage/settingsSchema.ts`.
 */
export const SETTINGS_SCHEMA_VERSION = 3;

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
 * few hours a stock level is old enough to act on wrongly. Fifteen minutes is the default —
 * long enough that moving between screens and ranges costs nothing, short
 * enough that a restock made in the seller cabinet shows up in one coffee.
 */
export const FRESHNESS_OPTIONS = [1, 5, 15, 30, 60, 180, 720] as const;

export const DEFAULT_FRESHNESS_MINUTES = 15;

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
 * Provider registry — the design's nine adapters.
 *
 * `models` is populated only where the catalogue is known; an empty list means
 * the adapter takes a free-text model id, which is how the design treats
 * self-hosted and OpenAI-compatible endpoints.
 */
export const AI_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    icon: 'orbit',
    meta: 'GPT-5.1 · GPT-4.1 mini',
    status: 'operational',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.1',
    models: [],
  },
  {
    id: 'claude',
    label: 'Claude',
    icon: 'asterisk',
    meta: 'Opus 5 · Sonnet 5',
    status: 'operational',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-5',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: 'diamond',
    meta: '3.8 Flash · 2.5 Flash-Lite',
    status: 'operational',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.6-flash',
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
    meta: '280+ models, one key',
    status: 'operational',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    models: [],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    icon: 'waves',
    meta: 'V3 · R1 reasoning',
    status: 'operational',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    icon: 'wind',
    meta: 'Large · Codestral',
    status: 'operational',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    models: [],
  },
  {
    id: 'grok',
    label: 'Grok',
    icon: 'square-x',
    meta: 'Grok 4 · fast',
    status: 'degraded',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    models: [],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    icon: 'hard-drive',
    meta: 'Local · no data leaves',
    status: 'not running',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    models: [],
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: 'code',
    meta: 'Any OpenAI-compatible API',
    status: 'configure',
    baseUrl: '',
    defaultModel: '',
    models: [],
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

/** The catalogue entry for a provider; falls back to the default provider. */
export function findProvider(id: AiProvider): AiProviderDefinition {
  return AI_PROVIDERS.find((provider) => provider.id === id) ?? AI_PROVIDERS[2];
}

/**
 * Display name for the configured model — the catalogue label where one
 * exists, the raw id otherwise (free-text adapters name their own models).
 */
export function describeModel(ai: AiSettings): string {
  const provider = findProvider(ai.provider);
  const model = provider.models.find((entry) => entry.id === ai.model);
  if (model !== undefined) return model.label;
  return ai.model === '' ? provider.label : ai.model;
}

/* ── defaults ───────────────────────────────────────────────────────────── */

const DEFAULT_PROVIDER = findProvider(DEFAULT_AI_PROVIDER);

/**
 * What a fresh install — and every reset — starts from.
 *
 * Credentials are empty by design: a key that ships in source is a key that
 * leaks, and this app has no server side to hold one.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  api: {
    baseUrl: DEFAULT_API_BASE_URL,
    token: '',
  },
  ai: {
    provider: DEFAULT_AI_PROVIDER,
    baseUrl: DEFAULT_PROVIDER.baseUrl,
    apiKey: '',
    orgId: '',
    model: DEFAULT_PROVIDER.defaultModel,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    temperature: 0.2,
    maxTokens: 4_096,
  },
  features: {
    maskSecrets: true,
    autoDiagnostics: false,
  },
  data: {
    freshnessMinutes: DEFAULT_FRESHNESS_MINUTES,
  },
};
