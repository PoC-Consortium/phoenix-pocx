import { Injectable, inject, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Observable, Subject, firstValueFrom, throwError } from 'rxjs';
import { catchError, timeout, takeUntil, combineLatestWith } from 'rxjs/operators';
import { CookieAuthService } from '../../../core/auth/cookie-auth.service';
import { ElectronService } from '../../../core/services/electron.service';
import { selectRpcHost, selectRpcPort } from '../../../store/settings/settings.selectors';

/**
 * JSON-RPC request structure
 */
export interface RpcRequest {
  jsonrpc: '1.0' | '2.0';
  id: string | number;
  method: string;
  params?: unknown[];
}

/**
 * JSON-RPC response structure
 */
export interface RpcResponse<T = unknown> {
  result: T | null;
  error: RpcError | null;
  id: string | number;
}

/**
 * JSON-RPC error structure
 */
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Connection status for the RPC client
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * RpcClientService provides low-level JSON-RPC communication with Bitcoin Core.
 *
 * This is the foundation layer - other services build on top of this.
 * Handles:
 * - HTTP transport with authentication
 * - Request/response formatting
 * - Connection status tracking
 * - Error handling and retries
 */
@Injectable({ providedIn: 'root' })
export class RpcClientService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly cookieAuth = inject(CookieAuthService);
  private readonly store = inject(Store);
  private readonly electron = inject(ElectronService);

  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly statusSubject = new BehaviorSubject<ConnectionStatus>('disconnected');
  private readonly lastErrorSubject = new BehaviorSubject<string | null>(null);
  private readonly destroy$ = new Subject<void>();

  private requestId = 0;
  private rpcUrl = 'http://127.0.0.1:18332';

  constructor() {
    // Subscribe to settings store for RPC host and port
    this.store
      .select(selectRpcHost)
      .pipe(combineLatestWith(this.store.select(selectRpcPort)), takeUntil(this.destroy$))
      .subscribe(([host, port]) => {
        this.rpcUrl = `http://${host}:${port}`;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Observable of connection status */
  readonly status$: Observable<ConnectionStatus> = this.statusSubject.asObservable();

  /** Observable of last error message */
  readonly lastError$: Observable<string | null> = this.lastErrorSubject.asObservable();

  /** Current connection status */
  get status(): ConnectionStatus {
    return this.statusSubject.value;
  }

  /** Check if connected */
  get isConnected(): boolean {
    return this.statusSubject.value === 'connected';
  }

  /**
   * Configure the RPC endpoint
   */
  setEndpoint(url: string): void {
    this.rpcUrl = url.replace(/\/$/, ''); // Remove trailing slash
    this.statusSubject.next('disconnected');
  }

  /**
   * Get current RPC endpoint
   */
  getEndpoint(): string {
    return this.rpcUrl;
  }

  /**
   * Execute a JSON-RPC call
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @param walletName - Optional wallet name for wallet-specific calls
   * @param timeoutMs - Request timeout in milliseconds
   * @returns Promise with the result
   */
  async call<T = unknown>(
    method: string,
    params: unknown[] = [],
    walletName?: string,
    timeoutMs: number = this.DEFAULT_TIMEOUT
  ): Promise<T> {
    const authHeader = this.cookieAuth.getAuthHeader();
    if (!authHeader) {
      console.warn('RpcClientService: No credentials available for call:', method);
      throw new Error('No RPC credentials available');
    }

    // Build URL (with wallet path if specified)
    let url = this.rpcUrl;
    if (walletName) {
      url = `${this.rpcUrl}/wallet/${encodeURIComponent(walletName)}`;
    }

    // Build request
    const request: RpcRequest = {
      jsonrpc: '1.0',
      id: ++this.requestId,
      method,
      params,
    };

    this.statusSubject.next('connecting');

    try {
      let response: RpcResponse<T>;

      if (this.electron.isTauri) {
        // Use Tauri HTTP plugin to bypass CORS
        response = await this.callWithTauri<T>(url, request, authHeader, timeoutMs);
      } else {
        // Use Angular HttpClient for browser/Electron
        const headers = new HttpHeaders({
          'Content-Type': 'application/json',
          Authorization: authHeader,
        });

        response = await firstValueFrom(
          this.http.post<RpcResponse<T>>(url, request, { headers }).pipe(
            timeout(timeoutMs),
            catchError((error: HttpErrorResponse) => this.handleHttpError(error))
          )
        );
      }

      if (response.error) {
        throw new Error(`RPC Error ${response.error.code}: ${response.error.message}`);
      }

      this.statusSubject.next('connected');
      this.lastErrorSubject.next(null);

      return response.result as T;
    } catch (error) {
      this.statusSubject.next('error');
      const message = error instanceof Error ? error.message : 'Unknown RPC error';
      this.lastErrorSubject.next(message);
      throw error;
    }
  }

  /**
   * Test connection with explicit config (for testing unsaved settings).
   * Does not affect global state or cached credentials.
   *
   * @param config - Connection configuration to test
   * @returns Object with success status and connection info or error
   */
  async testWithConfig(config: {
    host: string;
    port: number;
    credentials: { username: string; password: string } | null;
  }): Promise<{
    success: boolean;
    version?: string;
    chain?: string;
    blocks?: number;
    error?: string;
  }> {
    if (!config.credentials) {
      return { success: false, error: 'No credentials available. Check data directory path.' };
    }

    const url = `http://${config.host}:${config.port}`;
    const authHeader = `Basic ${btoa(`${config.credentials.username}:${config.credentials.password}`)}`;

    const request: RpcRequest = {
      jsonrpc: '1.0',
      id: ++this.requestId,
      method: 'getblockchaininfo',
      params: [],
    };

    try {
      let response: RpcResponse<{ chain: string; blocks: number }>;

      if (this.electron.isTauri) {
        response = await this.callWithTauri(url, request, authHeader, 10000);
      } else {
        const headers = new HttpHeaders({
          'Content-Type': 'application/json',
          Authorization: authHeader,
        });

        response = await firstValueFrom(
          this.http
            .post<RpcResponse<{ chain: string; blocks: number }>>(url, request, { headers })
            .pipe(
              timeout(10000),
              catchError((error: HttpErrorResponse) => this.handleHttpError(error))
            )
        );
      }

      if (response.error) {
        return {
          success: false,
          error: `RPC Error ${response.error.code}: ${response.error.message}`,
        };
      }

      // Get network info for version
      const networkRequest: RpcRequest = {
        jsonrpc: '1.0',
        id: ++this.requestId,
        method: 'getnetworkinfo',
        params: [],
      };

      let networkResponse: RpcResponse<{ version: number; subversion: string }>;

      if (this.electron.isTauri) {
        networkResponse = await this.callWithTauri(url, networkRequest, authHeader, 10000);
      } else {
        const headers = new HttpHeaders({
          'Content-Type': 'application/json',
          Authorization: authHeader,
        });

        networkResponse = await firstValueFrom(
          this.http
            .post<
              RpcResponse<{ version: number; subversion: string }>
            >(url, networkRequest, { headers })
            .pipe(
              timeout(10000),
              catchError((error: HttpErrorResponse) => this.handleHttpError(error))
            )
        );
      }

      const version = networkResponse.result?.subversion || `v${networkResponse.result?.version}`;

      return {
        success: true,
        version,
        chain: response.result?.chain,
        blocks: response.result?.blocks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      return { success: false, error: message };
    }
  }

  /**
   * Make RPC call using Tauri HTTP plugin
   */
  private async callWithTauri<T>(
    url: string,
    request: RpcRequest,
    authHeader: string,
    timeoutMs: number
  ): Promise<RpcResponse<T>> {
    const { fetch } = await import('@tauri-apps/plugin-http');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401) {
          console.error('RpcClientService: 401 Auth failed for', request.method, 'at', url);
          console.error('RpcClientService: Auth header length:', authHeader?.length || 0);
          throw new Error('Authentication failed. Invalid RPC credentials.');
        } else if (response.status === 403) {
          throw new Error('Access forbidden. Check rpcallowip configuration.');
        } else if (response.status === 404) {
          throw new Error('Wallet not found or RPC method not available.');
        } else if (response.status === 500) {
          // Bitcoin Core returns HTTP 500 for JSON-RPC errors — the body
          // still contains a valid JSON-RPC response with error details.
          try {
            return (await response.json()) as RpcResponse<T>;
          } catch {
            throw new Error('Internal Bitcoin Core error');
          }
        }
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as RpcResponse<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout', { cause: error });
      }
      if (error instanceof TypeError) {
        throw new Error('Cannot connect to Bitcoin Core. Is it running?', { cause: error });
      }
      throw error;
    }
  }

  /**
   * Execute multiple RPC calls in a batch
   */
  async batchCall<T = unknown[]>(
    calls: Array<{ method: string; params?: unknown[] }>,
    walletName?: string
  ): Promise<T[]> {
    const authHeader = this.cookieAuth.getAuthHeader();
    if (!authHeader) {
      throw new Error('No RPC credentials available');
    }

    let url = this.rpcUrl;
    if (walletName) {
      url = `${this.rpcUrl}/wallet/${encodeURIComponent(walletName)}`;
    }

    const requests: RpcRequest[] = calls.map(call => ({
      jsonrpc: '1.0' as const,
      id: ++this.requestId,
      method: call.method,
      params: call.params || [],
    }));

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: authHeader,
    });

    try {
      const responses = await firstValueFrom(
        this.http.post<RpcResponse<T>[]>(url, requests, { headers }).pipe(
          timeout(this.DEFAULT_TIMEOUT),
          catchError((error: HttpErrorResponse) => this.handleHttpError(error))
        )
      );

      this.statusSubject.next('connected');

      return responses.map(r => {
        if (r.error) {
          throw new Error(`RPC Error ${r.error.code}: ${r.error.message}`);
        }
        return r.result as T;
      });
    } catch (error) {
      this.statusSubject.next('error');
      throw error;
    }
  }

  /**
   * Test connection to Bitcoin Core
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.call('getblockchaininfo');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle HTTP errors and convert to readable messages
   */
  private handleHttpError(error: HttpErrorResponse): Observable<never> {
    let message: string;

    if (error.status === 0) {
      message = 'Cannot connect to Bitcoin Core. Is it running?';
    } else if (error.status === 401) {
      message = 'Authentication failed. Invalid RPC credentials.';
    } else if (error.status === 403) {
      message = 'Access forbidden. Check rpcallowip configuration.';
    } else if (error.status === 404) {
      message = 'Wallet not found or RPC method not available.';
    } else if (error.status === 500) {
      message = error.error?.error?.message || 'Internal Bitcoin Core error';
    } else {
      message = `HTTP Error ${error.status}: ${error.statusText}`;
    }

    return throwError(() => new Error(message));
  }
}
