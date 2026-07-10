import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe } from '../../../../core/i18n';
import { BtcxPipe, TimeAgoPipe } from '../../../../shared/pipes';
import { ContactsStoreService } from '../../../../shared/services';
import { TxRowComponent } from '../../components/tx-row/tx-row.component';
import { BtcxWalletService, BtcxChainInfo } from '../../../../core/services/btcx-wallet.service';
import { MiningService } from '../../../../mining/services';
import {
  BTCX_BLOCK_TIME_SECONDS,
  calculateNetworkCapacityTib,
  formatNetworkCapacityTib,
} from '../../../../mining/models/mining.models';

/**
 * WalletHomeComponent - the mobile wallet landing page.
 *
 * Branches on the wallet status:
 * - seed 'none'      -> onboarding entry (create / restore)
 * - seed 'locked'    -> unlock form
 * - seed 'unlocked'  -> Phoenix-dashboard-style cards: network info
 *                       (height, capacity, last block — from
 *                       btcx_chain_info, refreshed off the sync event),
 *                       balance breakdown, actions, recent transactions,
 *                       and entry points for assignments and contacts;
 *                       empty state when no Electrum server is configured
 *
 * While mining is not configured yet, an unlocked wallet also shows a hint
 * card linking to the mining setup wizard ("mine to this wallet") - the
 * wallet-side mirror of the wizard's create-wallet nudge.
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
    BtcxPipe,
    I18nPipe,
    TimeAgoPipe,
    TxRowComponent,
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
        <!-- Network info (Phoenix dashboard card) -->
        @if (wallet.hasElectrumServer()) {
          <div class="card gradient-card network-card">
            <div class="card-title">
              <mat-icon>link</mat-icon>
              {{ 'bitcoin_pocx_network' | i18n }}
            </div>
            <div class="info-grid">
              <div class="info-item">
                <span class="label">{{ 'height' | i18n }}</span>
                <span class="value">
                  @if (chain(); as info) {
                    {{ info.height | number }}
                  } @else {
                    —
                  }
                </span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'network_capacity' | i18n }}</span>
                <span class="value">{{ networkCapacity() }}</span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'last_block_time' | i18n }}</span>
                <span class="value">
                  @if (chain(); as info) {
                    {{ info.headerTime | timeAgo }}
                  } @else {
                    —
                  }
                </span>
              </div>
            </div>

            @if (wallet.walletActive() && !wallet.hasSynced()) {
              <div class="sync-row">
                <mat-spinner diameter="14"></mat-spinner>
                <span>{{ 'mwallet_waiting_first_sync' | i18n }}</span>
              </div>
            }
          </div>
        }

        <!-- Balance (Phoenix dashboard card) -->
        <div class="card gradient-card balance-card">
          <div class="card-title">
            <mat-icon>account_balance_wallet</mat-icon>
            {{ 'total_balance' | i18n }}
          </div>
          <div class="total-balance">
            <span class="amount">{{ (balance()?.totalSat ?? 0) / 100000000 | btcx }}</span>
            <span class="unit">BTCX</span>
          </div>
          <div class="balance-breakdown">
            <div class="breakdown-item">
              <span class="label">{{ 'mwallet_spendable' | i18n }}</span>
              <span class="value spendable">
                {{ (balance()?.spendableSat ?? 0) / 100000000 | btcx }} BTCX
              </span>
            </div>
            @if (pendingSat() > 0) {
              <div class="breakdown-item">
                <span class="label">{{ 'pending' | i18n }}</span>
                <span class="value pending"> {{ pendingSat() / 100000000 | btcx }} BTCX </span>
              </div>
            }
            @if ((balance()?.immatureSat ?? 0) > 0) {
              <div class="breakdown-item">
                <span class="label">{{ 'mwallet_immature' | i18n }}</span>
                <span class="value immature">
                  {{ (balance()?.immatureSat ?? 0) / 100000000 | btcx }} BTCX
                </span>
              </div>
            }
          </div>
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
            {{ 'transactions' | i18n }}
          </button>
        </div>

        <!-- Recent transactions -->
        <div class="card recent-card">
          <div class="card-title plain">
            <mat-icon>history</mat-icon>
            {{ 'recent_transactions' | i18n }}
          </div>
          @if (recentTransactions().length === 0) {
            <p class="hint-text no-tx">{{ 'no_transactions' | i18n }}</p>
          } @else {
            @for (tx of recentTransactions(); track tx.txid) {
              <div class="tx-item" routerLink="/wallet/history">
                <app-mwallet-tx-row [tx]="tx" />
              </div>
            }
            <div class="view-all-row">
              <a routerLink="/wallet/history">{{ 'mwallet_view_all' | i18n }}</a>
            </div>
          }
        </div>

        <!-- Mining nudge: only until mining is configured -->
        @if (showMiningHint()) {
          <div class="card mine-hint-card">
            <h3>{{ 'mwallet_mine_hint_title' | i18n }}</h3>
            <p class="hint-text">{{ 'mwallet_mine_hint_text' | i18n }}</p>
            <button mat-stroked-button routerLink="/miner/setup">
              <mat-icon>hardware</mat-icon>
              {{ 'mwallet_mine_setup' | i18n }}
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      .page {
        /* Density: tighter than the generic 16px page rhythm — the home
           stacks several cards, so the saved space adds up. */
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
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
        padding: 16px;

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

      /* Phoenix dashboard card look (desktop dashboard's info cards). */
      .gradient-card {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
      }

      .card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        font-weight: 500;
        margin-bottom: 10px;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }

        &.plain mat-icon {
          color: #42a5f5;
        }
      }

      /* Three compact stats: Height | Network Capacity | Last block. */
      .info-grid {
        display: grid;
        grid-template-columns: repeat(3, auto);
        justify-content: space-between;
        gap: 8px 12px;
      }

      .info-item {
        display: flex;
        flex-direction: column;
        min-width: 0;

        .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        .value {
          font-size: 14px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      }

      .total-balance {
        display: flex;
        justify-content: flex-end;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 10px;
        white-space: nowrap;

        .amount {
          font-size: 28px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        .unit {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.8);
        }
      }

      .balance-breakdown {
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        padding-top: 10px;

        .breakdown-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 3px 0;
          white-space: nowrap;

          .label {
            font-size: 13px;
            color: rgba(255, 255, 255, 0.7);
          }

          .value {
            font-size: 13px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;

            &.spendable {
              color: #69f0ae;
            }
            &.pending {
              color: #ffb74d;
            }
            &.immature {
              color: #90caf9;
            }
          }
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

      /* Waiting-for-first-sync spinner (the only footer state left). */
      .sync-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        font-size: 12px;
        color: rgba(255, 255, 255, 0.75);
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

      .recent-card {
        padding: 16px 16px 8px;

        .card-title {
          margin-bottom: 6px;
        }

        .no-tx {
          margin: 8px 0 12px;
        }
      }

      .tx-item {
        padding: 6px 0;
        cursor: pointer;

        &:not(:last-of-type) {
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }
      }

      .view-all-row {
        display: flex;
        justify-content: flex-end;
        padding: 8px 0 6px;

        a {
          font-size: 13px;
          font-weight: 500;
          color: #1976d2;
          text-decoration: none;
          cursor: pointer;
        }
      }

      .mine-hint-card {
        h3 {
          margin-top: 0;
        }

        .hint-text {
          margin-bottom: 12px;
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .gradient-card {
          background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        }

        .hint-text,
        .option-hint {
          color: rgba(255, 255, 255, 0.6);
        }

        .empty-card .empty-icon {
          color: rgba(255, 255, 255, 0.3);
        }

        .tx-item:not(:last-of-type) {
          border-bottom-color: rgba(255, 255, 255, 0.08);
        }

        .view-all-row a {
          color: #64b5f6;
        }
      }
    `,
  ],
})
export class WalletHomeComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly mining = inject(MiningService);
  private readonly contactsStore = inject(ContactsStoreService);

  readonly balance = computed(() => this.wallet.balance());
  readonly pendingSat = computed(() => {
    const b = this.wallet.balance();
    if (!b) return 0;
    return b.trustedPendingSat + b.untrustedPendingSat;
  });

  /** Recent activity preview — the newest 5 entries. */
  readonly recentTransactions = computed(() => this.wallet.transactions().slice(0, 5));

  /**
   * Chain tip snapshot (height, base target, header time). Fetched once on
   * entry and re-fetched when the background sync event reports a new
   * height — no polling of our own.
   */
  readonly chain = signal<BtcxChainInfo | null>(null);

  unlockPassphrase = '';
  readonly unlocking = signal(false);
  readonly unlockError = signal(false);

  // Only show the mining nudge once the mining state has actually loaded,
  // so a configured setup never sees the card flash.
  private readonly miningStateLoaded = signal(false);
  readonly showMiningHint = computed(() => this.miningStateLoaded() && !this.mining.isConfigured());

  constructor() {
    // Ride the btcx-wallet:sync event: refresh the tip snapshot when the
    // synced height moves past what we last fetched.
    effect(() => {
      const height = this.wallet.lastSync()?.height;
      if (height !== undefined && height !== this.chain()?.height) {
        void this.refreshChain();
      }
    });
  }

  ngOnInit(): void {
    // Fresh contacts book: the tx-row menu's "add to contact" hides
    // addresses that already have an entry (possibly added elsewhere).
    this.contactsStore.load();
    void this.wallet.initialize().then(() => {
      if (this.wallet.hasElectrumServer()) {
        void this.refreshChain();
      }
    });
    void this.mining.getState().then(() => this.miningStateLoaded.set(true));
  }

  private refreshing = false;
  private async refreshChain(): Promise<void> {
    if (this.refreshing || !this.wallet.hasElectrumServer()) return;
    this.refreshing = true;
    try {
      this.chain.set(await this.wallet.chainInfo());
    } catch (err) {
      console.warn('Failed to fetch chain info:', err);
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Network capacity derived from the tip's base target with the same
   * formula and units the desktop dashboard uses (mining.models /
   * blockchain-state.service).
   */
  networkCapacity(): string {
    const baseTarget = this.chain()?.baseTarget ?? 0;
    if (!baseTarget) return '—';
    return formatNetworkCapacityTib(
      calculateNetworkCapacityTib(baseTarget, BTCX_BLOCK_TIME_SECONDS)
    );
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
