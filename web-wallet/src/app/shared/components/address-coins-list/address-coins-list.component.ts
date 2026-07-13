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
      <div class="coins-scroll">
        <table class="coins-table">
          <thead>
            <tr>
              <th class="th-address">{{ 'address' | i18n }}</th>
              <th class="th-flag" aria-hidden="true"></th>
              <th class="th-coins">{{ 'coins_col' | i18n }}</th>
              <th class="th-balance">{{ 'balance' | i18n }} (BTCX)</th>
            </tr>
          </thead>
          <tbody>
            @for (row of pagedRows(); track row.address) {
              <tr>
                <td class="td-address">
                  <app-address-display
                    [address]="row.address"
                    [showCopyButton]="true"
                    [inline]="false"
                  />
                </td>
                <td class="td-flag">
                  @if (row.exposed) {
                    <mat-icon class="flag-icon" [matTooltip]="'address_exposed_hint' | i18n"
                      >key</mat-icon
                    >
                  }
                </td>
                <td class="td-coins">{{ row.coinCount }}</td>
                <td class="td-balance">{{ row.balanceBtc | btcx }}</td>
              </tr>
            }
          </tbody>
        </table>
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

      /* Only scrolls if a very long address can't fit the card. */
      .coins-scroll {
        overflow-x: auto;
      }

      /* A real table so the header and every row share column widths (a grid
         per row can't align across rows). Full width with a greedy address
         column pushes the number columns to the right edge, so their
         right-alignment reads cleanly (like the transactions table). */
      .coins-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0 6px;
      }

      .td-address,
      .th-address {
        width: 100%;
      }

      thead th {
        padding: 0 16px 4px;
        text-align: left;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #8a97a4;
        white-space: nowrap;
      }

      .th-coins {
        text-align: center;
      }

      .th-balance {
        text-align: right;
      }

      tbody td {
        background: #f5f7fa;
        padding: 8px 16px;
        vertical-align: middle;
      }

      tbody td:first-child {
        border-radius: 8px 0 0 8px;
      }

      tbody td:last-child {
        border-radius: 0 8px 8px 0;
      }

      .td-coins {
        text-align: center;
        font-variant-numeric: tabular-nums;
        color: #5a6b7a;
      }

      .td-balance {
        text-align: right;
        font-family: monospace;
        font-weight: 600;
        color: #002341;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .td-flag {
        text-align: center;
        width: 1%;
      }

      .flag-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #a06a00;
        cursor: default;
        vertical-align: middle;
      }

      mat-paginator {
        margin-top: 8px;
        background: transparent;
      }

      :host-context(.dark-theme) {
        .coins-intro {
          color: #9fb0bf;
        }

        tbody td {
          background: #333;
        }

        .td-coins {
          color: #9aa7b3;
        }

        .td-balance {
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
