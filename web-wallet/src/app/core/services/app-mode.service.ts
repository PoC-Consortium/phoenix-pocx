import { Injectable, inject, signal } from '@angular/core';
import { ElectronService } from './electron.service';

/**
 * AppModeService manages the application launch mode.
 *
 * The app can be launched in two modes:
 * - 'wallet' (default): Full wallet functionality with sidenav
 * - 'mining': Mining-only mode with simplified UI
 *
 * Mining-only mode is activated by:
 * - Passing --mining-only or -m flag when launching the desktop application
 * - Running on Android (always mining-only, no local node support)
 */
@Injectable({ providedIn: 'root' })
export class AppModeService {
  private readonly electronService = inject(ElectronService);

  /** Whether the app is in mining-only mode */
  readonly isMiningOnly = signal(false);

  /** Whether running on a mobile platform (Android) - no local node support */
  readonly isMobile = signal(false);

  /** Whether the mode has been initialized (internal guard) */
  private readonly _isInitialized = signal(false);

  /**
   * Initialize the app mode from launch arguments.
   * Should be called during app initialization (APP_INITIALIZER).
   */
  async initializeMode(): Promise<void> {
    if (this._isInitialized()) {
      return;
    }

    if (this.electronService.isDesktop) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');

        // Check platform first to detect mobile
        const platform = await invoke<string>('get_platform');
        if (platform === 'android') {
          this.isMobile.set(true);
        }

        // Get launch mode (always 'mining' on Android)
        const mode = await invoke<string>('get_launch_mode');
        if (mode === 'mining') {
          this.isMiningOnly.set(true);
        }
      } catch (error) {
        console.error('Failed to get launch mode:', error);
        // Default to wallet mode on error
      }
    }

    this._isInitialized.set(true);
  }
}
