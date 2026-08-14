import {
  AI_PROVIDER_IDS,
  AI_TIMEOUT_OPTIONS,
  DEFAULT_FRESHNESS_MINUTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SETTINGS,
  FRESHNESS_OPTIONS,
  MAX_TOKENS_BOUNDS,
  MAX_TOKENS_STEP,
  SETTINGS_SCHEMA_VERSION,
  TEMPERATURE_BOUNDS,
  TEMPERATURE_STEP,
  TEXT_LIMITS,
  findProvider,
} from '@/constants/settings';
import type {
  AiProvider,
  AiSettings,
  AppSettings,
  DataSettings,
  FeatureFlags,
  SettingsEnvelope,
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

function sanitizeAi(value: unknown): AiSettings {
  const raw = asRecord(value);
  const defaults = DEFAULT_SETTINGS.ai;

  const provider = oneOf<AiProvider>(raw['provider'], AI_PROVIDER_IDS, defaults.provider);
  const definition = findProvider(provider);

  /* A catalogued adapter constrains the model to its list; a free-text adapter
     names its own models, so anything is accepted there. */
  const model = text(raw['model'], definition.defaultModel, TEXT_LIMITS.identifier);
  const resolved = definition.models.length === 0
    ? model
    : (definition.models.find((entry) => entry.id === model)?.id ?? definition.defaultModel);

  return {
    provider,
    baseUrl: requiredText(raw['baseUrl'], definition.baseUrl, TEXT_LIMITS.url),
    apiKey: text(raw['apiKey'], defaults.apiKey, TEXT_LIMITS.secret),
    orgId: text(raw['orgId'], defaults.orgId, TEXT_LIMITS.identifier),
    model: resolved,
    timeoutMs: oneOf(toNumber(raw['timeoutMs']), AI_TIMEOUT_OPTIONS, DEFAULT_REQUEST_TIMEOUT_MS),
    temperature: decimal(
      raw['temperature'],
      defaults.temperature,
      TEMPERATURE_BOUNDS.min,
      TEMPERATURE_BOUNDS.max,
      TEMPERATURE_STEP,
    ),
    maxTokens: integer(
      raw['maxTokens'],
      defaults.maxTokens,
      MAX_TOKENS_BOUNDS.min,
      MAX_TOKENS_BOUNDS.max,
      MAX_TOKENS_STEP,
    ),
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
