import { MAX_TOKENS_BOUNDS } from '@/constants/settings';
import { ApiError } from '@/services/api/client';
import type { AiProvider, AiSettings, ReasoningEffort, ThinkingLevel } from '@/types/settings';

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
 *
 * Every provider now keeps its own complete configuration (`AiConnection` in
 * `types/settings.ts`) — a reasoning effort, a thinking level, an attribution
 * header — editable on that provider's own card and saved whether or not it
 * is the active one. This file is where that configuration turns into a
 * request: a value the seller chose that the *chosen model* does not accept
 * (Astra's `reasoning.effort` table has no `"none"`, a Gemini 2.x id has no
 * `thinkingConfig` at all) is dropped rather than sent — see
 * `reasoningEffortOptions`/`thinkingLevelOptions` and the private
 * `validReasoningEffort`/`validThinkingLevel` every sampling-field builder
 * below reads through.
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

/* ── output-token ceilings ──────────────────────────────────────────────── */

/**
 * When the ceilings below were last checked against each vendor's own model
 * page. They change with every model release — re-verify before editing.
 */
export const OUTPUT_CEILINGS_AS_OF = '2026-11-04';

/** What Auto sends when the model's ceiling is not known: the previous default. */
export const UNKNOWN_CEILING_MAX_TOKENS = 4_096;

/** Largest explicit value sent to a model of unknown ceiling: the old slider top, the most this app ever sent before. */
export const UNKNOWN_CEILING_SLIDER_TOP = 32_000;

/**
 * Published maximum output tokens, thinking/reasoning included. Exact ids
 * only: a provider that publishes no figure (Mistral publishes context
 * windows only, `grok-4.3`) or a gateway that proxies arbitrary models
 * (OpenRouter, Ollama, custom) is absent on purpose — never a guess.
 *
 * Sources, as of OUTPUT_CEILINGS_AS_OF:
 * - Gemini: ai.google.dev/gemini-api/docs/models/<id> and /docs/tokens
 *   ("Gemini 3 and 2.5: 65,536 output"); the thinking guide says the cap
 *   includes thinking tokens and a synchronous request above it is a 400.
 * - OpenAI: developers.openai.com/api/docs/models/<id>.
 * - Claude: Anthropic's models overview table.
 * - DeepSeek: api-docs.deepseek.com/quick_start/pricing (max_tokens 1..393,216).
 * - Grok: docs.x.ai/developers/models/grok-4.7 states no text output limit;
 *   xAI's best-practices guide gives 128,000 as the unset default, so it is
 *   a documented, accepted value.
 */
const OUTPUT_CEILINGS: Readonly<Partial<Record<AiProvider, Readonly<Record<string, number>>>>> = {
  gemini: {
    'gemini-3.8-flash': 65_536,
    'gemini-3.7-flash': 65_536,
    'gemini-3.6-flash': 65_536,
    'gemini-3.5-flash': 65_536,
    'gemini-3.5-flash-lite': 65_536,
    'gemini-3.1-flash-lite': 65_536,
    'gemini-3-flash-preview': 65_536,
    'gemini-2.5-flash': 65_536,
    'gemini-2.5-flash-lite': 65_536,
  },
  openai: { 'gpt-6-astra': 128_000, 'gpt-6-sol': 128_000, 'gpt-6-luna': 128_000 },
  claude: { 'claude-opus-5': 128_000, 'claude-sonnet-5': 128_000, 'claude-haiku-4-5': 64_000 },
  deepseek: { 'deepseek-v4-pro': 393_216, 'deepseek-flash': 393_216 },
  grok: { 'grok-4.7': 128_000 },
};

/** Published max output tokens (thinking/reasoning included), or null when not published. */
export function outputTokenCeiling(provider: AiProvider, model: string): number | null {
  const id = model.trim().toLowerCase();
  // Own-property lookup so an id like "constructor" cannot hit the prototype.
  const table = OUTPUT_CEILINGS[provider];
  if (table === undefined || !Object.prototype.hasOwnProperty.call(table, id)) return null;
  return table[id] ?? null;
}

/**
 * The Auto budget for OpenAI. Smaller than the others because OpenAI's
 * rate-limit guide (developers.openai.com/api/docs/guides/rate-limits, read
 * 2026-11-11) says the limit is calculated as the maximum of `max_tokens` and
 * the estimated tokens of the request, and advises setting `max_tokens` close
 * to the expected response size: the requested maximum is reserved against
 * TPM whether or not the model writes it, so a large value brings 429s sooner.
 */
export const AUTO_MAX_TOKENS_OPENAI = 16_384;

/**
 * The Auto budget for every other provider. Claude: Anthropic's rate-limits
 * page (platform.claude.com/docs/en/api/rate-limits, read 2026-11-11) says OTPM
 * limits are evaluated as output tokens are produced, "counting only the actual
 * tokens generated", and that `max_tokens` does not factor in. Gemini and
 * DeepSeek: an earlier session's reading of their docs, not re-read today and
 * not measured by this project. So this cap exists to bound a runaway
 * generation and its cost, not to protect a rate limit — hence a higher figure
 * than OpenAI's.
 */
export const AUTO_MAX_TOKENS_DEFAULT = 32_000;

/** Whether the stored value is the Auto sentinel, `MAX_TOKENS_BOUNDS.max` (or above). */
export function isAutoMaxTokens(maxTokens: number): boolean {
  return maxTokens >= MAX_TOKENS_BOUNDS.max;
}

/**
 * What Auto sends: the app's balanced budget — enough for a good answer,
 * never more than the model can write, and nothing like the model's own
 * maximum. A model whose ceiling is unknown keeps the old 4,096 default.
 */
export function balancedMaxTokens(provider: AiProvider, model: string): number {
  const ceiling = outputTokenCeiling(provider, model);
  if (ceiling === null) return UNKNOWN_CEILING_MAX_TOKENS;
  return Math.min(ceiling, provider === 'openai' ? AUTO_MAX_TOKENS_OPENAI : AUTO_MAX_TOKENS_DEFAULT);
}

/**
 * The one budget every dialect sends. The stored sentinel `MAX_TOKENS_BOUNDS.max`
 * means Auto (`balancedMaxTokens`) and must never reach the wire as-is; an
 * explicit value is honoured up to the model's ceiling, so choosing the
 * ceiling itself is how a seller asks for the model's maximum.
 */
export function effectiveMaxTokens(ai: Pick<AiSettings, 'provider' | 'model' | 'maxTokens'>): number {
  if (isAutoMaxTokens(ai.maxTokens)) return balancedMaxTokens(ai.provider, ai.model);
  const ceiling = outputTokenCeiling(ai.provider, ai.model);
  if (ceiling !== null) return Math.min(ai.maxTokens, ceiling);
  return Math.min(ai.maxTokens, UNKNOWN_CEILING_SLIDER_TOP);
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
 * Whether `output_config: { effort }` is worth sending at all.
 *
 * It lowers how long Opus-5/Sonnet-5-class adaptive thinking runs before the
 * first word — the same trade the Gemini dialect makes with
 * `thinkingLevel`, and one Anthropic explicitly prefers over disabling
 * thinking outright on these models. It errors on Haiku, which has no
 * thinking budget to trim. The *value* sent is a separate question — see
 * `reasoningEffortOptions` — this only gates whether the field exists here.
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

/* ── OpenAI reasoning family ────────────────────────────────────────────── */

const OPENAI_REASONING_PREFIXES: readonly string[] = ['gpt-5', 'gpt-6', 'o1', 'o3', 'o4'];

/** gpt-5*, gpt-6*, o1/o3/o4* — the ids OpenAI's own docs call reasoning models. */
export function openAiIsReasoningModel(model: string): boolean {
  const id = model.trim().toLowerCase();
  return OPENAI_REASONING_PREFIXES.some((prefix) => id.startsWith(prefix));
}

const OPENAI_TEMPERATURE_ALLOW: readonly string[] = ['gpt-4.1', 'gpt-4o'];

/**
 * Whether OpenAI accepts `temperature` for this id, Chat Completions or
 * Responses alike.
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

/* ── reasoning effort: which values each model actually accepts ──────────── */

/**
 * Anthropic's own scale, the same on every effort-capable model — the vendor
 * docs give one set for the whole family, not a per-model table the way
 * OpenAI's does.
 */
const CLAUDE_EFFORT_OPTIONS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Per-model option sets, from OpenAI's own model pages: Astra has no
 * `"none"` — sending it is a 400 — while Sol and Luna accept the full scale
 * down to `"none"`.
 */
const OPENAI_EFFORT_OPTIONS: ReadonlyArray<readonly [string, readonly ReasoningEffort[]]> = [
  ['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6-luna', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
];

/**
 * A reasoning id (`o1`, `o3`, `o4`, `gpt-5*`) this table has no per-model
 * evidence for. `low`/`medium`/`high` is the subset every named GPT-6 row
 * above accepts in common — the conservative middle, not a guess at the
 * extremes (`none`, `xhigh`, `max`) a family with no confirmed table might
 * reject.
 */
const OPENAI_EFFORT_FALLBACK: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

/** OpenRouter's own scale for its `reasoning.effort` body field — not gated by the (unknown) upstream model. */
const OPENROUTER_EFFORT_OPTIONS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * `grok-4.5` and up accept `reasoning_effort`; `4.6` and up also accept
 * `xhigh`. The catalogue's other id, `grok-4.3`, is below the 4.5 floor xAI's
 * own guide states, so it gets nothing — never a guessed value an older model
 * might 400 on.
 */
function grokEffortOptions(model: string): readonly ReasoningEffort[] {
  const match = /^grok-4\.(\d+)/i.exec(model.trim());
  const raw = match?.[1];
  const minor = raw === undefined ? null : Number(raw);
  if (minor === null || !Number.isFinite(minor) || minor < 5) return [];
  return minor >= 6 ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high'];
}

/**
 * The `reasoningEffort` values this provider's card may offer for this
 * model — `[]` means the parameter does not apply here at all, and the card
 * hides the control rather than showing one that can only ever be wrong.
 *
 * Every dialect that sends a reasoning effort reads the *same* table through
 * `validReasoningEffort` below before putting a value on the wire, so the
 * card's menu and the transport's own gate can never disagree about which
 * values a model accepts.
 */
export function reasoningEffortOptions(provider: AiProvider, model: string): readonly ReasoningEffort[] {
  if (provider === 'claude') return claudeSupportsEffort(model) ? CLAUDE_EFFORT_OPTIONS : [];
  if (provider === 'openai') {
    return openAiIsReasoningModel(model) ? matchPrefix(model, OPENAI_EFFORT_OPTIONS, OPENAI_EFFORT_FALLBACK) : [];
  }
  if (provider === 'openrouter') return OPENROUTER_EFFORT_OPTIONS;
  if (provider === 'grok') return grokEffortOptions(model);
  return [];
}

/**
 * A stored `reasoningEffort` this model will actually accept on the wire, or
 * `null`.
 *
 * `''` always means "the provider's own default" — nothing is sent, on
 * purpose. Anything else the model does not currently list in
 * `reasoningEffortOptions` is dropped the same way, silently, rather than
 * substituted with a guess: a model swap that leaves a value behind from the
 * model it *was* chosen for (Astra's `'none'`, left over after switching to
 * Sol) must never reach a request for a model it was never validated against.
 * The card is expected to only ever offer a value `reasoningEffortOptions`
 * lists, so this is a defensive floor under a stored configuration, not the
 * normal path.
 */
function validReasoningEffort(
  provider: AiProvider,
  model: string,
  value: ReasoningEffort | '',
): ReasoningEffort | null {
  if (value === '') return null;
  return reasoningEffortOptions(provider, model).includes(value) ? value : null;
}

/* ── Gemini thinking level ─────────────────────────────────────────────── */

/**
 * `thinkingConfig.thinkingLevel`'s accepted values, per Gemini 3 model —
 * ai.google.dev/gemini-api/docs/thinking, fetched 2026-09-28. Everything
 * below Gemini 3 has no such field at all (see `thinkingLevelOptions`), and
 * the page was ambiguous about 2.x, so this table starts at 3.
 */
const GEMINI_THINKING_OPTIONS: ReadonlyArray<readonly [string, readonly ThinkingLevel[]]> = [
  ['gemini-3.8-flash', ['low', 'medium', 'high']],
  ['gemini-3.7-flash', ['low', 'medium', 'high']],
  ['gemini-3.6-flash', ['minimal', 'low', 'medium', 'high']],
  ['gemini-3.5-flash-lite', ['minimal', 'low', 'medium', 'high']],
  ['gemini-3.5-flash', ['minimal', 'low', 'medium', 'high']],
  ['gemini-3-flash-preview', ['minimal', 'low', 'medium', 'high']],
  ['gemini-3.1-pro-preview', ['low', 'medium', 'high']],
  ['gemini-3-pro-preview', ['low', 'high']],
];

/**
 * A Gemini 3+ id not named above (`gemini-3.1-flash-lite` is in the
 * catalogue's model list but not in Google's own thinking-levels table) —
 * `low` and `high` are the one pair every row above accepts in common, so
 * this is the safe floor rather than a guess at `minimal` or `medium`, which
 * at least one named model (`3-pro-preview`) refuses.
 */
const GEMINI_THINKING_FALLBACK: readonly ThinkingLevel[] = ['low', 'high'];

/**
 * The `thinkingLevel` values this model's card may offer — `[]` below
 * Gemini 3, where the field does not exist at all.
 */
export function thinkingLevelOptions(model: string): readonly ThinkingLevel[] {
  const id = model.trim().toLowerCase();
  if (!/^gemini-[3-9]/.test(id)) return [];
  return matchPrefix(id, GEMINI_THINKING_OPTIONS, GEMINI_THINKING_FALLBACK);
}

/** Same defensive floor as `validReasoningEffort`, for Gemini's own scale. */
function validThinkingLevel(model: string, value: ThinkingLevel | ''): ThinkingLevel | null {
  if (value === '') return null;
  return thinkingLevelOptions(model).includes(value) ? value : null;
}

/* ── sampling / reasoning fields, per dialect ─────────────────────────────
 *
 * One function per wire shape, each reading only the settings fields its own
 * provider owns — `client.ts` and `stream.ts` call these rather than
 * building the fragment themselves, so the one-shot and streaming paths
 * cannot describe the same request two different ways.
 */

/**
 * The sampling-related body fields for a Claude request.
 */
export function claudeSamplingFields(
  ai: Pick<AiSettings, 'model' | 'temperature' | 'reasoningEffort'>,
): Record<string, unknown> {
  const effort = validReasoningEffort('claude', ai.model, ai.reasoningEffort);
  return {
    ...(claudeSupportsTemperature(ai.model) ? { temperature: ai.temperature } : {}),
    ...(effort === null ? {} : { output_config: { effort } }),
  };
}

/**
 * The Chat Completions body fields for the rest of the OpenAI-compatible
 * list — OpenRouter, DeepSeek, Mistral, Grok, Ollama, a custom gateway.
 *
 * `openai` itself is no longer one of these: it speaks Responses now (see
 * `openAiResponsesFields` and the `openai` branch of `dialectFor` in
 * `stream.ts`). Every field read here belongs to the provider it is gated
 * on — DeepSeek's `thinking` never reaches Grok's `reasoning_effort` branch —
 * so a field that does not belong to the active provider is structurally
 * unreachable, not merely blank.
 */
export function openAiCompatibleSamplingFields(
  ai: Pick<AiSettings, 'provider' | 'model' | 'temperature' | 'maxTokens' | 'thinking' | 'reasoningEffort'>,
): Record<string, unknown> {
  const grokEffort = ai.provider === 'grok' ? validReasoningEffort('grok', ai.model, ai.reasoningEffort) : null;
  const openRouterEffort =
    ai.provider === 'openrouter' ? validReasoningEffort('openrouter', ai.model, ai.reasoningEffort) : null;

  return {
    ...(samplingSupported(ai) ? { temperature: ai.temperature } : {}),
    max_tokens: effectiveMaxTokens(ai),
    /* DeepSeek's own toggle — the seller's choice, no longer hard-coded. */
    ...(ai.provider === 'deepseek' ? { thinking: { type: ai.thinking ? 'enabled' : 'disabled' } } : {}),
    ...(grokEffort === null ? {} : { reasoning_effort: grokEffort }),
    ...(openRouterEffort === null ? {} : { reasoning: { effort: openRouterEffort } }),
  };
}

/**
 * The Responses-only body fields for an `openai` request.
 *
 * `max_output_tokens` is Responses' own name for the same budget Chat
 * Completions calls `max_completion_tokens`. `store: false` because this
 * application ships no server side for OpenAI to hold the conversation state
 * on, which is also why a reasoning model additionally gets the one
 * `include` value that asks for the encrypted reasoning item a later
 * function-call turn has to replay — see `OpenAiReasoningItem` in
 * `messages.ts`. `include` is sent whether or not `reasoning.effort` itself
 * ends up on the wire: `''` (or a value this model does not list) means only
 * the effort is left for OpenAI's own default, not the encrypted-content
 * request that later turn depends on.
 */
export function openAiResponsesFields(
  ai: Pick<AiSettings, 'model' | 'temperature' | 'maxTokens' | 'reasoningEffort'>,
): Record<string, unknown> {
  const effort = validReasoningEffort('openai', ai.model, ai.reasoningEffort);

  return {
    max_output_tokens: effectiveMaxTokens({ provider: 'openai', model: ai.model, maxTokens: ai.maxTokens }),
    store: false,
    ...(openAiSendsTemperature(ai.model) ? { temperature: ai.temperature } : {}),
    ...(openAiIsReasoningModel(ai.model) ? { include: ['reasoning.encrypted_content'] } : {}),
    ...(effort === null ? {} : { reasoning: { effort } }),
  };
}

/**
 * The Gemini 3+ thinking level to send, or `null` to omit `thinkingConfig`
 * entirely and let the model pick its own — Gemini 3 always thinks, so `null`
 * is "no floor under it", never "thinking off", which these models cannot do
 * anyway.
 */
export function geminiThinkingLevel(ai: Pick<AiSettings, 'model' | 'thinkingLevel'>): ThinkingLevel | null {
  return validThinkingLevel(ai.model, ai.thinkingLevel);
}

/* ── the one switch every dialect and the settings form read ───────────── */

/**
 * Whether the sampling slider in Settings does anything for this model.
 *
 * `client.ts` and `stream.ts` call this to decide whether to put `temperature`
 * on the wire; the settings form calls the exact same function to decide
 * whether to show the slider at all, so the two can never disagree about a
 * model the seller is looking at right now. DeepSeek is the one provider
 * where sampling depends on a *setting* rather than the model id: its
 * thinking phase silently ignores `temperature`, so the slider only does
 * anything once thinking is switched off.
 */
export function samplingSupported(ai: Pick<AiSettings, 'provider' | 'model' | 'thinking'>): boolean {
  if (ai.provider === 'claude') return claudeSupportsTemperature(ai.model);
  if (ai.provider === 'openai') return openAiSendsTemperature(ai.model);
  if (ai.provider === 'deepseek') return !ai.thinking;
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

/**
 * Whether a value is safe to put on the wire as an HTTP header, verbatim.
 *
 * `fetch`'s `Headers` throws a `TypeError` — not an HTTP error, not something
 * `toApiError` or this transport's own error mapping ever sees — for a value
 * outside printable ASCII. A seller's own `appTitle` ("Savdo doʻkoni",
 * U+02BB), a Cyrillic organisation name, an IDN URL, or a key pasted with a
 * stray non-breaking space all qualify. Left unguarded, that `TypeError` is
 * caught by the generic handler around `fetch` and reported as `kind:
 * 'network'` — "could not be reached" — which sends the seller looking for a
 * firewall problem that does not exist, and for a streaming request gets
 * retried three times for a header that will never become valid. Exported so
 * the settings card can refuse the same input before it is ever saved.
 */
export function isHeaderSafe(value: string): boolean {
  return /^[\x20-\x7E]*$/.test(value.trim());
}

/**
 * A key that cannot be written into a request header at all is not a network
 * problem — it never reaches `fetch`. Thrown before the request is built, so
 * it is never counted as a request the provider saw (see `usage.ts`'s "what
 * counts as a request") and never retried (`isRetryable` is `false` for
 * `'unauthorized'`).
 */
function assertHeaderSafeKey(apiKey: string): void {
  if (!isHeaderSafe(apiKey)) {
    throw new ApiError('The API key contains characters no request header can carry', {
      kind: 'unauthorized',
    });
  }
}

/** Anthropic blocks browser calls unless this header opts in explicitly. */
export const ANTHROPIC_BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';
/** The current stable value, and the fallback when the card's own field is blank or unsafe to send. */
export const ANTHROPIC_VERSION = '2023-06-01';

export function anthropicHeaders(ai: Pick<AiSettings, 'apiKey' | 'anthropicVersion'>): Record<string, string> {
  assertHeaderSafeKey(ai.apiKey);
  const version = ai.anthropicVersion.trim();

  return {
    'content-type': 'application/json',
    'x-api-key': ai.apiKey,
    'anthropic-version': version !== '' && isHeaderSafe(version) ? version : ANTHROPIC_VERSION,
    [ANTHROPIC_BROWSER_HEADER]: 'true',
  };
}

export function geminiHeaders(apiKey: string): Record<string, string> {
  assertHeaderSafeKey(apiKey);
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
}

/**
 * The header set every OpenAI-compatible dialect sends — OpenAI's own
 * Responses API included, which reuses this rather than growing a second
 * copy of the bearer/organisation logic.
 *
 * A key is optional for exactly the two providers `requiresApiKey` excludes,
 * and a bare `Bearer ` with nothing after it is worse than sending no header
 * at all — several gateways treat it as a malformed credential rather than an
 * anonymous request. Every provider-specific header is read only inside its
 * own `if` — OpenAI's organisation/project headers cannot reach an OpenRouter
 * request, and OpenRouter's attribution headers cannot reach OpenAI's, even
 * if a stale value happens to sit in the field from a provider the seller
 * switched away from, because each provider now keeps its own configuration
 * and this function never reads the other's.
 */
export function openAiCompatibleHeaders(
  ai: Pick<AiSettings, 'provider' | 'apiKey' | 'orgId' | 'projectId' | 'appUrl' | 'appTitle'>,
): Record<string, string> {
  assertHeaderSafeKey(ai.apiKey);

  const key = ai.apiKey.trim();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(key === '' ? {} : { authorization: `Bearer ${key}` }),
  };

  /* An unsafe org/project/attribution value is dropped, not thrown on — it is
     an optional header, not a credential, so the request still goes out. */
  if (ai.provider === 'openai') {
    const orgId = ai.orgId.trim();
    const projectId = ai.projectId.trim();
    if (orgId !== '' && isHeaderSafe(orgId)) headers['openai-organization'] = orgId;
    if (projectId !== '' && isHeaderSafe(projectId)) headers['openai-project'] = projectId;
  } else if (ai.provider === 'openrouter') {
    const appUrl = ai.appUrl.trim();
    const appTitle = ai.appTitle.trim();
    if (appUrl !== '' && isHeaderSafe(appUrl)) headers['http-referer'] = appUrl;
    if (appTitle !== '' && isHeaderSafe(appTitle)) headers['x-openrouter-title'] = appTitle;
  }

  return headers;
}

/* ── OpenAI Responses failures, classified so a retry cannot repeat one ──── */

/**
 * `response.incomplete` (streaming) or `status: "incomplete"` (one-shot) with
 * nothing to show for it — no text, no call.
 *
 * Always `kind: 'client'`, never `'server'`: the run was cut off by something
 * about *this request* — `max_output_tokens` too low for the model's own
 * reasoning phase, most often, per OpenAI's reasoning guide's own warning that
 * this can happen with the tokens already spent — and the identical request
 * hits the identical wall on a retry. `ApiError.isRetryable` is `false` for
 * `'client'`, which is what stops `shouldRetry` in `stream.ts` from spending
 * the same reasoning tokens three more times for the same empty answer. The
 * reason rides in the message, which the settings pane's `aiErrRequest`
 * shows verbatim in English — which is the wrong frame for a seller reading
 * it in their own language. `code: 'incomplete'` is the machine-readable
 * half: the settings card maps it to a translated dictionary entry ("raise
 * max tokens, or lower reasoning effort") instead, and only falls back to the
 * raw message for a `code` it does not recognise.
 */
export function openAiIncompleteError(reason: string): ApiError {
  return new ApiError(`The model stopped before answering (${reason})`, {
    kind: 'client',
    code: 'incomplete',
  });
}

/**
 * `response.failed`'s nested `error`, or a bare `error` SSE event — classified
 * by `code` so a deterministic refusal is never retried and a genuine
 * transient failure still gets the three attempts every other 5xx in this
 * transport gets.
 *
 * `insufficient_quota` is checked first and on its own: OpenAI's billing
 * exhaustion code contains the substring `"quota"`, so the general rule below
 * would otherwise read it as a rate limit — three pointless retries and a
 * "slow down" message for a seller who needs to add billing, not wait a
 * minute. It keeps its own `code` for the same reason `'incomplete'` does:
 * the settings card can name the actual problem instead of paraphrasing the
 * message.
 *
 * OpenAI's own `server_error` type carries `code: null` in practice, which is
 * why an absent code is treated the same as one that names a server problem
 * rather than as the safer-sounding default of "leave it alone" — a bare mid-
 * stream `error` event historically corresponds to exactly this kind of
 * transient hiccup. Anything else specific enough to be named — a content
 * filter, an unsupported parameter, a model id the account cannot reach — is
 * a fact about this request that a retry cannot change.
 */
export function classifyOpenAiFailure(code: string | null, message: string): ApiError {
  const lower = (code ?? '').trim().toLowerCase();

  if (lower.includes('insufficient_quota')) {
    return new ApiError(message, { kind: 'client', code: 'insufficient_quota' });
  }
  if (lower.includes('rate_limit') || lower.includes('quota')) {
    return new ApiError(message, { kind: 'rateLimited', status: 429 });
  }
  if (lower === '' || lower.includes('server') || lower.includes('internal')) {
    return new ApiError(message, { kind: 'server' });
  }
  return new ApiError(message, { kind: 'client' });
}
