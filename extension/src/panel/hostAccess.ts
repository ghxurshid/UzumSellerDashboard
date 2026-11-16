/**
 * Host access for an AI endpoint the manifest does not name.
 *
 * The built-in providers' origins are in the manifest's `host_permissions`, so
 * the browser lets the panel call them without asking. A custom gateway or a
 * local runtime is only covered by `optional_host_permissions`: without a grant
 * the request is an ordinary cross-origin one, subject to that server's CORS
 * policy, which a server that expects browsers may allow and one that does not
 * will refuse. Granting is therefore the seller's option, never a requirement,
 * and this module only works out *what to ask for*.
 *
 * The pattern carries no port: match patterns for host permissions ignore it,
 * and a pattern that names one is rejected by some browsers.
 */

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

export interface HostRequest {
  /** The match pattern to pass to `permissions.contains` / `request`. */
  readonly pattern: string;
  /** What the seller reads: `host` or `host:port` as typed. */
  readonly label: string;
}

/**
 * What to request for an endpoint, or null when nothing can be requested: not a
 * URL, not http(s), or plain http to a machine the manifest's optional list does
 * not cover (only loopback may be http). Asking would only throw.
 */
export function hostRequestFor(baseUrl: string): HostRequest | null {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  if (url.hostname === '') return null;

  if (url.protocol === 'https:') {
    return { pattern: `https://${url.hostname}/*`, label: url.host };
  }
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    return { pattern: `http://${url.hostname}/*`, label: url.host };
  }
  return null;
}
