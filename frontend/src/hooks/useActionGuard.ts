import { useCallback } from 'react';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { useConnection } from '@/services/queries/useConnection';
import { useSessionStore } from '@/store/session.store';
import { useSyncStore } from '@/store/sync.store';
import { useToastStore } from '@/store/toast.store';

export type WriteBlock = 'unconfigured' | 'unauthorized' | 'forbidden' | 'offline' | 'syncing' | null;

interface UseActionGuardResult {
  /** True when the write may proceed; otherwise it has already explained why not. */
  readonly allow: () => boolean;
  /** Why writes are unavailable, or null when they are available. */
  readonly blockedBy: WriteBlock;
  readonly readOnly: boolean;
}

/**
 * The gate in front of every write.
 *
 * A write is refused for one of four real reasons, each of which the user can
 * do something about: no token, a token the API rejected, no connection, or a
 * sync in progress that would be reading the very rows being changed. There is
 * no notion of a "viewer" here — the seller API has no role model, so inventing
 * one would mean disabling buttons for a reason that does not exist.
 */
export function useActionGuard(): UseActionGuardResult {
  const { t } = useTranslation();
  const push = useToastStore((state) => state.push);

  const connection = useConnection();
  const network = useSessionStore((state) => state.network);
  const deniedAt = useSessionStore((state) => state.deniedAt);
  const syncing = useSyncStore((state) => state.phase === 'running');

  const blockedBy: WriteBlock =
    connection.status === 'unconfigured'
      ? 'unconfigured'
      : connection.status === 'unauthorized'
        ? 'unauthorized'
        : connection.status === 'forbidden' || deniedAt !== null
          ? 'forbidden'
          : network === 'offline'
            ? 'offline'
            : syncing
              ? 'syncing'
              : null;

  const allow = useCallback((): boolean => {
    switch (blockedBy) {
      case null:
        return true;
      case 'unconfigured':
        push(t('blInitT'), { kind: 'warn' });
        return false;
      case 'unauthorized':
        push(t('blUnauthT'), { kind: 'err' });
        return false;
      case 'forbidden':
        push(t('blForbT'), { kind: 'err' });
        return false;
      case 'offline':
        push(t('blOffT'), { kind: 'warn' });
        return false;
      case 'syncing':
        push(t('bnDisT'), { kind: 'warn' });
        return false;
    }
  }, [blockedBy, push, t]);

  return { allow, blockedBy, readOnly: blockedBy !== null };
}
