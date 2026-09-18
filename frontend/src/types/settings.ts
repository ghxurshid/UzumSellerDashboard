/**
 * Client-side settings model.
 *
 * These are the user-configurable values the app persists between sessions:
 * where it talks to, which credentials it presents, which model answers, and
 * which integration flags are on. They are deliberately kept out of
 * `types/domain.ts` — that file mirrors the seller API, this one describes the
 * local installation.
 *
 * Everything here is stored in the browser, in the `kv` store of the local
 * IndexedDB database, so it is readable by any script running on the page. That
 * is acceptable for credentials the user pastes in themselves; it is never
 * acceptable for a server-side secret. See `services/storage/settings.service.ts`.
 */

/**
 * The adapter the analysis layer is pointed at. Keys match the design's
 * provider registry — nine adapters plus the inert "add" card it draws
 * alongside them.
 */
export type AiProvider =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'openrouter'
  | 'deepseek'
  | 'mistral'
  | 'grok'
  | 'ollama'
  | 'custom';

/** Registry health as the design's provider cards report it. */
export type ProviderStatus = 'operational' | 'degraded' | 'not running' | 'configure';

/** Uzum seller API connection. */
export interface UzumApiSettings {
  /** Base URL every request is prefixed with. */
  readonly baseUrl: string;
  /** Raw `Authorization` value — empty until the user pastes one in. */
  readonly token: string;
}

/** AI provider connection and sampling. */
export interface AiSettings {
  readonly provider: AiProvider;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly orgId: string;
  /** Model id as the provider spells it, e.g. `gemini-3.6-flash`. */
  readonly model: string;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxTokens: number;
}

/** Integration flags — behaviour the user opts into, not screen state. */
export interface FeatureFlags {
  /** Credential fields render masked until explicitly revealed. */
  readonly maskSecrets: boolean;
  /** Connection diagnostics run as soon as the API pane opens. */
  readonly autoDiagnostics: boolean;
}

/**
 * How the local buffer behaves.
 *
 * Every screen reads from IndexedDB, never from the API directly, so these are
 * the settings that decide when the buffer goes back to Uzum for more.
 */
export interface DataSettings {
  /**
   * How long a re-readable payload — the catalogue, stock levels, open orders —
   * stays good enough to serve without asking Uzum again.
   *
   * It applies only to data that has no fixed period and therefore can never be
   * "complete": a stock level is a claim about right now, so the only question
   * is how old a claim may be. Settled history is not governed by this at all;
   * a sale that happened is a fact, and the buffer keeps it for good.
   */
  readonly freshnessMinutes: number;
}

export interface AppSettings {
  readonly api: UzumApiSettings;
  readonly ai: AiSettings;
  readonly features: FeatureFlags;
  readonly data: DataSettings;
}

export type SettingsSection = keyof AppSettings;

/** A partial write: any subset of sections, any subset of their fields. */
export type SettingsPatch = {
  readonly [K in SettingsSection]?: Partial<AppSettings[K]>;
};

/** What actually sits in the `kv` store — the payload plus its schema version. */
export interface SettingsEnvelope {
  readonly version: number;
  readonly settings: AppSettings;
}

/* ── provider catalogue ─────────────────────────────────────────────────── */

/**
 * A model's published rate limits, as the provider's console states them for the
 * project's current tier. All three are positive integers. A model whose limit is
 * zero on any axis cannot answer at all and is not offered in the catalogue.
 *
 * They are a claim about the provider's project quota, which every client of
 * that key draws on — not about this browser alone. A meter built on them can
 * count only the requests this browser sent, so it describes an upper bound on
 * what is left, never the exact remainder.
 */
export interface ModelRateLimits {
  /** Requests per minute. */
  readonly rpm: number;
  /** Input tokens per minute — Gemini counts the prompt, not the answer. */
  readonly tpm: number;
  /** Requests per day; the day ends at midnight Pacific time. */
  readonly rpd: number;
}

export interface AiModelOption {
  readonly id: string;
  readonly label: string;
  /** Published limits, where the provider publishes them per model. Absent means unknown — never "unlimited". */
  readonly limits?: ModelRateLimits;
}

export interface AiProviderDefinition {
  readonly id: AiProvider;
  readonly label: string;
  /** `iconRegistry` name drawn on the provider card. */
  readonly icon: string;
  /** The one-line model summary the card shows under its name. */
  readonly meta: string;
  readonly status: ProviderStatus;
  readonly baseUrl: string;
  /** Known models. Empty means the provider takes a free-text model id. */
  readonly models: readonly AiModelOption[];
  readonly defaultModel: string;
}
