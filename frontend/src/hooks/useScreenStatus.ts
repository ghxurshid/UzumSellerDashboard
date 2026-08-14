import type { UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { STATE_KIND } from '@/constants/app';
import { formatClock } from '@/lib/format';
import { ApiError } from '@/services/api/client';
import { useConnection } from '@/services/queries/useConnection';
import { useFailedSources, useSyncStore } from '@/store/sync.store';
import { useSessionStore } from '@/store/session.store';
import type { ScreenState, StateKind } from '@/types/domain';

/**
 * Which state a screen is in — resolved from what actually happened.
 *
 * Every state the design specifies is produced here by a real condition, in a
 * fixed order of precedence. Nothing can force a state and nothing defaults to
 * `loaded`; if the app cannot justify content, it says which of the twelve
 * other things is true instead.
 *
 *   unconfigured token      → initial
 *   401 from the API        → unauth
 *   403 from the API        → forbidden
 *   in flight, nothing yet  → loading
 *   failed, nothing cached  → offline | timeout | error
 *   resolved, zero rows     → empty
 *   filtered to zero        → noSearch | noFilter
 *   otherwise               → loaded (possibly refreshing)
 *
 * Cached data outranks a failure: once a sync has landed, a later network drop
 * shows the snapshot with an offline banner rather than throwing the screen
 * away. That is the difference between "we lost the connection" and "there is
 * nothing here".
 */

/** A banner sits above content the user can still read; a block replaces it. */
export type BannerKind = 'offline' | 'partial' | 'warning' | 'readonly' | 'success';

/** Data older than this is called out as stale in the header banner. */
export const STALE_AFTER_MS = 30 * 60 * 1_000;

export interface ScreenInput {
  /** Every query this screen needs; all are considered together. */
  readonly queries: readonly UseQueryResult<unknown>[];
  /** Rows the sources returned, before any client-side narrowing. */
  readonly total: number;
  /** Rows left after search and filters. */
  readonly visible: number;
  readonly searchActive: boolean;
  readonly filterActive: boolean;
}

export interface ScreenStatus {
  readonly state: ScreenState;
  readonly kind: StateKind;
  /** True when content is on screen and a refresh is in flight behind it. */
  readonly refreshing: boolean;
  readonly error: ApiError | null;
  /** The mono line under a block: status code, timings, last successful sync. */
  readonly meta: string | null;
  readonly banner: BannerKind | null;
  /** Epoch ms of the freshest data on screen, or null when there is none. */
  readonly updatedAt: number | null;
  readonly stale: boolean;
}

function firstApiError(queries: readonly UseQueryResult<unknown>[]): ApiError | null {
  for (const query of queries) {
    if (query.error instanceof ApiError) return query.error;
  }
  return null;
}

function blockStateFor(error: ApiError | null): ScreenState {
  if (error === null) return 'error';
  switch (error.kind) {
    case 'network':
      return 'offline';
    case 'timeout':
      return 'timeout';
    case 'unauthorized':
      return 'unauth';
    case 'forbidden':
      return 'forbidden';
    case 'unconfigured':
      return 'initial';
    default:
      return 'error';
  }
}

function minutesSince(at: number): number {
  return Math.max(0, Math.round((Date.now() - at) / 60_000));
}

function describeError(error: ApiError): string {
  const parts = [error.status === undefined ? error.code ?? error.kind : String(error.status)];
  if (error.message !== '') parts.push(error.message);
  if (error.retryAfterMs !== undefined) {
    parts.push(`retry in ${Math.ceil(error.retryAfterMs / 60_000)} min`);
  }
  return parts.join(' · ');
}

export function useScreenStatus(input: ScreenInput): ScreenStatus {
  const connection = useConnection();
  const network = useSessionStore((state) => state.network);
  const deniedAt = useSessionStore((state) => state.deniedAt);
  const syncPhase = useSyncStore((state) => state.phase);
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt);
  const failedSources = useFailedSources();

  const { queries, total, visible, searchActive, filterActive } = input;

  return useMemo<ScreenStatus>(() => {
    const withData = queries.filter((query) => query.data !== undefined);
    const hasData = withData.length === queries.length && queries.length > 0;
    const anyPending = queries.some((query) => query.isPending || query.isLoading);
    const anyFetching = queries.some((query) => query.isFetching);
    const error = firstApiError(queries) ?? connection.error;

    const updatedAt =
      withData.length === 0
        ? null
        : Math.min(...withData.map((query) => query.dataUpdatedAt || Date.now()));
    const stale = updatedAt !== null && Date.now() - updatedAt > STALE_AFTER_MS;

    const resolve = (): { state: ScreenState; meta: string | null } => {
      /* 1 — nothing is configured yet. */
      if (connection.status === 'unconfigured') {
        return { state: 'initial', meta: null };
      }

      /* 2 — the token itself was rejected. Outranks cached data: a signed-out
             user must never be shown figures they can no longer refresh. */
      if (connection.status === 'unauthorized' || error?.kind === 'unauthorized') {
        const at = useSessionStore.getState().unauthorizedAt;
        return { state: 'unauth', meta: at === null ? '401' : `401 · ${formatClock(at)}` };
      }

      /* 3 — authorised, but not for this. */
      if (connection.status === 'forbidden' || error?.kind === 'forbidden') {
        return { state: 'forbidden', meta: error === null ? '403' : describeError(error) };
      }

      /* 4 — the connection probe has not answered yet. */
      if (connection.status === 'checking' && !hasData) {
        return { state: 'loading', meta: null };
      }

      if (connection.status === 'unreachable' && !hasData) {
        return {
          state: 'offline',
          meta:
            lastSyncAt === null
              ? 'no successful sync yet'
              : `last sync ${formatClock(lastSyncAt)} · ${minutesSince(lastSyncAt)} min ago`,
        };
      }

      /* 5 — data is on its way and there is nothing cached to show meanwhile. */
      if (anyPending && !hasData) {
        return { state: 'loading', meta: null };
      }

      /* 6 — it failed and there is no snapshot to fall back on. */
      if (error !== null && !hasData) {
        const state = blockStateFor(error);
        const meta =
          state === 'offline' && lastSyncAt !== null
            ? `last sync ${formatClock(lastSyncAt)} · ${minutesSince(lastSyncAt)} min ago`
            : describeError(error);
        return { state, meta };
      }

      /* 7 — the sources answered, and the account genuinely has nothing here. */
      if (hasData && total === 0) {
        return { state: 'empty', meta: null };
      }

      /* 8 — rows exist; the user's own narrowing removed them all. */
      if (hasData && visible === 0 && total > 0) {
        return { state: searchActive ? 'noSearch' : filterActive ? 'noFilter' : 'empty', meta: null };
      }

      return { state: 'loaded', meta: null };
    };

    const { state, meta } = resolve();
    const kind = STATE_KIND[state];

    const banner = ((): BannerKind | null => {
      if (kind !== 'ok') return null;
      if (network === 'offline') return 'offline';
      /* Reads are landing but a write was refused — the screen is usable,
         just not writable, and that is worth saying before the next attempt. */
      if (deniedAt !== null) return 'readonly';
      if (failedSources.length > 0) return 'partial';
      if (stale) return 'warning';
      if (syncPhase === 'success') return 'success';
      return null;
    })();

    return {
      state,
      kind,
      refreshing: anyFetching && hasData,
      error,
      meta,
      banner,
      updatedAt,
      stale,
    };
  }, [
    connection.error,
    connection.status,
    deniedAt,
    failedSources.length,
    filterActive,
    lastSyncAt,
    network,
    queries,
    searchActive,
    syncPhase,
    total,
    visible,
  ]);
}
