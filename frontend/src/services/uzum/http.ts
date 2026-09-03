import type { AxiosRequestConfig } from 'axios';

import { ApiError, get, post } from '@/services/api/client';

import type { UzumEnvelope } from './types';

/**
 * Envelope and pagination handling for the seller OpenAPI.
 *
 * The API is not uniform: some routes return a bare array, some wrap the body
 * in `{ payload }`, and some return a bespoke object. Rather than teach every
 * call site which is which, everything goes through one of the readers here.
 */

/**
 * How far a paginated read has got.
 *
 * `total` is whatever the route published — `totalElements` on the routes that
 * have it, and 0 on the bare-array collections that do not. Zero means unknown,
 * never "nothing": a caller must not render it as 0%.
 */
export interface ProgressReport {
  readonly loaded: number;
  readonly total: number;
}

export type ProgressReporter = (report: ProgressReport) => void;

export interface RequestContext {
  readonly signal?: AbortSignal | undefined;
  /**
   * Called after each page lands. Threaded through the request layer rather
   * than published on a global bus so that progress belongs to the call that
   * produced it — two reads in flight report to their own callers.
   */
  readonly onProgress?: ProgressReporter | undefined;
}

function config(context: RequestContext, params?: Record<string, unknown>): AxiosRequestConfig {
  return {
    ...(params !== undefined ? { params } : {}),
    ...(context.signal !== undefined ? { signal: context.signal } : {}),
  };
}

/** A route that answers with the body itself. */
export function getRaw<T>(
  url: string,
  params: Record<string, unknown>,
  context: RequestContext,
): Promise<T> {
  return get<T>(url, config(context, params));
}

/** A route that answers `{ payload, timestamp }`. */
export async function getPayload<T>(
  url: string,
  params: Record<string, unknown>,
  context: RequestContext,
): Promise<T> {
  const body = await get<UzumEnvelope<T>>(url, config(context, params));

  if (body === null || typeof body !== 'object' || !('payload' in body)) {
    throw new ApiError(`Unexpected response shape from ${url}`, { kind: 'server' });
  }
  return body.payload;
}

export async function postPayload<T, B>(
  url: string,
  body: B,
  context: RequestContext,
): Promise<T> {
  const response = await post<UzumEnvelope<T> | T, B>(url, body, config(context));

  if (response !== null && typeof response === 'object' && 'payload' in response) {
    return (response as UzumEnvelope<T>).payload;
  }
  return response as T;
}

/* ── pagination ─────────────────────────────────────────────────────────── */

/**
 * Hard ceiling on pages walked per collection.
 *
 * The seller API is rate-limited per hour, and a 60-day window on a busy shop
 * runs to thousands of order items. Reading everything would spend the budget
 * on one screen refresh, so collections stop here and the UI reports how much
 * of the total it is showing rather than pretending it has all of it.
 */
export const MAX_PAGES = 40;

export interface PageResult<T> {
  readonly items: readonly T[];
  /** What the API says exists, when it says; otherwise what was read. */
  readonly total: number;
  /** True when the ceiling above cut the walk short. */
  readonly truncated: boolean;
}

export interface PaginateOptions<T> {
  readonly pageSize: number;
  readonly maxPages?: number;
  /** Fetch one page; return its items and, if known, the overall total. */
  readonly fetchPage: (page: number, size: number) => Promise<{
    readonly items: readonly T[];
    readonly total?: number | undefined;
  }>;
  readonly onProgress?: ProgressReporter | undefined;
}

/**
 * Walk a paginated collection until it runs out, the total is reached, or the
 * ceiling is hit. Pages are fetched in sequence on purpose: the API rate-limits
 * per hour and parallel bursts are what trips it.
 */
export async function paginate<T>(options: PaginateOptions<T>): Promise<PageResult<T>> {
  const limit = options.maxPages ?? MAX_PAGES;
  const collected: T[] = [];
  let reported: number | undefined;

  /**
   * Whether the walk *stopped* rather than ran out of budget.
   *
   * The only two honest reasons to stop are a short page — the route has no
   * more — and reaching the total it published. Anything else means the ceiling
   * cut in, and on the routes that publish no total that is the only thing
   * observable: comparing `collected.length` against a `total` that defaults to
   * `collected.length` can never be true, so `/v1/invoice`, `/v1/return` and
   * `/v1/fbs/invoice` used to report a clipped walk as a complete one.
   */
  let completed = false;

  for (let page = 0; page < limit; page += 1) {
    const result = await options.fetchPage(page, options.pageSize);

    /* A route that publishes 0 while still handing back rows is saying "unknown",
       not "nothing" — `/v1/finance/expenses` reports `totalElements: 0` on every
       page. Taken at face value it satisfies the completion check below on the
       first page and the walk stops one page in, so 0 is treated as absent. */
    if (result.total !== undefined && result.total > 0) reported = result.total;

    collected.push(...result.items);

    /* Reported per page rather than per row: the page is the unit that actually
       arrives, and a caller redrawing a progress bar wants one update per
       network round trip, not fifty per page. */
    options.onProgress?.({ loaded: collected.length, total: reported ?? 0 });

    if (result.items.length < options.pageSize) {
      completed = true;
      break;
    }
    if (reported !== undefined && collected.length >= reported) {
      completed = true;
      break;
    }
  }

  return { items: collected, total: reported ?? collected.length, truncated: !completed };
}

/* ── time window ────────────────────────────────────────────────────────── */

/**
 * `dateFrom` / `dateTo` are **seconds** on every route that takes them, while
 * every timestamp inside a response body is milliseconds. Mixing the two
 * silently returns an empty list, which is why this conversion has a name.
 */
export const toApiSeconds = (epochMs: number): number => Math.floor(epochMs / 1_000);
