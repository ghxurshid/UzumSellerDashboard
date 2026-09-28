import type { AiProvider, AiSettings } from '@/types/settings';

/**
 * Facts about a model id that decide what the wire dialect may send it, and
 * the header/config fragments built from those facts — shared by `client.ts`
 * (one-shot) and `stream.ts` (streaming) so the two request paths cannot
 * describe the same model, or the same provider's auth, two different ways.
 *
 * Anthropic and OpenAI both grew a "reasoning" model family that rejects a
 * request shape the previous generation accepted without complaint — sending
 * `temperature` to a model that removed it is a 400, but *omitting* it never
 * is, on any model, in either dialect. So every rule below is an allowlist: a
 * model has to be named, or match a named prefix, before this reaches for the
 * field that could break it. An id this catalogue does not recognise —
 * because it is new, a preview, or a typo — gets the conservative request,
 * not a guess.
 */

/**
 * Longest matching prefix wins, so a more specific id is never shadowed by a
 * shorter one that happens to prefix it (`claude-opus-4` — 4.0/4.1, allowed —
 * must not be shadowed by `claude-opus-4-6`, and must not itself shadow
 * `claude-opus-4-7`/`-4-8`, which start with the same six characters).
 */
function matchPrefix<T>(id: string, table: ReadonlyArray<readonly [string, T]>, fallback: T): T {
  const lower = id.trim().toLowerCase();
  let best = fallback;
  let bestLength = 0;

  for (const [prefix, value] of table) {
    if (lower.startsWith(prefix) && prefix.length > bestLength) {
      best = value;
      bestLength = prefix.length;
    }
  }

  return best;
}

/* ── Claude sampling ────────────────────────────────────────────────────── */

/**
 * Whether this Claude model accepts `temperature` at all.
 *
 * Anthropic removed the sampling parameters — a 400, not a warning — on Opus
 * 5, Sonnet 5 and the Opus 4.7/4.8 tier; they are still accepted on Opus 4.6,
 * Sonnet 4.6, Haiku 4.5 and everything older. The longest-prefix match is what
 * keeps `claude-opus-4` (4.0/4.1) from being shadowed by the newer
 * `claude-opus-4-6`/`-4-7`/`-4-8` rows below it, the same technique
 * `pricing.ts` already uses to keep `claude-opus-4`'s price from shadowing
 * them the other way.
 */
const CLAUDE_TEMPERATURE: ReadonlyArray<readonly [string, boolean]> = [
  ['claude-opus-5', false],
  ['claude-sonnet-5', false],
  ['claude-opus-4-8', false],
  ['claude-opus-4-7', false],
  ['claude-opus-4-6', true],
  ['claude-sonnet-4-6', true],
  ['claude-haiku-4-5', true],
  ['claude-opus-4', true],
  ['claude-sonnet-4', true],
  ['claude-haiku-4', true],
  ['claude-3-5-haiku', true],
  ['claude-3-5-sonnet', true],
  ['claude-3-opus', true],
  ['claude-3-sonnet', true],
  ['claude-3-haiku', true],
];

export function claudeSupportsTemperature(model: string): boolean {
  return matchPrefix(model, CLAUDE_TEMPERATURE, false);
}

/**
 * Whether `output_config: { effort }` is worth sending.
 *
 * It lowers how long Opus-5/Sonnet-5-class adaptive thinking runs before the
 * first word — the same trade the Gemini dialect makes with
 * `thinkingLevel: 'low'`, and one Anthropic explicitly prefers over disabling
 * thinking outright on these models. It errors on Haiku, which has no
 * thinking budget to trim.
 */
const CLAUDE_EFFORT: ReadonlyArray<readonly [string, boolean]> = [
  ['claude-opus-5', true],
  ['claude-sonnet-5', true],
  ['claude-opus-4-8', true],
  ['claude-opus-4-7', true],
  ['claude-opus-4-6', true],
  ['claude-sonnet-4-6', true],
  ['claude-haiku', false],
];

export function claudeSupportsEffort(model: string): boolean {
  return matchPrefix(model, CLAUDE_EFFORT, false);
}

/**
 * The sampling-related body fields for a Claude request — the one place
 * `client.ts` and `stream.ts` both read so a model's temperature/effort
 * treatment cannot drift between the streaming and one-shot paths.
 */
export function claudeSamplingFields(model: string, temperature: number): Record<string, unknown> {
  return {
    ...(claudeSupportsTemperature(model) ? { temperature } : {}),
    ...(claudeSupportsEffort(model) ? { output_config: { effort: 'low' } } : {}),
  };
}

/* ── OpenAI reasoning family ────────────────────────────────────────────── */

const OPENAI_REASONING_PREFIXES: readonly string[] = ['gpt-5', 'gpt-6', 'o1', 'o3', 'o4'];

/** gpt-5*, gpt-6*, o1/o3/o4* — the ids OpenAI's own docs call reasoning models. */
export function openAiIsReasoningModel(model: string): boolean {
  const id = model.trim().toLowerCase();
  return OPENAI_REASONING_PREFIXES.some((prefix) => id.startsWith(prefix));
}

const OPENAI_TEMPERATURE_ALLOW: readonly string[] = ['gpt-4.1', 'gpt-4o'];

/**
 * Whether OpenAI's Chat Completions accepts `temperature` for this id.
 *
 * Reasoning models never do — Astra, the family OpenAI's own guide says to
 * start with, is one of them. An id that is neither a known reasoning family
 * nor a known non-reasoning one is treated the same as an unrecognised Claude
 * id: left out, because omitting it has never produced a 400 and guessing
 * wrong has.
 */
export function openAiSendsTemperature(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (openAiIsReasoningModel(id)) return false;
  return OPENAI_TEMPERATURE_ALLOW.some((prefix) => id.startsWith(prefix));
}

/**
 * The OpenAI-compatible body fields that vary by provider and model:
 * `max_tokens` vs. `max_completion_tokens`, `reasoning_effort`, and
 * DeepSeek's thinking toggle. Read by both request paths so a provider's
 * quirks are declared once.
 */
export function openAiCompatibleSamplingFields(
  provider: AiProvider,
  model: string,
  temperature: number,
  maxTokens: number,
): Record<string, unknown> {
  const isOpenAi = provider === 'openai';
  const reasoning = isOpenAi && openAiIsReasoningModel(model);

  return {
    ...(samplingSupported({ provider, model }) ? { temperature } : {}),
    ...(isOpenAi ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(reasoning ? { reasoning_effort: 'low' } : {}),
    /* Our fixed 4 096-token default and the silent reasoning phase make
       DeepSeek's default high-effort thinking the wrong trade for a chat —
       and disabling it is also what makes `temperature` take effect again. */
    ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
  };
}

/* ── the one switch every dialect and the settings form read ───────────── */

/**
 * Whether the sampling slider in Settings does anything for this model.
 *
 * `client.ts` and `stream.ts` call this to decide whether to put `temperature`
 * on the wire; the settings form calls the exact same function to decide
 * whether to show the slider at all, so the two can never disagree about a
 * model the seller is looking at right now.
 */
export function samplingSupported(ai: Pick<AiSettings, 'provider' | 'model'>): boolean {
  if (ai.provider === 'claude') return claudeSupportsTemperature(ai.model);
  if (ai.provider === 'openai') return openAiSendsTemperature(ai.model);
  return true;
}

/* ── configuration ─────────────────────────────────────────────────────── */

/** Only a local runtime and a seller-supplied gateway can go without a key. */
export function requiresApiKey(provider: AiProvider): boolean {
  return provider !== 'ollama' && provider !== 'custom';
}

/**
 * Whether there is enough here to send a request at all.
 *
 * `streamComplete` and `complete` used to each inline their own
 * `apiKey.trim() === ''` check, which is wrong the moment a provider that
 * takes no key exists — an Ollama or custom endpoint with a blank key is a
 * normal, working setup, not a missing one. This is the one place that knows
 * the exception, so both request paths and the settings screen read it the
 * same way.
 */
export function isAiConfigured(
  ai: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey' | 'model'>,
): boolean {
  if (ai.baseUrl.trim() === '' || ai.model.trim() === '') return false;
  if (requiresApiKey(ai.provider) && ai.apiKey.trim() === '') return false;
  return true;
}

/**
 * Whether there is enough here to ask a provider which models it has.
 *
 * Deliberately not `isAiConfigured`: listing models is exactly the tool a
 * seller reaches for *because* the model field is still blank — a fresh
 * Ollama, custom, or OpenRouter connection — so gating "Load models" on a
 * model id already being filled in would make the button that fills it
 * unreachable until it is no longer needed. A model has no bearing on which
 * endpoint answers `GET /models` or what key it wants, so only the base URL
 * and (where the provider needs one) the key matter here.
 */
export function canListModels(
  ai: Pick<AiSettings, 'provider' | 'baseUrl' | 'apiKey'>,
): boolean {
  if (ai.baseUrl.trim() === '') return false;
  if (requiresApiKey(ai.provider) && ai.apiKey.trim() === '') return false;
  return true;
}

/* ── headers ────────────────────────────────────────────────────────────── */

/** Anthropic blocks browser calls unless this header opts in explicitly. */
export const ANTHROPIC_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';
export const ANTHROPIC_VERSION = '2023-06-01';

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    [ANTHROPIC_BROWSER_HEADER]: 'true',
  };
}

export function geminiHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
}

/**
 * The header set every OpenAI-compatible dialect sends.
 *
 * A key is optional for exactly the two providers `requiresApiKey` excludes,
 * and a bare `Bearer ` with nothing after it is worse than sending no header
 * at all — several gateways treat it as a malformed credential rather than an
 * anonymous request. The organisation header is OpenAI's own concept: the
 * settings form only ever offers an org id for `provider === 'openai'`, but a
 * value left over from a provider switch must never ride along to a
 * different vendor's endpoint.
 */
export function openAiCompatibleHeaders(
  provider: AiProvider,
  apiKey: string,
  orgId: string,
): Record<string, string> {
  const key = apiKey.trim();
  return {
    'content-type': 'application/json',
    ...(key === '' ? {} : { authorization: `Bearer ${key}` }),
    ...(provider === 'openai' && orgId.trim() !== '' ? { 'openai-organization': orgId } : {}),
  };
}
