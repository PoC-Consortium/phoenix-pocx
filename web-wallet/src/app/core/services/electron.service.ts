import { Injectable, inject, NgZone } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Options for reading cookie file
 */
export interface CookieReadOptions {
  dataDirectory: string;
  network: string;
}

/**
 * Result from reading cookie file
 */
export interface CookieReadResult {
  success: boolean;
  content?: string;
  error?: string;
  path?: string;
}

/**
 * Options for folder dialog
 */
export interface FolderDialogOptions {
  title?: string;
  defaultPath?: string;
}

/**
 * Options for desktop notification
 */
export interface NotificationOptions {
  title: string;
  body: string;
}

/**
 * Result from showing notification
 */
export interface NotificationResult {
  success: boolean;
  error?: string;
}

/**
 * Update asset information
 */
export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
}

/**
 * Update information from GitHub releases
 */
export interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  os: string;
  assets: UpdateAsset[];
  releaseUrl: string;
  releaseNotes: string;
}

/**
 * Type definition for the Electron API exposed via preload script
 */
interface ElectronAPI {
  readCookieFile: (options: CookieReadOptions) => Promise<CookieReadResult>;
  getCookiePath: (options: CookieReadOptions) => Promise<string | null>;
  getPlatform: () => Promise<string>;
  isDev: () => Promise<boolean>;
  showFolderDialog: (options?: FolderDialogOptions) => Promise<string | null>;
  showNotification: (options: NotificationOptions) => Promise<NotificationResult>;
  onRouteTo: (callback: (route: string) => void) => void;
  // Update notifications
  onNewVersion: (callback: (updateInfo: UpdateInfo) => void) => void;
  onNewVersionCheckNoUpdate: (callback: () => void) => void;
  onNewVersionDownloadStarted: (callback: () => void) => void;
  selectVersionAsset: (assetUrl: string) => void;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * ElectronService provides a bridge to Electron's main process via IPC.
 * Uses context isolation with preload script for security.
 *
 * In browser mode (non-Electron), methods return sensible defaults.
 */
@Injectable({ providedIn: 'root' })
export class ElectronService {
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);

  constructor() {
    this.initMenuRouteListener();
  }

  /**
   * Initialize listener for menu navigation events from Electron main process
   */
  private initMenuRouteListener(): void {
    if (this.isElectron && window.electronAPI?.onRouteTo) {
      window.electronAPI.onRouteTo((route: string) => {
        // Run navigation inside Angular zone to trigger change detection
        this.ngZone.run(() => {
          this.router.navigate([route]);
        });
      });
    }
  }

  /**
   * Check if running inside Electron
   */
  get isElectron(): boolean {
    return !!window.electronAPI?.isElectron;
  }

  /**
   * Read the Bitcoin Core cookie file for RPC authentication
   * @param options - dataDirectory and network settings
   * @returns Cookie read result with content or error
   */
  async readCookieFile(options: CookieReadOptions): Promise<CookieReadResult | null> {
    if (!this.isElectron) {
      console.warn('Cookie file reading only available in Electron');
      return null;
    }

    try {
      return await window.electronAPI!.readCookieFile(options);
    } catch (error) {
      console.error('Error reading cookie file:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get the path to the Bitcoin Core cookie file
   * @param options - dataDirectory and network settings
   */
  async getCookiePath(options: CookieReadOptions): Promise<string | null> {
    if (!this.isElectron) {
      return null;
    }
    return window.electronAPI!.getCookiePath(options);
  }

  /**
   * Get the current platform (win32, darwin, linux)
   */
  async getPlatform(): Promise<string> {
    if (!this.isElectron) {
      return 'browser';
    }
    return window.electronAPI!.getPlatform();
  }

  /**
   * Check if running in development mode
   */
  async isDev(): Promise<boolean> {
    if (!this.isElectron) {
      return true; // Assume dev mode in browser
    }
    return window.electronAPI!.isDev();
  }

  /**
   * Show a folder selection dialog
   * @param options - Dialog options (title, defaultPath)
   * @returns Selected folder path or null if cancelled
   */
  async showFolderDialog(options?: FolderDialogOptions): Promise<string | null> {
    if (!this.isElectron) {
      return null;
    }
    return window.electronAPI!.showFolderDialog(options);
  }

  /**
   * Show a desktop notification
   * @param title - Notification title
   * @param body - Notification body text
   * @returns Result indicating success or error
   */
  async showDesktopNotification(title: string, body: string): Promise<NotificationResult> {
    if (!this.isElectron) {
      // Fall back to browser notifications if available
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
        return { success: true };
      }
      return { success: false, error: 'Desktop notifications only available in Electron' };
    }

    try {
      return await window.electronAPI!.showNotification({ title, body });
    } catch (error) {
      console.error('Error showing notification:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Register callback for new version notifications
   * @param callback - Function to call when new version is available
   */
  onNewVersion(callback: (updateInfo: UpdateInfo) => void): void {
    if (this.isElectron && window.electronAPI?.onNewVersion) {
      window.electronAPI.onNewVersion(updateInfo => {
        this.ngZone.run(() => callback(updateInfo));
      });
    }
  }

  /**
   * Register callback for "no update available" notifications
   * @param callback - Function to call when no update is found
   */
  onNewVersionCheckNoUpdate(callback: () => void): void {
    if (this.isElectron && window.electronAPI?.onNewVersionCheckNoUpdate) {
      window.electronAPI.onNewVersionCheckNoUpdate(() => {
        this.ngZone.run(() => callback());
      });
    }
  }

  /**
   * Register callback for download started notifications
   * @param callback - Function to call when download starts
   */
  onNewVersionDownloadStarted(callback: () => void): void {
    if (this.isElectron && window.electronAPI?.onNewVersionDownloadStarted) {
      window.electronAPI.onNewVersionDownloadStarted(() => {
        this.ngZone.run(() => callback());
      });
    }
  }

  /**
   * Select an asset to download
   * @param assetUrl - URL of the asset to download
   */
  selectVersionAsset(assetUrl: string): void {
    if (this.isElectron && window.electronAPI?.selectVersionAsset) {
      window.electronAPI.selectVersionAsset(assetUrl);
    }
  }
}
