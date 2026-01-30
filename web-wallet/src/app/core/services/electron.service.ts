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
 * Type definition for the Electron API exposed via preload script (legacy)
 */
interface ElectronAPI {
  readCookieFile: (options: CookieReadOptions) => Promise<CookieReadResult>;
  getCookiePath: (options: CookieReadOptions) => Promise<string | null>;
  getPlatform: () => Promise<string>;
  isDev: () => Promise<boolean>;
  showFolderDialog: (options?: FolderDialogOptions) => Promise<string | null>;
  showNotification: (options: NotificationOptions) => Promise<NotificationResult>;
  onRouteTo: (callback: (route: string) => void) => void;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __TAURI_INTERNALS__?: unknown;
  }
}

/**
 * ElectronService provides a bridge to the desktop runtime (Tauri or Electron).
 * Tauri is the primary runtime, with Electron as fallback for legacy support.
 *
 * In browser mode (non-desktop), methods return sensible defaults.
 */
@Injectable({ providedIn: 'root' })
export class ElectronService {
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);

  constructor() {
    this.initMenuRouteListener();
  }

  /**
   * Check if running inside Tauri
   */
  get isTauri(): boolean {
    return !!window.__TAURI_INTERNALS__;
  }

  /**
   * Check if running inside Electron (legacy)
   */
  get isElectron(): boolean {
    return !!window.electronAPI?.isElectron;
  }

  /**
   * Check if running in any desktop environment
   */
  get isDesktop(): boolean {
    return this.isTauri || this.isElectron;
  }

  /**
   * Initialize listener for menu navigation events from main process
   */
  private initMenuRouteListener(): void {
    if (this.isElectron && window.electronAPI?.onRouteTo) {
      window.electronAPI.onRouteTo((route: string) => {
        this.ngZone.run(() => {
          this.router.navigate([route]);
        });
      });
    }
    // Tauri menu events are handled via Tauri event system
  }

  /**
   * Read the Bitcoin Core cookie file for RPC authentication
   * @param options - dataDirectory and network settings
   * @returns Cookie read result with content or error
   */
  async readCookieFile(options: CookieReadOptions): Promise<CookieReadResult | null> {
    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<CookieReadResult>('read_cookie_file', {
          options: {
            dataDirectory: options.dataDirectory,
            network: options.network,
          },
        });
      } catch (error) {
        console.error('Error reading cookie file:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    if (this.isElectron) {
      try {
        return await window.electronAPI!.readCookieFile(options);
      } catch (error) {
        console.error('Error reading cookie file:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    console.warn('Cookie file reading only available in desktop mode');
    return null;
  }

  /**
   * Get the path to the Bitcoin Core cookie file
   * @param options - dataDirectory and network settings
   */
  async getCookiePath(options: CookieReadOptions): Promise<string | null> {
    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string | null>('get_cookie_path', {
          options: {
            dataDirectory: options.dataDirectory,
            network: options.network,
          },
        });
      } catch {
        return null;
      }
    }

    if (this.isElectron) {
      return window.electronAPI!.getCookiePath(options);
    }

    return null;
  }

  /**
   * Get the current platform (win32, darwin, linux)
   */
  async getPlatform(): Promise<string> {
    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('get_platform');
      } catch {
        return 'browser';
      }
    }

    if (this.isElectron) {
      return window.electronAPI!.getPlatform();
    }

    return 'browser';
  }

  /**
   * Check if running in development mode
   */
  async isDev(): Promise<boolean> {
    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('is_dev');
      } catch {
        return true;
      }
    }

    if (this.isElectron) {
      return window.electronAPI!.isDev();
    }

    return true; // Assume dev mode in browser
  }

  /**
   * Show a folder selection dialog
   * @param options - Dialog options (title, defaultPath)
   * @returns Selected folder path or null if cancelled
   */
  async showFolderDialog(options?: FolderDialogOptions): Promise<string | null> {
    if (this.isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({
          directory: true,
          multiple: false,
          title: options?.title || 'Select Folder',
          defaultPath: options?.defaultPath,
        });
        return result as string | null;
      } catch {
        return null;
      }
    }

    if (this.isElectron) {
      return window.electronAPI!.showFolderDialog(options);
    }

    return null;
  }

  /**
   * Show a desktop notification
   * @param title - Notification title
   * @param body - Notification body text
   * @returns Result indicating success or error
   */
  async showDesktopNotification(title: string, body: string): Promise<NotificationResult> {
    if (this.isTauri) {
      try {
        const { sendNotification, isPermissionGranted, requestPermission } =
          await import('@tauri-apps/plugin-notification');

        let permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === 'granted';
        }

        if (permissionGranted) {
          sendNotification({ title, body });
          return { success: true };
        }
        return { success: false, error: 'Notification permission denied' };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    if (this.isElectron) {
      try {
        return await window.electronAPI!.showNotification({ title, body });
      } catch (error) {
        console.error('Error showing notification:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // Fall back to browser notifications if available
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
      return { success: true };
    }

    return { success: false, error: 'Desktop notifications only available in desktop mode' };
  }

  /**
   * Open URL in external browser
   * @param url - URL to open
   */
  async openExternal(url: string): Promise<void> {
    if (this.isTauri) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } catch (error) {
        console.error('Error opening URL:', error);
        window.open(url, '_blank');
      }
    } else {
      window.open(url, '_blank');
    }
  }
}
