import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import { DEFAULT_API_BASE_URL, DEFAULT_REQUEST_TIMEOUT_MS } from '@/constants/settings';
import { readApiSettings } from '@/services/storage/settings.service';
import { useSessionStore } from '@/store/session.store';

import { ApiError, type ApiFailureKind } from './errors';
import { noteRateLimited, observeRateLimit, reserveSlot } from './rateLimit';

/**
 * The single HTTP client for the Uzum seller OpenAPI.
 *
 * There is no application backend: this app talks to `api-seller.uzum.uz`
 * directly with the seller's own `Authorization` token, which the user pastes
 * into Settings. Base URL and token are therefore resolved *per request* — a
 * token saved in Settings takes effect on the next call with no reload and no
 * client rebuild.
 */

export const API_BASE_URL: string = DEFAULT_API_BASE_URL;
export const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

/** Uzum sends the raw token in `Authorization` — no `Bearer` prefix. */
const AUTH_HEADER = 'Authorization';

/* `ApiError` is defined in `./errors` so the pacer can throw one without
   importing this module, and re-exported here so every existing call site
   keeps its import path. */
export { ApiError };
export type { ApiFailureKind };

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

function readRetryAfter(headers: unknown): number | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const raw = (headers as Record<string, unknown>)['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
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

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
  /* Uzum takes repeated keys for array params: shopIds=1&shopIds=2. */
  paramsSerializer: { indexes: null },
});

/**
 * The pacer takes a real `AbortSignal`; axios types the field as the wider
 * `GenericAbortSignal`, which need not have `addEventListener`.
 */
function abortSignalOf(config: InternalAxiosRequestConfig): AbortSignal | undefined {
  const signal = config.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const { baseUrl, token } = readApiSettings();

  if (token === '') {
    /* Fail here rather than sending an anonymous request the API answers with
       a generic 401 — "not configured" and "token rejected" are different
       screens and the user needs to be sent to the right one. */
    throw new ApiError('Uzum API token is not configured', { kind: 'unconfigured' });
  }

  config.baseURL = baseUrl;
  config.headers.set(AUTH_HEADER, token);

  /* Hold here rather than at the call sites: pagination walks, the sync engine
     and every user action funnel through this one interceptor, so it is the
     only place that sees the whole request stream. Costs nothing while the
     budget is healthy — see `rateLimit.ts`. */
  await reserveSlot(abortSignalOf(config));
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    observeRateLimit(response.headers);
    return response;
  },
  (error: unknown) => {
    const apiError = toApiError(error);

    /* A rejected response still carries the gateway's budget headers, and a 429
       carries the ones that matter most. */
    if (error instanceof AxiosError && error.response !== undefined) {
      observeRateLimit(error.response.headers);
    }
    if (apiError.kind === 'rateLimited') noteRateLimited(apiError.retryAfterMs);

    /* A 401 means the token is no longer accepted; surface it once, centrally,
       so every screen resolves to `unauth` instead of inventing its own path.
       A 403 is narrower — the token works, this call is not permitted — and it
       turns the UI read-only rather than signing the user out. */
    if (apiError.kind === 'unauthorized') useSessionStore.getState().markUnauthorized();
    if (apiError.kind === 'forbidden') useSessionStore.getState().markForbidden();
    if (apiError.kind === 'network' || apiError.kind === 'timeout') {
      useSessionStore.getState().markUnreachable();
    } else if (apiError.kind !== 'cancelled') {
      useSessionStore.getState().markReachable();
    }

    return Promise.reject(apiError);
  },
);

/* ── typed wrappers ─────────────────────────────────────────────────────── */

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  try {
    const response = await apiClient.get<T>(url, config);
    useSessionStore.getState().markReachable();
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

export async function post<T, B = unknown>(
  url: string,
  body: B,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const response = await apiClient.post<T>(url, body, config);
    useSessionStore.getState().markReachable();
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}
