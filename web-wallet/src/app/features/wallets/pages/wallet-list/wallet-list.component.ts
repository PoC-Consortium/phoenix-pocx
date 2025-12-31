import { Component, inject, signal, OnInit } from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { I18nPipe } from '../../../../core/i18n';
import {
  PageLayoutComponent,
  EmptyStateComponent,
  BalanceDisplayComponent,
  LoadingSpinnerComponent,
} from '../../../../shared';
import { NotificationService } from '../../../../shared/services';
import {
  WalletManagerService,
  WalletSummary,
} from '../../../../bitcoin/services/wallet/wallet-manager.service';

/**
 * WalletListComponent displays available wallets for management.
 *
 * Features:
 * - List all wallets with balances
 * - Switch active wallet
 * - Create new wallet
 * - Import wallet
 * - Unload wallet
 */
@Component({
  selector: 'app-wallet-list',
  standalone: true,
  imports: [
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatChipsModule,
    I18nPipe,
    PageLayoutComponent,
    EmptyStateComponent,
    BalanceDisplayComponent,
    LoadingSpinnerComponent
],
  template: `
    <app-page-layout [title]="'wallets' | i18n">
      <div class="wallets-container">
        <!-- Actions Card -->
        <mat-card class="actions-card">
          <mat-card-content>
            <div class="actions-row">
              <button mat-raised-button color="primary" routerLink="/auth/create">
                <mat-icon>add</mat-icon>
                {{ 'create_new_wallet' | i18n }}
              </button>
              <button mat-stroked-button routerLink="/auth/import">
                <mat-icon>file_upload</mat-icon>
                {{ 'import_wallet' | i18n }}
              </button>
              <button mat-icon-button [disabled]="loading()" (click)="loadWallets()">
                <mat-icon>refresh</mat-icon>
              </button>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Wallet List -->
        <mat-card class="list-card">
          @if (loading()) {
            <mat-card-content>
              <app-loading-spinner />
            </mat-card-content>
          } @else if (error()) {
            <mat-card-content class="error-content">
              <mat-icon class="error-icon">error</mat-icon>
              <p>{{ error() }}</p>
              <button mat-stroked-button (click)="loadWallets()">
                <mat-icon>refresh</mat-icon>
                {{ 'retry' | i18n }}
              </button>
            </mat-card-content>
          } @else if (wallets().length === 0) {
            <mat-card-content>
              <app-empty-state
                icon="account_balance_wallet"
                [title]="'no_wallets' | i18n"
                [message]="'create_wallet_message' | i18n"
                [actionText]="'create_wallet' | i18n"
                (actionClick)="createWallet()"
              >
              </app-empty-state>
            </mat-card-content>
          } @else {
            <mat-card-content class="wallet-list">
              @for (wallet of wallets(); track wallet.name) {
                <div
                  class="wallet-item"
                  [class.active]="isActive(wallet.name)"
                  (click)="switchToWallet(wallet.name)"
                >
                  <div class="wallet-icon" [class.active]="isActive(wallet.name)">
                    <mat-icon>account_balance_wallet</mat-icon>
                  </div>
                  <div class="wallet-details">
                    <div class="wallet-name">
                      {{ wallet.name }}
                      @if (isActive(wallet.name)) {
                        <mat-chip class="active-chip">{{ 'active' | i18n }}</mat-chip>
                      }
                    </div>
                    <app-balance-display [amount]="wallet.balance ?? 0" [shortForm]="true">
                    </app-balance-display>
                    <div class="wallet-meta">
                      <span class="tx-count">{{ wallet.txCount }} {{ 'transactions' | i18n }}</span>
                    </div>
                  </div>
                  <div class="wallet-actions">
                    <button
                      mat-icon-button
                      [matMenuTriggerFor]="walletMenu"
                      [matMenuTriggerData]="{ wallet: wallet }"
                      (click)="$event.stopPropagation()"
                    >
                      <mat-icon>more_vert</mat-icon>
                    </button>
                  </div>
                </div>
                <mat-divider></mat-divider>
              }
            </mat-card-content>
          }
        </mat-card>

        <!-- Wallet Menu -->
        <mat-menu #walletMenu="matMenu">
          <ng-template matMenuContent let-wallet="wallet">
            @if (!isActive(wallet.name)) {
              <button mat-menu-item (click)="switchToWallet(wallet.name)">
                <mat-icon>swap_horiz</mat-icon>
                <span>{{ 'switch_to_wallet' | i18n }}</span>
              </button>
            }
            <button mat-menu-item (click)="viewWalletInfo(wallet.name)">
              <mat-icon>info</mat-icon>
              <span>{{ 'wallet_info' | i18n }}</span>
            </button>
            <mat-divider></mat-divider>
            <button
              mat-menu-item
              (click)="unloadWallet(wallet.name)"
              [disabled]="isActive(wallet.name)"
              class="unload-item"
            >
              <mat-icon>eject</mat-icon>
              <span>{{ 'unload_wallet' | i18n }}</span>
            </button>
          </ng-template>
        </mat-menu>
      </div>
    </app-page-layout>
  `,
  styles: [
    `
      .wallets-container {
        max-width: 800px;
        margin: 0 auto;
      }

      .actions-card {
        margin-bottom: 16px;
      }

      .actions-row {
        display: flex;
        gap: 12px;
        align-items: center;

        button:last-child {
          margin-left: auto;
        }
      }

      .list-card {
        .wallet-list {
          padding: 0;
        }
      }

      .error-content {
        text-align: center;
        padding: 48px;

        .error-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: #f44336;
          margin-bottom: 16px;
        }
      }

      .wallet-item {
        display: flex;
        align-items: center;
        padding: 16px;
        gap: 16px;
        cursor: pointer;
        transition: background 0.2s;

        &:hover {
          background: rgba(0, 0, 0, 0.02);
        }

        &.active {
          background: rgba(30, 58, 95, 0.05);
        }
      }

      .wallet-icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;

        mat-icon {
          font-size: 28px;
          width: 28px;
          height: 28px;
          color: rgba(0, 0, 0, 0.54);
        }

        &.active {
          background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);

          mat-icon {
            color: white;
          }
        }
      }

      .wallet-details {
        flex: 1;
        min-width: 0;
      }

      .wallet-name {
        font-weight: 500;
        font-size: 16px;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .active-chip {
        font-size: 11px;
        min-height: 20px;
        padding: 0 8px;
      }

      .wallet-meta {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.54);
        margin-top: 4px;
      }

      .wallet-actions {
        flex-shrink: 0;
      }

      .unload-item {
        color: #f44336;
      }

      :host-context(.dark-theme) {
        .wallet-item:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .wallet-item.active {
          background: rgba(30, 58, 95, 0.2);
        }

        .wallet-icon {
          background: #424242;

          mat-icon {
            color: rgba(255, 255, 255, 0.54);
          }
        }

        .wallet-meta {
          color: rgba(255, 255, 255, 0.54);
        }
      }

      @media (max-width: 599px) {
        .actions-row {
          flex-wrap: wrap;

          button {
            flex: 1;
            min-width: 120px;
          }

          button:last-child {
            flex: 0;
            min-width: auto;
          }
        }
      }
    `,
  ],
})
export class WalletListComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly walletManager = inject(WalletManagerService);
  private readonly notification = inject(NotificationService);

  loading = signal(false);
  error = signal<string | null>(null);
  wallets = signal<WalletSummary[]>([]);

  ngOnInit(): void {
    this.loadWallets();
  }

  async loadWallets(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const summaries = await this.walletManager.getWalletSummaries();
      this.wallets.set(summaries);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load wallets';
      this.error.set(message);
    } finally {
      this.loading.set(false);
    }
  }

  isActive(walletName: string): boolean {
    return this.walletManager.activeWallet === walletName;
  }

  async switchToWallet(walletName: string): Promise<void> {
    if (this.isActive(walletName)) return;

    try {
      await this.walletManager.loadWallet(walletName);
      this.walletManager.setActiveWallet(walletName);
      this.notification.success(`Switched to ${walletName}`);
      this.router.navigate(['/dashboard']);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to switch wallet';
      this.notification.error(message);
    }
  }

  async unloadWallet(walletName: string): Promise<void> {
    if (this.isActive(walletName)) {
      this.notification.warning('Cannot unload the active wallet');
      return;
    }

    try {
      await this.walletManager.unloadWallet(walletName);
      await this.loadWallets();
      this.notification.success(`Unloaded ${walletName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unload wallet';
      this.notification.error(message);
    }
  }

  viewWalletInfo(_walletName: string): void {
    // Navigate to wallet info page or show dialog
    this.notification.info('Wallet info coming soon');
  }

  createWallet(): void {
    this.router.navigate(['/auth/create']);
  }
}
