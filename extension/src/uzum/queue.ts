/**
 * The one sequential lane every cabinet request goes through.
 *
 * The cabinet API's real limits are unknown, and the site's header-driven pacer
 * has never been tried against it, so this does not invent a budget: requests
 * run strictly one at a time with a short gap, and a 429 holds the whole lane
 * for `Retry-After` (never less than a growing back-off, so a server that keeps
 * answering 429 is asked less and less often). Nothing is retried here — a
 * request that was refused fails to its caller, who decides whether to spend
 * another.
 *
 * What the recordings settle: the one recorded response (`products.list`,
 * request B) carried no `X-RateLimit-*` and no `Retry-After` header, so there is
 * nothing for a header-driven pacer to read and the plain sequential lane stays.
 * That is one response; the real limits, and whether other routes or a 429
 * answer send such headers, remain unknown.
 *
 * Limit: the lane belongs to one page. Two cabinet tabs each run their own, so
 * two tabs can have one request in flight each, and one tab's 429 hold does not
 * slow the other. Cross-tab coordination is deliberately not built.
 *
 * Imports nothing, so it can sit in the content script.
 */

/** Raised to a caller whose request was cancelled while it was still waiting. */
export class QueueCancelled extends Error {
  constructor() {
    super('Request cancelled while queued');
    this.name = 'QueueCancelled';
  }
}

export interface QueueOptions {
  readonly gapMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

interface Entry {
  readonly signal: AbortSignal;
  readonly run: (signal: AbortSignal) => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  detach(): void;
}

const BACKOFF_FIRST_MS = 2_000;
const BACKOFF_CAP_MS = 60_000;
/** A hostile or buggy `Retry-After: 99999999` must not park the lane for good. */
export const MAX_HOLD_MS = 10 * 60_000;

export class SerialQueue {
  private readonly pending: Entry[] = [];
  private running = false;
  private nextAt = 0;
  private holdUntil = 0;
  private strikes = 0;

  constructor(private readonly options: QueueOptions) {}

  enqueue<T>(signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(new QueueCancelled());

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        /* Settle at once: a cancelled caller must not wait out a long hold. */
        const index = this.pending.indexOf(entry);
        if (index === -1) return;
        this.pending.splice(index, 1);
        reject(new QueueCancelled());
      };
      const entry: Entry = {
        signal,
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        detach: () => signal.removeEventListener('abort', onAbort),
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.push(entry);
      void this.pump();
    });
  }

  /** Report an answer so the lane can widen (429) or relax (anything else). */
  noteOutcome(rateLimited: boolean, retryAfterMs?: number): void {
    if (!rateLimited) {
      this.strikes = 0;
      return;
    }
    this.strikes += 1;
    const backoff = Math.min(BACKOFF_FIRST_MS * 2 ** (this.strikes - 1), BACKOFF_CAP_MS);
    const hold = Math.min(Math.max(retryAfterMs ?? 0, backoff), MAX_HOLD_MS);
    this.holdUntil = Math.max(this.holdUntil, this.options.now() + hold);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const wait = Math.max(this.nextAt, this.holdUntil) - this.options.now();
        if (wait > 0) {
          /* Re-evaluate after sleeping: the head may have been cancelled and the hold widened. */
          await this.options.sleep(wait);
          continue;
        }
        const entry = this.pending.shift();
        if (entry === undefined) break;
        entry.detach();
        try {
          entry.resolve(await entry.run(entry.signal));
        } catch (error) {
          entry.reject(error);
        }
        this.nextAt = this.options.now() + this.options.gapMs;
      }
    } finally {
      this.running = false;
    }
  }
}
