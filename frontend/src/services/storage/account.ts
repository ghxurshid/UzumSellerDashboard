import { readApiSettings } from './settings.service';

/**
 * Which account the stored data belongs to.
 *
 * Everything this application persists is partitioned by two things: the
 * account the token authenticates, and the shop the rows describe. This module
 * owns the first half of that key, so the snapshot and the archive agree on
 * what "the same account" means instead of each deciding for itself.
 *
 * FNV-1a over base URL and token, only ever compared for equality. It answers
 * "is this the same account the data was stored for?", so that pasting another
 * seller's token shows their numbers rather than the previous one's. It is not
 * a secret and not a security boundary; the token itself is never written to
 * storage by any of this.
 */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function accountFingerprint(): string {
  const { baseUrl, token } = readApiSettings();
  return fnv1a(`${baseUrl} ${token}`);
}
