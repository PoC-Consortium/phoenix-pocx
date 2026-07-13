import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
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
   * Address reuse — this address received funds in more than one
   * transaction (a privacy concern: reuse links transactions together).
   */
  reused: boolean;
}

/**
 * Aggregate raw coins into per-address rows: group by address, sum amounts,
 * count coins, carry the change flag, derive the reuse flag. Sorted receive
 * addresses first, then change; within each group, balance descending.
 */
export function aggregateCoins(coins: WalletCoin[]): AddressBalance[] {
  const byAddress = new Map<string, AddressBalance>();
  for (const c of coins) {
    const existing = byAddress.get(c.address);
    if (existing) {
      existing.balanceBtc += c.amount;
      existing.coinCount += 1;
      existing.reused ||= c.reused === true;
    } else {
      byAddress.set(c.address, {
        address: c.address,
        balanceBtc: c.amount,
        coinCount: 1,
        isChange: c.isChange,
        reused: c.reused === true,
      });
    }
  }
  // Finalise reuse per address. Core sets `reused` per-coin accurately from
  // listreceivedbyaddress (which also catches reuse where only one UTXO
  // remains). Remote/BDK has no spend history, so `coinCount > 1` is the
  // proxy: an address holding multiple UTXOs was received-to more than once.
  for (const row of byAddress.values()) {
    row.reused = row.reused || row.coinCount > 1;
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
 * address: the address, its balance, a coin count, and an amber "Reused" flag
 * when the address was paid more than once. No receive/change labels — that
 * keychain distinction confuses more than it helps (a payment received to a
 * change address reads as "Change", reinforcing the very panic this defuses).
 * Purely informational — no warnings/modals.
 */
@Component({
  selector: 'app-address-coins-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
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
      <div class="coins-rows">
        @for (row of rows(); track row.address) {
          <div class="coin-row">
            <div class="coin-row-main">
              <app-address-display [address]="row.address" [showCopyButton]="true" />
              <div class="coin-tags">
                <span class="coin-count">{{
                  'coin_count' | i18n: { count: row.coinCount }
                }}</span>
                @if (row.reused) {
                  <span class="reused-chip" [matTooltip]="'address_reused_hint' | i18n">
                    <mat-icon class="reused-icon">warning_amber</mat-icon>
                    {{ 'address_reused' | i18n }}
                  </span>
                }
              </div>
            </div>
            <div class="coin-balance">
              <span class="amount">{{ row.balanceBtc | btcx }}</span>
              <span class="unit">BTCX</span>
            </div>
          </div>
        }
      </div>
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

      .coins-rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .coin-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        background: #f5f7fa;
        border-radius: 8px;
      }

      .coin-row-main {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        flex: 1;
      }

      .coin-tags {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }

      /* Subtle neutral tag, change addresses only. Receive addresses (the
         normal case) carry no keychain tag. */
      .kind-chip {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 2px 8px;
        border-radius: 10px;
        cursor: default;
        background: rgba(120, 120, 120, 0.16);
        color: #607080;
      }

      .coin-count {
        font-size: 12px;
        color: #7a8896;
      }

      /* Amber privacy flag — the address was received-to more than once. */
      .reused-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px 2px 5px;
        border-radius: 10px;
        background: rgba(176, 122, 0, 0.12);
        color: #a06a00;
        cursor: default;

        .reused-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }

      .coin-balance {
        display: flex;
        align-items: baseline;
        gap: 4px;
        flex-shrink: 0;
        white-space: nowrap;

        .amount {
          font-family: monospace;
          font-size: 15px;
          font-weight: 600;
          color: #002341;
        }

        .unit {
          font-size: 11px;
          color: #8a97a4;
        }
      }

      :host-context(.dark-theme) {
        .coins-intro {
          color: #9fb0bf;
        }

        .coin-row {
          background: #333;
        }

        .coin-count {
          color: #9aa7b3;
        }

        .coin-balance .amount {
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
}
