/**
 * The one error type every seller-API call rejects with.
 *
 * It lives apart from `client.ts` so that the rate-limit governor can construct
 * one without importing the module that builds the axios instance — a cycle
 * that would leave `apiClient` half-initialised at evaluation time. `client.ts`
 * re-exports both names, so every existing import site keeps working.
 */

export type ApiFailureKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'rateLimited'
  | 'notFound'
  | 'server'
  | 'client'
  | 'cancelled'
  | 'unconfigured';

export class ApiError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly kind: ApiFailureKind;
  /** Milliseconds until the rate-limit window resets, when the API says so. */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: {
    status?: number;
    code?: string;
    kind: ApiFailureKind;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.kind = options.kind;
    this.retryAfterMs = options.retryAfterMs;
  }

  get isTimeout(): boolean {
    return this.kind === 'timeout';
  }

  get isNetwork(): boolean {
    return this.kind === 'network';
  }

  get isCancelled(): boolean {
    return this.kind === 'cancelled';
  }

  /**
   * Whether repeating the identical request could succeed. A 4xx the caller
   * caused will not, so retrying it only burns rate-limit budget.
   */
  get isRetryable(): boolean {
    switch (this.kind) {
      case 'network':
      case 'timeout':
      case 'server':
      case 'rateLimited':
        return true;
      default:
        return false;
    }
  }
}
