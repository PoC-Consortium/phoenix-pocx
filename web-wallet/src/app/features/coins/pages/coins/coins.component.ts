import { Component, OnInit, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { I18nPipe } from '../../../../core/i18n';
import {
  AddressBalance,
  AddressCoinsListComponent,
  aggregateCoins,
} from '../../../../shared/components';
import { BackendRouterService } from '../../../../core/backend/backend-router.service';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';

/**
 * CoinsComponent — the desktop "Coins & Addresses" view. Shows the wallet's
 * spendable coins grouped by their funding address, reassuring the user that
 * funds spread across derived addresses are normal (not lost). Works in both
 * node modes via the WalletBackend seam.
 */
@Component({
  selector: 'app-coins',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, I18nPipe, AddressCoinsListComponent],
  template: `
    <div class="page-layout">
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'coins_title' | i18n }}</h1>
        </div>
      </div>

      <div class="content">
        <div class="coins-card">
          <app-address-coins-list [rows]="rows()" [loading]="loading()" />
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .page-layout {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        align-items: center;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 16px;

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 300;
        }
      }

      .back-button {
        color: rgba(255, 255, 255, 0.9);
      }

      .content {
        padding: 24px;
        display: flex;
        justify-content: center;
        overflow-y: auto;
      }

      .coins-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        /* Wide enough for a full bech32(m) address + the coins/balance/flag
           columns without the address wrapping (word-break). */
        max-width: 780px;
        width: 100%;
        padding: 20px 24px;
        box-sizing: border-box;
      }

      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

        .coins-card {
          background: #424242;
        }
      }
    `,
  ],
})
export class CoinsComponent implements OnInit {
  private readonly backend = inject(BackendRouterService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly location = inject(Location);

  readonly rows = signal<AddressBalance[]>([]);
  readonly loading = signal(false);

  ngOnInit(): void {
    void this.loadCoins();
  }

  goBack(): void {
    this.location.back();
  }

  private async loadCoins(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    this.loading.set(true);
    try {
      const coins = await this.backend.wallet().listCoins(walletName);
      this.rows.set(aggregateCoins(coins));
    } catch (error) {
      console.error('Failed to load coins:', error);
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
