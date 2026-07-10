import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService, ContactsStoreService } from '../../../../shared/services';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';
import { TxRowComponent } from '../../components/tx-row/tx-row.component';

/** Desktop transaction-list page sizes, defaulting to the mobile-sensible 25. */
const PAGE_SIZE = 25;

/**
 * WalletHistoryComponent - transaction list (newest first).
 *
 * Rows are the shared mobile TxRowComponent (same row the home preview
 * renders, including the per-row menu). Pagination mirrors the desktop
 * transaction-list: a mat-paginator with page-size options and first/last
 * buttons over a client-side slice, instead of the former "load more"
 * button. Refresh pokes the background sync worker (sync_now) and
 * re-reads the cached history. Tapping an item expands a simple detail:
 * txid with copy, address, fee, vsize.
 */
@Component({
  selector: 'app-wallet-history',
  standalone: true,
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatTooltipModule,
    I18nPipe,
    TxRowComponent,
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
              <app-mwallet-tx-row [tx]="tx" />

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

          <!-- Desktop transaction-list pagination, scaled to mobile -->
          <mat-paginator
            [length]="wallet.transactions().length"
            [pageSize]="pageSize()"
            [pageIndex]="pageIndex()"
            [pageSizeOptions]="pageSizeOptions"
            (page)="onPageChange($event)"
            [showFirstLastButtons]="true"
          >
          </mat-paginator>
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
        padding: 4px 0 0;
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

        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      }

      /* Compact paginator (the desktop transaction-list pager, mobile-sized). */
      mat-paginator {
        border-radius: 0 0 8px 8px;

        ::ng-deep .mat-mdc-paginator-container {
          min-height: 44px;
          padding: 0 4px;
          justify-content: center;
        }

        ::ng-deep .mat-mdc-paginator-page-size {
          margin-right: 4px;
        }

        ::ng-deep .mat-mdc-paginator-page-size-label,
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

        .tx-item {
          border-bottom-color: rgba(255, 255, 255, 0.08);
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
  private readonly contactsStore = inject(ContactsStoreService);

  readonly refreshing = signal(false);
  readonly expandedTxid = signal<string | null>(null);

  // Desktop transaction-list pagination state (client-side slicing).
  readonly pageSize = signal(PAGE_SIZE);
  readonly pageIndex = signal(0);
  readonly pageSizeOptions = [10, 25, 50];

  readonly visibleTransactions = computed(() => {
    const txs = this.wallet.transactions();
    // Clamp: a refresh can shrink the list below the current page.
    const lastPage = Math.max(0, Math.ceil(txs.length / this.pageSize()) - 1);
    const page = Math.min(this.pageIndex(), lastPage);
    const start = page * this.pageSize();
    return txs.slice(start, start + this.pageSize());
  });

  ngOnInit(): void {
    // Fresh contacts book for the row menu's "add to contact" visibility.
    this.contactsStore.load();
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

  onPageChange(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
    this.expandedTxid.set(null);
  }

  toggleDetail(tx: BtcxWalletTx): void {
    this.expandedTxid.set(this.expandedTxid() === tx.txid ? null : tx.txid);
  }

  async copyTxid(txid: string): Promise<void> {
    await this.clipboard.copyTxid(txid);
  }

  async copyAddress(address: string): Promise<void> {
    await this.clipboard.copyAddress(address);
  }
}
