import type {
  AnalyticsJob,
  AnalyticsResult,
  ExpenseTotals,
  Granularity,
  ProductTotal,
  SeriesResult,
  WorkerRequest,
  WorkerResponse,
} from './aggregation';
import { runAnalytics } from './analytics.runner';
import type { EntityType } from './schema';

/**
 * The main thread's handle on the analytics worker.
 *
 * Everything a screen asks about a period goes through here, and the caller
 * never learns whether a worker answered or the main thread did. That is the
 * point of the fallback: the worker is an optimisation, and a browser that
 * cannot start one should render slightly less smoothly rather than not at all.
 *
 * Three things this owns that the worker deliberately does not:
 *
 *   • **Request identity.** Every job carries an id, and replies are routed
 *     back to the promise that asked. Several screens can have questions in
 *     flight at once over one worker.
 *
 *   • **Cancellation.** A range change abandons the question it replaces. The
 *     worker is not interrupted — there is no safe way to stop it mid-cursor —
 *     but the pending promise is rejected immediately and its reply discarded
 *     on arrival, so a stale answer can never overwrite a fresh one.
 *
 *   • **Failure recovery.** A worker that dies takes its pending jobs with it.
 *     They are rejected, the handle is dropped, and the next call starts a new
 *     worker — or falls back to the main thread if starting one keeps failing.
 */

interface Pending {
  readonly resolve: (result: AnalyticsResult) => void;
  readonly reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Set once starting a worker has failed; every later job runs inline. */
let workersUnavailable = false;

function disposeWorker(reason: string): void {
  for (const [, entry] of pending) entry.reject(new Error(reason));
  pending.clear();

  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker | null {
  if (workersUnavailable) return null;
  if (worker !== null) return worker;

  try {
    /* `new URL(..., import.meta.url)` is the form the bundler recognises, which
       is what lets the worker be code-split and hashed like any other module
       rather than needing a hand-maintained path in `public/`. */
    const instance = new Worker(new URL('./analytics.worker.ts', import.meta.url), {
      type: 'module',
      name: 'savdo-analytics',
    });

    instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const entry = pending.get(response.id);
      /* No entry means the job was cancelled while in flight. Dropping the
         reply is the whole of what cancellation means here. */
      if (entry === undefined) return;

      pending.delete(response.id);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new Error(response.error));
    };

    instance.onerror = () => {
      disposeWorker('The analytics worker stopped unexpectedly');
    };

    worker = instance;
    return instance;
  } catch {
    workersUnavailable = true;
    return null;
  }
}

/**
 * Run a job, off the main thread where possible.
 *
 * `signal` abandons the *answer*, not the work. Once a cursor is walking there
 * is nothing to interrupt, and pretending otherwise would mean either polling a
 * flag between rows (slow) or leaving a half-read transaction open (worse). The
 * honest contract is that an abandoned job's result is discarded, which is
 * exactly what a range change needs.
 */
export function runJob(
  job: AnalyticsJob,
  signal?: AbortSignal | undefined,
): Promise<AnalyticsResult> {
  if (signal?.aborted === true) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  const instance = ensureWorker();

  if (instance === null) {
    /* No worker: run inline. Still asynchronous, so callers see one behaviour. */
    return runAnalytics(job);
  }

  const id = nextId;
  nextId += 1;

  return new Promise<AnalyticsResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });

    const onAbort = (): void => {
      pending.delete(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const request: WorkerRequest = { id, job };
    try {
      instance.postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error('Failed to dispatch analytics job'));
    }
  }).finally(() => {
    pending.delete(id);
  });
}

/* ── typed conveniences ─────────────────────────────────────────────────── */

/**
 * The revenue/units/profit series for a window.
 *
 * This is the call a chart makes. It returns gap-free buckets already sized to
 * the window, so the component receives something it can draw directly rather
 * than a row set it has to group first.
 */
export async function loadSeries(
  storeIds: readonly number[],
  fromMs: number,
  toMs: number,
  options: { readonly granularity?: Granularity; readonly signal?: AbortSignal } = {},
): Promise<SeriesResult> {
  const result = await runJob(
    { kind: 'series', storeIds, fromMs, toMs, granularity: options.granularity },
    options.signal,
  );
  if (result.kind !== 'series') throw new Error('Unexpected analytics reply');
  return result.value;
}

/** Products ranked by revenue over a window. */
export async function loadProductTotals(
  storeIds: readonly number[],
  fromMs: number,
  toMs: number,
  options: { readonly limit?: number; readonly signal?: AbortSignal } = {},
): Promise<readonly ProductTotal[]> {
  const result = await runJob(
    { kind: 'products', storeIds, fromMs, toMs, limit: options.limit },
    options.signal,
  );
  if (result.kind !== 'products') throw new Error('Unexpected analytics reply');
  return result.value;
}

/** Net cash movement and the biggest outgoings over a window. */
export async function loadExpenseTotals(
  storeIds: readonly number[],
  fromMs: number,
  toMs: number,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ExpenseTotals> {
  const result = await runJob({ kind: 'expenses', storeIds, fromMs, toMs }, options.signal);
  if (result.kind !== 'expenses') throw new Error('Unexpected analytics reply');
  return result.value;
}

/** Rows held for a window, counted by the index without reading any. */
export async function countRecords(
  storeIds: readonly number[],
  entity: EntityType,
  fromMs: number,
  toMs: number,
  options: { readonly signal?: AbortSignal } = {},
): Promise<number> {
  const result = await runJob({ kind: 'count', storeIds, entity, fromMs, toMs }, options.signal);
  if (result.kind !== 'count') throw new Error('Unexpected analytics reply');
  return result.value;
}

/** Shut the worker down — used when the account changes and on teardown. */
export function stopAnalyticsWorker(): void {
  disposeWorker('The analytics worker was stopped');
}
