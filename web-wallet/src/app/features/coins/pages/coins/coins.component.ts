import { Component, effect, inject, signal, untracked } from '@angular/core';
import { Location } from '@angular/common';
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
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';

/**
 * CoinsComponent — the ONE responsive "Coins & Addresses" (Balance details)
 * page, serving both the desktop route (`/coins`, main-layout) and the
 * mobile-wallet route (`/wallet/coins`, mobile-wallet-layout). Shows the
 * wallet's spendable coins grouped by their funding address, reassuring the
 * user that funds spread across derived addresses are normal (not lost).
 *
 * Shell-agnostic: it works in every node mode through the WalletBackend seam
 * (`backend.wallet().listCoins()` routes to Core RPC or the local BDK wallet)
 * and lays out identically under both shells — the shared
 * AddressCoinsListComponent reflows from a wide table to stacked cards purely
 * on width. The gradient header (back + title + refresh) and the flex-fill
 * height chain give the list a bounded height for fit-based pagination.
 */
@Component({
  selector: 'app-coins',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, I18nPipe, AddressCoinsListComponent],
  template: `
    <div class="page-layout">
      <div class="header">
        <div class="header-inner">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'coins_title' | i18n }}</h1>
          <span class="spacer"></span>
          <button
            mat-icon-button
            class="refresh-button"
            [disabled]="loading()"
            (click)="refresh()"
            [matTooltip]="'refresh' | i18n"
          >
            <mat-icon [class.spinning]="loading()">refresh</mat-icon>
          </button>
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
      @use 'breakpoints' as bp;

      /* Fill the routed content column (desktop main-layout / mobile-wallet-
         layout are both bounded flex columns) so the list card can flex into
         the leftover viewport height — giving the coins list a measurable
         height for fit-based pagination under BOTH shells. */
      :host {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .page-layout {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      /* Full-width gradient band. Its height is the shared balance band token
         (--menu-balance-h) — the SAME height as the menu's balance block — so
         the page header and the menu balance area move in tandem and both
         shrink at the mobile breakpoint. */
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        height: var(--menu-balance-h);
        flex-shrink: 0;
      }

      /* The header row spans the full page width (like the desktop header and
         the app's other page headers) — NOT constrained to the card column —
         so the back arrow sits at the page's left edge and refresh at its
         right. Fills the band height; horizontal padding is the band's edge
         inset (24px desktop / 16px mobile). */
      .header-inner {
        display: flex;
        align-items: center;
        gap: 16px;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 0 24px;

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 300;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      /* -8px counters the icon-button's internal padding so the arrow glyph
         sits on the card's left content edge (page-header's back-button trick). */
      .back-button {
        color: rgba(255, 255, 255, 0.9);
        flex-shrink: 0;
        margin-left: -8px;
      }

      .spacer {
        flex: 1;
      }

      .refresh-button {
        color: rgba(255, 255, 255, 0.9);
        flex-shrink: 0;
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

      .content {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 24px;
        box-sizing: border-box;
      }

      /* Flex-fills the content column so the embedded list has a bounded
         height (fit-based pagination). The height chain mirrors the unified
         contacts card exactly (:host → .page-layout → .content → .coins-card
         → the list's .table-body), so FitRows measures the leftover space and
         the list never grows a scrollbar of its own: basis 0, min-height 0
         (never grow to fit content), overflow hidden (the inner .table-body is
         the only scroll container). Max-width matches contacts: a full bech32
         address + the key/coins/balance columns. */
      .coins-card {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        max-width: 700px;
        width: 100%;
        padding: 20px 24px;
        box-sizing: border-box;
        overflow: hidden;
      }

      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

        .coins-card {
          background: #424242;
        }
      }

      @include bp.phone {
        /* Band height comes from --menu-balance-h (shrinks to the mobile
           balance-block height at this breakpoint). Only the edge padding and
           title size change here. */
        .header-inner {
          padding: 0 16px;
        }

        .header-inner h1 {
          font-size: 20px;
        }

        .content {
          padding: 16px;
        }

        .coins-card {
          padding: 16px;
        }
      }
    `,
  ],
})
export class CoinsComponent {
  private readonly backend = inject(BackendRouterService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly btcxWallet = inject(BtcxWalletService);
  private readonly location = inject(Location);

  readonly rows = signal<AddressBalance[]>([]);
  readonly loading = signal(false);

  constructor() {
    // Remote (BDK) mode populates the UTXO set via the background sync, so a
    // one-shot load can land before the coins arrive. Reload on wallet switch
    // (btcx walletName) and on every sync tick (lastSync). Both are signals:
    // in nodeless/remote mode they drive the refresh; in Core mode they are
    // constant (the btcx service is never initialized), so the effect just
    // does the initial load. The list tracks by address → no flicker;
    // untracked() keeps loadCoins' own signal reads out of the dependency set.
    effect(() => {
      this.btcxWallet.walletName();
      this.btcxWallet.lastSync();
      untracked(() => void this.loadCoins());
    });
  }

  goBack(): void {
    this.location.back();
  }

  refresh(): void {
    void this.loadCoins();
  }

  private async loadCoins(): Promise<void> {
    // One wallet-identity source for every shell: the manager's active wallet
    // (Core wallet name, or the remote group id the Electrum backend ignores).
    // In the nodeless shell it is fed by the manager's btcx bridge — the
    // per-page resolveWalletName() fallback this replaced is gone for good.
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    // Spinner only while the list is still empty — background refreshes update
    // silently so it doesn't flash on every sync tick; a transient error keeps
    // the last-good rows.
    if (this.rows().length === 0) this.loading.set(true);
    try {
      const coins = await this.backend.wallet().listCoins(walletName);
      this.rows.set(aggregateCoins(coins));
    } catch (error) {
      console.error('Failed to load coins:', error);
    } finally {
      this.loading.set(false);
    }
  }
}
