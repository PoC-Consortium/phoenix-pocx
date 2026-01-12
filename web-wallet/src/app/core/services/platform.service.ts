import { Injectable, inject } from '@angular/core';
import { ElectronService } from './electron.service';

export type Platform = 'win32' | 'darwin' | 'linux' | 'browser';

/**
 * PlatformService provides platform detection and environment information.
 * Centralizes all platform-specific logic.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly electron = inject(ElectronService);

  private _platform: Platform = 'browser';
  private _initialized = false;

  /**
   * Check if running in desktop (Tauri or Electron) mode
   */
  get isDesktop(): boolean {
    return this.electron.isDesktop;
  }

  /**
   * Check if running in browser mode
   */
  get isBrowser(): boolean {
    return !this.electron.isDesktop;
  }

  /**
   * Check if running in Tauri
   */
  get isTauri(): boolean {
    return this.electron.isTauri;
  }

  /**
   * Get the current platform
   */
  get platform(): Platform {
    return this._platform;
  }

  /**
   * Check if running on Windows
   */
  get isWindows(): boolean {
    return this._platform === 'win32';
  }

  /**
   * Check if running on macOS
   */
  get isMac(): boolean {
    return this._platform === 'darwin';
  }

  /**
   * Check if running on Linux
   */
  get isLinux(): boolean {
    return this._platform === 'linux';
  }

  /**
   * Initialize platform detection (call once at app startup)
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    const platform = await this.electron.getPlatform();
    this._platform = platform as Platform;
    this._initialized = true;
  }

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }
}
