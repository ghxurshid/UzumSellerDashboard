import { AI_PROVIDER_IDS } from '@/constants/settings';
import { ApiError } from '@/services/api/client';
import type { AiProvider, ModelRateLimits } from '@/types/settings';

/**
 * How much of a model's rate limit this browser has spent.
 *
 * No provider hands back "requests left this minute" — Gemini's rate-limit
 * docs are explicit that the only place that number lives is the console for
 * a human to read, and the wire carries nothing of the kind on a normal
 * response. So the meter is built from what the transport itself can see: one
 * event per request it sent, folded against the limit the provider published
 * for that model and, where a 429 says otherwise, the limit the provider is
 * actually enforcing right now for this project.
 *
 * Everything below `summarizeUsage` is pure — no clock read, no storage read —
 * so a browser tab that restores yesterday's events from IndexedDB reproduces
 * the same gauges a live tab would have shown, and a test can hand it a fixed
 * `now` and a fixed event list and get a fixed answer.
 *
 * ## What this cannot promise
 *
 * A published RPM/TPM/RPD figure is a project-wide budget, not a per-browser
 * one — a seller running two tabs, or a second key holder on the same
 * project, spends from the same pool this meter never sees. So what is
 * computed here is an upper bound on what is left, built to fail toward
 * showing *less* headroom than there really is rather than more: any 429 the
 * provider actually sent overrides the catalogue number outright, on the
 * theory that Google's own statement about this project beats a table typed
 * from a screenshot.
 *
 * ## What counts as a request
 *
 * `stream.ts` and `client.ts` call `recordModelRequest` for a response they
 * got back, not for a request they sent — the distinction matters because a
 * rejected key never reached a project's quota at all. Gemini answers a bad
 * key with `401`/`403`, or with a `400 INVALID_ARGUMENT` whose body names the
 * reason `API_KEY_INVALID` (see `isKeyRejection`); none of the three was ever
 * charged to anyone's rate limit, so recording one would show a seller
 * "exhausted" from a key that was rejected outright rather than spent against.
 * Every *other* non-2xx — a bad model id, a malformed request body, a 5xx, a
 * 429 — did occupy a slot on the provider's side (the 429 case is a project
 * refusing a request it still counted) and is recorded as `'failed'` or
 * `'limited'` accordingly. A request the browser could not even complete
 * (`network`, `timeout`, `cancelled` — no response at all) is not recorded
 * either, for the same reason: it never reached the provider to occupy
 * anything.
 */

/* ── the shapes ─────────────────────────────────────────────────────────── */

export type QuotaAxis = 'rpm' | 'tpm' | 'rpd';

/** What a 429 said about which quota ran out. Every field is optional knowledge. */
export interface QuotaSignal {
  readonly axis: QuotaAxis | null;
  readonly limit: number | null;
  readonly retryAfterMs: number | null;
}

/** One HTTP request the transport sent and got a response to. */
export interface ModelRequestEvent {
  readonly id: string;
  readonly provider: AiProvider;
  readonly model: string;
  readonly at: number;
  /** Raw prompt as the provider counted it, cache included. `null` = not reported. */
  readonly inputTokens: number | null;
  /** Subset of `inputTokens` served from the provider's cache. Absent on an event recorded before this field existed. */
  readonly cachedInputTokens?: number | null;
  /** Output as the provider counted it, reasoning included. Absent on an event recorded before this field existed. */
  readonly outputTokens?: number | null;
  /** Subset of `outputTokens` spent on reasoning. Absent on an event recorded before this field existed. */
  readonly reasoningTokens?: number | null;
  readonly outcome: 'ok' | 'limited' | 'failed';
  readonly quota?: QuotaSignal;
}

export interface QuotaGauge {
  readonly axis: QuotaAxis;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly exhausted: boolean;
  readonly resetsAt: number;
  readonly unknownTokens: number;
}

export interface ModelUsage {
  readonly provider: AiProvider;
  readonly model: string;
  readonly rpm: QuotaGauge;
  readonly tpm: QuotaGauge;
  readonly rpd: QuotaGauge;
  readonly remainingShare: number;
  readonly bottleneck: QuotaAxis;
}

/**
 * A daily quota the transport must not spend another request finding out
 * about again — `kind` stays `'rateLimited'` so every existing branch on
 * `ApiError.kind` keeps working; `quota` is the extra a caller that knows
 * about it (this module's own `shouldRetry`, and the chat panel's "continue"
 * offer) can read.
 */
export class ModelQuotaError extends ApiError {
  readonly quota: QuotaSignal | null;

  constructor(message: string, options: { readonly quota: QuotaSignal | null; readonly retryAfterMs?: number }) {
    super(message, {
      kind: 'rateLimited',
      status: 429,
      ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
    });
    this.quota = options.quota;
  }

  /**
   * `ApiError.isRetryable` says a `rateLimited` kind is always worth another
   * try, which is right for rpm/tpm — the window reopens within a minute —
   * and wrong for `rpd`: only the Pacific day turning over frees that one, so
   * offering "continue" would let the seller press a button whose every press
   * is one more counted request refused for the same reason, until midnight.
   * Every other quota failure (a named rpm/tpm axis, or a 429 whose body did
   * not say which axis at all) keeps the ordinary rate-limited retryability.
   */
  override get isRetryable(): boolean {
    if (this.quota?.axis === 'rpd') return false;
    return super.isRetryable;
  }
}

/* ── the log ────────────────────────────────────────────────────────────── */

const listeners = new Set<(event: ModelRequestEvent) => void>();

/** A subscriber survives until it calls the function this returns. */
export function subscribeModelRequests(listener: (event: ModelRequestEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function newEventId(): string {
  /* `crypto.randomUUID` is not guaranteed in every embedding of this bundle
     (older WebViews, some test runners without the Web Crypto polyfill), and
     an event that fails to mint an id is still worth keeping. */
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Publish one request. Called by `stream.ts` and `client.ts`, never by
 * anything above them — a caller two layers up has no HTTP request to report.
 *
 * A listener's own bug must not undo the request it is being told about: the
 * seller already spent the round trip, so the transport's job here is done
 * whether or not the meter manages to record it.
 */
export function recordModelRequest(input: {
  readonly provider: AiProvider;
  readonly model: string;
  readonly at: number;
  readonly inputTokens: number | null;
  readonly cachedInputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly reasoningTokens?: number | null;
  readonly outcome: ModelRequestEvent['outcome'];
  readonly quota?: QuotaSignal;
}): void {
  const event: ModelRequestEvent = { id: newEventId(), ...input };

  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* A meter bug is not this request's failure. */
    }
  }
}

/* ── reading nested values, defensively ─────────────────────────────────── */

function at(value: unknown, path: readonly (string | number)[]): unknown {
  let cursor: unknown = value;
  for (const step of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[step];
  }
  return cursor;
}

function textAt(value: unknown, path: readonly (string | number)[]): string | null {
  const found = at(value, path);
  return typeof found === 'string' ? found : null;
}

function numberAt(value: unknown, path: readonly (string | number)[]): number | null {
  const found = at(value, path);
  return typeof found === 'number' ? found : null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * `quotaId`/`quotaMetric` → which axis ran out.
 *
 * There is no enum for this — Google spells the id as an English sentence
 * fragment (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
 * `GenerateContentInputTokensPerModelPerMinute-FreeTier`) and the free vs.
 * paid tier changes the suffix, not the part that matters here. "token" beats
 * "minute" because a token-per-minute id contains the word "minute" too.
 *
 * A per-day *token* quota (`…InputTokensPerModelPerDay…`) is real but is not
 * one of the three axes this meter models — `rpd` counts *requests*, and
 * conflating the two would let a daily token cap masquerade as the daily
 * request cap and force a false "exhausted" on an axis nothing actually said
 * was exhausted. So "day" only resolves to `'rpd'` when "token" is absent;
 * otherwise it is `null`, the same as an id this function does not recognise
 * at all.
 */
function axisFromQuotaId(id: string): QuotaAxis | null {
  const lower = id.toLowerCase();
  if (lower.includes('day')) return lower.includes('token') ? null : 'rpd';
  if (lower.includes('token')) return 'tpm';
  if (lower.includes('minute')) return 'rpm';
  return null;
}

/** `"23s"` → `23`. The only shape Google's `RetryInfo.retryDelay` is documented to use. */
function parseRetryDelaySeconds(text: string): number | null {
  const match = /^([\d.]+)s$/.exec(text.trim());
  if (match === null) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function detailsOf(parsed: unknown): readonly unknown[] | null {
  const nested = at(parsed, ['error', 'details']);
  if (Array.isArray(nested)) return nested;
  const bare = at(parsed, ['details']);
  return Array.isArray(bare) ? bare : null;
}

/** A violation's own `quotaValue`, or `null` when it is absent or not a real limit. */
function limitOfViolation(violation: unknown): number | null {
  const rawValue = textAt(violation, ['quotaValue']);
  const value = rawValue === null ? Number.NaN : Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Which violation this meter believes, and its axis and limit read together.
 *
 * A response can list several violations at once (a project can be over both
 * its per-minute and per-day budgets in the same call), and pairing the axis
 * from one with the `quotaValue` of another is how a 20-request daily cap and
 * a 5-request-per-minute cap turn into a nonsense "5 requests per day". So
 * both are always read from the *same* violation. When more than one
 * violation resolves to an axis, a per-day request quota wins outright — it
 * is the one worth surfacing, and the one `shouldRetry` and the daily-quota
 * message key off — and otherwise `tpm` is preferred over `rpm`, the same
 * order `axisFromQuotaId` breaks ties in.
 */
function pickViolation(violations: readonly unknown[]): { readonly axis: QuotaAxis; readonly limit: number | null } | null {
  let tpm: { readonly limit: number | null } | null = null;
  let rpm: { readonly limit: number | null } | null = null;

  for (const violation of violations) {
    const id = textAt(violation, ['quotaId']) ?? textAt(violation, ['quotaMetric']);
    if (id === null) continue;

    const axis = axisFromQuotaId(id);
    if (axis === null) continue; // includes the unmodelled per-day token quota

    const limit = limitOfViolation(violation);
    if (axis === 'rpd') return { axis: 'rpd', limit };
    if (axis === 'tpm' && tpm === null) tpm = { limit };
    if (axis === 'rpm' && rpm === null) rpm = { limit };
  }

  if (tpm !== null) return { axis: 'tpm', limit: tpm.limit };
  if (rpm !== null) return { axis: 'rpm', limit: rpm.limit };
  return null;
}

/**
 * What a Gemini 429 body says, read defensively.
 *
 * The shape below is not from a sample recorded in this repo — Gemini never
 * hands one to the browser under normal operation, so there is nothing here
 * to record one from — but from Google's own public error-format
 * documentation and issue reports showing the literal body:
 *
 * ```json
 * { "error": { "code": 429, "status": "RESOURCE_EXHAUSTED", "message": "…",
 *     "details": [
 *       { "@type": "type.googleapis.com/google.rpc.QuotaFailure",
 *         "violations": [ { "quotaMetric": "…generate_content_free_tier_requests",
 *           "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
 *           "quotaDimensions": { "location": "global", "model": "gemini-2.5-flash" },
 *           "quotaValue": "20" } ] },
 *       { "@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "23s" }
 *     ] } }
 * ```
 *
 * so every read here tolerates the field being absent, the array being empty,
 * or the whole body being something else entirely — another provider's 429,
 * an HTML error page from a proxy, `undefined`. `null` means "this does not
 * look like a Gemini quota error at all"; a `QuotaSignal` with `axis: null`
 * means "it does, but did not say which limit."
 */
export function readQuotaFailure(body: unknown): QuotaSignal | null {
  const parsed = typeof body === 'string' ? tryParseJson(body) : body;
  if (parsed === null || typeof parsed !== 'object') return null;

  const code = numberAt(parsed, ['error', 'code']) ?? numberAt(parsed, ['code']);
  const status = textAt(parsed, ['error', 'status']) ?? textAt(parsed, ['status']);
  const looksLikeQuotaError = code === 429 || status === 'RESOURCE_EXHAUSTED';

  const details = detailsOf(parsed);
  if (details === null) return looksLikeQuotaError ? { axis: null, limit: null, retryAfterMs: null } : null;

  const allViolations: unknown[] = [];
  let retryAfterMs: number | null = null;

  for (const detail of details) {
    const type = textAt(detail, ['@type']) ?? '';

    if (type.includes('QuotaFailure')) {
      const violations = at(detail, ['violations']);
      if (Array.isArray(violations)) allViolations.push(...violations);
    }

    if (type.includes('RetryInfo')) {
      const delay = textAt(detail, ['retryDelay']);
      if (delay !== null) {
        const seconds = parseRetryDelaySeconds(delay);
        if (seconds !== null) retryAfterMs = Math.round(seconds * 1_000);
      }
    }
  }

  const picked = pickViolation(allViolations);
  const axis = picked?.axis ?? null;
  const limit = picked?.limit ?? null;

  if (!looksLikeQuotaError && axis === null && limit === null && retryAfterMs === null) return null;
  return { axis, limit, retryAfterMs };
}

/**
 * Whether a failed request never occupied a slot in any project's quota
 * because the provider rejected the key itself, rather than a request the
 * project received and then refused.
 *
 * Gemini answers a bad key with `401`/`403`, or with a `400 INVALID_ARGUMENT`
 * whose body names the reason `API_KEY_INVALID` — as an `ErrorInfo` detail's
 * `reason` field, and again in the plain-English `message`. xAI answers a bad
 * key with a bare `400`, in a shape none of the other eight providers use:
 * `{"code":"invalid-argument","error":"Incorrect API key provided. ..."}` — a
 * plain string under `error`, not the `{error:{message}}` envelope everyone
 * else sends. None of those was ever charged to a project, so counting one
 * toward this meter would show a seller "exhausted" from a key that was never
 * accepted in the first place — see the module header, "what counts as a
 * request".
 *
 * Every other 400 (an unknown model id, a malformed body, a schema the
 * provider rejected) did reach a project and stays recorded as `'failed'`
 * like any other non-quota failure. Read as defensively as `readQuotaFailure`
 * — the body can be absent, unparsable, or another provider's shape entirely.
 */
export function isKeyRejection(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  if (status !== 400) return false;

  if (typeof body === 'string' && body.includes('API_KEY_INVALID')) return true;

  const parsed = typeof body === 'string' ? tryParseJson(body) : body;
  if (parsed === null || typeof parsed !== 'object') return false;

  const message = textAt(parsed, ['error', 'message']) ?? textAt(parsed, ['message']);
  if (message !== null && message.includes('API_KEY_INVALID')) return true;

  const details = detailsOf(parsed);
  if (details !== null && details.some((detail) => textAt(detail, ['reason']) === 'API_KEY_INVALID')) {
    return true;
  }

  /* xAI's flat shape: `error` is a string, not an object with `message`. */
  const code = textAt(parsed, ['code']);
  const flatError = textAt(parsed, ['error']);
  if (code === 'invalid-argument' && flatError !== null && /api key/i.test(flatError)) return true;

  return false;
}

/* ── validating a restored event ────────────────────────────────────────── */

const OUTCOMES: readonly ModelRequestEvent['outcome'][] = ['ok', 'limited', 'failed'];
const AXES: readonly QuotaAxis[] = ['rpm', 'tpm', 'rpd'];

function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * `structuredClone` — what a `BroadcastChannel` or IndexedDB round trip both
 * use — preserves `NaN`, `Infinity` and negative numbers exactly, unlike
 * `JSON.parse`, which would already have turned them into `null` or dropped
 * the field. So a value can arrive here that is technically `typeof ===
 * 'number'` and still not a number this meter can do arithmetic with —
 * `Infinity - x` and `NaN >= limit` produce gauges that are simply wrong
 * rather than absent. Every numeric field is checked for finiteness here, on
 * top of its own domain constraint (a limit is a positive ceiling, a wait or
 * a token count cannot be negative).
 */
function isQuotaSignal(value: unknown): value is QuotaSignal {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  const axisOk =
    record['axis'] === null ||
    (typeof record['axis'] === 'string' && (AXES as readonly string[]).includes(record['axis']));
  const limitOk =
    record['limit'] === null ||
    (typeof record['limit'] === 'number' && Number.isFinite(record['limit']) && record['limit'] > 0);
  const retryOk =
    record['retryAfterMs'] === null ||
    (typeof record['retryAfterMs'] === 'number' &&
      Number.isFinite(record['retryAfterMs']) &&
      record['retryAfterMs'] >= 0);

  return axisOk && limitOk && retryOk;
}

/** `null` is always a valid "not reported"; otherwise a finite, non-negative count. */
function isValidCount(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

/** Whether a value read back out of storage is still a request this meter can trust. */
export function isModelRequestEvent(value: unknown): value is ModelRequestEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  if (typeof record['id'] !== 'string' || record['id'] === '') return false;
  if (typeof record['provider'] !== 'string' || !isAiProvider(record['provider'])) return false;
  if (typeof record['model'] !== 'string' || record['model'] === '') return false;
  if (typeof record['at'] !== 'number' || !Number.isFinite(record['at'])) return false;
  /* Required — unlike the three below, a stored event always had this field,
     so `undefined` (the field missing outright) is rejected, not accepted as
     "unreported". */
  if (!isValidCount(record['inputTokens'])) return false;
  /* Added after the first events were already on disk — `undefined` here
     means a legacy event, not a malformed one, and is accepted as such. */
  if (record['cachedInputTokens'] !== undefined && !isValidCount(record['cachedInputTokens'])) return false;
  if (record['outputTokens'] !== undefined && !isValidCount(record['outputTokens'])) return false;
  if (record['reasoningTokens'] !== undefined && !isValidCount(record['reasoningTokens'])) return false;
  if (
    typeof record['outcome'] !== 'string' ||
    !OUTCOMES.includes(record['outcome'] as ModelRequestEvent['outcome'])
  ) {
    return false;
  }
  if (record['quota'] !== undefined && !isQuotaSignal(record['quota'])) return false;

  return true;
}

/* ── retention ──────────────────────────────────────────────────────────── */

/** Longer than the longest possible Pacific day (25h, the fall-back day) plus a full RPM/TPM window. */
export const USAGE_RETENTION_MS = 26 * 60 * 60 * 1_000;

export function pruneUsage(events: readonly ModelRequestEvent[], now: number): ModelRequestEvent[] {
  const cutoff = now - USAGE_RETENTION_MS;
  return events.filter((event) => event.at > cutoff);
}

/* ── the Pacific day, DST-correct ───────────────────────────────────────── */

const PACIFIC_TZ = 'America/Los_Angeles';

interface WallDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * `summarizeUsage` runs once per model per second while the quota panel is
 * open — nine models, every tick — and each run walks through here. A fresh
 * `Intl.DateTimeFormat` is not free to construct (it parses and validates the
 * time zone every time), so the two shapes this module needs are built once
 * per zone and kept, rather than remade on every gauge. Lazy, not eager: a
 * seller who never opens the panel never pays for one.
 */
const wallDateFormatters = new Map<string, Intl.DateTimeFormat>();

function wallDateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = wallDateFormatters.get(timeZone);
  if (cached !== undefined) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  wallDateFormatters.set(timeZone, formatter);
  return formatter;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = offsetFormatters.get(timeZone);
  if (cached !== undefined) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  offsetFormatters.set(timeZone, formatter);
  return formatter;
}

function wallDateIn(instant: number, timeZone: string): WallDate {
  const parts = wallDateFormatter(timeZone).formatToParts(new Date(instant));

  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: read('year'), month: read('month'), day: read('day') };
}

/**
 * The zone's UTC offset in effect at `instant`, in milliseconds.
 *
 * Formatting the instant's wall-clock digits as though they were UTC and
 * subtracting the real instant back out yields the offset without a
 * hand-maintained DST table — the same trick `date-fns-tz` and `luxon` use
 * internally, built here from `Intl` alone since that is already a dependency
 * of nothing.
 */
function offsetMsAt(instant: number, timeZone: string): number {
  const parts = offsetFormatter(timeZone).formatToParts(new Date(instant));

  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - instant;
}

/**
 * The UTC instant of local midnight on the given calendar date.
 *
 * Two passes settle the offset on either side of a DST change. Local midnight
 * itself is never inside the skipped or repeated hour — both US transitions
 * happen at 02:00 local — so this always converges to one unambiguous answer.
 */
function midnightUtc(wall: WallDate, timeZone: string): number {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, 0, 0, 0);
  const firstPass = target - offsetMsAt(target, timeZone);
  return target - offsetMsAt(firstPass, timeZone);
}

export function pacificDayStart(now: number): number {
  return midnightUtc(wallDateIn(now, PACIFIC_TZ), PACIFIC_TZ);
}

export function nextPacificMidnight(now: number): number {
  const wall = wallDateIn(now, PACIFIC_TZ);
  /* `Date.UTC` normalises an out-of-range day into the next month (and year)
     on its own, so this is correct at month and year ends too. */
  const tomorrow = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));
  return midnightUtc(
    { year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate() },
    PACIFIC_TZ,
  );
}

/* ── the gauges ─────────────────────────────────────────────────────────── */

const MINUTE_MS = 60_000;

/** The instant the oldest in-window event stops counting, or `now` when the window is empty. */
function windowResetsAt(inWindow: readonly ModelRequestEvent[], now: number): number {
  if (inWindow.length === 0) return now;
  let oldest = inWindow[0]?.at ?? now;
  for (const event of inWindow) if (event.at < oldest) oldest = event.at;
  return oldest + MINUTE_MS;
}

/**
 * The catalogue limit, overridden by whatever the provider most recently said
 * about this axis. "Latest" is by the request's own clock, not by how large
 * the stated limit is — a tier upgrade shows up as a *later* 429 with a
 * *larger* `quotaValue`, and the later one has to win either way.
 */
function overrideLimit(scoped: readonly ModelRequestEvent[], axis: QuotaAxis): number | null {
  let bestAt = Number.NEGATIVE_INFINITY;
  let value: number | null = null;

  for (const event of scoped) {
    if (event.outcome !== 'limited' || event.quota?.axis !== axis) continue;
    const limit = event.quota.limit;
    if (limit === null || limit <= 0) continue;
    if (event.at >= bestAt) {
      bestAt = event.at;
      value = limit;
    }
  }

  return value;
}

/** The furthest-out still-active wait a 429 on this axis asked for, or `null` if none is still running. */
function activeLimitWait(scoped: readonly ModelRequestEvent[], axis: QuotaAxis, now: number): number | null {
  let latest: number | null = null;

  for (const event of scoped) {
    if (event.outcome !== 'limited' || event.quota?.axis !== axis) continue;
    const wait = event.at + (event.quota.retryAfterMs ?? MINUTE_MS);
    if (wait > now && (latest === null || wait > latest)) latest = wait;
  }

  return latest;
}

function rpmGauge(scoped: readonly ModelRequestEvent[], catalogueLimit: number, now: number): QuotaGauge {
  const limit = overrideLimit(scoped, 'rpm') ?? catalogueLimit;
  const inWindow = scoped.filter((event) => event.at > now - MINUTE_MS);
  const used = inWindow.length;

  const wait = activeLimitWait(scoped, 'rpm', now);
  const resetsAt = Math.max(windowResetsAt(inWindow, now), wait ?? 0);
  const exhausted = used >= limit || wait !== null;

  return {
    axis: 'rpm',
    used,
    limit,
    remaining: exhausted ? 0 : Math.max(0, limit - used),
    exhausted,
    resetsAt,
    unknownTokens: 0,
  };
}

function tpmGauge(scoped: readonly ModelRequestEvent[], catalogueLimit: number, now: number): QuotaGauge {
  const limit = overrideLimit(scoped, 'tpm') ?? catalogueLimit;
  const inWindow = scoped.filter((event) => event.at > now - MINUTE_MS);
  const known = inWindow.filter((event) => event.inputTokens !== null);
  const used = known.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0);
  const unknownTokens = inWindow.length - known.length;

  const wait = activeLimitWait(scoped, 'tpm', now);
  const resetsAt = Math.max(windowResetsAt(known, now), wait ?? 0);
  const exhausted = used >= limit || wait !== null;

  return {
    axis: 'tpm',
    used,
    limit,
    remaining: exhausted ? 0 : Math.max(0, limit - used),
    exhausted,
    resetsAt,
    unknownTokens,
  };
}

function rpdGauge(scoped: readonly ModelRequestEvent[], catalogueLimit: number, now: number): QuotaGauge {
  const limit = overrideLimit(scoped, 'rpd') ?? catalogueLimit;
  const dayStart = pacificDayStart(now);
  const used = scoped.filter((event) => event.at >= dayStart).length;

  const limitedToday = scoped.some(
    (event) => event.outcome === 'limited' && event.quota?.axis === 'rpd' && event.at >= dayStart,
  );
  const exhausted = used >= limit || limitedToday;

  return {
    axis: 'rpd',
    used,
    limit,
    remaining: exhausted ? 0 : Math.max(0, limit - used),
    exhausted,
    /* A daily quota does not reopen early no matter how long a 429 asked this
       one request to wait — only the Pacific day turning over frees it. */
    resetsAt: nextPacificMidnight(now),
    unknownTokens: 0,
  };
}

/**
 * What is left of this model's budget, on all three axes, from the requests
 * this browser has a record of sending.
 */
export function summarizeUsage(
  events: readonly ModelRequestEvent[],
  provider: AiProvider,
  model: string,
  limits: ModelRateLimits,
  now: number,
): ModelUsage {
  const scoped = events.filter((event) => event.provider === provider && event.model === model);

  const rpm = rpmGauge(scoped, limits.rpm, now);
  const tpm = tpmGauge(scoped, limits.tpm, now);
  const rpd = rpdGauge(scoped, limits.rpd, now);

  /* Tie-break order is the longest wait first: rpd resets once a day, tpm and
     rpm within a minute, so a tie is resolved toward whichever gauge leaves
     the seller waiting longest — the one worth surfacing. */
  const ordered: ReadonlyArray<readonly [QuotaAxis, QuotaGauge]> = [
    ['rpd', rpd],
    ['tpm', tpm],
    ['rpm', rpm],
  ];

  let bottleneck: QuotaAxis = 'rpd';
  let remainingShare = rpd.remaining / rpd.limit;

  for (const [axis, gauge] of ordered) {
    const share = gauge.remaining / gauge.limit;
    if (share < remainingShare) {
      remainingShare = share;
      bottleneck = axis;
    }
  }

  return { provider, model, rpm, tpm, rpd, remainingShare, bottleneck };
}

/* ── token totals, for the settings screen's spend read-out ───────────────
 *
 * `summarizeUsage` answers "how much of the rate limit is left" — a gauge
 * against a published ceiling. This answers a different question a seller
 * asks in Settings: "what have I actually spent". No ceiling, no exhaustion,
 * just what the provider billed, summed over whichever window the caller
 * asks for (today, this session, all of `USAGE_RETENTION_MS`) — the caller
 * decides `since`, because "today" is a wall-clock, timezone-bearing idea
 * this module has no business computing on every call the way it does for
 * the Pacific quota day above.
 */

/** Sums over a window of events, restricted to the ones a cost figure can be trusted from. */
export interface TokenTotals {
  /** Events in the window, any outcome. */
  readonly requests: number;
  /** Of those, the ones that carried both `inputTokens` and `outputTokens` — see the fields below. */
  readonly reported: number;
  /** Summed over `reported` events only — an unreported event contributes nothing rather than a guess. */
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  /**
   * Of the `reported` events, how many also stated a cache figure at all —
   * `0` means "this provider never said", not "nothing was cached". Claude
   * and OpenAI always report it; DeepSeek and Mistral may not. Reading
   * `cachedInputTokens` without checking this first turns a provider's
   * silence into a false "0 cached".
   */
  readonly cachedReported: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  /**
   * Of the `reported` events, how many also stated a reasoning figure at all
   * — `0` means "unknown", not "no reasoning spent". Claude's usage object
   * never separates thinking tokens out of `outputTokens` at all, so this is
   * `0` for every Claude model, always.
   */
  readonly reasoningReported: number;
}

export interface ModelTokenTotals extends TokenTotals {
  readonly model: string;
  /** This model's own most recent event in the window, reported or not. */
  readonly lastAt: number;
}

export interface TokenUsageSummary {
  readonly provider: AiProvider;
  readonly since: number;
  readonly total: TokenTotals;
  /** Most recently used model first. */
  readonly byModel: readonly ModelTokenTotals[];
  /** The newest event of this provider that carried usage, or `null` if none did. */
  readonly last: ModelRequestEvent | null;
}

type MutableTotals = { -readonly [K in keyof TokenTotals]: TokenTotals[K] };

function emptyTotals(): MutableTotals {
  return {
    requests: 0,
    reported: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cachedReported: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    reasoningReported: 0,
  };
}

/**
 * Folds one already-`reported` event's token figures into a totals bucket —
 * shared so the provider-wide sum and its per-model breakdown can never fold
 * the same event two different ways.
 *
 * `cachedInputTokens`/`reasoningTokens` are summed only over the events that
 * actually stated them (`typeof … === 'number'`), each counted apart in
 * `cachedReported`/`reasoningReported` — a provider that never reports one
 * (Claude's usage object has no reasoning-token field at all) must read as
 * "unknown", not silently as a truthful "0".
 */
function addReportedEvent(totals: MutableTotals, event: ModelRequestEvent): void {
  totals.reported += 1;
  totals.inputTokens += event.inputTokens ?? 0;
  totals.outputTokens += event.outputTokens ?? 0;

  if (typeof event.cachedInputTokens === 'number') {
    totals.cachedReported += 1;
    totals.cachedInputTokens += event.cachedInputTokens;
  }
  if (typeof event.reasoningTokens === 'number') {
    totals.reasoningReported += 1;
    totals.reasoningTokens += event.reasoningTokens;
  }
}

/**
 * What this browser has recorded spending for one provider since `since`.
 *
 * Pure — no clock read — so the caller supplies "since" (typically local
 * midnight, computed once by the settings screen) rather than this module
 * guessing what "today" means for a seller it has no timezone for.
 */
export function summarizeTokens(
  events: readonly ModelRequestEvent[],
  provider: AiProvider,
  since: number,
): TokenUsageSummary {
  const scoped = events.filter((event) => event.provider === provider && event.at >= since);

  const total = emptyTotals();
  const perModel = new Map<string, { totals: MutableTotals; lastAt: number }>();
  let last: ModelRequestEvent | null = null;

  /* Ascending order, so the final write to `last` — and to each model's
     `lastAt` — is simply the most recent one, with no second pass needed. */
  const ordered = [...scoped].sort((a, b) => a.at - b.at);

  for (const event of ordered) {
    total.requests += 1;

    const bucket = perModel.get(event.model) ?? { totals: emptyTotals(), lastAt: event.at };
    bucket.totals.requests += 1;
    bucket.lastAt = event.at;

    /* "Carried both" — an event missing either half (a legacy event with no
       `outputTokens` field at all, or one where the provider stated only the
       input side) cannot honestly contribute to a token total. */
    const reported = event.inputTokens !== null && typeof event.outputTokens === 'number';

    if (reported) {
      addReportedEvent(total, event);
      addReportedEvent(bucket.totals, event);
      last = event;
    }

    perModel.set(event.model, bucket);
  }

  const byModel: ModelTokenTotals[] = [...perModel.entries()]
    .map(([model, bucket]) => ({ model, lastAt: bucket.lastAt, ...bucket.totals }))
    .sort((a, b) => b.lastAt - a.lastAt);

  return { provider, since, total, byModel, last };
}
