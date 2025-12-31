/**
 * Language definition
 */
export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

/**
 * Supported languages - matches old Phoenix wallet exactly
 * Keep in sync with /assets/locales/*.json files
 */
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'de-de', name: 'German', nativeName: 'Deutsch' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'es-es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'gl', name: 'Galician', nativeName: 'Galego' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिंदी' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuviškai' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'pt-br', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovensky' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türk' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Yкраiнска' },
  { code: 'zh-cn', name: 'Chinese (Simplified)', nativeName: '中文 (simplified)' },
];

/**
 * Default language code
 */
export const DEFAULT_LANGUAGE_CODE = 'en';

/**
 * Get language by code
 */
export function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGES.find(lang => lang.code === code);
}

/**
 * Get default language
 */
export function getDefaultLanguage(): Language {
  return LANGUAGES.find(lang => lang.code === DEFAULT_LANGUAGE_CODE)!;
}
