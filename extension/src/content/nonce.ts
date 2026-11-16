/**
 * The handshake nonce. The panel accepts the bridge handshake only if the
 * nonce arrives in the handshake message itself and was recorded in extension
 * storage by this content script (fresh, single use). It must therefore be
 * unguessable: bytes from the platform CSPRNG, hex-encoded.
 *
 * It never appears in a URL, an attribute, a dataset, a log or any object a page
 * script can reach. An iframe's `src` is one of those (a page that obtains the
 * element, or a resource-timing entry, reads it), and a page that learned the
 * nonce before the handshake was posted could post its own handshake first. The
 * storage record already proves the content script started the frame, so a URL
 * copy would add exposure and no proof. The nonce goes to `registerFrameNonce`
 * and `attachBridge` only.
 */
export const NONCE_BYTES = 16;

export function createNonce(
  fill: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
  length = NONCE_BYTES,
): string {
  const bytes = fill(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * `panel.html?r=<n>`. Every load is a full navigation: the query differs on
 * every call (`reload` is a counter the caller increments), so the browser
 * never treats it as a same-document change and always fires a new `load`; the
 * extension's `web_accessible_resources` match ignores the query. There is no
 * hash and no nonce.
 */
export function buildFrameUrl(panelUrl: string, reload: number): string {
  return `${panelUrl}?r=${reload}`;
}
