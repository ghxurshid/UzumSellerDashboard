/**
 * Theme and language of the launcher and frame chrome, and the few strings the
 * content script shows.
 *
 * The content script cannot carry the site's dictionary (it would undo the
 * small-bundle rule), so it keeps a three-language table of its own. It follows
 * the seller's choice in the panel rather than the browser's language, which is
 * why `chrome.i18n` is not used here.
 */
import type { FrameLanguage, FrameTheme, PanelPrefs } from './frameMessages';

export interface PrefsEnvironment {
  /** `navigator.languages`, most preferred first. */
  readonly languages: readonly string[];
  readonly prefersDark: boolean;
}

/** First browser language we ship; Uzbek like the site when none matches. */
export function languageFromBrowser(languages: readonly string[]): FrameLanguage {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'uz' || base === 'ru' || base === 'en') return base;
  }
  return 'uz';
}

/** The stored choice if there is one, otherwise what the browser suggests. */
export function resolvePrefs(stored: PanelPrefs | null, env: PrefsEnvironment): PanelPrefs {
  return (
    stored ?? {
      theme: env.prefersDark ? 'dark' : 'light',
      language: languageFromBrowser(env.languages),
    }
  );
}

export interface ChromeStrings {
  readonly openLabel: string;
  readonly closeLabel: string;
  readonly frameTitle: string;
  /** Shown in the frame when the panel could not be started or keeps being reloaded under us. */
  readonly loadFailed: string;
  readonly retry: string;
}

const STRINGS: Record<FrameLanguage, ChromeStrings> = {
  en: {
    openLabel: 'Open Savdo Copilot',
    closeLabel: 'Close Savdo Copilot',
    frameTitle: 'Savdo Copilot',
    loadFailed: 'The Copilot could not be started on this page.',
    retry: 'Try again',
  },
  ru: {
    openLabel: 'Открыть Savdo Copilot',
    closeLabel: 'Закрыть Savdo Copilot',
    frameTitle: 'Savdo Copilot',
    loadFailed: 'Не удалось запустить Copilot на этой странице.',
    retry: 'Повторить',
  },
  uz: {
    openLabel: 'Savdo Copilot’ni ochish',
    closeLabel: 'Savdo Copilot’ni yopish',
    frameTitle: 'Savdo Copilot',
    loadFailed: 'Copilot bu sahifada ishga tushmadi.',
    retry: 'Qayta urinish',
  },
};

export function stringsFor(language: FrameLanguage): ChromeStrings {
  return STRINGS[language];
}

export type { FrameLanguage, FrameTheme };
