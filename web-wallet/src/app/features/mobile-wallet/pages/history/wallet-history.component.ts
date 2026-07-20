import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { downloadTextFile } from '../../../../shared/utils/download';
import { ContactsStoreService } from '../../../../shared/services';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';
import { TxRowComponent } from '../../components/tx-row/tx-row.component';
import { FitRowsDirective } from '../../../../shared/directives';
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
 * and re-reads the current page. Tapping an item just selects it (a
 * visual highlight, no expand/detail) — copy/send/add-contact live in the
 * row's own action menu.
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
        [disabled]="exporting() || wallet.transactionsTotal() === 0"
        (click)="exportCsv()"
        [matTooltip]="'export_csv' | i18n"
      >
        <mat-icon>file_download</mat-icon>
      </button>
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
            [fitRowSelector]="'.tx-item'"
            [fitMinRows]="3"
            (fitRows)="onFitRows($event)"
          >
            @for (tx of visibleTransactions(); track tx.txid) {
              <div
                class="tx-item"
                [class.selected]="selectedTxid() === tx.txid"
                (click)="selectTx(tx)"
              >
                <app-mwallet-tx-row [tx]="tx" />
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
         The fit-sized page never scrolls. */
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

        /* Visual selection only (no expand/detail behind it). */
        &.selected {
          background: rgba(30, 58, 95, 0.08);
        }
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

          &.selected {
            background: rgba(255, 255, 255, 0.06);
          }
        }
      }
    `,
  ],
})
export class WalletHistoryComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly contactsStore = inject(ContactsStoreService);
  private readonly i18n = inject(I18nService);

  readonly refreshing = signal(false);
  readonly exporting = signal(false);
  readonly selectedTxid = signal<string | null>(null);

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
   * Export the FULL transaction history as a CSV download. Uses
   * `fetchTransactionsPage()` (no args = all rows) so the paged UI window is
   * left untouched. ISO-8601 UTC timestamps; amounts are signed by direction
   * with a dot decimal, independent of locale.
   */
  async exportCsv(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const { items } = await this.wallet.fetchTransactionsPage();
      const headers = [
        this.i18n.get('date'),
        this.i18n.get('type'),
        this.i18n.get('amount'),
        this.i18n.get('fee'),
        this.i18n.get('confirmations'),
        this.i18n.get('transaction_id'),
        this.i18n.get('address'),
      ];
      const rows = items.map(tx => [
        tx.timestamp != null ? new Date(tx.timestamp * 1000).toISOString() : '',
        this.i18n.get(tx.direction === 'received' ? 'tx_type_receive' : 'tx_type_send'),
        (tx.direction === 'sent' ? '-' : '') + (tx.amountSat / 100000000).toFixed(8),
        tx.feeSat != null ? (tx.feeSat / 100000000).toFixed(8) : '',
        tx.confirmations,
        tx.txid,
        tx.address ?? '',
      ]);
      const csv = [headers, ...rows].map(r => r.map(c => this.csvCell(c)).join(',')).join('\r\n');
      await downloadTextFile('transactions.csv', csv);
    } catch (err) {
      console.error('Failed to export transactions:', err);
    } finally {
      this.exporting.set(false);
    }
  }

  /** Quote a CSV cell if it contains a comma, quote or newline (RFC 4180). */
  private csvCell(value: string | number): string {
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
    this.selectedTxid.set(null);
  }

  selectTx(tx: BtcxWalletTx): void {
    // Visual selection only — no expand/detail behind it.
    this.selectedTxid.set(this.selectedTxid() === tx.txid ? null : tx.txid);
  }
}
