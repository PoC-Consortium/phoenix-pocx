import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe } from '../../../../core/i18n';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';

/**
 * WalletHomeComponent - the mobile wallet landing page.
 *
 * Branches on the wallet status:
 * - seed 'none'      -> onboarding entry (create / restore)
 * - seed 'locked'    -> unlock form
 * - seed 'unlocked'  -> balance breakdown, sync status, actions;
 *                       empty state when no Electrum server is configured
 */
@Component({
  selector: 'app-wallet-home',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    DecimalPipe,
    I18nPipe,
  ],
  template: `
    <div class="page">
      @if (!wallet.initialized() && wallet.isLoading()) {
        <div class="loading-state">
          <mat-spinner diameter="36"></mat-spinner>
        </div>
      } @else if (wallet.seedState() === 'none') {
        <!-- Onboarding entry -->
        <div class="card onboarding-card">
          <h2>{{ 'mwallet_onboarding_title' | i18n }}</h2>
          <p class="hint-text">{{ 'mwallet_onboarding_intro' | i18n }}</p>

          <button mat-raised-button color="primary" class="full-width" routerLink="/wallet/create">
            <mat-icon>add</mat-icon>
            {{ 'mwallet_create_wallet' | i18n }}
          </button>
          <p class="option-hint">{{ 'mwallet_create_wallet_hint' | i18n }}</p>

          <button mat-stroked-button class="full-width" routerLink="/wallet/restore">
            <mat-icon>restore</mat-icon>
            {{ 'mwallet_restore_wallet' | i18n }}
          </button>
          <p class="option-hint">{{ 'mwallet_restore_wallet_hint' | i18n }}</p>
        </div>
      } @else if (wallet.seedState() === 'locked') {
        <!-- Unlock form -->
        <div class="card">
          <h2>{{ 'mwallet_locked_title' | i18n }}</h2>
          <p class="hint-text">{{ 'mwallet_locked_hint' | i18n }}</p>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'mwallet_passphrase_label' | i18n }}</mat-label>
            <input
              matInput
              type="password"
              [(ngModel)]="unlockPassphrase"
              (keyup.enter)="unlock()"
              autocomplete="off"
            />
          </mat-form-field>

          @if (unlockError()) {
            <p class="error-text">{{ 'mwallet_unlock_failed' | i18n }}</p>
          }

          <button
            mat-raised-button
            color="primary"
            class="full-width"
            [disabled]="!unlockPassphrase || unlocking()"
            (click)="unlock()"
          >
            @if (unlocking()) {
              <mat-spinner diameter="20"></mat-spinner>
            } @else {
              <mat-icon>lock_open</mat-icon>
            }
            {{ 'unlock' | i18n }}
          </button>
        </div>
      } @else {
        <!-- Balance -->
        <div class="card balance-card">
          <span class="balance-label">{{ 'mwallet_spendable' | i18n }}</span>
          <span class="balance-value">
            {{ (balance()?.spendableSat ?? 0) / 100000000 | number: '1.8-8' }}
            <span class="balance-unit">BTCX</span>
          </span>

          <div class="balance-details">
            @if (pendingSat() > 0) {
              <div class="detail-row">
                <span>{{ 'pending' | i18n }}</span>
                <span>{{ pendingSat() / 100000000 | number: '1.8-8' }}</span>
              </div>
            }
            @if ((balance()?.immatureSat ?? 0) > 0) {
              <div class="detail-row">
                <span>{{ 'mwallet_immature' | i18n }}</span>
                <span>{{ (balance()?.immatureSat ?? 0) / 100000000 | number: '1.8-8' }}</span>
              </div>
            }
          </div>

          <!-- Sync status -->
          @if (wallet.walletActive()) {
            <div class="sync-row">
              @if (wallet.hasSynced()) {
                <mat-icon class="sync-icon synced">check_circle</mat-icon>
                <span>
                  {{ 'block_height' | i18n }}: {{ wallet.syncedHeight() ?? 0 }}
                  @if (wallet.syncAgeSecs() !== null) {
                    · {{ 'mwallet_sync_age' | i18n: { seconds: wallet.syncAgeSecs() ?? 0 } }}
                  }
                </span>
              } @else {
                <mat-spinner diameter="14"></mat-spinner>
                <span>{{ 'mwallet_waiting_first_sync' | i18n }}</span>
              }
            </div>
          }
        </div>

        <!-- No Electrum server configured -->
        @if (!wallet.hasElectrumServer()) {
          <div class="card empty-card">
            <mat-icon class="empty-icon">cloud_off</mat-icon>
            <h3>{{ 'mwallet_no_server_title' | i18n }}</h3>
            <p class="hint-text">{{ 'mwallet_no_server_hint' | i18n }}</p>
            <button mat-stroked-button routerLink="/wallet/settings">
              <mat-icon>settings</mat-icon>
              {{ 'mwallet_server_settings' | i18n }}
            </button>
          </div>
        }

        <!-- Actions -->
        <div class="actions-row">
          <button
            mat-raised-button
            color="primary"
            routerLink="/wallet/send"
            [disabled]="!wallet.walletActive()"
          >
            <mat-icon>arrow_upward</mat-icon>
            {{ 'send' | i18n }}
          </button>
          <button
            mat-raised-button
            routerLink="/wallet/receive"
            [disabled]="!wallet.walletActive()"
          >
            <mat-icon>arrow_downward</mat-icon>
            {{ 'receive' | i18n }}
          </button>
          <button mat-raised-button routerLink="/wallet/history">
            <mat-icon>history</mat-icon>
            {{ 'mwallet_history_title' | i18n }}
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .page {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 480px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
      }

      .loading-state {
        display: flex;
        justify-content: center;
        padding: 48px 0;
      }

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;

        h2 {
          margin: 0 0 8px;
          font-size: 18px;
          font-weight: 500;
        }

        h3 {
          margin: 8px 0 4px;
          font-size: 15px;
          font-weight: 500;
        }
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 16px;
      }

      .option-hint {
        color: rgba(0, 0, 0, 0.5);
        font-size: 12px;
        margin: 6px 0 16px;
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      .full-width {
        width: 100%;
      }

      .balance-card {
        display: flex;
        flex-direction: column;
      }

      .balance-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(0, 0, 0, 0.5);
      }

      .balance-value {
        font-size: 28px;
        font-weight: 500;
        margin: 4px 0 8px;
        font-variant-numeric: tabular-nums;

        .balance-unit {
          font-size: 14px;
          color: rgba(0, 0, 0, 0.5);
        }
      }

      .balance-details {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        color: rgba(0, 0, 0, 0.6);
        font-variant-numeric: tabular-nums;
      }

      .sync-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        font-size: 12px;
        color: rgba(0, 0, 0, 0.6);

        .sync-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;

          &.synced {
            color: #4caf50;
          }
        }
      }

      .empty-card {
        text-align: center;

        .empty-icon {
          font-size: 36px;
          width: 36px;
          height: 36px;
          color: rgba(0, 0, 0, 0.3);
        }
      }

      .actions-row {
        display: flex;
        gap: 8px;

        button {
          flex: 1;
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text,
        .option-hint,
        .balance-label,
        .detail-row,
        .sync-row {
          color: rgba(255, 255, 255, 0.6);
        }

        .balance-value .balance-unit {
          color: rgba(255, 255, 255, 0.5);
        }

        .sync-row {
          border-top-color: rgba(255, 255, 255, 0.12);
        }

        .empty-card .empty-icon {
          color: rgba(255, 255, 255, 0.3);
        }
      }
    `,
  ],
})
export class WalletHomeComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);

  readonly balance = computed(() => this.wallet.balance());
  readonly pendingSat = computed(() => {
    const b = this.wallet.balance();
    if (!b) return 0;
    return b.trustedPendingSat + b.untrustedPendingSat;
  });

  unlockPassphrase = '';
  readonly unlocking = signal(false);
  readonly unlockError = signal(false);

  ngOnInit(): void {
    void this.wallet.initialize();
  }

  async unlock(): Promise<void> {
    if (!this.unlockPassphrase || this.unlocking()) return;
    this.unlocking.set(true);
    this.unlockError.set(false);
    try {
      await this.wallet.unlock(this.unlockPassphrase);
      this.unlockPassphrase = '';
    } catch (err) {
      console.error('Unlock failed:', err);
      this.unlockError.set(true);
    } finally {
      this.unlocking.set(false);
    }
  }
}
