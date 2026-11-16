import { useCallback, useEffect, useState } from 'react';

import { getSellerSession, onBridgeClosed } from '@ext/uzum/client';

import { statusOfError, statusOfSession, type CabinetStatus } from './cabinetStatus';

/**
 * The cabinet's state as the panel last read it.
 *
 * Read when the panel mounts, whenever the frame is shown (`refreshKey` — the
 * seller may have signed in, or switched shop, while it was closed) and on
 * demand. A read that is replaced by a newer one is aborted and says nothing,
 * so a slow answer cannot overwrite a fresh one.
 */
export function useCabinetStatus(refreshKey: number): {
  readonly status: CabinetStatus;
  readonly recheck: () => void;
} {
  const [status, setStatus] = useState<CabinetStatus>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getSellerSession(controller.signal)
      .then((session) => setStatus(statusOfSession(session)))
      .catch((error: unknown) => {
        const next = statusOfError(error);
        if (next !== null) setStatus(next);
      });
    return () => controller.abort();
  }, [refreshKey, attempt]);

  /* Said by the cabinet page itself, so it is shown even when no read is in flight.
     Nothing replaces it afterwards: every later read would fail the same way. */
  useEffect(() => onBridgeClosed(() => setStatus('closed')), []);

  const recheck = useCallback(() => setAttempt((count) => count + 1), []);
  return { status, recheck };
}

