import {
  ApplicationConfig,
  provideZoneChangeDetection,
  isDevMode,
  APP_INITIALIZER,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideStore, Store } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { firstValueFrom, filter, take } from 'rxjs';

import { routes } from './app.routes';
import { reducers, metaReducers, effects } from './store';
import { CookieAuthService } from './core/auth/cookie-auth.service';
import { I18nService, CustomPaginatorIntl } from './core/i18n';
import { PlatformService } from './core/services/platform.service';
import { SettingsActions, selectNodeConfig } from './store/settings';
import { NodeService } from './node';

/**
 * Initialize platform and settings at app startup.
 * This must run BEFORE cookie auth since cookie auth needs the dataDirectory setting.
 */
function initializeSettings(store: Store, platform: PlatformService): () => Promise<void> {
  return async () => {
    // Initialize platform detection first
    await platform.initialize();

    // Dispatch loadSettings action to load from localStorage
    store.dispatch(SettingsActions.loadSettings());

    // Wait for settings to be loaded (dataDirectory will be set by effect)
    await firstValueFrom(
      store.select(selectNodeConfig).pipe(
        filter(config => !!config.dataDirectory),
        take(1)
      )
    );
  };
}

/**
 * Initialize node service and cookie authentication at app startup.
 * Note: Node startup and RPC waiting is handled in AppComponent to allow showing a dialog.
 */
function initializeNodeAndAuth(
  cookieAuth: CookieAuthService,
  nodeService: NodeService
): () => Promise<void> {
  return async () => {
    // Ensure NodeService is fully initialized
    if (!nodeService.isReady()) {
      console.log('APP_INITIALIZER: Waiting for NodeService to initialize...');
      await nodeService.initialize();
      console.log('APP_INITIALIZER: NodeService initialized');
    }

    // Try to load cookie credentials (may fail if node not started yet - that's OK)
    console.log('APP_INITIALIZER: Loading cookie credentials...');
    await cookieAuth.loadCredentials();
    console.log('APP_INITIALIZER: Cookie auth complete');
  };
}

/**
 * Initialize i18n translations at app startup.
 * HttpClient dependency ensures HTTP is ready before we load translations.
 */
function initializeI18n(i18n: I18nService, _http: HttpClient): () => Promise<void> {
  return async () => {
    await i18n.initialize();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimationsAsync(),

    // I18n initialization (must run first, deps ensure HttpClient is ready)
    {
      provide: APP_INITIALIZER,
      useFactory: initializeI18n,
      deps: [I18nService, HttpClient],
      multi: true,
    },

    // Settings initialization (must run before cookie auth)
    {
      provide: APP_INITIALIZER,
      useFactory: initializeSettings,
      deps: [Store, PlatformService],
      multi: true,
    },

    // Node service and cookie authentication initialization
    {
      provide: APP_INITIALIZER,
      useFactory: initializeNodeAndAuth,
      deps: [CookieAuthService, NodeService],
      multi: true,
    },

    // Custom paginator translations
    { provide: MatPaginatorIntl, useClass: CustomPaginatorIntl },

    // NgRx Store
    provideStore(reducers, { metaReducers }),
    provideEffects(effects),

    // Store DevTools (only in development)
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
      trace: false,
      traceLimit: 75,
    }),
  ],
};
