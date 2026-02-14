import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { ElectronService, CookieReadOptions } from '../services/electron.service';
import { selectNodeConfig } from '../../store/settings/settings.selectors';
import { NodeService } from '../../node';

export interface RpcCredentials {
  username: string;
  password: string;
}

/**
 * CookieAuthService handles Bitcoin Core RPC authentication.
 *
 * Bitcoin Core uses cookie-based authentication where credentials are
 * stored in a .cookie file in the data directory. This service reads
 * that file and provides credentials for RPC calls.
 *
 * Cookie format: __cookie__:randompassword
 */
@Injectable({ providedIn: 'root' })
export class CookieAuthService {
  private readonly electron = inject(ElectronService);
  private readonly store = inject(Store);
  private readonly nodeService = inject(NodeService);

  private readonly credentialsSubject = new BehaviorSubject<RpcCredentials | null>(null);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);

  /** Observable of current RPC credentials */
  readonly credentials$: Observable<RpcCredentials | null> = this.credentialsSubject.asObservable();

  /** Observable of authentication errors */
  readonly error$: Observable<string | null> = this.errorSubject.asObservable();

  /** Current credentials (synchronous access) */
  get credentials(): RpcCredentials | null {
    return this.credentialsSubject.value;
  }

  /** Check if credentials are loaded */
  get isAuthenticated(): boolean {
    return this.credentialsSubject.value !== null;
  }

  /**
   * Load credentials from the cookie file.
   * Reads dataDirectory and network from the settings store.
   * Should be called at app startup after settings are loaded.
   */
  async loadCredentials(): Promise<boolean> {
    this.errorSubject.next(null);

    if (!this.electron.isDesktop) {
      // In browser mode, use manual credentials or environment variables
      const manualCredentials = this.getManualCredentials();
      if (manualCredentials) {
        this.credentialsSubject.next(manualCredentials);
        return true;
      }
      this.errorSubject.next('Running in browser mode - manual RPC credentials required');
      return false;
    }

    try {
      let dataDirectory: string;
      let network: string;

      // For managed mode, use NodeService config (which has the correct paths)
      if (this.nodeService.isManaged()) {
        const nodeConfig = this.nodeService.config();
        const paths = this.nodeService.paths();
        dataDirectory = paths?.dataDir ?? '';
        network = nodeConfig.network;
        console.log('CookieAuthService: Using managed mode paths:', {
          dataDir: dataDirectory,
          network,
          pathsLoaded: paths !== null,
        });
      } else {
        // For external mode, use settings store
        const storeConfig = await firstValueFrom(this.store.select(selectNodeConfig));

        // If using username/password auth, apply credentials directly (no cookie needed)
        if (
          storeConfig.authMethod === 'credentials' &&
          storeConfig.username &&
          storeConfig.password
        ) {
          console.log('CookieAuthService: Using stored username/password credentials');
          this.credentialsSubject.next({
            username: storeConfig.username,
            password: storeConfig.password,
          });
          return true;
        }

        dataDirectory = storeConfig.dataDirectory;
        network = storeConfig.network;
        console.log('CookieAuthService: Using external mode config:', { dataDirectory, network });
      }

      if (!dataDirectory) {
        console.warn('CookieAuthService: Data directory is empty!');
        this.errorSubject.next('Data directory not configured. Please check settings.');
        return false;
      }

      const options: CookieReadOptions = {
        dataDirectory,
        network,
      };

      console.log('CookieAuthService: Reading cookie file with options:', options);
      const result = await this.electron.readCookieFile(options);

      if (!result || !result.success) {
        const error = result?.error || 'Cookie file not found';
        console.warn('CookieAuthService: Failed to read cookie:', error, 'path:', result?.path);
        this.errorSubject.next(`${error}. Is Bitcoin Core running?`);
        return false;
      }

      if (!result.content) {
        console.warn('CookieAuthService: Cookie file is empty at:', result.path);
        this.errorSubject.next('Cookie file is empty');
        return false;
      }

      const credentials = this.parseCookie(result.content);
      if (!credentials) {
        console.warn('CookieAuthService: Invalid cookie format');
        this.errorSubject.next('Invalid cookie file format');
        return false;
      }

      console.log('CookieAuthService: Credentials loaded successfully from:', result.path);
      this.credentialsSubject.next(credentials);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error reading cookie';
      this.errorSubject.next(message);
      return false;
    }
  }

  /**
   * Refresh credentials (re-read cookie file)
   */
  async refreshCredentials(): Promise<boolean> {
    this.credentialsSubject.next(null);
    return this.loadCredentials();
  }

  /**
   * Read cookie file with specific config (without caching).
   * Used for testing connection with unsaved settings.
   */
  async readCookieWithConfig(
    dataDirectory: string,
    network: string
  ): Promise<RpcCredentials | null> {
    if (!this.electron.isDesktop) {
      return this.getManualCredentials();
    }

    if (!dataDirectory) {
      return null;
    }

    try {
      const result = await this.electron.readCookieFile({ dataDirectory, network });

      if (!result || !result.success || !result.content) {
        return null;
      }

      return this.parseCookie(result.content);
    } catch {
      return null;
    }
  }

  /**
   * Set manual credentials (for browser mode or custom auth)
   */
  setManualCredentials(username: string, password: string): void {
    this.credentialsSubject.next({ username, password });
    this.errorSubject.next(null);
  }

  /**
   * Clear stored credentials
   */
  clearCredentials(): void {
    this.credentialsSubject.next(null);
  }

  /**
   * Get the Authorization header value for RPC calls
   */
  getAuthHeader(): string | null {
    const creds = this.credentials;
    if (!creds) return null;
    const encoded = btoa(`${creds.username}:${creds.password}`);
    return `Basic ${encoded}`;
  }

  /**
   * Parse cookie file content into credentials
   */
  private parseCookie(content: string): RpcCredentials | null {
    const trimmed = content.trim();
    const colonIndex = trimmed.indexOf(':');

    if (colonIndex === -1) {
      return null;
    }

    const username = trimmed.substring(0, colonIndex);
    const password = trimmed.substring(colonIndex + 1);

    if (!username || !password) {
      return null;
    }

    return { username, password };
  }

  /**
   * Get manual credentials from localStorage (for browser development)
   */
  private getManualCredentials(): RpcCredentials | null {
    try {
      const stored = localStorage.getItem('rpc_credentials');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.username && parsed.password) {
          return parsed as RpcCredentials;
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }
}
