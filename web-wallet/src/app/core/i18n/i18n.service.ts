import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import {
  Language,
  LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  getLanguageByCode,
  getDefaultLanguage,
} from './languages';

/**
 * Translation dictionary type
 */
export type TranslationDictionary = Record<string, string>;

/**
 * Interpolation options for translations
 */
export interface InterpolationOptions {
  [key: string]: string | number;
}

const STORAGE_KEY = 'phoenix_pocx_language';

/**
 * I18nService handles internationalization and translations.
 *
 * Features:
 * - Lazy-loads translation JSON files
 * - Caches loaded translations
 * - Supports string interpolation: "Hello {name}" -> "Hello John"
 * - Persists language preference to localStorage
 * - Uses Angular signals for reactivity
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly http = inject(HttpClient);

  // Translation cache
  private readonly translationsCache = new Map<string, TranslationDictionary>();

  // Current state using signals
  private readonly _currentLanguage = signal<Language>(getDefaultLanguage());
  private readonly _translations = signal<TranslationDictionary>({});
  private readonly _isLoading = signal<boolean>(false);
  private readonly _isInitialized = signal<boolean>(false);

  // Subject for language change notifications (for components like MatPaginatorIntl)
  private readonly _languageChange = new Subject<Language>();
  readonly languageChange$ = this._languageChange.asObservable();

  // Public readonly signals
  readonly currentLanguage = this._currentLanguage.asReadonly();
  readonly translations = this._translations.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isInitialized = this._isInitialized.asReadonly();

  // Computed values
  readonly currentLanguageCode = computed(() => this._currentLanguage().code);
  readonly currentLanguageName = computed(() => this._currentLanguage().nativeName);

  /** All available languages */
  readonly languages = LANGUAGES;

  /**
   * Initialize the i18n service.
   * Call this at app startup.
   */
  async initialize(): Promise<void> {
    if (this._isInitialized()) return;

    // Load saved language preference
    const savedCode = this.getSavedLanguageCode();
    const language = getLanguageByCode(savedCode) || getDefaultLanguage();

    await this.setLanguage(language);
    this._isInitialized.set(true);
  }

  /**
   * Set the current language and load translations
   */
  async setLanguage(language: Language): Promise<void> {
    // Check if this language is already loaded (has actual translations, not empty object)
    const currentTranslations = this._translations();
    const hasTranslations = Object.keys(currentTranslations).length > 0;
    if (this._currentLanguage().code === language.code && hasTranslations) {
      return; // Already loaded
    }

    this._isLoading.set(true);

    try {
      const translations = await this.loadTranslations(language.code);
      this._currentLanguage.set(language);
      this._translations.set(translations);
      this.saveLanguageCode(language.code);
      this._languageChange.next(language);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Set language by code
   */
  async setLanguageByCode(code: string): Promise<void> {
    const language = getLanguageByCode(code);
    if (language) {
      await this.setLanguage(language);
    }
  }

  /**
   * Get a translation by key
   *
   * @param key - Translation key (e.g., 'send_bitcoin')
   * @param options - Optional interpolation values
   * @returns Translated string or the key if not found
   */
  get(key: string, options?: InterpolationOptions): string {
    const translations = this._translations();
    let translation = translations[key];

    if (!translation) {
      // Return key as fallback (useful for development)
      return key;
    }

    // Handle interpolation: "Hello {name}" -> "Hello John"
    if (options) {
      translation = this.interpolate(translation, options);
    }

    return translation;
  }

  /**
   * Alias for get() - matches old API
   */
  getTranslation(key: string, options?: InterpolationOptions): string {
    return this.get(key, options);
  }

  /**
   * Check if a translation key exists
   */
  has(key: string): boolean {
    return key in this._translations();
  }

  /**
   * Get multiple translations at once
   */
  getMany(keys: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of keys) {
      result[key] = this.get(key);
    }
    return result;
  }

  /**
   * Load translations for a language code
   */
  private async loadTranslations(code: string): Promise<TranslationDictionary> {
    // Check cache first
    const cached = this.translationsCache.get(code);
    if (cached) {
      return cached;
    }

    // Load from JSON file
    const url = `assets/locales/${code}.json`;

    try {
      const translations = await firstValueFrom(this.http.get<TranslationDictionary>(url));
      this.translationsCache.set(code, translations);
      return translations;
    } catch (error) {
      console.error(`Failed to load translations for ${code}:`, error);

      // Fall back to English if available
      if (code !== DEFAULT_LANGUAGE_CODE) {
        return this.loadTranslations(DEFAULT_LANGUAGE_CODE);
      }

      return {};
    }
  }

  /**
   * Interpolate values into a translation string
   * "Hello {name}, you have {count} messages" + {name: "John", count: 5}
   * -> "Hello John, you have 5 messages"
   */
  private interpolate(text: string, options: InterpolationOptions): string {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      return options[key]?.toString() ?? match;
    });
  }

  /**
   * Get saved language code from localStorage
   */
  private getSavedLanguageCode(): string {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANGUAGE_CODE;
    } catch {
      return DEFAULT_LANGUAGE_CODE;
    }
  }

  /**
   * Save language code to localStorage
   */
  private saveLanguageCode(code: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Ignore storage errors
    }
  }
}
