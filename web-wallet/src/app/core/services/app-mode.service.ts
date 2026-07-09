import { Injectable, inject, signal } from '@angular/core';
import { ElectronService } from './electron.service';

/**
 * AppModeService manages the application launch mode.
 *
 * The app can be launched in four modes:
 * - 'wallet' (default): Full wallet functionality with sidenav
 * - 'mining': Mining-only mode with simplified UI
 * - 'mobile': Mining + nodeless BTCX wallet (Android)
 * - 'wallet-mobile': Nodeless BTCX wallet ONLY — the wallet-only app
 *   flavor (Android `wallet-only` cargo feature builds; desktop
 *   `--wallet-only` for dev-testing). No mining, no node.
 *
 * Mining-only mode is activated by passing --mining-only or -m when
 * launching the desktop application. Android always launches in mobile
 * or wallet-mobile mode (no local node support); mobile mode may use the
 * /miner routes and the mobile wallet routes, wallet-only mode only the
 * mobile wallet routes — neither ever uses the Core-RPC-backed desktop
 * wallet routes.
 */
@Injectable({ providedIn: 'root' })
export class AppModeService {
  private readonly electronService = inject(ElectronService);

  /** Whether the app is in mining-only mode (desktop --mining-only launch) */
  readonly isMiningOnly = signal(false);

  /** Whether the app is in mobile mode (wallet + mining, Android) */
  readonly isMobileMode = signal(false);

  /** Whether the app is in wallet-only mode (nodeless wallet, no mining) */
  readonly isWalletOnly = signal(false);

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

        // Get launch mode ('mobile'/'wallet-mobile' on Android, 'mining'
        // for --mining-only, 'wallet-mobile' for --wallet-only)
        const mode = await invoke<string>('get_launch_mode');
        if (mode === 'mining') {
          this.isMiningOnly.set(true);
        } else if (mode === 'mobile') {
          this.isMobileMode.set(true);
        } else if (mode === 'wallet-mobile') {
          this.isWalletOnly.set(true);
        }
      } catch (error) {
        console.error('Failed to get launch mode:', error);
        // Default to wallet mode on error
      }
    }

    this._isInitialized.set(true);
  }
}
