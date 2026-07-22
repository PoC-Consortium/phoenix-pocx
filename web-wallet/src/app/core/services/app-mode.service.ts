import { Injectable, inject, signal, computed } from '@angular/core';
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

  /**
   * Whether this run has NO local bitcoind — the Android platform, or a
   * mobile launch flavor used to dev-test the Android experience on
   * desktop (`--mobile` / `--wallet-only`). The node-mode gates key on
   * this so the desktop mobile view behaves like Android (always remote /
   * Electrum), not by the persisted desktop node mode. On real Android
   * `isMobile` is already true, so this is a no-op there.
   */
  readonly isNodeless = computed(
    () => this.isMobile() || this.isMobileMode() || this.isWalletOnly()
  );

  /**
   * Whether the nodeless BTCX wallet backend (Rust `wallet` cargo feature) is
   * compiled into THIS build. False ONLY in the Android mining-only flavor —
   * `get_launch_mode` returns "mining" on Android, so `isMiningOnly()` is true
   * AND `isMobile()` is true. There the `btcx_wallet_*` / `btcx_electrum_*` /
   * `btcx_chain_info` commands are absent and callers MUST NOT invoke them.
   *
   * Desktop `--mining-only` keeps the wallet compiled (the desktop binary is
   * always the hybrid build and picks the layout at runtime), so it stays
   * true there — no behavior change for desktop mining-only.
   */
  readonly hasWalletBackend = computed(() => !(this.isMiningOnly() && this.isMobile()));

  /**
   * Symmetric counterpart: whether the mining/plotting/aggregator backend
   * (Rust `mining` cargo feature) is compiled in. False ONLY in the Android
   * wallet-only flavor (`isWalletOnly()` + `isMobile()`), where every mining/
   * aggregator command is absent. Desktop `--wallet-only` keeps mining
   * compiled, so it stays true there — use this to guard whether a mining
   * COMMAND is safe to call, NOT whether mining should run.
   */
  readonly hasMiningBackend = computed(() => !(this.isWalletOnly() && this.isMobile()));

  /**
   * Whether mining/plotting/aggregator should actually be ENABLED for this
   * mode — the backend is compiled in AND we are not in wallet-only mode.
   * Mining belongs to hybrid (default desktop), mining-only, and the full
   * mobile flavor; wallet-only never mines, on ANY platform. (Desktop
   * `--wallet-only` compiles mining in but must not auto-start or surface it —
   * `hasMiningBackend` stays true there for command-safety, this is false.)
   */
  readonly miningEnabled = computed(() => this.hasMiningBackend() && !this.isWalletOnly());

  /**
   * Map a desktop page route onto the shell the app is running in.
   *
   * The nodeless shell (mobile / wallet-only) mounts the SAME unified page
   * components under the `/wallet` route tree, so shared components must
   * never hard-code desktop URLs. The exceptions cover routes whose nodeless
   * path differs by more than the prefix; everything else just gains
   * `/wallet`. On desktop shells the path is returned unchanged.
   */
  pageRoute(desktopPath: string): string {
    if (!this.isNodeless()) return desktopPath;
    const exceptions: Record<string, string> = {
      '/dashboard': '/wallet',
      '/transactions': '/wallet/history',
    };
    return exceptions[desktopPath] ?? `/wallet${desktopPath}`;
  }

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
