import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { map, tap, withLatestFrom } from 'rxjs/operators';
import { SettingsActions } from './settings.actions';
import { selectSettingsState } from './settings.selectors';
import { getDefaultDataDirectory, defaultNodeConfig } from './settings.state';
import { PlatformService } from '../../core/services/platform.service';

const STORAGE_KEY = 'phoenix_pocx_settings';

/**
 * Settings effects - handles persistence and side effects
 */
@Injectable()
export class SettingsEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly platform = inject(PlatformService);

  /**
   * Load settings from localStorage.
   * If dataDirectory is not set, compute platform-aware default.
   */
  loadSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.loadSettings),
      map(() => {
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          let settings = stored ? JSON.parse(stored) : {};

          // Set platform-aware default dataDirectory if not already set
          if (!settings.nodeConfig?.dataDirectory) {
            const coinType = settings.nodeConfig?.coinType || 'bitcoin-pocx';
            const defaultDataDir = getDefaultDataDirectory(coinType, this.platform.platform);

            settings = {
              ...settings,
              nodeConfig: {
                ...settings.nodeConfig,
                dataDirectory: defaultDataDir,
              },
            };
          }

          return SettingsActions.loadSettingsSuccess({ settings });
        } catch (error) {
          console.warn('Failed to load settings from storage:', error);
          // Even on error, set default dataDirectory
          const defaultDataDir = getDefaultDataDirectory('bitcoin-pocx', this.platform.platform);
          return SettingsActions.loadSettingsSuccess({
            settings: {
              nodeConfig: { ...defaultNodeConfig, dataDirectory: defaultDataDir },
            },
          });
        }
      })
    )
  );

  /**
   * Save settings to localStorage when they change
   */
  saveSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        // Node config
        SettingsActions.updateNodeConfig,
        SettingsActions.setNodeConfig,
        SettingsActions.setNetwork,
        // Notifications
        SettingsActions.updateNotifications,
        SettingsActions.setNotifications,
        SettingsActions.toggleNotificationsEnabled,
        // Display
        SettingsActions.setLanguage,
        // Preferences
        SettingsActions.setDefaultAddressType,
        SettingsActions.setConfirmationsRequired,
        SettingsActions.setAutoRefreshInterval,
        // Privacy
        SettingsActions.toggleHideBalances,
        SettingsActions.setHideBalances,
        // Advanced
        SettingsActions.toggleDebugMode,
        SettingsActions.setCustomFeeRate
      ),
      map(() => SettingsActions.saveSettings())
    )
  );

  /**
   * Persist settings to localStorage
   */
  persistSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SettingsActions.saveSettings),
      withLatestFrom(this.store.select(selectSettingsState)),
      tap(([, settings]) => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
          console.warn('Failed to save settings to storage:', error);
        }
      }),
      map(() => SettingsActions.saveSettingsSuccess())
    )
  );

  /**
   * Reset all data - clears localStorage and navigates to root
   */
  resetAllData$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(SettingsActions.resetAllData),
        tap(() => {
          try {
            // Clear all Phoenix-related localStorage items
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && (key.startsWith('phoenix') || key === 'theme_preference')) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));

            // Navigate to root and reload
            this.router.navigate(['/']).then(() => {
              window.location.reload();
            });
          } catch (error) {
            console.error('Failed to reset data:', error);
          }
        })
      ),
    { dispatch: false }
  );
}
