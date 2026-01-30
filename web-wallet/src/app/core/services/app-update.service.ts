import { Injectable, inject, signal, computed, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { ElectronService } from './electron.service';

/**
 * Update information from the Rust backend
 */
export interface WalletUpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
}

const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours in ms
const DISMISSED_VERSION_KEY = 'phoenix-dismissed-update-version';

/**
 * Service for checking and managing app updates.
 * Checks GitHub releases on startup and periodically.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly electronService = inject(ElectronService);
  private readonly ngZone = inject(NgZone);
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private menuUnlisten: (() => void) | null = null;

  /** Subject that emits when the update dialog should be shown (e.g., from menu) */
  readonly showUpdateDialog$ = new Subject<void>();

  /** Current app version */
  readonly currentVersion = signal<string>('');

  /** Latest update info from GitHub */
  readonly updateInfo = signal<WalletUpdateInfo | null>(null);

  /** Whether the update badge should be shown */
  readonly showUpdateBadge = computed(() => {
    const info = this.updateInfo();
    if (!info?.available || !info.latestVersion) {
      return false;
    }

    // Check if user dismissed this version
    const dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
    if (dismissedVersion === info.latestVersion) {
      return false;
    }

    return true;
  });

  /**
   * Initialize the update service.
   * Gets current version from backend and starts periodic update checks.
   */
  async initialize(): Promise<void> {
    if (!this.electronService.isDesktop) {
      return;
    }

    try {
      // Get current version from Rust backend
      const { invoke } = await import('@tauri-apps/api/core');
      const version = await invoke<string>('get_app_version');
      this.currentVersion.set(version);

      // Check for updates immediately
      await this.checkForUpdate();

      // Start periodic checks every 6 hours
      this.checkInterval = setInterval(() => {
        this.checkForUpdate();
      }, UPDATE_CHECK_INTERVAL);

      // Listen for menu:check-update event from Help menu
      const { listen } = await import('@tauri-apps/api/event');
      this.menuUnlisten = await listen('menu:check-update', async () => {
        // Refresh update info and show dialog
        await this.checkForUpdate();
        this.ngZone.run(() => {
          this.showUpdateDialog$.next();
        });
      });
    } catch (error) {
      console.error('Failed to initialize update service:', error);
    }
  }

  /**
   * Check for available updates from GitHub.
   */
  async checkForUpdate(): Promise<WalletUpdateInfo | null> {
    if (!this.electronService.isDesktop) {
      return null;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const info = await invoke<WalletUpdateInfo>('check_wallet_update');
      console.log('[AppUpdate] Check result:', info);

      this.ngZone.run(() => {
        this.updateInfo.set(info);
      });

      return info;
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return null;
    }
  }

  /**
   * Dismiss the current update notification.
   * The badge will not show again until a newer version is available.
   */
  dismissUpdate(): void {
    const info = this.updateInfo();
    if (info?.latestVersion) {
      localStorage.setItem(DISMISSED_VERSION_KEY, info.latestVersion);
      // Trigger re-evaluation of showUpdateBadge
      this.updateInfo.set({ ...info });
    }
  }

  /**
   * Clean up interval and listeners on service destroy.
   */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.menuUnlisten) {
      this.menuUnlisten();
      this.menuUnlisten = null;
    }
  }
}
