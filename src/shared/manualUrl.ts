import type { Language } from "./i18n";

/**
 * #737: the official online manual, one fixed URL per UI language. Keyed by
 * `Language` (from `languageDefinitions`), so adding a language without its
 * manual URL is a compile error. Only the app's own UI language chooses the
 * URL — never the browser's Accept-Language or the OS locale.
 */
export const MANUAL_URLS: Record<Language, string> = {
  ja: "https://pergamum-ide.github.io/ja/",
  en: "https://pergamum-ide.github.io/en/"
};

export function manualUrlForLanguage(language: Language): string {
  return MANUAL_URLS[language];
}
