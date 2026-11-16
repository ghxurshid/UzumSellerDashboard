/**
 * Reading a response header without caring which HTTP stack produced it.
 *
 * Kept free of any import so both the Uzum client and the LLM transport (and,
 * later, the browser extension) can use it without pulling in a host.
 */

/**
 * Axios normalises response header names to lower case, but the object is an
 * `AxiosHeaders` instance on some adapters and a plain record on others, and the
 * AI stream hands over a `fetch` `Headers`, so every shape is read rather than
 * assumed.
 */
export function headerValue(headers: unknown, name: string): string | null {
  if (typeof headers !== 'object' || headers === null) return null;

  const bag = headers as Record<string, unknown> & { get?: (key: string) => unknown };
  const raw = bag[name] ?? (typeof bag.get === 'function' ? bag.get(name) : undefined);

  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  /* A repeated header arrives as a list; the first value is the current one. */
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}
