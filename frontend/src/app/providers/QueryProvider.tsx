import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ApiError } from '@/services/api/client';

const MAX_RETRIES = 2;
const STALE_TIME_MS = 30_000;

/**
 * How long an unobserved query survives in memory.
 *
 * Short on purpose: the query cache is only a working view of the local
 * database, and dropping an entry costs an indexed read from IndexedDB rather
 * than a request to Uzum. Holding every scope a user has visited in RAM for a
 * day would be caching the cache.
 */
const GC_TIME_MS = 30 * 60 * 1_000;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: GC_TIME_MS,
        refetchOnWindowFocus: false,
        /* Retry transport failures, never a 4xx the server will reject again. */
        retry: (failureCount, error) => {
          if (failureCount >= MAX_RETRIES) return false;
          if (error instanceof ApiError) return error.isRetryable;
          return true;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ children }: { readonly children: ReactNode }): ReactNode {
  /* One client per app instance — created in state so StrictMode's double
     render does not throw away a client with in-flight queries.

     Nothing is seeded into it. Each source's query function reads the local
     database itself, so there is no separate restore step to keep in step with
     the writes — a returning user's first render starts a read that resolves
     from disk rather than from the network. */
  const [client] = useState(createQueryClient);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
