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
 * The adapter the analysis layer is pointed at — one key per entry in the
 * provider catalogue. Eight are named vendors or self-hosted runtimes; `custom`
 * is any OpenAI-compatible endpoint the seller supplies themselves.
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

/**
 * One provider's own connection, kept while another provider is the active one.
 *
 * A key belongs to the vendor that issued it. Keeping each provider's connection
 * apart is what stops a switch from sending one vendor's secret to another's
 * endpoint, and lets the seller switch back without pasting it in again.
 */
export interface AiConnection {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly orgId: string;
  readonly model: string;
}

/** Uzum seller API connection. */
export interface UzumApiSettings {
  /** Base URL every request is prefixed with. */
  readonly baseUrl: string;
  /** Raw `Authorization` value — empty until the user pastes one in. */
  readonly token: string;
}

/**
 * AI provider connection and sampling.
 *
 * The flat connection fields describe the ACTIVE provider only, so every
 * consumer that talks to the model reads one connection and never has to know
 * the others exist. The inactive providers' connections wait in `saved` until
 * the seller switches back to them.
 */
export interface AiSettings {
  readonly provider: AiProvider;
  /** The active provider's endpoint. */
  readonly baseUrl: string;
  /** The active provider's key — empty until the seller pastes one in. */
  readonly apiKey: string;
  /** The active provider's organisation id — empty unless the provider takes one (only OpenAI does). */
  readonly orgId: string;
  /** Model id as the active provider spells it, e.g. `gemini-3.6-flash`. */
  readonly model: string;
  readonly timeoutMs: number;
  readonly temperature: number;
  readonly maxTokens: number;
  /**
   * Connections of the providers that are not active. Never holds an entry for
   * `provider` — the active connection lives in the flat fields above, and a
   * second copy here could only drift from it.
   */
  readonly saved: Readonly<Partial<Record<AiProvider, AiConnection>>>;
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

/**
 * How the endpoint field is offered.
 *
 * - `fixed` — the vendor's own URL; editable only under "advanced", because a
 *   seller who changes it by accident gets a connection that can never answer.
 * - `editable` — shown up front, with a self-hosted default such as Ollama's
 *   local address that the seller is expected to adjust.
 * - `required` — no default exists; the seller must fill it in (`custom`).
 */
export type AiEndpointMode = 'fixed' | 'editable' | 'required';

/**
 * A catalogue entry: the static facts the settings form needs to lay out one
 * provider's connection.
 *
 * It deliberately carries no health status — the catalogue is compiled into the
 * bundle and cannot know whether a vendor is up, so any status it claimed would
 * be a fixed string presented as a live reading. Whether the provider needs a
 * key is not here either: that is the transport's knowledge
 * (`requiresApiKey()` in `services/ai`), kept in one place.
 */
export interface AiProviderDefinition {
  readonly id: AiProvider;
  readonly label: string;
  /** `iconRegistry` name drawn on the provider card. */
  readonly icon: string;
  /** Default endpoint; empty where the seller must supply one. */
  readonly baseUrl: string;
  readonly endpoint: AiEndpointMode;
  /** Shown in the empty key field, e.g. `sk-ant-…`. */
  readonly keyPlaceholder: string;
  /** Where the seller creates a key; `null` for self-hosted adapters. */
  readonly keyUrl: string | null;
  /** Whether the provider takes an organisation header (OpenAI only). */
  readonly orgId: boolean;
  /** Suggested models. The seller may also load the key's own list or type an id. */
  readonly models: readonly AiModelOption[];
  readonly defaultModel: string;
}
