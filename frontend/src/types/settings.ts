/**
 * Client-side settings model.
 *
 * These are the user-configurable values the app persists between sessions:
 * where it talks to, which credentials it presents, which model answers, and
 * which integration flags are on. They are deliberately kept out of
 * `types/domain.ts` — that file mirrors the seller API, this one describes the
 * local installation.
 *
 * The AI section stores every provider's whole configuration side by side,
 * keyed by provider, next to a pointer naming the one the Copilot uses. A key
 * belongs to the vendor that issued it, and a sampling or reasoning value chosen
 * for one vendor's model says nothing about another's, so no value is shared
 * between providers: making a provider active moves the pointer and nothing
 * else, and every other provider's configuration stays exactly as it was left.
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
 * One vocabulary for reasoning depth across OpenAI, OpenRouter, xAI and
 * Anthropic; each accepts a per-model subset (decided in
 * `services/ai/modelRules.ts`).
 *
 * The vendors spell the field differently (`reasoning.effort`,
 * `reasoning_effort`, `output_config.effort`) but grade it on one scale, so a
 * single union lets the card offer one control and leaves the per-model subset
 * and the wire spelling to the transport, where they are known.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Gemini 3's `thinkingConfig.thinkingLevel`; the accepted subset depends on the
 * model. Kept apart from `ReasoningEffort` because it is a different request
 * field with its own scale, and folding it in would offer Gemini values it
 * refuses.
 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/**
 * The provider-specific fields of `AiConnection`. A catalogue entry lists the
 * ones its card offers, so a card never shows a field its provider would ignore.
 */
export type AiParam =
  | 'orgId'
  | 'projectId'
  | 'reasoningEffort'
  | 'anthropicVersion'
  | 'thinkingLevel'
  | 'appUrl'
  | 'appTitle'
  | 'thinking';

/**
 * One provider's whole configuration — every value a request to it is built
 * from.
 *
 * Nothing here is shared between providers. A key belongs to the vendor that
 * issued it, and keeping each provider's configuration apart is what stops a
 * switch from sending one vendor's secret to another's endpoint, or one model's
 * sampling to a model it was never chosen for. A field a provider does not use
 * keeps its default and is never sent.
 */
export interface AiConnection {
  /** The provider's endpoint. */
  readonly baseUrl: string;
  /** The provider's key — empty until the seller pastes one in. */
  readonly apiKey: string;
  /** Model id as the provider spells it, e.g. `gemini-3.6-flash`. */
  readonly model: string;
  readonly timeoutMs: number;
  readonly temperature: number;
  /**
   * The seller's output-token ceiling, not the figure sent. The top of
   * `MAX_TOKENS_BOUNDS` (the default) means "Auto": the app's balanced output
   * budget for the chosen model, enough for a complete answer without spending
   * the provider's limits for nothing. Any other value is the seller's own
   * ceiling, clamped to the model's published ceiling, so asking for exactly
   * that ceiling is how the model's maximum is requested; where no ceiling is
   * published it is capped at `UNKNOWN_CEILING_SLIDER_TOP` instead. The transport
   * resolves the stored value per model through `effectiveMaxTokens` /
   * `balancedMaxTokens` in `services/ai/modelRules.ts`, which own the figures.
   */
  readonly maxTokens: number;
  /** OpenAI `OpenAI-Organization` header; '' = not sent. */
  readonly orgId: string;
  /** OpenAI `OpenAI-Project` header; '' = not sent. */
  readonly projectId: string;
  /**
   * '' = the provider's own default (field not sent). OpenAI
   * `reasoning.effort`, OpenRouter `reasoning.effort`, xAI `reasoning_effort`,
   * Anthropic `output_config.effort`.
   */
  readonly reasoningEffort: ReasoningEffort | '';
  /** Anthropic `anthropic-version` header. */
  readonly anthropicVersion: string;
  /** Gemini 3+ thinking level; '' = the model's default. */
  readonly thinkingLevel: ThinkingLevel | '';
  /** OpenRouter `HTTP-Referer` attribution header; '' = not sent. */
  readonly appUrl: string;
  /** OpenRouter `X-OpenRouter-Title` attribution header; '' = not sent. */
  readonly appTitle: string;
  /** DeepSeek `thinking.type`: true = enabled. */
  readonly thinking: boolean;
}

/** Uzum seller API connection. */
export interface UzumApiSettings {
  /** Base URL every request is prefixed with. */
  readonly baseUrl: string;
  /** Raw `Authorization` value — empty until the user pastes one in. */
  readonly token: string;
}

/**
 * What is stored: which provider the Copilot uses, and every provider's own
 * configuration.
 *
 * `providers` holds an entry for every provider, not only the ones the seller
 * has touched, so a card always has a complete configuration to show and no
 * reader needs a fallback. The active provider's configuration lives in
 * `providers` like every other — there is no second copy of it that could drift.
 */
export interface AiSection {
  readonly provider: AiProvider;
  readonly providers: Readonly<Record<AiProvider, AiConnection>>;
}

/**
 * What the transport reads: one provider's configuration together with its id.
 *
 * A request talks to one provider at a time, so the transport receives that
 * provider's configuration flat and never has to know the others exist. It is
 * resolved from `AiSection` by a pure helper and never stored itself — a stored
 * copy could only drift from the section it came from.
 */
export interface AiSettings extends AiConnection {
  readonly provider: AiProvider;
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
  readonly ai: AiSection;
  readonly features: FeatureFlags;
  readonly data: DataSettings;
}

export type SettingsSection = keyof AppSettings;

/**
 * A partial write: any subset of sections, any subset of their fields.
 *
 * Partial one level deep only — for `ai`, `providers` is still the whole map,
 * so a write that carries it carries every provider's configuration.
 */
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
 * provider's card.
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
  /** Suggested models. The seller may also load the key's own list or type an id. */
  readonly models: readonly AiModelOption[];
  readonly defaultModel: string;
  /** Provider-specific request parameters this provider's card offers, in display order. */
  readonly params: readonly AiParam[];
  /**
   * This provider's own defaults over the app-wide ones (temperature 0.2,
   * maxTokens "Auto" — the balanced per-model budget from
   * `services/ai/modelRules.ts`, timeout 60 s, '' / false for params).
   */
  readonly defaults?: Partial<Omit<AiConnection, 'baseUrl' | 'apiKey' | 'model'>>;
}
