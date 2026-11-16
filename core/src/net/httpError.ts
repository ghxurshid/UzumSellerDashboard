import axios, { AxiosError } from 'axios';

import { ApiError, type ApiFailureKind } from '@core/errors/apiError';
import { headerValue } from './headers';

/* One import line for the whole taxonomy: the LLM transport takes `ApiError`,
   `toApiError` and `readRetryAfter` from here. */
export { ApiError };
export type { ApiFailureKind };

/**
 * Turning any HTTP failure into an `ApiError`, with no host attached.
 *
 * This lives apart from `client.ts` because the LLM transport needs the same
 * taxonomy and `Retry-After` reading but must not import the Uzum client, which
 * reads the seller's settings and the session store. Imports here are limited to
 * npm packages and sibling pure modules.
 */

/** Pull the human message out of Uzum's `{ errors: [{ code, message }] }`. */
function describeBody(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const body = data as Record<string, unknown>;

  const errors = body['errors'];
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? String((entry as Record<string, unknown>)['message'] ?? '')
          : '',
      )
      .filter((message) => message !== '');
    if (messages.length > 0) return messages.join('; ');
  }

  const single = body['error'] ?? body['message'];
  return typeof single === 'string' && single !== '' ? single : null;
}

/**
 * `Retry-After`, in milliseconds, in either shape the RFC allows.
 *
 * Delta-seconds is what the gateway normally sends, but the header is equally
 * allowed to be an HTTP-date, and reading that as a number yields `NaN` — which
 * used to fall through to the two-second default and start the retry storm the
 * header existed to prevent. Read through `headerValue` so an `AxiosHeaders`
 * instance, a `fetch` `Headers` and a plain record are all handled, as they are
 * everywhere else — the AI stream reads the same header off a `fetch` response
 * to decide how long to wait before asking a busy model again.
 */
export function readRetryAfter(headers: unknown): number | undefined {
  const raw = headerValue(headers, 'retry-after');
  if (raw === null || raw.trim() === '') return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1_000 : undefined;

  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return undefined;

  const delta = at - Date.now();
  return delta > 0 ? delta : undefined;
}

function classify(status: number): ApiFailureKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'server';
  return 'client';
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isCancel(error)) {
    return new ApiError('Request cancelled', { kind: 'cancelled', code: 'ERR_CANCELED' });
  }

  if (error instanceof AxiosError) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError('Request timed out', {
        kind: 'timeout',
        code: error.code,
        cause: error,
      });
    }

    const response = error.response;
    if (response === undefined) {
      return new ApiError('Network unreachable', {
        kind: 'network',
        ...(error.code !== undefined ? { code: error.code } : {}),
        cause: error,
      });
    }

    const message = describeBody(response.data) ?? error.message;
    const retryAfterMs = readRetryAfter(response.headers);

    return new ApiError(message, {
      status: response.status,
      kind: classify(response.status),
      ...(error.code !== undefined ? { code: error.code } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      cause: error,
    });
  }

  return new ApiError('Unexpected request failure', { kind: 'server', cause: error });
}
