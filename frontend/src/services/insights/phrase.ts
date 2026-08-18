import type { Translator } from '@/lib/i18n/useTranslation';

import type { Phrase } from './blocks';

/**
 * A phrase, whoever wrote it.
 *
 * A rule ships `{ key, vars }` because its wording lives in the dictionary in
 * three languages; the model ships a plain string because it was told to write
 * in the seller's language and has no keys to point at. Both arrive at the
 * renderer, and this is where the difference stops mattering.
 */
export function phrase(t: Translator, value: Phrase): string {
  return typeof value === 'string' ? value : t(value.key, value.vars);
}
