import { Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { takeUntil, skip } from 'rxjs/operators';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService, BlockExplorerService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import {
  WalletRpcService,
  WalletTransaction,
} from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import {
  FeeBumpDialogComponent,
  FeeBumpDialogData,
  FeeBumpDialogResult,
} from '../../components/fee-bump-dialog/fee-bump-dialog.component';

type TransactionFilter = 'all' | 'send' | 'receive' | 'immature' | 'generate';

/**
 * TransactionListComponent displays all wallet transactions with filtering.
 *
 * Features:
 * - Filter by type (all, send, receive, pending)
 * - Search by address/txid
 * - Pagination
 * - Click to view details
 */
@Component({
  selector: 'app-transaction-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatPaginatorModule,
    MatMenuModule,
    MatTooltipModule,
    MatDatepickerModule,
    MatNativeDateModule,
    I18nPipe,
  ],
  template: `
    <div class="page-layout">
      <!-- Header with gradient background -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'transactions' | i18n }}</h1>
        </div>
        <div class="header-right">
          <!-- Load Limit -->
          <mat-form-field appearance="outline" class="limit-field">
            <mat-label>{{ 'load_limit' | i18n }}</mat-label>
            <mat-select [(value)]="loadLimit" (selectionChange)="onLoadLimitChange()">
              @for (option of loadLimitOptions; track option.value) {
                <mat-option [value]="option.value">{{ option.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <!-- Refresh Button -->
          <button
            mat-icon-button
            [disabled]="loading()"
            (click)="loadTransactions()"
            [matTooltip]="'refresh' | i18n"
            class="refresh-button"
          >
            <mat-icon>refresh</mat-icon>
          </button>
        </div>
      </div>

      <!-- Filter Row -->
      <div class="filter-row">
        <!-- Search -->
        <mat-form-field appearance="outline" class="search-field">
          <mat-label>{{ 'search' | i18n }}</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            [(ngModel)]="searchQuery"
            [placeholder]="'search_transactions' | i18n"
            (ngModelChange)="applyFilters()"
          />
          @if (searchQuery) {
            <button mat-icon-button matSuffix (click)="clearSearch()">
              <mat-icon>close</mat-icon>
            </button>
          }
        </mat-form-field>

        <!-- Type Selection -->
        <mat-form-field appearance="outline" class="type-field">
          <mat-label>{{ 'type' | i18n }}</mat-label>
          <mat-select [(value)]="selectedType" (selectionChange)="setFilter($event.value)">
            @for (filter of filterOptions; track filter.value) {
              <mat-option [value]="filter.value">
                {{ filter.label | i18n }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        <!-- Date From -->
        <mat-form-field appearance="outline" class="date-field">
          <mat-label>{{ 'from' | i18n }}</mat-label>
          <input
            matInput
            [matDatepicker]="fromPicker"
            [(ngModel)]="dateFrom"
            (dateChange)="applyFilters()"
          />
          <mat-datepicker-toggle matIconSuffix [for]="fromPicker"></mat-datepicker-toggle>
          <mat-datepicker #fromPicker></mat-datepicker>
        </mat-form-field>

        <!-- Date To -->
        <mat-form-field appearance="outline" class="date-field">
          <mat-label>{{ 'to' | i18n }}</mat-label>
          <input
            matInput
            [matDatepicker]="toPicker"
            [(ngModel)]="dateTo"
            (dateChange)="applyFilters()"
          />
          <mat-datepicker-toggle matIconSuffix [for]="toPicker"></mat-datepicker-toggle>
          <mat-datepicker #toPicker></mat-datepicker>
        </mat-form-field>

        <!-- Reset Button -->
        <button mat-stroked-button class="reset-button" (click)="resetFilters()">
          {{ 'reset' | i18n }}
        </button>
      </div>

      <!-- Transaction Count Info Row -->
      @if (!loading() && transactions().length > 0) {
        <div class="info-row">
          <span class="tx-count">
            {{ filteredTransactions().length }} {{ 'transactions' | i18n }}
            @if (oldestTransactionDate()) {
              ({{ 'since' | i18n }} {{ oldestTransactionDate() | date: 'mediumDate' }})
            }
          </span>
        </div>
      }

      <!-- Content Card -->
      <mat-card class="transactions-card">
        <mat-card-content>
          @if (loading() && transactions().length === 0) {
            <div class="loading-state">
              <mat-spinner diameter="24"></mat-spinner>
              <span>{{ 'loading_transactions' | i18n }}</span>
            </div>
          } @else if (filteredTransactions().length === 0) {
            <div class="empty-state">
              <mat-icon>receipt_long</mat-icon>
              <p>
                {{ searchQuery ? ('no_matching_transactions' | i18n) : ('no_transactions' | i18n) }}
              </p>
            </div>
          } @else {
            <div class="transactions-table-container">
              <table class="transactions-table">
                <thead>
                  <tr>
                    <th class="col-datetime">{{ 'date' | i18n }}</th>
                    <th class="col-type">{{ 'type' | i18n }}</th>
                    <th class="col-amount">{{ 'amount' | i18n }}</th>
                    <th class="col-account">{{ 'account' | i18n }}</th>
                    <th class="col-status">{{ 'status' | i18n }}</th>
                    <th class="col-txid">{{ 'transaction_id' | i18n }}</th>
                    <th class="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (tx of paginatedTransactions(); track tx.txid) {
                    <tr class="tx-row" [class.unconfirmed]="tx.confirmations === 0">
                      <td class="col-datetime">
                        <div class="datetime-stack">
                          <span class="date">{{ formatTxDate(tx) }}</span>
                          <span class="time">{{ formatTxTime(tx) }}</span>
                        </div>
                      </td>
                      <td class="col-type">
                        <span class="type-badge">{{ getTransactionType(tx) }}</span>
                      </td>
                      <td class="col-amount">
                        <span class="amount-badge">{{ formatTransactionAmount(tx) }}</span>
                      </td>
                      <td class="col-account">
                        <span class="account-label">{{ getAccountLabel(tx) }}</span>
                        <span class="address-text">{{ tx.address || '-' }}</span>
                      </td>
                      <td class="col-status">
                        <span class="status-badge">{{ getConfirmationStatus(tx) }}</span>
                      </td>
                      <td class="col-txid">
                        <span
                          class="txid-text"
                          (click)="viewTransactionDetails(tx)"
                          [matTooltip]="'view_details' | i18n"
                          >{{ tx.txid }}</span
                        >
                      </td>
                      <td class="col-actions">
                        <button
                          mat-icon-button
                          [matMenuTriggerFor]="txMenu"
                          aria-label="More Actions"
                        >
                          <mat-icon>more_vert</mat-icon>
                        </button>
                        <mat-menu #txMenu="matMenu">
                          <button mat-menu-item (click)="copyToClipboard(tx.txid)">
                            <mat-icon>file_copy</mat-icon>
                            <span>{{ 'copy_transaction_id' | i18n }}</span>
                          </button>
                          @if (tx.address) {
                            <button mat-menu-item (click)="copyToClipboard(tx.address)">
                              <mat-icon>file_copy</mat-icon>
                              <span>{{ 'copy_address' | i18n }}</span>
                            </button>
                          }
                          <mat-divider></mat-divider>
                          <button mat-menu-item (click)="openTransactionInExplorer(tx.txid)">
                            <mat-icon>open_in_new</mat-icon>
                            <span>{{ 'view_tx_in_explorer' | i18n }}</span>
                          </button>
                          @if (tx.address) {
                            <button mat-menu-item (click)="openAddressInExplorer(tx.address)">
                              <mat-icon>open_in_new</mat-icon>
                              <span>{{ 'view_address_in_explorer' | i18n }}</span>
                            </button>
                          }
                          <button mat-menu-item (click)="viewTransactionDetails(tx)">
                            <mat-icon>info</mat-icon>
                            <span>{{ 'transaction_details' | i18n }}</span>
                          </button>
                          @if (tx.address) {
                            <mat-divider></mat-divider>
                            <button mat-menu-item (click)="sendToAddress(tx.address)">
                              <mat-icon>send</mat-icon>
                              <span>{{ 'send_to_address' | i18n }}</span>
                            </button>
                            <button mat-menu-item (click)="addToContacts(tx)">
                              <mat-icon>person_add</mat-icon>
                              <span>{{ 'add_to_contacts' | i18n }}</span>
                            </button>
                          }
                          @if (
                            tx.confirmations === 0 &&
                            tx.bip125_replaceable === 'yes' &&
                            tx.category === 'send'
                          ) {
                            <mat-divider></mat-divider>
                            <button mat-menu-item (click)="openBumpFeeDialog(tx)">
                              <mat-icon>speed</mat-icon>
                              <span>{{ 'bump_fee' | i18n }}</span>
                            </button>
                          }
                        </mat-menu>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <mat-paginator
              [length]="filteredTransactions().length"
              [pageSize]="pageSize()"
              [pageIndex]="pageIndex()"
              [pageSizeOptions]="pageSizeOptions"
              (page)="onPageChange($event)"
              [showFirstLastButtons]="true"
            >
            </mat-paginator>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .page-layout {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
        background: #eaf0f6;
      }

      /* Header - gradient background */
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        padding: 16px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 12px;

        .back-button {
          color: white;
        }

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 300;
          color: white;
        }
      }

      .header-right {
        display: flex;
        align-items: center;
        gap: 12px;

        .limit-field {
          width: 140px;

          ::ng-deep {
            .mat-mdc-text-field-wrapper {
              background: rgba(255, 255, 255, 0.1);
              padding: 0 12px;
            }

            .mdc-notched-outline__leading,
            .mdc-notched-outline__notch,
            .mdc-notched-outline__trailing {
              border-color: rgba(255, 255, 255, 0.3) !important;
            }

            .mat-mdc-form-field-flex {
              height: 40px;
              align-items: center;
            }

            .mat-mdc-form-field-infix {
              padding: 0;
              min-height: 40px;
              display: flex;
              align-items: center;
            }

            .mat-mdc-select-value,
            .mat-mdc-select-arrow,
            .mdc-floating-label {
              color: white !important;
            }

            .mdc-floating-label {
              top: 50% !important;
              transform: translateY(-50%) !important;
            }

            .mdc-floating-label--float-above {
              top: 0 !important;
              transform: translateY(-50%) scale(0.75) !important;
            }

            .mat-mdc-form-field-subscript-wrapper {
              display: none;
            }
          }
        }

        .refresh-button {
          color: white;

          &:disabled {
            color: rgba(255, 255, 255, 0.5);
          }
        }
      }

      /* Filter Row */
      .filter-row {
        background: white;
        padding: 16px 24px;
        margin-top: 1px;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        border-bottom: 1px solid #e0e0e0;

        .search-field {
          flex: 1;
          min-width: 200px;
          max-width: 300px;

          /* Shift label to account for search icon */
          ::ng-deep .mdc-floating-label:not(.mdc-floating-label--float-above) {
            left: 36px !important;
          }
        }

        .type-field {
          width: 150px;
        }

        .date-field {
          width: 150px;
        }

        .reset-button {
          height: 40px;
        }

        mat-form-field {
          ::ng-deep {
            .mat-mdc-form-field-subscript-wrapper {
              display: none;
            }

            .mat-mdc-text-field-wrapper {
              padding: 0 12px;
            }

            .mat-mdc-form-field-flex {
              height: 40px;
              align-items: center;
            }

            .mat-mdc-form-field-infix {
              padding: 8px 0;
              min-height: 40px;
              width: auto;
            }

            .mat-mdc-form-field-icon-prefix {
              padding: 0 8px 0 0;
            }

            /* Label when field is empty - centered vertically */
            .mdc-floating-label {
              top: 50% !important;
              transform: translateY(-50%) !important;
            }

            /* Label when field has value - sits on top border */
            .mdc-floating-label--float-above {
              top: 0 !important;
              transform: translateY(-50%) scale(0.75) !important;
            }
          }
        }
      }

      /* Transactions Card */
      .transactions-card {
        margin: 16px;
        background: #ffffff !important;
        border-radius: 8px;
        overflow: hidden;

        mat-card-content {
          padding: 16px 16px 0 16px !important;
        }

        mat-paginator {
          background: transparent;
          margin-top: 0;

          ::ng-deep {
            .mat-mdc-paginator-container {
              color: #888888;
              min-height: 40px;
              padding: 0;
              align-items: center;
            }

            .mat-mdc-paginator-page-size {
              align-items: center;
            }

            .mat-mdc-paginator-page-size-label,
            .mat-mdc-paginator-range-label {
              color: #888888;
              font-size: 12px;
            }

            .mat-mdc-paginator-page-size-select {
              width: 56px;
              margin: 0 4px;

              .mat-mdc-text-field-wrapper {
                padding: 0 4px;

                .mat-mdc-form-field-flex {
                  height: 32px;
                  align-items: center;
                }

                .mdc-notched-outline__leading,
                .mdc-notched-outline__notch,
                .mdc-notched-outline__trailing {
                  border: none !important;
                }

                .mat-mdc-form-field-infix {
                  padding: 0;
                  min-height: 32px;
                  display: flex;
                  align-items: center;
                }
              }
            }

            .mat-mdc-select-value,
            .mat-mdc-select-arrow {
              color: #666666 !important;
            }

            .mat-mdc-icon-button {
              color: #666666;
              width: 32px;
              height: 32px;
              padding: 4px;

              &:hover:not(:disabled) {
                color: #333333;
              }

              &:disabled {
                color: #cccccc;
              }

              .mat-mdc-paginator-icon {
                width: 20px;
                height: 20px;
              }
            }
          }
        }
      }

      .info-row {
        padding: 13px 24px 0 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;

        .tx-count {
          font-size: 13px;
          color: rgb(0, 35, 65);
        }
      }

      .loading-state {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px;
        color: #666666;
      }

      .empty-state {
        text-align: center;
        padding: 48px;

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          color: rgba(0, 35, 65, 0.2);
        }

        p {
          margin-top: 16px;
          color: #666666;
        }
      }

      .transactions-table-container {
        flex: 1;
        overflow: auto;
        background: #ffffff;
      }

      .transactions-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;

        thead {
          th {
            padding: 6px 5px;
            text-align: left;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            color: rgb(0, 35, 65);
            border-bottom: 1px solid #d0d0e0;
            white-space: nowrap;
            background: transparent;

            &.col-amount {
              text-align: center;
            }

            &.col-status {
              text-align: center;
            }

            &.col-actions {
              width: 40px;
            }
          }
        }

        tbody {
          .tx-row {
            background: transparent;
            transition: background 0.2s;

            &:hover {
              background: #f0f4ff;
            }

            &.unconfirmed {
              animation: pulse 3s ease-in-out infinite;
            }

            td {
              padding: 5px;
              border-bottom: 1px solid #e8e8e8;
              vertical-align: middle;
              color: rgb(0, 35, 65);
            }
          }

          .col-datetime {
            .datetime-stack {
              display: flex;
              flex-direction: column;
              gap: 2px;

              .date {
                font-weight: 500;
                font-size: 13px;
                color: rgb(0, 35, 65);
              }

              .time {
                font-size: 11px;
                color: #666666;
              }
            }
          }

          .col-type {
            .type-badge {
              display: inline-block;
              font-size: 13px;
              font-weight: 500;
              color: rgb(0, 35, 65);
            }
          }

          .col-amount {
            text-align: center;

            .amount-badge {
              display: inline-block;
              font-weight: 600;
              font-family: monospace;
              font-size: 13px;
              color: rgb(0, 35, 65);
            }
          }

          .col-account {
            .account-label {
              font-size: 11px;
              color: #666666;
              margin-right: 4px;
            }

            .address-text {
              font-family: monospace;
              font-size: 11px;
              color: rgb(0, 35, 65);
              word-break: break-all;
            }
          }

          .col-status {
            text-align: center;

            .status-badge {
              font-size: 12px;
              font-weight: 500;
              color: rgb(0, 35, 65);
            }
          }

          .col-txid {
            .txid-text {
              font-family: monospace;
              font-size: 10px;
              color: #1565c0;
              cursor: pointer;
              word-break: break-all;

              &:hover {
                text-decoration: underline;
              }
            }
          }

          .col-actions {
            text-align: center;
            vertical-align: middle;

            button {
              color: #666666;
              width: 32px;
              height: 32px;
              padding: 0;
              display: inline-flex;
              align-items: center;
              justify-content: center;

              mat-icon {
                font-size: 20px;
                width: 20px;
                height: 20px;
                line-height: 20px;
              }

              &:hover {
                color: rgb(0, 35, 65);
              }
            }
          }
        }
      }

      @keyframes pulse {
        0% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
        100% {
          opacity: 1;
        }
      }

      @media (max-width: 899px) {
        .filter-row {
          .search-field {
            max-width: none;
          }

          .type-field,
          .date-field {
            flex: 1;
            min-width: 120px;
          }
        }

        .transactions-table {
          font-size: 12px;

          th,
          td {
            padding: 4px 3px;
          }

          .col-account {
            display: none;
          }

          .col-txid {
            .txid-text {
              max-width: 80px;
              overflow: hidden;
              text-overflow: ellipsis;
              display: inline-block;
              white-space: nowrap;
            }
          }
        }
      }

      @media (max-width: 599px) {
        .header {
          padding: 12px 16px;
        }

        .filter-row {
          padding: 12px 16px;
        }

        .transactions-card {
          margin: 8px;
        }

        .transactions-table {
          .col-status {
            display: none;
          }
        }
      }
    `,
  ],
})
export class TransactionListComponent implements OnInit, OnDestroy {
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly i18n = inject(I18nService);
  private readonly notification = inject(NotificationService);
  private readonly blockExplorer = inject(BlockExplorerService);
  private readonly dialog = inject(MatDialog);
  private readonly destroy$ = new Subject<void>();

  loading = signal(false);
  transactions = signal<WalletTransaction[]>([]);
  activeFilter = signal<TransactionFilter>('all');
  pageIndex = signal(0);
  pageSize = signal(10);
  pageSizeOptions = [10, 25, 50];
  searchQuery = '';
  selectedType: TransactionFilter = 'all';
  dateFrom: Date | null = null;
  dateTo: Date | null = null;

  // Load limit options (0 = ALL)
  loadLimitOptions: Array<{ value: number; label: string }> = [
    { value: 1000, label: '1000' },
    { value: 5000, label: '5000' },
    { value: 10000, label: '10000' },
    { value: 0, label: 'ALL' },
  ];
  loadLimit = 1000;

  filterOptions: Array<{ value: TransactionFilter; label: string }> = [
    { value: 'all', label: 'all' },
    { value: 'send', label: 'send' },
    { value: 'receive', label: 'receive' },
    { value: 'immature', label: 'immature' },
    { value: 'generate', label: 'generate' },
  ];

  filteredTransactions = computed(() => {
    let txs = this.transactions();
    const filter = this.activeFilter();
    const query = this.searchQuery.toLowerCase().trim();

    // Apply type filter
    if (filter === 'send') {
      txs = txs.filter(tx => tx.category === 'send');
    } else if (filter === 'receive') {
      txs = txs.filter(tx => tx.category === 'receive');
    } else if (filter === 'immature') {
      txs = txs.filter(tx => tx.category === 'immature');
    } else if (filter === 'generate') {
      txs = txs.filter(tx => tx.category === 'generate');
    }

    // Apply search filter
    if (query) {
      txs = txs.filter(
        tx =>
          tx.txid.toLowerCase().includes(query) ||
          tx.address?.toLowerCase().includes(query) ||
          tx.label?.toLowerCase().includes(query)
      );
    }

    return txs;
  });

  paginatedTransactions = computed(() => {
    const txs = this.filteredTransactions();
    const start = this.pageIndex() * this.pageSize();
    return txs.slice(start, start + this.pageSize());
  });

  oldestTransactionDate = computed(() => {
    const txs = this.transactions();
    if (txs.length === 0) return null;
    const oldest = txs[txs.length - 1];
    return new Date(oldest.time * 1000);
  });

  ngOnInit(): void {
    this.loadTransactions();

    // Subscribe to wallet changes to reload transactions
    this.walletManager.activeWallet$
      .pipe(
        skip(1), // Skip initial value since we already loaded
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.pageIndex.set(0);
        this.loadTransactions();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadTransactions(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    this.loading.set(true);

    try {
      // Load transactions based on load limit (0 = ALL, use large number)
      const count = this.loadLimit === 0 ? 999999 : this.loadLimit;
      const txs = await this.walletRpc.listTransactions(walletName, '*', count, 0);

      // Sort by time descending
      const sorted = txs.sort((a, b) => b.time - a.time);
      this.transactions.set(sorted);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      this.loading.set(false);
    }
  }

  onLoadLimitChange(): void {
    this.pageIndex.set(0);
    this.loadTransactions();
  }

  setFilter(filter: TransactionFilter): void {
    this.activeFilter.set(filter);
    this.selectedType = filter;
    this.pageIndex.set(0);
  }

  applyFilters(): void {
    this.pageIndex.set(0);
    // Trigger recomputation by touching activeFilter
    this.activeFilter.set(this.activeFilter());
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.applyFilters();
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.selectedType = 'all';
    this.activeFilter.set('all');
    this.dateFrom = null;
    this.dateTo = null;
    this.pageIndex.set(0);
  }

  goBack(): void {
    this.location.back();
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  // Transaction display methods
  getTransactionType(tx: WalletTransaction): string {
    switch (tx.category) {
      case 'receive':
        return this.i18n.get('tx_type_receive');
      case 'send':
        return this.i18n.get('tx_type_send');
      case 'generate':
        return this.i18n.get('tx_type_generate');
      case 'immature':
        return this.i18n.get('tx_type_immature');
      default:
        return tx.category;
    }
  }

  formatTransactionAmount(tx: WalletTransaction): string {
    const prefix =
      tx.category === 'receive' || tx.category === 'generate' || tx.category === 'immature'
        ? '+'
        : '';
    return `${prefix}${tx.amount.toFixed(8)} BTCX`;
  }

  getAccountLabel(_tx: WalletTransaction): string {
    return this.i18n.get('to') + ':';
  }

  getConfirmationStatus(tx: WalletTransaction): string {
    if (tx.confirmations === 0) {
      return this.i18n.get('pending');
    } else if (tx.confirmations < 6) {
      return `${tx.confirmations} ${this.i18n.get('confirmations_short')}`;
    } else {
      return this.i18n.get('confirmed');
    }
  }

  formatTxDate(tx: WalletTransaction): string {
    const date = new Date(tx.time * 1000);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatTxTime(tx: WalletTransaction): string {
    const date = new Date(tx.time * 1000);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // Actions
  viewTransactionDetails(tx: WalletTransaction): void {
    this.router.navigate(['/transactions', tx.txid]);
  }

  copyToClipboard(text: string): void {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.notification.show(this.i18n.get('copied_to_clipboard'), 'success');
    }
  }

  addToContacts(tx: WalletTransaction): void {
    if (!tx.address) return;
    this.router.navigate(['/contacts'], { queryParams: { add: tx.address } });
  }

  sendToAddress(address: string): void {
    this.router.navigate(['/send'], { queryParams: { to: address } });
  }

  openTransactionInExplorer(txid: string): void {
    this.blockExplorer.openTransaction(txid);
  }

  openAddressInExplorer(address: string): void {
    this.blockExplorer.openAddress(address);
  }

  async openBumpFeeDialog(tx: WalletTransaction): Promise<void> {
    const dialogRef = this.dialog.open(FeeBumpDialogComponent, {
      width: '500px',
      data: {
        txid: tx.txid,
        originalFee: Math.abs(tx.fee ?? 0),
        amount: Math.abs(tx.amount),
        address: tx.address,
      } as FeeBumpDialogData,
    });

    const result = (await dialogRef.afterClosed().toPromise()) as FeeBumpDialogResult | undefined;
    if (result?.confirmed) {
      await this.executeBumpFee(tx.txid, result);
    }
  }

  private async executeBumpFee(txid: string, options: FeeBumpDialogResult): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    try {
      const bumpOptions: { confTarget?: number; feeRate?: number } = {};
      if (options.feeRate !== undefined) {
        bumpOptions.feeRate = options.feeRate;
      } else if (options.confTarget !== undefined) {
        bumpOptions.confTarget = options.confTarget;
      }

      const result = await this.walletRpc.bumpFee(walletName, txid, bumpOptions);

      this.notification.success(
        this.i18n.get('bump_fee_success').replace('{txid}', result.txid.substring(0, 16) + '...')
      );

      // Refresh transactions list
      this.loadTransactions();
      // Also refresh wallet service for balance updates
      this.walletService.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('bump_fee_error');
      this.notification.error(message);
    }
  }
}
