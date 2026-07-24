import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  computed,
  effect,
  untracked,
} from '@angular/core';
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
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil, skip } from 'rxjs/operators';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  ClipboardService,
  NotificationService,
  BlockExplorerService,
} from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { AppModeService } from '../../../../core/services/app-mode.service';
import { ViewportService } from '../../../../core/services/viewport.service';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';
import { TxRowComponent } from '../../../mobile-wallet/components/tx-row/tx-row.component';
import { FitRowsDirective } from '../../../../shared/directives';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import {
  WalletRpcService,
  WalletTransaction,
} from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BackendRouterService } from '../../../../core/backend/backend-router.service';
import { downloadTextFile } from '../../../../shared/utils/download';
import {
  FeeBumpDialogComponent,
  FeeBumpDialogData,
  FeeBumpDialogResult,
} from '../../components/fee-bump-dialog/fee-bump-dialog.component';
import {
  AbandonTxDialogComponent,
  AbandonTxDialogData,
  AbandonTxDialogResult,
} from '../../components/abandon-tx-dialog/abandon-tx-dialog.component';
import {
  CpfpDialogComponent,
  CpfpDialogData,
  CpfpDialogResult,
} from '../../components/cpfp-dialog/cpfp-dialog.component';

type TransactionFilter =
  | 'all'
  | 'send'
  | 'receive'
  | 'immature'
  | 'generate'
  | 'assignment'
  | 'revocation';

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
    TxRowComponent,
    FitRowsDirective,
    I18nPipe,
  ],
  template: `
    <div class="page-layout" [class.filters-open]="filtersOpen()">
      <!-- Header with gradient background -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'transactions' | i18n }}</h1>
        </div>
        <div class="header-right">
          <!-- Phone-only: expand/collapse the filter row + load limit -->
          <button
            mat-icon-button
            class="refresh-button filter-toggle"
            [class.active]="filtersOpen()"
            (click)="filtersOpen.set(!filtersOpen())"
            [matTooltip]="'search' | i18n"
          >
            <mat-icon>filter_list</mat-icon>
          </button>

          <!-- Export CSV (kept apart from the load-limit + refresh pair) -->
          <button
            mat-icon-button
            [disabled]="loading() || filteredTransactions().length === 0"
            (click)="exportCsv()"
            [matTooltip]="'export_csv' | i18n"
            class="refresh-button export-button"
          >
            <mat-icon>file_download</mat-icon>
          </button>

          <!-- Load limit: its own icon + menu (refresh stays one tap). On
               phone it lives in the funnel-revealed filter row instead so the
               header keeps to two icons and never wraps. -->
          <button
            mat-icon-button
            [disabled]="loading()"
            [matMenuTriggerFor]="limitMenu"
            [matTooltip]="'load_limit' | i18n"
            class="refresh-button limit-button"
          >
            <mat-icon>format_list_numbered</mat-icon>
          </button>
          <mat-menu #limitMenu="matMenu">
            @for (option of loadLimitOptions; track option.value) {
              <button mat-menu-item (click)="setLoadLimit(option.value)">
                <mat-icon>{{
                  loadLimit === option.value ? 'radio_button_checked' : 'radio_button_unchecked'
                }}</mat-icon>
                <span>{{ option.label }}</span>
              </button>
            }
          </mat-menu>

          <!-- Refresh: plain one-tap -->
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

        <!-- Phone-only load-limit trigger (same menu as the header icon) -->
        <button
          mat-icon-button
          [disabled]="loading()"
          [matMenuTriggerFor]="limitMenu"
          [matTooltip]="'load_limit' | i18n"
          class="limit-inline"
        >
          <mat-icon>format_list_numbered</mat-icon>
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
            @if (viewport.phone()) {
              <!-- Phone: the old mobile history — TxRow cards, fit-derived
                   page size (FitRows), tap opens the detail view. -->
              <div
                class="tx-card-list"
                appFitRows
                [fitRowSelector]="'.tx-item'"
                [fitMinRows]="3"
                [fitFallbackRowPx]="96"
                (fitRows)="onFit($event)"
              >
                @for (
                  tx of phoneRows();
                  track tx.src.txid + '-' + tx.src.vout + '-' + tx.src.category
                ) {
                  <div class="tx-item" (click)="viewTransactionDetails(tx.src)">
                    <app-mwallet-tx-row [tx]="tx.row" />
                  </div>
                }
              </div>
            } @else {
              <div
                class="transactions-table-container"
                appFitRows
                [fitRowSelector]="'.fit-row'"
                [fitHeaderSelector]="'thead'"
                [fitMinRows]="3"
                [fitFallbackRowPx]="46"
                (fitRows)="onFit($event)"
              >
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
                    @for (
                      tx of paginatedTransactions();
                      track tx.txid + '-' + tx.vout + '-' + tx.category
                    ) {
                      <tr class="tx-row fit-row" [class.unconfirmed]="tx.confirmations === 0">
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
                            @if (
                              tx.confirmations === 0 &&
                              tx.category === 'receive' &&
                              tx.vout !== undefined &&
                              cpfpEnabled()
                            ) {
                              <mat-divider></mat-divider>
                              <button mat-menu-item (click)="openCpfpDialog(tx)">
                                <mat-icon>bolt</mat-icon>
                                <span>{{ 'speed_up_cpfp' | i18n }}</span>
                              </button>
                            }
                            @if (tx.confirmations === 0 && tx.category === 'send') {
                              @if (tx.bip125_replaceable !== 'yes') {
                                <mat-divider></mat-divider>
                              }
                              <button mat-menu-item (click)="openAbandonDialog(tx)">
                                <mat-icon>delete_forever</mat-icon>
                                <span>{{ 'abandon_tx' | i18n }}</span>
                              </button>
                            }
                          </mat-menu>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            <mat-paginator
              [length]="filteredTransactions().length"
              [pageSize]="fitPageSize()"
              [pageIndex]="pageIndex()"
              [hidePageSize]="true"
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
      @use 'breakpoints' as bp;

      /* Height chain for fit-based paging at EVERY width (coins/contacts
         pattern): host fills the routed column, the card flex-fills the
         leftover height, FitRows measures the table/card viewport. */
      :host {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .page-layout {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        /* No height: 100% — percentage-of-auto breaks the bounded chain and
           the fit viewport grows with its rows (circular measurement). */
        min-height: 0;
        box-sizing: border-box;
        background: #eaf0f6;
      }

      /* Header — gradient band on the shared balance-band height token, in
         tandem with the menu balance block (min-height: a wrapped control
         row may grow it). */
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        min-height: var(--menu-balance-h);
        box-sizing: border-box;
        padding: 0 24px;
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
          font-size: 20px;
          font-weight: 300;
          color: white;
        }
      }

      .header-right {
        display: flex;
        align-items: center;
        gap: 12px;

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
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;

        mat-card-content {
          padding: 16px 16px 0 16px !important;
          flex: 1 1 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
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

      /* The measured row viewport: height comes from the card (bounded
         flex chain below), never from the rows — FitRows derives the page
         size, so the fit-sized page never scrolls. */
      .transactions-table-container {
        flex: 1 1 0;
        min-height: 0;
        overflow: hidden;
        background: #ffffff;
      }

      .transactions-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        /* FIXED layout — same hazard as the dashboard's recent table: with
           auto layout the rendered rows set the column widths, and the fit
           loop (rows -> widths -> wrapping -> row height -> fit) can
           oscillate at mid widths. Width-independent row heights break it. */
        table-layout: fixed;

        th.col-datetime {
          width: 96px;
        }
        th.col-type {
          width: 72px;
        }
        th.col-amount {
          width: 150px;
        }
        th.col-status {
          width: 92px;
        }
        th.col-actions {
          width: 44px;
        }

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
              display: block;
              font-family: monospace;
              font-size: 11px;
              color: rgb(0, 35, 65);
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
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
              display: block;
              font-family: monospace;
              font-size: 10px;
              color: #1565c0;
              cursor: pointer;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;

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

      @include bp.tablet-down {
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

      /* The funnel only exists at phone — desktop shows the filters inline. */
      .filter-toggle {
        display: none;
      }

      /* The in-row load-limit trigger only exists at phone — desktop keeps
         it in the header. */
      .limit-inline {
        display: none;
      }

      @include bp.phone {
        .header {
          padding: 0 16px;
        }

        .filter-toggle {
          display: inline-flex;

          &.active mat-icon {
            color: #4caf50;
          }
        }

        /* Collapsed by default (the old mobile look); the funnel reveals
           the filter row (wrapping). */
        .filter-row {
          display: none;
        }

        .filters-open .filter-row {
          display: flex;
          flex-wrap: wrap;
        }

        /* Nobody exports CSV on a phone. */
        .export-button {
          display: none;
        }

        /* Two icons max in the header (funnel + refresh) so it never wraps
           on narrow phones — the load limit moves into the filter row. */
        .header-right {
          gap: 0;

          .limit-button {
            display: none;
          }
        }

        .filters-open .limit-inline {
          display: inline-flex;
        }

        .transactions-card {
          margin: 8px;
        }

        .transactions-table {
          .col-status {
            display: none;
          }
        }

        .tx-card-list {
          flex: 1 1 0;
          min-height: 0;
          overflow: hidden;
        }

        /* The old mobile-home card rows (dashboard recent-list pattern). */
        .tx-item {
          padding: 6px 0;
          cursor: pointer;

          &:not(:last-of-type) {
            border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          }

          app-mwallet-tx-row {
            display: block;
            width: 100%;
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
  private readonly backendRouter = inject(BackendRouterService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly i18n = inject(I18nService);
  private readonly notification = inject(NotificationService);
  private readonly blockExplorer = inject(BlockExplorerService);
  private readonly clipboard = inject(ClipboardService);
  private readonly dialog = inject(MatDialog);
  private readonly appMode = inject(AppModeService);
  private readonly btcxWallet = inject(BtcxWalletService);
  readonly viewport = inject(ViewportService);

  /** Electrum/remote mode — the Core-only detail view is hidden. */
  readonly isRemote = computed(() => this.backendRouter.isRemote());

  constructor() {
    // Remote/nodeless mode: new blocks arrive via the background sync — ride
    // the btcx-wallet:sync signal and reload silently (no spinner flash; the
    // signal is constant in Core mode, so this is a no-op there).
    effect(() => {
      this.btcxWallet.lastSync();
      untracked(() => {
        if (this.walletManager.activeWallet) void this.reloadIfChanged();
      });
    });
  }
  private readonly destroy$ = new Subject<void>();

  /** CPFP (child-pays-for-parent) is Core-only — gated on the backend flag. */
  readonly cpfpEnabled = (): boolean => this.backendRouter.capabilities().cpfp;

  loading = signal(false);
  transactions = signal<WalletTransaction[]>([]);
  activeFilter = signal<TransactionFilter>('all');
  pageIndex = signal(0);
  /** Phone: the filter row + load limit are collapsed behind the funnel. */
  readonly filtersOpen = signal(false);
  /**
   * Fit-derived page size at EVERY width (the app-wide pattern): FitRows
   * measures how many rows fit the table/card viewport — no items-per-page
   * selector. Initial value only covers the first paint.
   */
  readonly fitPageSize = signal(10);
  searchQuery = '';
  selectedType: TransactionFilter = 'all';
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  private filterVersion = signal(0);

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
    { value: 'assignment', label: 'tx_type_assignment' },
    { value: 'revocation', label: 'tx_type_revocation' },
  ];

  filteredTransactions = computed(() => {
    this.filterVersion();
    let txs = this.transactions();
    const filter = this.activeFilter();
    const query = this.searchQuery.toLowerCase().trim();

    // Apply type filter. Assignment/revocation are virtual types overlaid on
    // `send`; when filtering by `send`, exclude rows that carry a pocx_type so
    // the three filters partition the underlying send rows cleanly.
    if (filter === 'send') {
      txs = txs.filter(tx => tx.category === 'send' && !tx.pocx_type);
    } else if (filter === 'receive') {
      txs = txs.filter(tx => tx.category === 'receive');
    } else if (filter === 'immature') {
      txs = txs.filter(tx => tx.category === 'immature');
    } else if (filter === 'generate') {
      txs = txs.filter(tx => tx.category === 'generate');
    } else if (filter === 'assignment') {
      txs = txs.filter(tx => tx.pocx_type === 'assignment');
    } else if (filter === 'revocation') {
      txs = txs.filter(tx => tx.pocx_type === 'revocation');
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

    // Apply date range (tx.time is Unix seconds; end-of-day inclusive)
    if (this.dateFrom) {
      const fromSec = Math.floor(this.dateFrom.getTime() / 1000);
      txs = txs.filter(tx => tx.time >= fromSec);
    }
    if (this.dateTo) {
      const toEnd = new Date(this.dateTo);
      toEnd.setHours(23, 59, 59, 999);
      const toSec = Math.floor(toEnd.getTime() / 1000);
      txs = txs.filter(tx => tx.time <= toSec);
    }

    return txs;
  });

  paginatedTransactions = computed(() => {
    const txs = this.filteredTransactions();
    const start = this.pageIndex() * this.fitPageSize();
    return txs.slice(start, start + this.fitPageSize());
  });

  oldestTransactionDate = computed(() => {
    const txs = this.transactions();
    if (txs.length === 0) return null;
    const oldest = txs[txs.length - 1];
    return new Date(oldest.time * 1000);
  });

  /** Phone rows mapped for the shared mobile tx-row (source kept for actions). */
  readonly phoneRows = computed(() =>
    this.paginatedTransactions().map(tx => ({ src: tx, row: this.toRowTx(tx) }))
  );

  /**
   * Map a Core-shaped WalletTransaction onto the shared mobile tx-row's
   * BtcxWalletTx input — display fields only (vsize is not shown by the row).
   */
  private toRowTx(tx: WalletTransaction): BtcxWalletTx {
    return {
      txid: tx.txid,
      direction: tx.category === 'send' ? 'sent' : 'received',
      amountSat: Math.round(Math.abs(tx.amount) * 1e8),
      feeSat: tx.fee != null ? Math.round(Math.abs(tx.fee) * 1e8) : null,
      vsize: 0,
      confirmations: tx.confirmations ?? 0,
      timestamp: tx.time ?? null,
      address: tx.address ?? null,
    };
  }

  /** New measured fit: adopt as page size, keep the first visible row on page. */
  onFit(fit: number): void {
    const oldSize = this.fitPageSize();
    if (fit === oldSize) return;
    const firstVisible = this.pageIndex() * oldSize;
    this.fitPageSize.set(fit);
    this.pageIndex.set(Math.floor(firstVisible / fit));
  }

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

  /** Last tx probe {total, tip} — sync ticks skip identical reloads. */
  private lastProbe: { total: number; tip: number } | null = null;

  /** Sync tick: refetch only when the probe says the history moved. */
  private async reloadIfChanged(): Promise<void> {
    try {
      const probe = await this.btcxWallet.txProbe();
      if (
        this.lastProbe &&
        this.lastProbe.total === probe.total &&
        this.lastProbe.tip === probe.tip &&
        this.transactions().length > 0
      ) {
        return;
      }
      this.lastProbe = probe;
    } catch {
      // probe unavailable (Core mode / older backend) — plain reload
    }
    await this.loadTransactions();
  }

  async loadTransactions(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    // Spinner only while the list is still empty — background sync reloads
    // update silently instead of flashing the table away.
    if (this.transactions().length === 0) this.loading.set(true);

    try {
      // Load transactions based on load limit (0 = ALL, use large number).
      // Routed through the mode's backend (Core RPC or the local BDK wallet).
      const count = this.loadLimit === 0 ? 999999 : this.loadLimit;
      const txs = await this.backendRouter.wallet().listTransactions(walletName, count, 0);

      // Both backends return newest-first — no client re-sort.
      this.transactions.set(txs);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      this.loading.set(false);
    }
  }

  /** Menu pick: adopt the limit and reload with it. */
  setLoadLimit(value: number): void {
    this.loadLimit = value;
    this.onLoadLimitChange();
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
    this.filterVersion.update(v => v + 1);
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
    this.filterVersion.update(v => v + 1);
  }

  /**
   * Export the currently-filtered transactions as a CSV download (Blob +
   * anchor, same mechanism as the mining dashboard's deadline export).
   * Timestamps are ISO-8601 UTC so spreadsheets parse them unambiguously;
   * amounts use a dot decimal via toFixed, independent of locale.
   */
  async exportCsv(): Promise<void> {
    const txs = this.filteredTransactions();
    if (txs.length === 0) return;
    const headers = [
      this.i18n.get('date'),
      this.i18n.get('type'),
      this.i18n.get('amount'),
      this.i18n.get('fee'),
      this.i18n.get('confirmations'),
      this.i18n.get('transaction_id'),
      this.i18n.get('address'),
      this.i18n.get('label'),
    ];
    const rows = txs.map(tx => [
      new Date(tx.time * 1000).toISOString(),
      this.getTransactionType(tx),
      tx.amount.toFixed(8),
      tx.fee != null ? Math.abs(tx.fee).toFixed(8) : '',
      tx.confirmations,
      tx.txid,
      tx.address ?? '',
      tx.label ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => this.csvCell(c)).join(',')).join('\r\n');
    try {
      await downloadTextFile('transactions.csv', csv);
    } catch (err) {
      console.error('Failed to export transactions:', err);
      this.notification.error(`${err}`);
    }
  }

  /** Quote a CSV cell if it contains a comma, quote or newline (RFC 4180). */
  private csvCell(value: string | number): string {
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  goBack(): void {
    this.location.back();
  }

  onPageChange(event: PageEvent): void {
    // Page size is fit-derived (no selector) — only the index is user-driven.
    this.pageIndex.set(event.pageIndex);
  }

  // Transaction display methods
  getTransactionType(tx: WalletTransaction): string {
    // PoCX virtual types take precedence over `send` when the node provides them.
    // Absent on unpatched nodes — falls through to the category switch.
    if (tx.pocx_type === 'assignment') {
      return this.i18n.get('tx_type_assignment');
    }
    if (tx.pocx_type === 'revocation') {
      return this.i18n.get('tx_type_revocation');
    }
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
    return new Date(tx.time * 1000).toLocaleDateString(this.i18n.currentLanguageCode(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatTxTime(tx: WalletTransaction): string {
    return new Date(tx.time * 1000).toLocaleTimeString(this.i18n.currentLanguageCode(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Actions
  viewTransactionDetails(tx: WalletTransaction): void {
    this.router.navigate([this.appMode.pageRoute('/transactions'), tx.txid]);
  }

  copyToClipboard(text: string): void {
    this.clipboard.copy(text);
  }

  addToContacts(tx: WalletTransaction): void {
    if (!tx.address) return;
    this.router.navigate([this.appMode.pageRoute('/contacts')], {
      queryParams: { add: tx.address },
    });
  }

  sendToAddress(address: string): void {
    this.router.navigate([this.appMode.pageRoute('/send')], { queryParams: { to: address } });
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

    const result = (await firstValueFrom(dialogRef.afterClosed())) as
      | FeeBumpDialogResult
      | undefined;
    if (result?.confirmed) {
      await this.executeBumpFee(tx.txid, result);
    }
  }

  private async executeBumpFee(txid: string, options: FeeBumpDialogResult): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    try {
      // Routed through the mode's backend (Core RPC or the local BDK wallet).
      const newTxid = await this.backendRouter.wallet().bumpFee(walletName, txid, options.feeRate);

      this.notification.success(
        this.i18n.get('bump_fee_success').replace('{txid}', newTxid.substring(0, 16) + '...')
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

  async openCpfpDialog(tx: WalletTransaction): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName || tx.vout === undefined) return;

    const dialogRef = this.dialog.open(CpfpDialogComponent, {
      width: '500px',
      data: {
        parentTxid: tx.txid,
        vout: tx.vout,
        receivedAmount: Math.abs(tx.amount),
        walletName,
      } as CpfpDialogData,
    });

    const result = (await firstValueFrom(dialogRef.afterClosed())) as CpfpDialogResult | undefined;
    if (result?.confirmed && result.childFeeRate !== undefined) {
      await this.executeCpfp(tx, result.childFeeRate);
    }
  }

  private async executeCpfp(tx: WalletTransaction, childFeeRate: number): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName || tx.vout === undefined) return;

    try {
      // Core-only: spends the parent's output with a high-fee child, dragging
      // the parent into the same package.
      const childTxid = await this.backendRouter
        .wallet()
        .cpfpBumpFee(walletName, tx.txid, tx.vout, childFeeRate);

      this.notification.success(
        this.i18n.get('cpfp_success').replace('{txid}', childTxid.substring(0, 16) + '...')
      );

      this.loadTransactions();
      this.walletService.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('cpfp_error');
      this.notification.error(message);
    }
  }

  async openAbandonDialog(tx: WalletTransaction): Promise<void> {
    const dialogRef = this.dialog.open(AbandonTxDialogComponent, {
      width: '500px',
      data: {
        txid: tx.txid,
        amount: Math.abs(tx.amount),
        address: tx.address,
      } as AbandonTxDialogData,
    });

    const result = (await firstValueFrom(dialogRef.afterClosed())) as
      | AbandonTxDialogResult
      | undefined;
    if (result?.confirmed) {
      await this.executeAbandon(tx.txid);
    }
  }

  private async executeAbandon(txid: string): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    if (this.backendRouter.isRemote()) {
      // abandontransaction is a Core wallet concept with no BDK analog.
      this.notification.error(this.i18n.get('feature_unavailable_remote'));
      return;
    }

    try {
      await this.walletRpc.abandonTransaction(walletName, txid);
      this.notification.success(this.i18n.get('abandon_tx_success'));
      this.loadTransactions();
      this.walletService.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('abandon_tx_error');
      this.notification.error(message);
    }
  }
}
