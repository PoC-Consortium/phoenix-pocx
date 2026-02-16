import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  WalletManagerService,
  WalletSummary,
} from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { CookieAuthService } from '../../../../core/auth/cookie-auth.service';
import { AppUpdateService } from '../../../../core/services/app-update.service';

/**
 * WalletSelectComponent displays available wallets and options to create/import.
 * This is the entry point when no wallet is active.
 * Matches the original Phoenix wallet look and feel.
 */
@Component({
  selector: 'app-wallet-select',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    I18nPipe,
  ],
  template: `
    <!-- Main Content - uses shared toolbar from app.component -->
    <div class="wallet-select-container">
      <div class="logo-container">
        <img src="assets/images/logos/phoenix_trans.svg" alt="Phoenix PoCX" class="logo" />
      </div>

      <div class="wallet-selector-box">
        <div class="box-header">
          <h2>{{ 'wallets' | i18n }}</h2>
        </div>

        <div class="box-content">
          <!-- Connecting State -->
          @if (isConnecting()) {
            <div class="state-container">
              <mat-spinner diameter="48"></mat-spinner>
              <p>{{ 'connecting_to_bitcoin_core' | i18n }}</p>
            </div>
          }

          <!-- Connection Error -->
          @if (connectionError() && !isConnecting()) {
            <div class="state-container error-state">
              <mat-icon class="error-icon">error_outline</mat-icon>
              <h3>{{ 'connection_failed' | i18n }}</h3>
              <p>{{ connectionError() }}</p>
              <div class="connection-help">
                <p>{{ 'please_ensure' | i18n }}:</p>
                <ul>
                  <li>Bitcoin-PoCX is running</li>
                  <li>RPC server is enabled</li>
                  <li>Cookie authentication is accessible</li>
                </ul>
              </div>
              <div class="error-actions">
                <button mat-raised-button color="primary" (click)="retryConnection()">
                  <mat-icon>refresh</mat-icon>
                  {{ 'retry' | i18n }}
                </button>
                <button mat-stroked-button routerLink="/settings">
                  <mat-icon>settings</mat-icon>
                  {{ 'settings' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Loading Wallets -->
          @if (!isConnecting() && !connectionError() && isLoading()) {
            <div class="state-container">
              <mat-spinner diameter="48"></mat-spinner>
              <p>{{ 'loading' | i18n }}...</p>
            </div>
          }

          <!-- Welcome State (no wallets yet) -->
          @if (!isConnecting() && !connectionError() && !isLoading() && wallets().length === 0) {
            <div class="welcome-state">
              <mat-icon class="welcome-icon">rocket_launch</mat-icon>
              <h3>{{ 'welcome_heading' | i18n }}</h3>
              <p class="welcome-node-status">
                <mat-icon class="node-ready-icon">check_circle</mat-icon>
                {{ 'welcome_node_ready' | i18n }}
              </p>
              <p class="welcome-body">{{ 'welcome_body' | i18n }}</p>
            </div>
          }

          <!-- Wallet Table -->
          @if (!isConnecting() && !connectionError() && !isLoading() && wallets().length > 0) {
            <div class="wallet-table-container">
              <table mat-table [dataSource]="wallets()" class="wallet-table">
                <!-- Status Column -->
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>{{ 'status' | i18n }}</th>
                  <td mat-cell *matCellDef="let wallet">
                    <span
                      class="status-badge"
                      [class.loaded]="wallet.isLoaded"
                      [class.unloaded]="!wallet.isLoaded"
                    >
                      <mat-icon class="status-icon">{{
                        wallet.isLoaded ? 'check_circle' : 'radio_button_unchecked'
                      }}</mat-icon>
                      {{ wallet.isLoaded ? ('loaded' | i18n) : ('not_loaded' | i18n) }}
                    </span>
                  </td>
                </ng-container>

                <!-- Name Column -->
                <ng-container matColumnDef="name">
                  <th mat-header-cell *matHeaderCellDef class="name-header">
                    {{ 'wallet_name' | i18n }}
                  </th>
                  <td mat-cell *matCellDef="let wallet" [class.unloaded]="!wallet.isLoaded">
                    {{ wallet.name || '(default)' }}
                  </td>
                </ng-container>

                <!-- Balance Column -->
                <ng-container matColumnDef="balance">
                  <th mat-header-cell *matHeaderCellDef class="balance-header">
                    {{ 'balance' | i18n }}
                  </th>
                  <td
                    mat-cell
                    *matCellDef="let wallet"
                    [class.unloaded]="!wallet.isLoaded"
                    class="balance-cell"
                  >
                    @if (wallet.isLoaded && wallet.balance !== undefined) {
                      <span>{{ wallet.balance | number: '1.8-8' }} BTCX</span>
                    } @else {
                      <span class="no-balance">--</span>
                    }
                  </td>
                </ng-container>

                <!-- Lock/Encryption Column (or Eye for watch-only) -->
                <ng-container matColumnDef="encryption">
                  <th mat-header-cell *matHeaderCellDef class="encryption-header"></th>
                  <td mat-cell *matCellDef="let wallet" class="encryption-cell">
                    @if (wallet.isLoaded && wallet.isWatchOnly) {
                      <mat-icon
                        class="encryption-icon watch-only"
                        matTooltip="{{ 'watch_only_wallet' | i18n }}"
                        >visibility</mat-icon
                      >
                    } @else if (wallet.isLoaded && wallet.isEncrypted === true) {
                      <mat-icon
                        class="encryption-icon encrypted"
                        matTooltip="{{ 'wallet_encrypted' | i18n }}"
                        >lock</mat-icon
                      >
                    } @else if (wallet.isLoaded && wallet.isEncrypted === false) {
                      <mat-icon
                        class="encryption-icon not-encrypted"
                        matTooltip="{{ 'wallet_not_encrypted' | i18n }}"
                        >lock_open</mat-icon
                      >
                    } @else {
                      <span class="no-encryption">--</span>
                    }
                  </td>
                </ng-container>

                <!-- Action Column -->
                <ng-container matColumnDef="action">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let wallet" class="action-cell">
                    @if (isWalletLoading(wallet.name)) {
                      <mat-spinner diameter="24"></mat-spinner>
                    } @else {
                      <button
                        mat-stroked-button
                        class="action-button"
                        [class.load-button]="!wallet.isLoaded"
                        [class.unload-button]="wallet.isLoaded"
                        (click)="toggleWalletLoad(wallet, $event)"
                      >
                        {{ wallet.isLoaded ? ('unload' | i18n) : ('load' | i18n) }}
                      </button>
                    }
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr
                  mat-row
                  *matRowDef="let wallet; columns: displayedColumns"
                  [class.selected]="selectedWallet() === wallet.name"
                  (click)="selectRow(wallet)"
                ></tr>
              </table>
            </div>
          }
        </div>

        <!-- Bottom Actions -->
        <div class="box-actions">
          <div class="left-actions">
            <button mat-stroked-button routerLink="/auth/create" [disabled]="!isConnected()">
              <mat-icon>add</mat-icon>
              {{ 'create_new' | i18n }}
            </button>
            <button mat-stroked-button routerLink="/auth/import" [disabled]="!isConnected()">
              <mat-icon>import_export</mat-icon>
              {{ 'import' | i18n }}
            </button>
            <button mat-stroked-button routerLink="/auth/watch-only" [disabled]="!isConnected()">
              <mat-icon>visibility</mat-icon>
              {{ 'watch_only' | i18n }}
            </button>
          </div>
          <div class="right-actions">
            <button
              mat-raised-button
              color="primary"
              [disabled]="!isConnected() || !selectedWallet() || isOpening()"
              (click)="openWallet()"
              class="primary-action-button"
            >
              @if (isOpening()) {
                <mat-spinner diameter="20"></mat-spinner>
              }
              @if (!isOpening()) {
                <mat-icon>arrow_forward</mat-icon>
              }
              {{ !isOpening() ? ('open_wallet' | i18n) : '' }}
            </button>
          </div>
        </div>
      </div>

      <p class="version-info">v{{ appVersion() }}</p>
    </div>
  `,
  styles: [
    `
      /* Main Container - uses flex layout from app.component */
      :host {
        display: block;
        height: 100%;
        overflow: auto;
      }

      .wallet-select-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        background: #eceff1;
        padding: 24px;
        gap: 24px;
        box-sizing: border-box;
      }

      .logo-container {
        text-align: center;

        .logo {
          width: 140px;
          height: auto;
        }
      }

      /* Wallet Selector Box - fixed width matching original */
      .wallet-selector-box {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        width: 670px;
        max-width: 100%;
        overflow: hidden;
      }

      .box-header {
        padding: 24px 24px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);

        h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.87);
        }
      }

      .box-content {
        padding: 16px 24px;
        min-height: 200px;
      }

      /* State containers */
      .state-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 24px;
        text-align: center;

        p {
          margin-top: 16px;
          color: rgba(0, 0, 0, 0.6);
        }

        h3 {
          margin: 16px 0 8px;
          color: rgba(0, 0, 0, 0.87);
        }

        &.error-state {
          .error-icon {
            font-size: 48px;
            width: 48px;
            height: 48px;
            color: #f44336;
          }
        }

        .connection-help {
          text-align: left;
          margin: 16px 0;
          padding: 16px;
          background: rgba(0, 0, 0, 0.04);
          border-radius: 4px;

          p {
            margin: 0 0 8px;
            color: rgba(0, 0, 0, 0.6);
          }

          ul {
            margin: 0;
            padding-left: 20px;
            color: rgba(0, 0, 0, 0.6);

            li {
              margin: 4px 0;
            }
          }
        }

        .error-actions {
          display: flex;
          gap: 12px;
          margin-top: 8px;
          align-items: center;

          button {
            min-width: 120px;
            height: 36px;

            mat-icon {
              margin-right: 4px;
            }
          }
        }
      }

      .welcome-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 24px;
        text-align: center;

        .welcome-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: #2196f3;
        }

        h3 {
          margin: 16px 0 0;
          font-size: 20px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.87);
        }

        .welcome-node-status {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 16px 0 0;
          color: #4caf50;
          font-size: 14px;
          font-weight: 500;

          .node-ready-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }

        .welcome-body {
          margin: 12px 0 0;
          color: rgba(0, 0, 0, 0.6);
          font-size: 14px;
          line-height: 1.5;
          max-width: 400px;
        }
      }

      /* Wallet Table */
      .wallet-table-container {
        overflow-x: auto;
      }

      .wallet-table {
        width: 100%;

        th.mat-mdc-header-cell {
          font-weight: 600;
          color: rgba(0, 0, 0, 0.6);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        td.mat-mdc-cell {
          padding: 12px 16px;
        }

        tr.mat-mdc-row {
          cursor: pointer;
          transition: background-color 0.15s ease;

          &:hover {
            background-color: rgba(0, 0, 0, 0.04);
          }

          &.selected {
            background-color: rgba(33, 150, 243, 0.12);

            &:hover {
              background-color: rgba(33, 150, 243, 0.18);
            }
          }
        }

        .unloaded {
          color: rgba(0, 0, 0, 0.4);
        }

        .no-balance {
          color: rgba(0, 0, 0, 0.3);
        }

        .name-header {
          white-space: nowrap;
        }

        .balance-header {
          text-align: center !important;
          white-space: nowrap;
        }

        .balance-cell {
          text-align: right !important;
          font-family: monospace;
          white-space: nowrap;
        }

        .action-cell {
          text-align: right !important;
          width: 90px;
        }

        .action-button {
          font-size: 12px;
          line-height: 24px;
          min-width: 70px;
          width: 70px;
          padding: 0 8px;
          height: 28px;
        }

        .load-button {
          color: rgba(0, 0, 0, 0.6);
          border-color: rgba(0, 0, 0, 0.3);
        }

        .unload-button {
          color: rgba(0, 0, 0, 0.4);
          border-color: rgba(0, 0, 0, 0.2);
        }

        .encryption-header,
        .encryption-cell {
          text-align: center !important;
          width: 48px;
          min-width: 48px;
          max-width: 48px;
        }

        .encryption-cell {
          font-size: 0; /* Hide any stray text nodes */
        }

        .encryption-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;

          &.encrypted {
            color: #4caf50;
          }

          &.not-encrypted {
            color: rgba(0, 0, 0, 0.25);
          }

          &.watch-only {
            color: #2196f3;
          }
        }

        .no-encryption {
          color: rgba(0, 0, 0, 0.3);
          font-size: 14px; /* Reset from cell's font-size: 0 */
        }
      }

      /* Status badge */
      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;

        .status-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &.loaded {
          color: #4caf50;
        }

        &.unloaded {
          color: rgba(0, 0, 0, 0.4);
        }
      }

      /* Bottom Actions */
      .box-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(0, 0, 0, 0.02);
        flex-wrap: wrap;
        gap: 12px;

        .left-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;

          button mat-icon {
            margin-right: 4px;
          }
        }

        .right-actions {
          .primary-action-button {
            min-width: 140px;

            mat-icon {
              margin-right: 4px;
            }

            mat-spinner {
              display: inline-block;
              margin-right: 8px;
            }
          }
        }
      }

      .version-info {
        color: rgba(0, 0, 0, 0.54);
        font-size: 12px;
      }

      /* Responsive */
      @media (max-width: 600px) {
        .box-actions {
          flex-direction: column;
          align-items: stretch;

          .left-actions {
            justify-content: center;
          }

          .right-actions {
            display: flex;
            justify-content: center;

            .primary-action-button {
              flex: 1;
            }
          }
        }
      }
    `,
  ],
})
export class WalletSelectComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly walletManager = inject(WalletManagerService);
  private readonly cookieAuth = inject(CookieAuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  private readonly appUpdateService = inject(AppUpdateService);
  private readonly destroy$ = new Subject<void>();

  /** App version from backend */
  readonly appVersion = this.appUpdateService.currentVersion;

  // State signals
  isConnecting = signal(true);
  isLoading = signal(false);
  isOpening = signal(false);
  connectionError = signal<string | null>(null);
  wallets = signal<WalletSummary[]>([]);
  selectedWallet = signal<string | null>(null);

  // Computed: are we connected to the node?
  isConnected = computed(() => !this.isConnecting() && !this.connectionError());

  // Loading wallets tracking
  loadingWallets = new Set<string>();

  // Table columns
  displayedColumns: string[] = ['status', 'name', 'balance', 'encryption', 'action'];

  ngOnInit(): void {
    // Subscribe to wallet changes (sync with toolbar)
    this.walletManager.walletsChanged$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.loadWallets();
    });

    this.checkConnection();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async checkConnection(): Promise<void> {
    this.isConnecting.set(true);
    this.connectionError.set(null);

    // Check if we have RPC credentials
    if (!this.cookieAuth.isAuthenticated) {
      // Try to load credentials
      const success = await this.cookieAuth.loadCredentials();
      if (!success) {
        this.connectionError.set('No RPC credentials available. Is Bitcoin Core running?');
        this.isConnecting.set(false);
        return;
      }
    }

    // Try to load wallets
    try {
      await this.loadWallets();
      this.isConnecting.set(false);
    } catch (err) {
      console.error('Connection check failed:', err);
      const message = err instanceof Error ? err.message : 'Connection failed';
      this.connectionError.set(message);
      this.isConnecting.set(false);
    }
  }

  async loadWallets(): Promise<void> {
    this.isLoading.set(true);

    try {
      const summaries = await this.walletManager.getWalletSummaries();
      this.wallets.set(summaries);

      // Auto-select first loaded wallet
      if (!this.selectedWallet() && summaries.length > 0) {
        const firstLoaded = summaries.find(w => w.isLoaded);
        if (firstLoaded) {
          this.selectedWallet.set(firstLoaded.name);
        }
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  retryConnection(): void {
    this.checkConnection();
  }

  selectRow(wallet: WalletSummary): void {
    this.selectedWallet.set(wallet.name);
  }

  isWalletLoading(walletName: string): boolean {
    return this.loadingWallets.has(walletName);
  }

  /**
   * Toggle wallet load/unload state
   */
  async toggleWalletLoad(wallet: WalletSummary, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.isWalletLoading(wallet.name)) return;

    this.loadingWallets.add(wallet.name);

    try {
      if (wallet.isLoaded) {
        // Unload wallet
        await this.walletManager.unloadWallet(wallet.name);
        // Clear selection if we unloaded the selected wallet
        if (this.selectedWallet() === wallet.name) {
          this.selectedWallet.set(null);
        }
      } else {
        // Load wallet
        await this.walletManager.loadWallet(wallet.name);
        this.selectedWallet.set(wallet.name);
      }
      await this.loadWallets();
    } catch (err) {
      const action = wallet.isLoaded ? 'unload' : 'load';
      const message = err instanceof Error ? err.message : `Failed to ${action} wallet`;
      this.snackBar.open(message, this.i18n.get('dismiss'), { duration: 5000 });
    } finally {
      this.loadingWallets.delete(wallet.name);
    }
  }

  async openWallet(): Promise<void> {
    const walletName = this.selectedWallet();
    if (!walletName) return;

    const wallet = this.wallets().find(w => w.name === walletName);
    if (!wallet) return;

    this.isOpening.set(true);

    try {
      // Load wallet if not loaded
      if (!wallet.isLoaded) {
        await this.walletManager.loadWallet(walletName);
      }

      // Set as active wallet
      this.walletManager.setActiveWallet(walletName);

      // Navigate to dashboard
      this.router.navigate(['/dashboard']);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open wallet';
      this.snackBar.open(message, this.i18n.get('dismiss'), { duration: 5000 });
      this.isOpening.set(false);
    }
  }
}
