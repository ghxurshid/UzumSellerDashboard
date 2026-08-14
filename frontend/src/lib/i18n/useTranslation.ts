import { useCallback } from 'react';

import { usePreferencesStore } from '@/store/preferences.store';
import type { Language } from '@/types/domain';

import { interpolate, translate, type TranslationKey } from './dictionary';

export type Translator = (
  key: TranslationKey,
  vars?: Readonly<Record<string, string | number>>,
) => string;

interface UseTranslationResult {
  readonly t: Translator;
  readonly language: Language;
}

/**
 * Reads the active language from the preferences store and returns a stable
 * translator. Subscribing to `language` alone means a locale switch re-renders
 * the tree, but a theme or sidebar change does not.
 */
export function useTranslation(): UseTranslationResult {
  const language = usePreferencesStore((state) => state.language);

  const t = useCallback<Translator>(
    (key, vars) => {
      const text = translate(key, language);
      return vars ? interpolate(text, vars) : text;
    },
    [language],
  );

  return { t, language };
}
