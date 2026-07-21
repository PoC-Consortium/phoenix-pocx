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
 * AddressCoinsListComponent — the ONE responsive "Coins & Addresses" list,
 * serving both the desktop route (`/coins`, main-layout) and the mobile-wallet
 * route (`/wallet/coins`, mobile-wallet-layout). One template, one set of
 * styles: a flex "table" at wide widths that reflows to stacked cards below
 * the 600px breakpoint (like the mining dashboard / the unified contacts list
 * — pure CSS `@media`, no BreakpointObserver, no desktop/mobile fork).
 *
 * Shows the user their funds are spread across derived addresses (a normal
 * consequence of BIP-84 derivation), defusing "my money is gone" panic. Per
 * address: the address, its balance, a coin count, and a "Key exposed" flag
 * when the address' pubkey is already on-chain (it has been spent from before)
 * — a security signal, not a privacy one. No receive/change labels — that
 * keychain distinction confuses more than it helps. Purely informational.
 *
 * Fit-to-viewport pagination at ALL widths: FitRowsDirective measures how many
 * `.table-row` elements fit the leftover viewport height (the fit IS the page
 * size — no items-per-page selector). The measured row height adapts as the
 * table reflows to taller cards below 600px.
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
    } @else {
      <!-- Column header (hidden below the 600px card breakpoint). -->
      <div class="table-header">
        <div class="col-address">{{ 'address' | i18n }}</div>
        <div class="col-flag" aria-hidden="true"></div>
        <div class="col-coins">{{ 'coins_col' | i18n }}</div>
        <div class="col-balance">{{ 'balance' | i18n }} (BTCX)</div>
      </div>

      <!-- Fit-derived pagination (same idiom as the transactions page): the
           row viewport flex-fills the leftover height and FitRowsDirective
           measures how many .table-row elements fit — that fit IS the page
           size, so there is no size selector. The measured row height adapts
           as the table reflows to cards below 600px. -->
      <div
        class="table-body"
        appFitRows
        [fitRowSelector]="'.table-row'"
        [fitMinRows]="3"
        [fitFallbackRowPx]="64"
        (fitRows)="onFitRows($event)"
      >
        @for (row of pagedRows(); track row.address) {
          <div class="table-row">
            <div class="col-address">
              <app-address-display
                [address]="row.address"
                [showCopyButton]="true"
                [inline]="false"
              />
            </div>
            <!-- The three stat cells: display:contents at wide so they are
                 flat flex children of the row (aligned under the header),
                 and collapse to one meta line inside the card at narrow. -->
            <div class="col-meta">
              <div class="col-flag">
                @if (row.exposed) {
                  <mat-icon class="flag-icon" [matTooltip]="'address_exposed_hint' | i18n"
                    >key</mat-icon
                  >
                }
              </div>
              <div class="col-coins">
                {{ row.coinCount }} <span class="meta-label">{{ 'coins_col' | i18n }}</span>
              </div>
              <div class="col-balance">
                {{ row.balanceBtc | btcx }} <span class="meta-unit">BTCX</span>
              </div>
            </div>
          </div>
        }
      </div>

      @if (rows().length > pageSize()) {
        <mat-paginator
          [length]="rows().length"
          [pageSize]="pageSize()"
          [pageIndex]="pageIndex()"
          [hidePageSize]="true"
          (page)="onPageChange($event)"
          [showFirstLastButtons]="true"
        ></mat-paginator>
      }
    }
  `,
  styles: [
    `
      /* Flex-fill the bounded parent (the wrapper's .coins-card) so the row
         viewport height is viewport-derived — giving FitRowsDirective a real
         height to measure under BOTH shells. */
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }

      .coins-intro {
        flex-shrink: 0;
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

      /* Column header — a flat flex row matching the wide row's cells (the
         row's .col-meta is display:contents at wide, so flag/coins/balance
         are direct flex children aligned under these labels). */
      .table-header {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px 6px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #8a97a4;
        white-space: nowrap;
      }

      /* The measured row viewport: basis 0 so its height comes from the
         leftover space between the header and the paginator (never from its
         own rows). Steady-state the fit-sized page never scrolls. */
      .table-body {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
      }

      .table-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        margin-bottom: 6px;
        border-radius: 8px;
        background: #f5f7fa;
      }

      .table-row:last-child {
        margin-bottom: 0;
      }

      /* Address column — greedy, so the number columns sit at the right edge. */
      .col-address {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* At wide, the meta wrapper is transparent to layout so its three cells
         participate directly in the row/header flex. */
      .col-meta {
        display: contents;
      }

      .col-flag {
        flex: 0 0 auto;
        width: 18px;
        text-align: center;
      }

      .flag-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #a06a00;
        cursor: default;
        vertical-align: middle;
      }

      .col-coins {
        flex: 0 0 auto;
        width: 64px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        color: #5a6b7a;
        white-space: nowrap;
      }

      .col-balance {
        flex: 0 0 auto;
        width: 120px;
        text-align: right;
        font-family: monospace;
        font-weight: 600;
        color: #002341;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      /* The inline unit/label ("coins", "BTCX") duplicates the column header,
         so it is hidden at wide and only shown inside the card at narrow. */
      .meta-label,
      .meta-unit {
        display: none;
      }

      mat-paginator {
        flex-shrink: 0;
        margin-top: 4px;
        background: transparent;

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

      :host-context(.dark-theme) {
        .coins-intro {
          color: #9fb0bf;
        }

        .table-row {
          background: #333;
        }

        .col-coins {
          color: #9aa7b3;
        }

        .col-balance {
          color: #90caf9;
        }
      }

      /* Responsive — reflow each table row to a stacked card below 600px
         (tablet portrait, phone). The address wraps at full width; the three
         stat cells collapse onto one meta line under it. */
      @media (max-width: 600px) {
        .table-header {
          display: none;
        }

        .table-row {
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          padding: 10px 12px;
        }

        .col-address {
          width: 100%;
        }

        /* The meta wrapper becomes a real one-line flex row inside the card.
           Card meta order matches the OLD mobile coin-card:
           [balance] [coins] .......... [key flag on the far right]. The three
           cells are DOM-ordered flag/coins/balance (so display:contents aligns
           them under the wide header), so re-order them here with the CSS
           order property — only the narrow card reorders, the wide table
           stays aligned under its headers. */
        .col-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          font-size: 13px;
        }

        /* Balance first (prominent). */
        .col-balance {
          width: auto;
          order: 1;
          color: #1976d2;
        }

        .col-coins {
          width: auto;
          order: 2;
          text-align: left;
        }

        /* Exposed-key flag pushed to the far right edge of the meta line. */
        .col-flag {
          width: auto;
          order: 3;
          margin-left: auto;
        }

        .meta-label,
        .meta-unit {
          display: inline;
        }

        :host-context(.dark-theme) .col-balance {
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

  // Fit-derived pagination: the page size is whatever FitRowsDirective
  // measures fits the row viewport (initial value only covers the first paint
  // before the directive's AfterViewInit measurement lands).
  readonly pageSize = signal(6);
  readonly pageIndex = signal(0);

  /** The current page of rows (transactions-style pagination). */
  readonly pagedRows = computed(() => {
    const all = this.rows();
    const size = this.pageSize();
    const maxPage = Math.max(0, Math.ceil(all.length / size) - 1);
    const page = Math.min(this.pageIndex(), maxPage);
    return all.slice(page * size, page * size + size);
  });

  /**
   * New measured fit (reflow, resize, first measurement): adopt it as the
   * page size and keep the user on the page containing the previously first
   * visible row instead of resetting to page 0.
   */
  onFitRows(fit: number): void {
    const oldSize = this.pageSize();
    if (fit === oldSize) return;
    const firstVisibleIndex = this.pageIndex() * oldSize;
    this.pageSize.set(fit);
    this.pageIndex.set(Math.floor(firstVisibleIndex / fit));
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
  }
}
