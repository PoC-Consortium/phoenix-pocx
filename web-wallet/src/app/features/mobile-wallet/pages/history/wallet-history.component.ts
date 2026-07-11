import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService, ContactsStoreService } from '../../../../shared/services';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';
import { TxRowComponent } from '../../components/tx-row/tx-row.component';
import { FitRowsDirective } from '../../fit-rows.directive';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';

/**
 * WalletHistoryComponent - transaction list (newest first).
 *
 * Rows are the shared mobile TxRowComponent (same row the home preview
 * renders, including the per-row menu). Pagination mirrors the desktop
 * transaction-list's mat-paginator (first/last buttons), but the page size
 * is not chosen from a dropdown: the list card flex-fills the viewport and
 * the shared FitRowsDirective (the home page's recent-list fill, round 6)
 * derives how many rows fit without scrolling — that fit IS the page size,
 * recomputed on resize/rotation. When the fit changes, the pager stays on
 * the page containing the previously first visible transaction.
 *
 * Fat-wallet rule (round 8): each page is fetched from the backend with
 * `refreshTransactions(pageSize, offset)` — only the visible slice ever
 * crosses IPC, the paginator length comes from `transactionsTotal`, and
 * sync ticks re-request the same current page through the service's
 * remembered window. Refresh pokes the background sync worker (sync_now)
 * and re-reads the current page. Tapping an item expands a simple detail:
 * txid with copy, address, fee, vsize (the list scrolls the few
 * overflowing pixels while a detail is open) — all from data already in
 * the row.
 */
@Component({
  selector: 'app-wallet-history',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatTooltipModule,
    I18nPipe,
    TxRowComponent,
    FitRowsDirective,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="transactions">
      <button
        mat-icon-button
        [disabled]="refreshing()"
        (click)="refresh()"
        [matTooltip]="'refresh' | i18n"
      >
        <mat-icon [class.spinning]="refreshing()">refresh</mat-icon>
      </button>
    </app-mwallet-page-header>

    <div class="page">
      <div class="card list-card">
        @if (wallet.transactionsTotal() === 0) {
          <div class="empty-state">
            <mat-icon>receipt_long</mat-icon>
            <span>{{ 'no_transactions' | i18n }}</span>
          </div>
        } @else {
          <div
            class="tx-list"
            appFitRows
            [fitRowSelector]="'.tx-item:not(:has(.tx-detail))'"
            [fitMinRows]="3"
            (fitRows)="onFitRows($event)"
          >
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
                        <span class="detail-value mono"
                          >{{ tx.feeSat }} sat ({{ tx.vsize }} vB)</span
                        >
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>

          <!-- Desktop transaction-list pagination; the page size is the
               measured fit, so there is no size dropdown. -->
          <mat-paginator
            [length]="wallet.transactionsTotal()"
            [pageSize]="pageSize()"
            [pageIndex]="pageIndex()"
            [hidePageSize]="true"
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
      /* Fill the wallet-content column so the list card can flex into the
         leftover viewport height (same fill idiom as the home page). */
      :host {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .page {
        padding: 16px;
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        gap: 16px;
        max-width: 480px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
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

      /* Flex-fill: basis 0 so the card's height comes from the leftover
         viewport space (never from its own rows); the min-height floor
         keeps ~3 rows readable on tiny viewports (the page then scrolls
         slightly instead). */
      .list-card {
        padding: 4px 0 0;
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 280px;
        overflow: hidden;
      }

      /* The measured row viewport: exactly the space between card top and
         paginator (basis 0: its height never depends on its own rows).
         Steady-state the fit-sized page never scrolls; an expanded detail
         scrolls its extra height here. */
      .tx-list {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
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

  // Fit-derived pagination: the page size is whatever FitRowsDirective
  // measures (initial value only covers the first paint before AfterViewInit).
  readonly pageSize = signal(8);
  readonly pageIndex = signal(0);

  /**
   * The service's transaction window IS the current page (the history
   * fetches per page — only the visible slice crosses IPC). The defensive
   * slice covers the transient where another page's window (e.g. the
   * home's recent list) is still in the signal.
   */
  readonly visibleTransactions = computed(() =>
    this.wallet.transactions().slice(0, this.pageSize())
  );

  ngOnInit(): void {
    // Fresh contacts book for the row menu's "add to contact" visibility.
    this.contactsStore.load();
    void this.init();
  }

  private async init(): Promise<void> {
    await this.wallet.initialize();
    if (this.wallet.walletActive()) {
      await this.loadPage(this.pageIndex());
    }
  }

  /**
   * Fetch one fit-sized page from the backend and clamp: a refresh can
   * shrink the history below the requested page — then re-request the
   * last page that still exists. The service remembers the window, so
   * sync ticks keep this page fresh without another explicit fetch.
   */
  private async loadPage(index: number): Promise<void> {
    const size = this.pageSize();
    await this.wallet.refreshTransactions(size, index * size);
    const lastPage = Math.max(0, Math.ceil(this.wallet.transactionsTotal() / size) - 1);
    if (index > lastPage) {
      index = lastPage;
      await this.wallet.refreshTransactions(size, index * size);
    }
    this.pageIndex.set(index);
  }

  async refresh(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    try {
      await this.wallet.syncNow();
      await this.loadPage(this.pageIndex());
    } finally {
      this.refreshing.set(false);
    }
  }

  /**
   * New measured fit (rotation, resize, first measurement): adopt it as
   * the page size and keep the user on the page that contains the
   * previously first visible transaction (cheap: one division) instead
   * of resetting to page 0.
   */
  onFitRows(fit: number): void {
    const oldSize = this.pageSize();
    if (fit === oldSize) return;
    const firstVisibleIndex = this.pageIndex() * oldSize;
    this.pageSize.set(fit);
    void this.loadPage(Math.floor(firstVisibleIndex / fit));
  }

  onPageChange(event: PageEvent): void {
    void this.loadPage(event.pageIndex);
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
