import {
  AI_PROVIDER_IDS,
  AI_TIMEOUT_OPTIONS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_FRESHNESS_MINUTES,
  DEFAULT_SETTINGS,
  FRESHNESS_OPTIONS,
  MAX_TOKENS_BOUNDS,
  MAX_TOKENS_STEP,
  SETTINGS_SCHEMA_VERSION,
  TEMPERATURE_BOUNDS,
  TEMPERATURE_STEP,
  TEXT_LIMITS,
  defaultAiConnection,
} from '@/constants/settings';
import type {
  AiConnection,
  AiProvider,
  AiSection,
  AppSettings,
  DataSettings,
  FeatureFlags,
  ReasoningEffort,
  SettingsEnvelope,
  ThinkingLevel,
  UzumApiSettings,
} from '@/types/settings';

/**
 * Schema layer: turn whatever is in localStorage into a valid `AppSettings`.
 *
 * The store is a string a user can edit, an extension can clobber and an older
 * build can have written in a different shape. Nothing here trusts it. Every
 * field is checked independently and falls back to its default on its own, so
 * one bad value costs one setting rather than the whole configuration.
 */

/* ── primitives ─────────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  /* Only non-blank strings — `Number('')` and `Number(null)` are both 0, which
     would silently turn a missing field into a legitimate-looking zero. */
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Optional free text — an empty result is meaningful (no credential set). */
function text(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

/** Free text that must not be blank, e.g. a base URL requests are built from. */
function requiredText(value: unknown, fallback: string, maxLength: number): string {
  const parsed = text(value, fallback, maxLength);
  return parsed === '' ? fallback : parsed;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number, step = 1): number {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  const stepped = Math.round(clamp(parsed, min, max) / step) * step;
  return clamp(stepped, min, max);
}

function decimal(value: unknown, fallback: number, min: number, max: number, step: number): number {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  const stepped = Math.round(clamp(parsed, min, max) / step) * step;
  /* Snapping reintroduces float noise (0.30000000000000004); round it off. */
  return Number(stepped.toFixed(2));
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/* ── sections ───────────────────────────────────────────────────────────── */

function sanitizeApi(value: unknown): UzumApiSettings {
  const raw = asRecord(value);
  const defaults = DEFAULT_SETTINGS.api;

  return {
    baseUrl: requiredText(raw['baseUrl'], defaults.baseUrl, TEXT_LIMITS.url),
    token: text(raw['token'], defaults.token, TEXT_LIMITS.secret),
  };
}

/**
 * Every value `oneOf` may accept for a reasoning-effort field, across every
 * vendor that offers one — '' first, so it is always the fallback a bad or
 * absent value resolves to alongside whatever the provider's own default
 * names. Kept here rather than in the catalogue: this is the sanitiser's own
 * exhaustive list of the type it validates, not a fact about any one vendor.
 */
const REASONING_EFFORT_OPTIONS: readonly (ReasoningEffort | '')[] = [
  '',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Same reasoning as `REASONING_EFFORT_OPTIONS`, for Gemini's thinking level. */
const THINKING_LEVEL_OPTIONS: readonly (ThinkingLevel | '')[] = [
  '',
  'minimal',
  'low',
  'medium',
  'high',
];

/**
 * One provider's whole connection, field by field, against `provider`'s own
 * catalogue defaults — never the generic app-wide ones — so e.g. Claude's
 * blank `anthropicVersion` falls back to the required header value and not to
 * ''. A `value` that is not an object at all (a provider the seller never
 * configured, or a corrupt entry) sanitizes straight to that provider's own
 * fresh defaults, and never borrows a field from another provider or from the
 * currently active one.
 */
function sanitizeConnection(value: unknown, provider: AiProvider): AiConnection {
  const raw = asRecord(value);
  const fallback = defaultAiConnection(provider);

  return {
    /* Blank falls back to the catalogue's own endpoint, which is legitimately
       '' for `custom` — there is nothing else to fall back to. */
    baseUrl: requiredText(raw['baseUrl'], fallback.baseUrl, TEXT_LIMITS.url),
    apiKey: text(raw['apiKey'], fallback.apiKey, TEXT_LIMITS.secret),
    /* The settings form offers three ways to name a model: the catalogue's
       suggested list, whatever the provider's own `/models` endpoint returns
       for the seller's key, and free text. None of those is ours to
       second-guess, so any non-blank id within the length limit is accepted
       as-is; only a blank value falls back to the catalogue default. */
    model: requiredText(raw['model'], fallback.model, TEXT_LIMITS.identifier),
    timeoutMs: oneOf(toNumber(raw['timeoutMs']), AI_TIMEOUT_OPTIONS, fallback.timeoutMs),
    temperature: decimal(
      raw['temperature'],
      fallback.temperature,
      TEMPERATURE_BOUNDS.min,
      TEMPERATURE_BOUNDS.max,
      TEMPERATURE_STEP,
    ),
    maxTokens: integer(
      raw['maxTokens'],
      fallback.maxTokens,
      MAX_TOKENS_BOUNDS.min,
      MAX_TOKENS_BOUNDS.max,
      MAX_TOKENS_STEP,
    ),
    orgId: text(raw['orgId'], fallback.orgId, TEXT_LIMITS.identifier),
    projectId: text(raw['projectId'], fallback.projectId, TEXT_LIMITS.identifier),
    reasoningEffort: oneOf(raw['reasoningEffort'], REASONING_EFFORT_OPTIONS, fallback.reasoningEffort),
    /* Required — never plain `text` — so Claude, the one provider whose every
       request needs this header, can never end up persisting a blank value
       merely because a stored payload happened to carry one. Every other
       provider's own default is already '', so this changes nothing for them. */
    anthropicVersion: requiredText(
      raw['anthropicVersion'],
      fallback.anthropicVersion,
      TEXT_LIMITS.identifier,
    ),
    thinkingLevel: oneOf(raw['thinkingLevel'], THINKING_LEVEL_OPTIONS, fallback.thinkingLevel),
    appUrl: text(raw['appUrl'], fallback.appUrl, TEXT_LIMITS.url),
    appTitle: text(raw['appTitle'], fallback.appTitle, TEXT_LIMITS.identifier),
    thinking: flag(raw['thinking'], fallback.thinking),
  };
}

/**
 * Every provider's connection, independently sanitized against `provider`'s
 * own catalogue id — never against whatever key the stored payload happens to
 * carry. Iterating `AI_PROVIDER_IDS` rather than `Object.keys(raw)` means an
 * id this build no longer knows about is silently dropped, and every id it
 * does know about is always present: a card never has to fall back to a
 * fabricated connection because its provider is missing from the map.
 */
function sanitizeProviders(value: unknown): Readonly<Record<AiProvider, AiConnection>> {
  const raw = asRecord(value);
  const entries = AI_PROVIDER_IDS.map((id) => [id, sanitizeConnection(raw[id], id)] as const);

  /* Exhaustive by construction — one tuple per id in AI_PROVIDER_IDS, which
     enumerates the whole AiProvider union — not a claim the compiler can
     check from a `.map` over an array, hence the cast. */
  return Object.fromEntries(entries) as Readonly<Record<AiProvider, AiConnection>>;
}

function sanitizeAi(value: unknown): AiSection {
  const raw = asRecord(value);

  return {
    provider: oneOf<AiProvider>(raw['provider'], AI_PROVIDER_IDS, DEFAULT_AI_PROVIDER),
    providers: sanitizeProviders(raw['providers']),
  };
}

function sanitizeFeatures(value: unknown): FeatureFlags {
  const raw = asRecord(value);
  const defaults = DEFAULT_SETTINGS.features;

  return {
    maskSecrets: flag(raw['maskSecrets'], defaults.maskSecrets),
    autoDiagnostics: flag(raw['autoDiagnostics'], defaults.autoDiagnostics),
  };
}

function sanitizeData(value: unknown): DataSettings {
  const raw = asRecord(value);

  return {
    /* Snapped to the offered spread rather than clamped to a range: a value
       between two options would be honoured but never selectable again in the
       UI, which is how a setting becomes impossible to change back. */
    freshnessMinutes: oneOf(
      toNumber(raw['freshnessMinutes']),
      FRESHNESS_OPTIONS,
      DEFAULT_FRESHNESS_MINUTES,
    ),
  };
}

/** The one entry point that guarantees a complete, in-range `AppSettings`. */
export function sanitizeSettings(value: unknown): AppSettings {
  const raw = asRecord(value);

  return {
    api: sanitizeApi(raw['api']),
    ai: sanitizeAi(raw['ai']),
    features: sanitizeFeatures(raw['features']),
    data: sanitizeData(raw['data']),
  };
}

/* ── migrations ─────────────────────────────────────────────────────────── */

export type SettingsMigration = (settings: unknown) => unknown;

/** v1 provider keys → the design's registry keys used from v2 on. */
const V1_PROVIDER_KEYS: Readonly<Record<string, AiProvider>> = {
  google: 'gemini',
  anthropic: 'claude',
};

/**
 * `version` → the step that upgrades a payload written at that version to the
 * next one.
 *
 * To add one: bump `SETTINGS_SCHEMA_VERSION`, then register the step under the
 * version it upgrades *from*. Steps run in sequence, so a v1 store reaches v3
 * through v2 without a bespoke path. A step only has to move fields — the
 * sanitiser still validates whatever it produces.
 */
const MIGRATIONS: Readonly<Record<number, SettingsMigration>> = {
  /* v1 → v2: rename two provider keys, drop the separate model tier, and move
     the request timeout from the Uzum section onto the provider. */
  1: (settings) => {
    const root = asRecord(settings);
    const api = asRecord(root['api']);
    const ai = asRecord(root['ai']);
    const provider = ai['provider'];

    const renamed =
      typeof provider === 'string' && provider in V1_PROVIDER_KEYS
        ? V1_PROVIDER_KEYS[provider]
        : provider;

    const nextApi: Record<string, unknown> = { ...api };
    const nextAi: Record<string, unknown> = {
      ...ai,
      provider: renamed,
      timeoutMs: ai['timeoutMs'] ?? api['timeoutMs'],
    };
    delete nextApi['timeoutMs'];
    delete nextAi['modelTier'];

    return { ...root, api: nextApi, ai: nextAi };
  },

  /* v2 → v3: the `data` section arrives with the local buffer. There is nothing
     to move — the section simply did not exist — so the step only has to make
     it present, and the sanitiser fills in the default. */
  2: (settings) => {
    const root = asRecord(settings);
    return { ...root, data: asRecord(root['data']) };
  },

  /* v3 → v4: the default freshness rose from fifteen minutes to sixty. A
     stored fifteen is indistinguishable from a seller who never opened the
     pane, and is exactly the value the new default replaces, so it moves
     forward with it. Any other stored value — including a fifteen chosen on
     purpose after this step has already run once — is a deliberate choice and
     is left alone. */
  3: (settings) => {
    const root = asRecord(settings);
    const data = asRecord(root['data']);
    if (data['freshnessMinutes'] !== 15) return root;

    return { ...root, data: { ...data, freshnessMinutes: DEFAULT_FRESHNESS_MINUTES } };
  },

  /**
   * v4 → v5: one shared `ai` connection becomes nine independent ones.
   *
   * v4 never got its own version bump when `saved` was added (see commit
   * 864c4dd), so two different payloads both carry version 4 and both must
   * migrate cleanly here:
   *
   *   (a) the deployed shape — flat `provider`/`baseUrl`/`apiKey`/`orgId`/
   *       `model`/`timeoutMs`/`temperature`/`maxTokens`, no `saved` at all.
   *       This is the shape that let a provider switch leak the previous
   *       vendor's key into the new one's fields — the bug this release
   *       fixes — so there is nothing to recover for a provider the seller
   *       had switched away from; only the active one carried real data.
   *   (b) the shape with `saved`: the same flat fields, plus `saved[id]` for
   *       every provider the seller had switched away from, holding that
   *       provider's own `baseUrl`/`apiKey`/`orgId`/`model` (never its own
   *       timeout or sampling — v4 had only one shared value for those).
   *
   * `providers[activeProvider]` gets the flat fields whole, including the
   * shared timeout/temperature/maxTokens it was actually serving requests
   * with. `providers[id]` for every `id` in `saved` gets that saved
   * connection *plus* the same shared timeout/temperature/maxTokens — the
   * seller's one choice applied to every provider it actually governed, not
   * only the one active when this step runs. A provider that was never
   * configured and never saved is left absent here; `sanitizeAi` fills it
   * with its own catalogue defaults, never with another provider's values.
   */
  4: (settings) => {
    const root = asRecord(settings);
    const ai = asRecord(root['ai']);
    const activeProvider = ai['provider'];
    const saved = asRecord(ai['saved']);

    /* Only the keys v4 actually shared across every provider — not the whole
       `ai` record — so a field this step does not know about never rides
       along into a provider it was never chosen for. */
    const shared: Record<string, unknown> = {};
    if ('timeoutMs' in ai) shared['timeoutMs'] = ai['timeoutMs'];
    if ('temperature' in ai) shared['temperature'] = ai['temperature'];
    if ('maxTokens' in ai) shared['maxTokens'] = ai['maxTokens'];

    const providers: Record<string, unknown> = {};

    if (typeof activeProvider === 'string') {
      providers[activeProvider] = {
        baseUrl: ai['baseUrl'],
        apiKey: ai['apiKey'],
        orgId: ai['orgId'],
        model: ai['model'],
        ...shared,
      };
    }

    for (const [id, entry] of Object.entries(saved)) {
      /* The active provider's connection was just built above, from the flat
         fields — the live ones, not whatever a stale `saved` entry under the
         same id might also hold. A healthy v4 payload never saved the active
         provider in the first place, but a corrupt one is not allowed to
         overwrite the connection that was actually in use. */
      if (id === activeProvider) continue;
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      providers[id] = { ...entry, ...shared };
    }

    return { ...root, ai: { provider: activeProvider, providers } };
  },

  /* v5 → v6: the default output-token budget rose from 4,096 to "Auto" (the
     app's balanced output budget for the model, stored as the sentinel
     `MAX_TOKENS_BOUNDS.max`, which is never sent as-is — the transport resolves
     it in `effectiveMaxTokens` / `balancedMaxTokens`, services/ai/modelRules.ts).
     A stored 4,096 is
     indistinguishable from a seller who never touched the slider, and is
     exactly the value the new default replaces, so it moves forward with it.
     Any other stored value — including a 4,096 chosen on purpose after this
     step has already run once — is a deliberate choice and is left alone. */
  5: (settings) => {
    const root = asRecord(settings);
    const ai = asRecord(root['ai']);
    const providers = asRecord(ai['providers']);

    const next: Record<string, unknown> = {};
    for (const [id, entry] of Object.entries(providers)) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        next[id] = entry;
        continue;
      }
      const connection = entry as Record<string, unknown>;
      next[id] =
        connection['maxTokens'] === 4_096
          ? { ...connection, maxTokens: MAX_TOKENS_BOUNDS.max }
          : connection;
    }

    return { ...root, ai: { ...ai, providers: next } };
  },
};

function migrate(payload: unknown, fromVersion: number): unknown {
  let current = payload;

  for (let version = fromVersion; version < SETTINGS_SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    /* No registered path — hand what we have to the sanitiser, which recovers
       every field it still recognises and defaults the rest. A store written
       by a *newer* build lands here too, and is treated the same way. */
    if (step === undefined) return current;
    try {
      current = step(current);
    } catch {
      return current;
    }
  }

  return current;
}

/* ── envelope ───────────────────────────────────────────────────────────── */

/**
 * What actually goes into the store.
 *
 * An object rather than a JSON string, because IndexedDB stores structured
 * clones: stringifying first would cost a serialise on every write and a parse
 * on every read, to produce the same object graph the engine would have stored
 * anyway. The version rides along so a payload written by an older build can be
 * migrated rather than discarded.
 */
export function settingsEnvelope(settings: AppSettings): SettingsEnvelope {
  return { version: SETTINGS_SCHEMA_VERSION, settings };
}

/**
 * Turn whatever came back out of storage into a valid `AppSettings`.
 *
 * Takes `unknown` rather than a string: the value arrives as a structured clone,
 * and the only thing that can be assumed about it is that some build of this
 * application wrote it. Missing, malformed and out-of-date payloads all resolve
 * to a usable configuration rather than throwing.
 *
 * A JSON string is still accepted, because the one-shot import from the previous
 * localStorage engine hands one straight through.
 */
export function parseStoredSettings(value: unknown): AppSettings {
  if (value === null || value === undefined) return DEFAULT_SETTINGS;

  let decoded: unknown = value;

  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  const envelope = asRecord(decoded);
  const version = toNumber(envelope['version']);

  return sanitizeSettings(
    migrate(envelope['settings'], Number.isFinite(version) ? version : 0),
  );
}
