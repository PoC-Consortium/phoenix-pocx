import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../../core/i18n';
import { HashTruncatePipe } from '../../../../shared/pipes';
import { ClipboardService } from '../../../../shared/services';
import { BlockExplorerService } from '../../../../shared/services/block-explorer.service';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';

/** Rows added per "load more" tap (and shown initially). */
const PAGE_SIZE = 25;

/**
 * WalletHistoryComponent - transaction list (newest first).
 *
 * Incrementally paged (25 rows + "load more"). Each row shows the display
 * address (counterparty on sends, own receive address otherwise) and has a
 * per-item menu: copy txid, copy address, open in the block explorer.
 * Refresh pokes the background sync worker (sync_now) and re-reads the
 * cached history. Tapping an item expands a simple detail: txid with
 * copy, address, fee, vsize.
 */
@Component({
  selector: 'app-wallet-history',
  standalone: true,
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DatePipe,
    DecimalPipe,
    HashTruncatePipe,
    I18nPipe,
  ],
  template: `
    <div class="page">
      <div class="header-row">
        <button mat-icon-button routerLink="/wallet">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h2>{{ 'mwallet_history_title' | i18n }}</h2>
        <span class="spacer"></span>
        <button
          mat-icon-button
          [disabled]="refreshing()"
          (click)="refresh()"
          [matTooltip]="'refresh' | i18n"
        >
          <mat-icon [class.spinning]="refreshing()">refresh</mat-icon>
        </button>
      </div>

      <div class="card list-card">
        @if (wallet.transactions().length === 0) {
          <div class="empty-state">
            <mat-icon>receipt_long</mat-icon>
            <span>{{ 'no_transactions' | i18n }}</span>
          </div>
        } @else {
          @for (tx of visibleTransactions(); track tx.txid) {
            <div class="tx-item" (click)="toggleDetail(tx)">
              <div class="tx-row">
                <mat-icon
                  class="tx-icon"
                  [class.received]="tx.direction === 'received'"
                  [class.sent]="tx.direction === 'sent'"
                >
                  {{ tx.direction === 'received' ? 'arrow_downward' : 'arrow_upward' }}
                </mat-icon>

                <div class="tx-main">
                  <span class="tx-direction">
                    {{ (tx.direction === 'received' ? 'mwallet_received' : 'mwallet_sent') | i18n }}
                  </span>
                  @if (tx.address) {
                    <span class="tx-address mono">{{ tx.address | hashTruncate: 12 : 6 }}</span>
                  }
                  <span class="tx-time">
                    @if (tx.timestamp) {
                      {{ tx.timestamp * 1000 | date: 'short' }}
                    }
                  </span>
                </div>

                <div class="tx-right">
                  <span
                    class="tx-amount"
                    [class.received]="tx.direction === 'received'"
                    [class.sent]="tx.direction === 'sent'"
                  >
                    {{ tx.direction === 'received' ? '+' : '-'
                    }}{{ tx.amountSat / 100000000 | number: '1.8-8' }}
                  </span>
                  <span class="tx-conf" [class.unconfirmed]="tx.confirmations === 0">
                    @if (tx.confirmations === 0) {
                      {{ 'mwallet_unconfirmed' | i18n }}
                    } @else {
                      {{ 'mwallet_confirmations_n' | i18n: { count: tx.confirmations } }}
                    }
                  </span>
                </div>

                <button
                  mat-icon-button
                  class="tx-menu-button"
                  [matMenuTriggerFor]="txMenu"
                  (click)="$event.stopPropagation()"
                >
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #txMenu="matMenu">
                  <button mat-menu-item (click)="copyTxid(tx.txid)">
                    <mat-icon>content_copy</mat-icon>
                    <span>{{ 'copy_transaction_id' | i18n }}</span>
                  </button>
                  @if (tx.address) {
                    <button mat-menu-item (click)="copyAddress(tx.address)">
                      <mat-icon>content_copy</mat-icon>
                      <span>{{ 'copy_address' | i18n }}</span>
                    </button>
                  }
                  <button mat-menu-item (click)="openInExplorer(tx.txid)">
                    <mat-icon>open_in_new</mat-icon>
                    <span>{{ 'view_in_explorer' | i18n }}</span>
                  </button>
                </mat-menu>
              </div>

              @if (expandedTxid() === tx.txid) {
                <div class="tx-detail">
                  <div class="detail-line">
                    <span class="detail-label">{{ 'transaction_id' | i18n }}</span>
                    <div
                      class="detail-value copyable"
                      (click)="copyTxid(tx.txid); $event.stopPropagation()"
                      [matTooltip]="'copy' | i18n"
                    >
                      <span class="mono">{{ tx.txid }}</span>
                      <mat-icon class="copy-icon">content_copy</mat-icon>
                    </div>
                  </div>
                  @if (tx.address) {
                    <div class="detail-line">
                      <span class="detail-label">{{ 'address' | i18n }}</span>
                      <div
                        class="detail-value copyable"
                        (click)="copyAddress(tx.address); $event.stopPropagation()"
                        [matTooltip]="'copy' | i18n"
                      >
                        <span class="mono">{{ tx.address }}</span>
                        <mat-icon class="copy-icon">content_copy</mat-icon>
                      </div>
                    </div>
                  }
                  @if (tx.feeSat !== null) {
                    <div class="detail-line">
                      <span class="detail-label">{{ 'fee' | i18n }}</span>
                      <span class="detail-value mono">{{ tx.feeSat }} sat ({{ tx.vsize }} vB)</span>
                    </div>
                  }
                </div>
              }
            </div>
          }

          @if (hasMore()) {
            <div class="load-more-row">
              <button mat-button (click)="loadMore()">
                <mat-icon>expand_more</mat-icon>
                {{ 'mwallet_load_more' | i18n }}
              </button>
            </div>
          }
        }
      </div>
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

      .header-row {
        display: flex;
        align-items: center;
        gap: 8px;

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 500;
        }

        .spacer {
          flex: 1;
        }
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

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .list-card {
        padding: 4px 0;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 32px 0;
        color: rgba(0, 0, 0, 0.38);

        mat-icon {
          font-size: 40px;
          width: 40px;
          height: 40px;
          margin-bottom: 8px;
        }

        span {
          font-size: 13px;
        }
      }

      .tx-item {
        padding: 10px 8px 10px 16px;
        cursor: pointer;

        &:not(:last-child) {
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }
      }

      .tx-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .tx-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        flex-shrink: 0;

        &.received {
          color: #4caf50;
        }

        &.sent {
          color: #1976d2;
        }
      }

      .tx-main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;

        .tx-direction {
          font-size: 14px;
        }

        .tx-address {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.6);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tx-time {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.5);
        }
      }

      .tx-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;

        .tx-amount {
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          font-family: monospace;

          &.received {
            color: #2e7d32;
          }
        }

        .tx-conf {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.5);

          &.unconfirmed {
            color: #e65100;
          }
        }
      }

      .tx-menu-button {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        padding: 6px;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: rgba(0, 0, 0, 0.45);
        }
      }

      .load-more-row {
        display: flex;
        justify-content: center;
        padding: 4px 0;
        border-top: 1px solid rgba(0, 0, 0, 0.06);
      }

      .tx-detail {
        margin-top: 8px;
        padding: 8px 8px 4px 32px;
        border-top: 1px dashed rgba(0, 0, 0, 0.08);
      }

      .detail-line {
        margin-bottom: 8px;

        .detail-label {
          display: block;
          font-size: 10px;
          font-weight: 600;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }

        .detail-value {
          font-size: 12px;

          &.copyable {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;

            .copy-icon {
              font-size: 16px;
              width: 16px;
              height: 16px;
              color: #1976d2;
              flex-shrink: 0;
            }
          }
        }

        .mono {
          font-family: monospace;
          word-break: break-all;
        }
      }

      .mono {
        font-family: monospace;
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .empty-state {
          color: rgba(255, 255, 255, 0.38);
        }

        .tx-item:not(:last-child) {
          border-bottom-color: rgba(255, 255, 255, 0.08);
        }

        .tx-main .tx-address {
          color: rgba(255, 255, 255, 0.6);
        }

        .tx-main .tx-time,
        .tx-right .tx-conf {
          color: rgba(255, 255, 255, 0.5);
        }

        .tx-menu-button mat-icon {
          color: rgba(255, 255, 255, 0.55);
        }

        .tx-right .tx-amount.received {
          color: #81c784;
        }

        .load-more-row {
          border-top-color: rgba(255, 255, 255, 0.08);
        }

        .tx-detail {
          border-top-color: rgba(255, 255, 255, 0.12);
        }
      }
    `,
  ],
})
export class WalletHistoryComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly clipboard = inject(ClipboardService);
  private readonly explorer = inject(BlockExplorerService);

  readonly refreshing = signal(false);
  readonly expandedTxid = signal<string | null>(null);
  readonly visibleCount = signal(PAGE_SIZE);

  readonly visibleTransactions = computed(() =>
    this.wallet.transactions().slice(0, this.visibleCount())
  );
  readonly hasMore = computed(() => this.wallet.transactions().length > this.visibleCount());

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    await this.wallet.initialize();
    if (this.wallet.walletActive()) {
      await this.wallet.refreshTransactions();
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    try {
      await this.wallet.syncNow();
      await this.wallet.refreshTransactions();
    } finally {
      this.refreshing.set(false);
    }
  }

  loadMore(): void {
    this.visibleCount.update(count => count + PAGE_SIZE);
  }

  toggleDetail(tx: BtcxWalletTx): void {
    this.expandedTxid.set(this.expandedTxid() === tx.txid ? null : tx.txid);
  }

  openInExplorer(txid: string): void {
    this.explorer.openTransaction(txid, this.wallet.network());
  }

  async copyTxid(txid: string): Promise<void> {
    await this.clipboard.copyTxid(txid);
  }

  async copyAddress(address: string): Promise<void> {
    await this.clipboard.copyAddress(address);
  }
}
