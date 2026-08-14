import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { SourceId } from '@/services/queries/sources';
import { useScope } from '@/services/queries/useScope';
import { useSyncStore } from '@/store/sync.store';

import type { ShopSyncReport } from './archiveSync';
import { cancelSync, runBackfill, runSync, type SyncResult } from './syncEngine';

/**
 * React's handle on the sync engine.
 *
 * Deliberately thin. Every component that can start a sync calls this hook, and
 * every one of them must drive the *same* run — so all the state that a run
 * needs to be cancellable and joinable lives in `syncEngine.ts`, at module
 * scope, not in a ref inside this hook. Four components each holding their own
 * abort controller is exactly how a cancel button ends up cancelling nothing.
 *
 * What the hook supplies is the part only React knows: the query client and the
 * current scope.
 */
export interface UseSyncResult {
  /** Run a full sync, or only the named sources (a retry from the banner). */
  readonly run: (only?: readonly SourceId[]) => Promise<SyncResult>;
  /**
   * Extend the archive further back without touching the screens.
   *
   * The ordinary sync adds a couple of months of older history per run so that
   * it converges quietly; this is the same walk, run deeper, for someone who
   * wants the whole record now and is willing to spend the requests.
   */
  readonly backfill: () => Promise<readonly ShopSyncReport[]>;
  readonly cancel: () => void;
  readonly isRunning: boolean;
}

export function useSync(): UseSyncResult {
  const client = useQueryClient();
  const scope = useScope();

  /* Read from the store rather than from the engine so that starting a run
     anywhere re-renders every button that shows its state. */
  const isRunning = useSyncStore((state) => state.phase === 'running');

  const run = useCallback(
    (only?: readonly SourceId[]): Promise<SyncResult> => runSync({ client, scope, only }),
    [client, scope],
  );

  const backfill = useCallback((): Promise<readonly ShopSyncReport[]> => runBackfill(scope), [scope]);

  const cancel = useCallback(() => cancelSync(client), [client]);

  return { run, backfill, cancel, isRunning };
}

export type { SyncResult };
