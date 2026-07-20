import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { I18nPipe } from '../../../core/i18n';
import { BtcxPipe } from '../../pipes';
import { FitRowsDirective } from '../../directives';
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
  host: { '[class.compact]': 'compact()' },
  imports: [
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatPaginatorModule,
    I18nPipe,
    BtcxPipe,
    FitRowsDirective,
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
    } @else if (compact()) {
      <!-- Mobile: fit-derived pagination (same idiom as the transactions
           page). The cards container flex-fills the card and FitRowsDirective
           measures how many .coin-card rows fit without scrolling — that fit
           IS the page size, so there is no items-per-page selector. -->
      <div
        class="coins-cards"
        appFitRows
        [fitRowSelector]="'.coin-card'"
        [fitMinRows]="3"
        [fitFallbackRowPx]="82"
        (fitRows)="onFitRows($event)"
      >
        @for (row of pagedRows(); track row.address) {
          <div class="coin-card">
            <app-address-display [address]="row.address" [showCopyButton]="true" [inline]="false" />
            <div class="coin-card-meta">
              <span class="coin-card-balance">{{ row.balanceBtc | btcx }} BTCX</span>
              <span class="coin-card-count">{{ row.coinCount }} {{ 'coins_col' | i18n }}</span>
              @if (row.exposed) {
                <mat-icon class="flag-icon" [matTooltip]="'address_exposed_hint' | i18n"
                  >key</mat-icon
                >
              }
            </div>
          </div>
        }
      </div>

      @if (rows().length > compactPageSize()) {
        <mat-paginator
          [length]="rows().length"
          [pageSize]="compactPageSize()"
          [pageIndex]="pageIndex()"
          [hidePageSize]="true"
          (page)="onPageChange($event)"
          [showFirstLastButtons]="true"
        ></mat-paginator>
      }
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

      /* Compact (mobile) layout flex-fills its bounded parent so the cards
         viewport height is viewport-derived (see .coins-cards below). */
      :host.compact {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
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

      /* Compact (mobile) layout: one stacked card per address. */
      .coins-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* The measured row viewport: basis 0 so its height comes from the
         leftover space between the intro and the paginator (never from its
         own cards). Steady-state the fit-sized page never scrolls; the few
         overflowing pixels (inter-card gaps) scroll here. */
      :host.compact .coins-cards {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
      }

      /* Compact paginator (the transactions-page pager, mobile-sized). */
      :host.compact mat-paginator {
        margin-top: 0;
        flex-shrink: 0;

        ::ng-deep .mat-mdc-paginator-container {
          min-height: 44px;
          padding: 0 4px;
          justify-content: center;
        }

        ::ng-deep .mat-mdc-paginator-range-label {
          font-size: 11px;
          margin: 0 6px;
        }

        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-first,
        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-previous,
        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-next,
        ::ng-deep .mat-mdc-icon-button.mat-mdc-paginator-navigation-last {
          width: 36px;
          height: 36px;
          padding: 6px;
        }
      }

      .coin-card {
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.015);
      }

      .coin-card-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 8px;
        font-size: 13px;
      }

      .coin-card-balance {
        font-weight: 600;
        color: #1976d2;
      }

      .coin-card-count {
        color: #5a6b7a;
      }

      .coin-card-meta .flag-icon {
        margin-left: auto;
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

        .coin-card {
          border-color: rgba(255, 255, 255, 0.12);
          background: #333;
        }

        .coin-card-balance {
          color: #90caf9;
        }

        .coin-card-count {
          color: #9fb0bf;
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
  /**
   * Compact (transposed) layout: each address becomes a stacked card instead
   * of a wide table row — for narrow / mobile viewports where the 4 columns
   * don't fit.
   */
  readonly compact = input(false);

  // Desktop (non-compact) pagination: a user-chosen size from the selector.
  readonly pageSize = signal(10);
  readonly pageIndex = signal(0);
  readonly pageSizeOptions = [10, 25, 50];

  // Compact (mobile) pagination: the page size is whatever FitRowsDirective
  // measures fits the viewport (initial value only covers the first paint
  // before the directive's AfterViewInit measurement lands).
  readonly compactPageSize = signal(6);

  /** The effective page size for the active layout. */
  private readonly effectivePageSize = computed(() =>
    this.compact() ? this.compactPageSize() : this.pageSize()
  );

  /** The current page of rows (transactions-style pagination). */
  readonly pagedRows = computed(() => {
    const all = this.rows();
    const size = this.effectivePageSize();
    const maxPage = Math.max(0, Math.ceil(all.length / size) - 1);
    const page = Math.min(this.pageIndex(), maxPage);
    return all.slice(page * size, page * size + size);
  });

  /**
   * New measured fit (rotation, resize, first measurement): adopt it as the
   * compact page size and keep the user on the page containing the previously
   * first visible row instead of resetting to page 0.
   */
  onFitRows(fit: number): void {
    const oldSize = this.compactPageSize();
    if (fit === oldSize) return;
    const firstVisibleIndex = this.pageIndex() * oldSize;
    this.compactPageSize.set(fit);
    this.pageIndex.set(Math.floor(firstVisibleIndex / fit));
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    // Only the desktop selector changes the page size; the compact pager
    // hides the selector and its size is the measured fit.
    if (!this.compact()) this.pageSize.set(event.pageSize);
  }
}
