import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const THEME_STORAGE_KEY = 'theme_preference';

/**
 * ThemeService manages the application's light/dark theme.
 *
 * Features:
 * - Persists preference to localStorage
 * - Auto-detects system preference on first load
 * - Applies CSS class to document body
 */
@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly isDarkSubject = new BehaviorSubject<boolean>(false);

  /** Observable for dark theme state */
  readonly isDarkTheme$ = this.isDarkSubject.asObservable();

  /** Signal for dark theme state */
  readonly isDarkTheme = signal(false);

  constructor() {
    this.initTheme();
  }

  private initTheme(): void {
    // Check localStorage first
    const stored = localStorage.getItem(THEME_STORAGE_KEY);

    if (stored !== null) {
      const isDark = stored === 'dark';
      this.setTheme(isDark);
    } else {
      // Auto-detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.setTheme(prefersDark);
    }

    // Listen for system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      // Only auto-switch if no manual preference set
      if (localStorage.getItem(THEME_STORAGE_KEY) === null) {
        this.setTheme(e.matches);
      }
    });
  }

  /**
   * Set the theme explicitly.
   */
  setTheme(isDark: boolean): void {
    this.isDarkSubject.next(isDark);
    this.isDarkTheme.set(isDark);
    this.applyTheme(isDark);
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  }

  /**
   * Toggle between light and dark theme.
   */
  toggleTheme(): void {
    this.setTheme(!this.isDarkSubject.value);
  }

  /**
   * Get current theme state.
   */
  get currentTheme(): 'light' | 'dark' {
    return this.isDarkSubject.value ? 'dark' : 'light';
  }

  private applyTheme(isDark: boolean): void {
    if (isDark) {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
    }
  }
}
