import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { I18nPipe } from '../../../core/i18n';
import { BtcxPipe } from '../../pipes';
import { WalletCoin } from '../../../core/backend/wallet-backend.model';
import { AddressDisplayComponent } from '../address-display/address-display.component';
import { EmptyStateComponent } from '../empty-state/empty-state.component';

/** One address row of the coins view — coins of that address, aggregated. */
export interface AddressBalance {
  address: string;
  /** Sum of the address' coins, in BTC. */
  balanceBtc: number;
  coinCount: number;
  isChange: boolean;
  /**
   * The address' public key has been revealed on-chain (it has been spent
   * from before) — a security signal: coins here are guarded only by the
   * pubkey, not its hash. Undefined-per-coin (remote/BDK) folds to false.
   */
  exposed: boolean;
}

/**
 * Aggregate raw coins into per-address rows: group by address, sum amounts,
 * count coins, carry the change flag and the pubkey-exposure flag. Sorted
 * receive addresses first, then change; within each group, balance descending.
 */
export function aggregateCoins(coins: WalletCoin[]): AddressBalance[] {
  const byAddress = new Map<string, AddressBalance>();
  for (const c of coins) {
    const existing = byAddress.get(c.address);
    if (existing) {
      existing.balanceBtc += c.amount;
      existing.coinCount += 1;
      existing.exposed ||= c.exposed === true;
    } else {
      byAddress.set(c.address, {
        address: c.address,
        balanceBtc: c.amount,
        coinCount: 1,
        isChange: c.isChange,
        exposed: c.exposed === true,
      });
    }
  }
  return [...byAddress.values()].sort((a, b) => {
    if (a.isChange !== b.isChange) return a.isChange ? 1 : -1;
    return b.balanceBtc - a.balanceBtc;
  });
}

/**
 * AddressCoinsListComponent — presentational "Coins & Addresses" list.
 *
 * Shows the user their funds are spread across derived addresses (a normal
 * consequence of BIP-84 derivation), defusing "my money is gone" panic. Per
 * address: the address, its balance, a coin count, and a "Key exposed" flag
 * when the address' pubkey is already on-chain (it has been spent from before)
 * — a security signal, not a privacy one. No receive/change labels — that
 * keychain distinction confuses more than it helps (a payment received to a
 * change address reads as "Change", reinforcing the very panic this defuses).
 * Purely informational — no warnings/modals.
 */
@Component({
  selector: 'app-address-coins-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatPaginatorModule,
    I18nPipe,
    BtcxPipe,
    AddressDisplayComponent,
    EmptyStateComponent,
  ],
  template: `
    <p class="coins-intro">{{ 'coins_intro' | i18n }}</p>

    @if (loading()) {
      <div class="coins-loading">
        <mat-spinner diameter="28"></mat-spinner>
      </div>
    } @else if (rows().length === 0) {
      <app-empty-state icon="account_balance_wallet" [message]="'coins_empty' | i18n" />
    } @else {
      <div class="coins-table">
        <div class="coin-row coin-head">
          <span class="col-address">{{ 'address' | i18n }}</span>
          <span class="col-coins">{{ 'coins_col' | i18n }}</span>
          <span class="col-balance">{{ 'balance' | i18n }} (BTCX)</span>
          <span class="col-flag"></span>
        </div>
        @for (row of pagedRows(); track row.address) {
          <div class="coin-row">
            <div class="col-address">
              <app-address-display [address]="row.address" [showCopyButton]="true" />
            </div>
            <span class="col-coins">{{ row.coinCount }}</span>
            <span class="col-balance">{{ row.balanceBtc | btcx }}</span>
            <span class="col-flag">
              @if (row.exposed) {
                <mat-icon class="flag-icon" [matTooltip]="'address_exposed_hint' | i18n"
                  >key</mat-icon
                >
              }
            </span>
          </div>
        }
      </div>

      @if (rows().length > pageSizeOptions[0]) {
        <mat-paginator
          [length]="rows().length"
          [pageSize]="pageSize()"
          [pageIndex]="pageIndex()"
          [pageSizeOptions]="pageSizeOptions"
          (page)="onPageChange($event)"
          [showFirstLastButtons]="true"
        ></mat-paginator>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .coins-intro {
        margin: 0 0 16px;
        font-size: 13px;
        line-height: 1.5;
        color: #5a6b7a;
      }

      .coins-loading {
        display: flex;
        justify-content: center;
        padding: 32px 0;
      }

      .coins-table {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      /* One compact row: address | coins | balance | exposure flag. */
      .coin-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 56px minmax(110px, auto) 28px;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: #f5f7fa;
        border-radius: 8px;
      }

      /* Column-header row: same grid, no background. */
      .coin-head {
        background: transparent;
        padding: 2px 14px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #8a97a4;
      }

      .col-address {
        min-width: 0;
      }

      .col-coins {
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: #5a6b7a;
      }

      .col-balance {
        text-align: right;
        font-family: monospace;
        font-weight: 600;
        color: #002341;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .col-flag {
        display: flex;
        justify-content: center;
      }

      .flag-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #a06a00;
        cursor: default;
      }

      mat-paginator {
        margin-top: 8px;
        background: transparent;
      }

      :host-context(.dark-theme) {
        .coins-intro {
          color: #9fb0bf;
        }

        .coin-row {
          background: #333;
        }

        .col-coins {
          color: #9aa7b3;
        }

        .col-balance {
          color: #90caf9;
        }
      }
    `,
  ],
})
export class AddressCoinsListComponent {
  /** Aggregated address rows to render. */
  readonly rows = input.required<AddressBalance[]>();
  /** Whether the source query is still loading. */
  readonly loading = input(false);

  readonly pageSize = signal(10);
  readonly pageIndex = signal(0);
  readonly pageSizeOptions = [10, 25, 50];

  /** The current page of rows (transactions-style pagination). */
  readonly pagedRows = computed(() => {
    const all = this.rows();
    const size = this.pageSize();
    const maxPage = Math.max(0, Math.ceil(all.length / size) - 1);
    const page = Math.min(this.pageIndex(), maxPage);
    return all.slice(page * size, page * size + size);
  });

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }
}
