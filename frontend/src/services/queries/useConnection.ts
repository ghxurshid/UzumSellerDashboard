import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ApiError } from '@/services/api/client';
import type { UzumShop } from '@/services/uzum/types';
import { useApiSettings } from '@/store/settings.store';

import { shopsQuery } from './sources';

/**
 * The connection to the seller API.
 *
 * This is step one of the real lifecycle: nothing else may run until a token
 * is stored *and* the API has accepted it. `GET /v1/shops` is the probe —
 * cheapest authenticated call there is — and its answer decides which of the
 * five states below the whole application is in.
 */
export type ConnectionStatus =
  /** No token saved yet. Fresh install. */
  | 'unconfigured'
  /** Token saved, probe in flight. */
  | 'checking'
  /** Probe succeeded; shops are known. */
  | 'connected'
  /** Token rejected — 401. */
  | 'unauthorized'
  /** Token accepted elsewhere, but this account may not read shops — 403. */
  | 'forbidden'
  /** Could not reach Uzum at all. */
  | 'unreachable'
  /** Anything else the API answered with. */
  | 'error';

/** One shared empty list, so "no shops yet" keeps a stable identity. */
const NO_SHOPS: readonly UzumShop[] = [];

export interface Connection {
  readonly status: ConnectionStatus;
  readonly configured: boolean;
  readonly shops: readonly UzumShop[];
  readonly error: ApiError | null;
  /** Milliseconds since the shops list was last confirmed, or null. */
  readonly checkedAt: number | null;
  readonly retry: () => void;
}

function statusFrom(error: ApiError | null): ConnectionStatus {
  if (error === null) return 'error';
  switch (error.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'forbidden':
      return 'forbidden';
    case 'network':
    case 'timeout':
      return 'unreachable';
    case 'unconfigured':
      return 'unconfigured';
    default:
      return 'error';
  }
}

export function useConnection(): Connection {
  const { token, baseUrl } = useApiSettings();
  const configured = token.trim() !== '' && baseUrl.trim() !== '';

  const query = useQuery({ ...shopsQuery(), enabled: configured });

  const error = query.error instanceof ApiError ? query.error : null;

  const status = useMemo<ConnectionStatus>(() => {
    if (!configured) return 'unconfigured';
    if (query.isError) return statusFrom(error);
    if (query.data !== undefined) return 'connected';
    return 'checking';
  }, [configured, error, query.data, query.isError]);

  const shops = query.data ?? NO_SHOPS;
  const { dataUpdatedAt, refetch } = query;

  return useMemo<Connection>(
    () => ({
      status,
      configured,
      shops,
      error,
      checkedAt: dataUpdatedAt === 0 ? null : dataUpdatedAt,
      retry: () => void refetch(),
    }),
    [configured, dataUpdatedAt, error, refetch, shops, status],
  );
}

/** Shops alone, for callers that only need the list. */
export function useShops(): readonly UzumShop[] {
  return useConnection().shops;
}
