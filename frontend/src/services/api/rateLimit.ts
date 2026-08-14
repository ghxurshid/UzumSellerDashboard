import { ApiError } from './errors';

/**
 * Request pacing, driven by the seller API's own rate-limit headers.
 *
 * Uzum answers every request with what its gateway thinks of us:
 *
 * ```
 * X-RateLimit-Replenish-Rate     tokens added per second
 * X-RateLimit-Burst-Capacity     most requests allowed inside one second
 * X-RateLimit-Remaining          tokens left right now
 * X-RateLimit-Limit-Per-Day      requests allowed today
 * X-RateLimit-Remaining-Per-Day  requests left today
 * ```
 *
 * This module mirrors that bucket locally and makes every request wait for a
 * token before it goes out. The delay is therefore *earned*, not guessed: a
 * full bucket costs nothing, and only a sync deep into a paginated read — the
 * one thing that actually drains the budget — ends up spaced out.
 *
 * The mirror is corrected by every response, so drift never accumulates: if the
 * gateway says four tokens are left, four is what we believe, whatever our own
 * arithmetic had. Until the first response teaches us the real numbers, the
 * fallback below governs, which also covers the case where the headers are not
 * readable at all (a cross-origin build without `Access-Control-Expose-Headers`
 * sees no `X-RateLimit-*` even though the server sent them; the dev proxy in
 * `vite.config.ts` passes them through, so development sees the real values).
 *
 * Pacing is applied to *every* request rather than only to syncs, because the
 * gateway counts every request and the wait is zero whenever the budget is
 * healthy. One shared queue means concurrent callers space out against each
 * other instead of each pacing itself in isolation.
 */

/* ── configuration ──────────────────────────────────────────────────────── */

/**
 * What we assume before the first response, and forever if the headers turn
 * out to be unreadable. Deliberately modest: five per second sustained is slow
 * enough to be safe on an unknown gateway and fast enough that a six-source
 * sync is not painful.
 */
const FALLBACK_REPLENISH_RATE = 5;
const FALLBACK_BURST_CAPACITY = 10;

/**
 * Tokens we refuse to spend. The local mirror can only ever be as fresh as the
 * last response, so hitting the gateway's exact ceiling is how a 429 happens;
 * stopping one short is how it does not.
 */
const RESERVED_TOKENS = 1;

/** Fallback cooldown after a 429 that arrives without a `Retry-After`. */
const DEFAULT_COOLDOWN_MS = 2_000;

/**
 * How long an exhausted daily budget is believed before one request is let
 * through to check again.
 *
 * Only responses carry the headers, so refusing to send anything is also
 * refusing to ever learn that the day rolled over — a tab left open overnight
 * would stay locked on yesterday's zero. One request a minute is a cheap way to
 * find out, and until then callers fail fast with a reason instead of waiting.
 */
const DAILY_RECHECK_MS = 60_000;

/** No single wait exceeds this — a wrong header should slow us, not hang us. */
const MAX_WAIT_MS = 30_000;

/* ── observed state ─────────────────────────────────────────────────────── */

export interface RateLimitSnapshot {
  /** True once a response actually carried the headers. */
  readonly observed: boolean;
  readonly replenishRate: number;
  readonly burstCapacity: number;
  /** Tokens the local mirror believes are available right now. */
  readonly available: number;
  readonly dailyLimit: number | null;
  readonly dailyRemaining: number | null;
  /** When the gateway last told us anything. */
  readonly observedAt: number | null;
  /** Instant a 429 cooldown expires, or null when not holding. */
  readonly holdUntil: number | null;
}

let replenishRate = FALLBACK_REPLENISH_RATE;
let burstCapacity = FALLBACK_BURST_CAPACITY;
let tokens = FALLBACK_BURST_CAPACITY;
let refilledAt = Date.now();
let holdUntil = 0;
let dailyLimit: number | null = null;
let dailyRemaining: number | null = null;
let observed = false;
let observedAt: number | null = null;

/** Usable capacity — the gateway's ceiling minus the reserve we never spend. */
function capacity(): number {
  return Math.max(1, burstCapacity - RESERVED_TOKENS);
}

function refill(now: number): void {
  const elapsedMs = Math.max(0, now - refilledAt);
  tokens = Math.min(capacity(), tokens + (elapsedMs / 1_000) * replenishRate);
  refilledAt = now;
}

/* ── reading the headers ────────────────────────────────────────────────── */

const HEADER = {
  remaining: 'x-ratelimit-remaining',
  replenishRate: 'x-ratelimit-replenish-rate',
  burstCapacity: 'x-ratelimit-burst-capacity',
  dailyLimit: 'x-ratelimit-limit-per-day',
  dailyRemaining: 'x-ratelimit-remaining-per-day',
} as const;

/**
 * Axios normalises response header names to lower case, but the object is an
 * `AxiosHeaders` instance on some adapters and a plain record on others, so
 * both shapes are read rather than assumed.
 */
function headerValue(headers: unknown, name: string): string | null {
  if (typeof headers !== 'object' || headers === null) return null;

  const bag = headers as Record<string, unknown> & { get?: (key: string) => unknown };
  const raw = bag[name] ?? (typeof bag.get === 'function' ? bag.get(name) : undefined);

  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  /* A repeated header arrives as a list; the first value is the current one. */
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

function headerNumber(headers: unknown, name: string): number | null {
  const raw = headerValue(headers, name);
  if (raw === null || raw.trim() === '') return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Fold one response's headers into the local mirror.
 *
 * Called for successful and failed responses alike — a 429 carries the numbers
 * that matter most.
 */
export function observeRateLimit(headers: unknown): void {
  const rate = headerNumber(headers, HEADER.replenishRate);
  const burst = headerNumber(headers, HEADER.burstCapacity);
  const remaining = headerNumber(headers, HEADER.remaining);
  const limitPerDay = headerNumber(headers, HEADER.dailyLimit);
  const remainingPerDay = headerNumber(headers, HEADER.dailyRemaining);

  if (rate === null && burst === null && remaining === null && remainingPerDay === null) {
    return;
  }

  observed = true;
  observedAt = Date.now();

  if (rate !== null && rate > 0) replenishRate = rate;
  if (burst !== null && burst > 0) burstCapacity = burst;
  if (limitPerDay !== null && limitPerDay >= 0) dailyLimit = limitPerDay;
  if (remainingPerDay !== null && remainingPerDay >= 0) dailyRemaining = remainingPerDay;

  if (remaining !== null && remaining >= 0) {
    /* Trust the gateway downward only. It reports what was left *before* the
       requests still in flight land, so believing a higher number than our own
       count is how a burst slips through. */
    refill(Date.now());
    tokens = Math.min(tokens, Math.max(0, remaining - RESERVED_TOKENS));
  }
}

/**
 * A 429 came back. Hold every request until the window the server named, and
 * empty the mirror so pacing restarts from the bottom rather than from whatever
 * it wrongly believed a moment ago.
 */
export function noteRateLimited(retryAfterMs: number | undefined): void {
  const cooldown = Math.min(MAX_WAIT_MS, retryAfterMs ?? DEFAULT_COOLDOWN_MS);
  holdUntil = Math.max(holdUntil, Date.now() + cooldown);
  tokens = 0;
  refilledAt = Date.now();
}

/** What the pacer currently believes — for diagnostics and the settings screen. */
export function readRateLimit(): RateLimitSnapshot {
  refill(Date.now());
  return {
    observed,
    replenishRate,
    burstCapacity,
    available: Math.floor(tokens),
    dailyLimit,
    dailyRemaining,
    observedAt,
    holdUntil: holdUntil > Date.now() ? holdUntil : null,
  };
}

/* ── the queue ──────────────────────────────────────────────────────────── */

function cancelled(): ApiError {
  return new ApiError('Request cancelled', { kind: 'cancelled', code: 'ERR_CANCELED' });
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(cancelled());
      return;
    }

    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve();
    }

    function abort(): void {
      clearTimeout(timer);
      reject(cancelled());
    }

    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** How long until one token is available, in milliseconds. */
function waitFor(now: number): number {
  const cooldown = Math.max(0, holdUntil - now);
  refill(now);

  const refillWait = tokens >= 1 ? 0 : Math.ceil(((1 - tokens) / replenishRate) * 1_000);
  return Math.min(MAX_WAIT_MS, Math.max(cooldown, refillWait));
}

/**
 * Whether the day's budget is spent *and* that reading is recent enough to act
 * on. A stale zero lets one request through, which is what refreshes it.
 */
function dailyExhausted(now: number): boolean {
  if (dailyRemaining === null || dailyRemaining > 0) return false;
  if (observedAt === null) return false;
  return now - observedAt < DAILY_RECHECK_MS;
}

async function take(signal: AbortSignal | undefined): Promise<void> {
  if (dailyExhausted(Date.now())) {
    /* Sending anyway would spend a request to be told the same thing, and the
       screens read this as a rate-limit state rather than a generic failure. */
    throw new ApiError('Daily request limit for this token is exhausted', {
      kind: 'rateLimited',
    });
  }

  for (;;) {
    const wait = waitFor(Date.now());
    if (wait <= 0) break;
    await sleep(wait, signal);
  }

  /* Only the per-second bucket is counted locally. The daily figure is left to
     the header on the next response: every request produces one, so there is
     nothing to gain from a second, drifting count of the same number. */
  tokens -= 1;
}

/**
 * One chain, so that N concurrent requests queue behind each other instead of
 * all reading a full bucket at the same instant and leaving together.
 */
let queue: Promise<void> = Promise.resolve();

/**
 * Wait until it is this request's turn to go out.
 *
 * Rejects with a cancelled `ApiError` if the caller aborts mid-wait, so a
 * cancelled sync stops immediately instead of finishing its queue.
 */
export function reserveSlot(signal: AbortSignal | undefined): Promise<void> {
  const turn = queue.then(() => take(signal));
  /* The chain must survive a rejected turn, or one cancellation would wedge
     every request that follows. */
  queue = turn.catch(() => undefined);
  return turn;
}
