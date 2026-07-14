import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../../core/i18n';
import {
  AddressBalance,
  AddressCoinsListComponent,
  aggregateCoins,
} from '../../../../shared/components';
import { BackendRouterService } from '../../../../core/backend/backend-router.service';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';

/**
 * WalletCoinsComponent — the mobile "Coins & Addresses" view. Groups the
 * nodeless wallet's spendable coins by funding address so the user sees
 * their balance is the sum of many derived-address outputs (nothing lost).
 */
@Component({
  selector: 'app-wallet-coins',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    I18nPipe,
    AddressCoinsListComponent,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="coins_title">
      <button
        mat-icon-button
        [disabled]="loading()"
        (click)="refresh()"
        [matTooltip]="'refresh' | i18n"
      >
        <mat-icon [class.spinning]="loading()">refresh</mat-icon>
      </button>
    </app-mwallet-page-header>

    <div class="page">
      <div class="card">
        <app-address-coins-list [rows]="rows()" [loading]="loading()" [compact]="true" />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .page {
        max-width: 480px;
        margin: 0 auto;
        padding: 16px;
        box-sizing: border-box;
      }

      .card {
        background: var(--mwallet-card-bg, #ffffff);
        border-radius: 12px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        padding: 16px;
      }

      .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      :host-context(.dark-theme) .card {
        background: #424242;
      }
    `,
  ],
})
export class WalletCoinsComponent {
  private readonly backend = inject(BackendRouterService);
  private readonly wallet = inject(BtcxWalletService);

  readonly rows = signal<AddressBalance[]>([]);
  readonly loading = signal(false);

  constructor() {
    // The coins/UTXO set is populated by the background sync, so a one-shot
    // load can land BEFORE the coins arrive (the empty "no coins yet"). Reload
    // on wallet switch (walletName) and on every sync tick (lastSync). The list
    // tracks by address, so refreshing in place doesn't flicker; untracked()
    // keeps loadCoins' own signal reads out of the effect's dependency set.
    effect(() => {
      this.wallet.walletName();
      this.wallet.lastSync();
      untracked(() => void this.loadCoins());
    });
  }

  refresh(): void {
    void this.loadCoins();
  }

  private async loadCoins(): Promise<void> {
    // Spinner only while the list is still empty — background refreshes update
    // silently so it doesn't flash on every sync tick. A transient error keeps
    // the last-good rows rather than blanking the list.
    if (this.rows().length === 0) this.loading.set(true);
    try {
      const coins = await this.backend.wallet().listCoins(this.wallet.walletName());
      this.rows.set(aggregateCoins(coins));
    } catch (error) {
      console.error('Failed to load coins:', error);
    } finally {
      this.loading.set(false);
    }
  }
}
