import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ViewChild,
  effect,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  WalletTransaction,
  WalletRpcService,
} from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainStateService } from '../../../../bitcoin/services/blockchain-state.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { NotificationService, BlockExplorerService } from '../../../../shared/services';
import {
  FeeBumpDialogComponent,
  FeeBumpDialogData,
  FeeBumpDialogResult,
} from '../../../transactions/components/fee-bump-dialog/fee-bump-dialog.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatPaginatorModule,
    MatTooltipModule,
    I18nPipe,
    DecimalPipe,
  ],
  template: `
    <div class="bitcoin-dashboard">
      <!-- Blockchain Status Card -->
      <mat-card class="blockchain-status-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>link</mat-icon>
            {{ 'bitcoin_pocx_network' | i18n }}
          </mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (isLoadingBlockchain()) {
            <div class="loading-state">
              <mat-spinner diameter="24"></mat-spinner>
              <span>{{ 'loading_blockchain_info' | i18n }}</span>
            </div>
          } @else if (blockchainInfo()) {
            <div class="blockchain-info">
              <div class="info-item">
                <span class="label">{{ 'chain' | i18n }}:</span>
                <span class="value">{{ getChainName() }}</span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'status' | i18n }}:</span>
                <span
                  class="value"
                  [class.syncing]="syncState().phase !== 'synced'"
                  [class.synced]="syncState().phase === 'synced'"
                >
                  {{ getSyncStateWithProgress() }}
                </span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'current_block_height' | i18n }}:</span>
                <span class="value">{{ blockchainInfo().blocks | number }}</span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'network_capacity' | i18n }}:</span>
                <span class="value">{{ getNetworkCapacity() }}</span>
              </div>
              <div class="info-item">
                <span class="label">{{ 'last_block_time' | i18n }}:</span>
                <span class="value">{{ getLastBlockTime() }}</span>
              </div>
            </div>
          }
        </mat-card-content>
      </mat-card>

      <!-- Total Balance Card -->
      <mat-card class="total-balance-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>account_balance_wallet</mat-icon>
            {{ 'total_balance' | i18n }}
          </mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="total-balance">
            <span class="amount">{{ formatBtcx(getTotalAll()) }}</span>
            <span class="unit">BTCX</span>
          </div>

          <div class="balance-breakdown">
            <div class="breakdown-item">
              <span class="label">{{ 'confirmed' | i18n }}:</span>
              <span class="value confirmed">{{ formatBtcx(totalBalance()) }} BTCX</span>
            </div>
            @if (pendingBalance() > 0) {
              <div class="breakdown-item">
                <span class="label">{{ 'pending' | i18n }}:</span>
                <span class="value pending">{{ formatBtcx(pendingBalance()) }} BTCX</span>
              </div>
            }
            @if (immatureBalance() > 0) {
              <div class="breakdown-item">
                <span class="label">{{ 'immature' | i18n }}:</span>
                <span class="value immature">{{ formatBtcx(immatureBalance()) }} BTCX</span>
              </div>
            }
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Balance Chart Card -->
      <mat-card class="balance-chart-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>show_chart</mat-icon>
            {{ 'balance_history' | i18n }}
          </mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (chartPoints().length > 1) {
            <div class="chart-container">
              <div class="y-axis-labels">
                @for (label of yAxisLabels(); track $index) {
                  <span class="y-label">{{ label }}</span>
                }
              </div>
              <div class="chart-area">
                <svg viewBox="0 0 280 100" preserveAspectRatio="none" class="balance-chart">
                  <defs>
                    <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" style="stop-color:rgba(66, 165, 245, 0.3)" />
                      <stop offset="100%" style="stop-color:rgba(66, 165, 245, 0.02)" />
                    </linearGradient>
                  </defs>
                  <!-- Grid lines -->
                  @for (y of [20, 40, 60, 80]; track y) {
                    <line
                      [attr.x1]="0"
                      [attr.y1]="y"
                      [attr.x2]="280"
                      [attr.y2]="y"
                      stroke="rgba(255,255,255,0.1)"
                      stroke-width="1"
                    />
                  }
                  @for (x of getGridXPositions(); track x) {
                    <line
                      [attr.x1]="x"
                      [attr.y1]="0"
                      [attr.x2]="x"
                      [attr.y2]="100"
                      stroke="rgba(255,255,255,0.1)"
                      stroke-width="1"
                    />
                  }
                  <!-- Chart area and line -->
                  <path [attr.d]="getChartAreaPath()" fill="url(#chartGradient)" />
                  <path
                    [attr.d]="getChartLinePath()"
                    fill="none"
                    stroke="#42a5f5"
                    stroke-width="2"
                  />
                </svg>
                <div class="chart-labels">
                  @for (label of chartLabels(); track $index) {
                    <span class="chart-label">{{ label }}</span>
                  }
                </div>
              </div>
            </div>
          } @else {
            <div class="chart-placeholder-text">
              {{ 'no_transaction_history' | i18n }}
            </div>
          }
        </mat-card-content>
      </mat-card>

      <!-- Transactions Card -->
      <mat-card class="transactions-card">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>history</mat-icon>
            {{ 'recent_transactions' | i18n }}
          </mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (isLoadingTransactions()) {
            <div class="loading-state">
              <mat-spinner diameter="24"></mat-spinner>
              <span>{{ 'loading_transactions' | i18n }}</span>
            </div>
          } @else if (transactions().length === 0) {
            <div class="empty-state">
              <mat-icon>receipt_long</mat-icon>
              <p>{{ 'no_transactions_yet' | i18n }}</p>
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
                  @for (tx of transactions(); track tx.txid) {
                    <tr class="tx-row" [class.unconfirmed]="tx.confirmations === 0">
                      <td class="col-datetime">
                        <div class="datetime-stack">
                          <span class="date">{{ formatTxDate(tx) }}</span>
                          <span class="time">{{ formatTxTime(tx) }}</span>
                        </div>
                      </td>
                      <td class="col-type">
                        <span class="type-badge">
                          {{ getTransactionType(tx) }}
                        </span>
                      </td>
                      <td class="col-amount">
                        <span class="amount-badge">
                          {{ formatTransactionAmount(tx) }}
                        </span>
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
              [length]="allTransactions().length"
              [pageSize]="txPageSize"
              [pageSizeOptions]="txPageSizeOptions"
              [showFirstLastButtons]="true"
              (page)="onPageChange($event)"
            >
            </mat-paginator>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .bitcoin-dashboard {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: 250px auto;
        gap: 16px;
        padding: 16px;
        box-sizing: border-box;

        @media (max-width: 1000px) {
          grid-template-columns: repeat(2, 1fr);
          grid-template-rows: 250px 250px auto;
        }

        @media (max-width: 600px) {
          grid-template-columns: 1fr;
          grid-template-rows: auto;
        }

        mat-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          overflow: hidden;

          mat-card-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            overflow: hidden;
          }
        }

        mat-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;

          mat-card-title {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
            font-size: 16px;
            font-weight: 500;

            mat-icon {
              color: #42a5f5;
            }
          }
        }
      }

      .blockchain-status-card {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%) !important;

        mat-card-header {
          padding: 12px 16px 0 16px !important;
          margin: 0 !important;

          mat-card-title {
            color: #ffffff !important;

            mat-icon {
              color: #ffffff !important;
            }
          }
        }

        mat-card-content {
          padding: 12px 16px 16px 16px !important;
        }

        .loading-state {
          display: flex;
          align-items: center;
          gap: 12px;
          color: rgba(255, 255, 255, 0.7);
        }

        .blockchain-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 16px;

          .info-item {
            display: flex;
            flex-direction: column;

            .label {
              font-size: 12px;
              color: rgba(255, 255, 255, 0.7);
              text-transform: uppercase;
            }

            .value {
              font-size: 16px;
              font-weight: 500;
              color: #ffffff;

              &.syncing {
                color: #ffb74d;
              }

              &.synced {
                color: #69f0ae;
              }
            }
          }
        }
      }

      .balance-chart-card {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%) !important;

        mat-card-header {
          padding: 12px 16px 0 16px !important;
          margin: 0 !important;

          mat-card-title {
            color: #ffffff !important;

            mat-icon {
              color: #ffffff !important;
            }
          }
        }

        mat-card-content {
          padding: 12px 16px 16px 16px !important;
        }

        .chart-container {
          flex: 1;
          display: flex;
          flex-direction: row;
          min-height: 100px;
          width: 100%;
          gap: 4px;

          .y-axis-labels {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 2px 0;
            min-width: 50px;

            .y-label {
              font-size: 9px;
              color: rgba(255, 255, 255, 0.5);
              text-align: right;
              line-height: 1;
            }
          }

          .chart-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;

            .balance-chart {
              flex: 1;
              width: 100%;
              min-height: 70px;
            }

            .chart-labels {
              display: flex;
              justify-content: space-between;
              padding: 2px 0 0 0;

              .chart-label {
                font-size: 9px;
                color: rgba(255, 255, 255, 0.5);
              }
            }
          }
        }

        .chart-placeholder-text {
          text-align: center;
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      }

      .total-balance-card {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%) !important;

        mat-card-header {
          padding: 12px 16px 0 16px !important;
          margin: 0 !important;

          mat-card-title {
            color: #ffffff !important;

            mat-icon {
              color: #ffffff !important;
            }
          }
        }

        mat-card-content {
          padding: 12px 16px 16px 16px !important;
        }

        .total-balance {
          display: flex;
          justify-content: flex-end;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 12px;
          white-space: nowrap;

          .amount {
            font-size: 32px;
            font-weight: 600;
            color: #ffffff;
          }

          .unit {
            font-size: 18px;
            color: rgba(255, 255, 255, 0.8);
          }
        }

        .balance-breakdown {
          border-top: 1px solid rgba(255, 255, 255, 0.2);
          padding-top: 12px;

          .breakdown-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0;
            white-space: nowrap;

            .label {
              font-size: 14px;
              color: rgba(255, 255, 255, 0.7);
            }

            .value {
              font-size: 14px;
              font-weight: 500;
              text-align: right;

              &.confirmed {
                color: #69f0ae;
              }

              &.pending {
                color: #ffb74d;
              }

              &.immature {
                color: #90caf9;
              }
            }
          }
        }
      }

      .transactions-card {
        grid-column: 1 / -1;
        min-height: 300px;
        background: #ffffff !important;

        mat-card-header {
          padding: 12px 16px 0 16px !important;
          margin: 0 !important;

          mat-card-title {
            color: rgb(0, 35, 65) !important;

            mat-icon {
              color: #1565c0 !important;
            }
          }
        }

        mat-card-content {
          overflow: hidden;
          padding: 8px 16px 0 16px !important;
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
                padding: 4px 5px;
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
      }
    `,
  ],
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild(MatPaginator, { static: false }) paginator!: MatPaginator;

  // Inject centralized state services
  readonly blockchainState = inject(BlockchainStateService);
  readonly walletService = inject(WalletService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly notification = inject(NotificationService);
  private readonly blockExplorer = inject(BlockExplorerService);
  private readonly dialog = inject(MatDialog);
  private readonly destroy$ = new Subject<void>();

  // Loading states derived from services
  isLoadingBlockchain = computed(() => this.blockchainState.isLoading());
  isLoadingTransactions = computed(() => this.walletService.isLoading());

  // Blockchain info - wrap service signals for template compatibility
  blockchainInfo = computed(() => ({
    chain: this.blockchainState.chain(),
    blocks: this.blockchainState.blockHeight(),
    headers: this.blockchainState.headers(),
    bestblockhash: this.blockchainState.bestBlockHash(),
    verificationprogress: this.blockchainState.verificationProgress(),
    initialblockdownload: this.blockchainState.initialBlockDownload(),
    difficulty: this.blockchainState.difficulty(),
  }));

  // Sync state for phase-aware progress display
  syncState = computed(() => this.blockchainState.syncState());

  // Balance from WalletService
  totalBalance = computed(() => this.walletService.balance());
  pendingBalance = computed(() => this.walletService.unconfirmedBalance());
  immatureBalance = computed(() => this.walletService.immatureBalance());

  // Transactions from WalletService
  allTransactions = computed(() => this.walletService.recentTransactions());
  transactions = signal<WalletTransaction[]>([]);
  txPageSize = 10;
  txPageSizeOptions = [10, 25, 50];

  // Chart data
  chartPoints = signal<{ x: number; y: number; balance: number }[]>([]);
  chartLabels = signal<string[]>([]);
  yAxisLabels = signal<string[]>([]);

  constructor() {
    // Effect to update transactions page and chart when allTransactions changes
    effect(() => {
      const txs = this.allTransactions();
      if (txs.length > 0) {
        this.updateTransactionPage();
        this.updateBalanceChart(txs);
      }
    });
  }

  ngOnInit(): void {
    // Initial page update
    this.updateTransactionPage();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Chart methods
  private updateBalanceChart(transactions: WalletTransaction[]): void {
    const currentBalance = this.getTotalAll();

    if (transactions.length === 0) {
      this.chartPoints.set([{ x: 140, y: 50, balance: currentBalance }]);
      this.chartLabels.set(['Now']);
      this.yAxisLabels.set([this.formatChartValue(currentBalance)]);
      return;
    }

    // Group transactions by confirmation count
    const blockMap = new Map<number, WalletTransaction[]>();
    for (const tx of transactions) {
      const confs = tx.confirmations;
      if (!blockMap.has(confs)) {
        blockMap.set(confs, []);
      }
      blockMap.get(confs)!.push(tx);
    }

    // Get unique confirmation levels, sorted ascending (newest first)
    const sortedConfs = Array.from(blockMap.keys())
      .filter(c => c > 0)
      .sort((a, b) => a - b);

    // Start from current balance and work backwards
    let balance = currentBalance;
    const balanceHistory: { confs: number; balance: number }[] = [];

    // Current point (now)
    balanceHistory.push({ confs: 0, balance: currentBalance });

    // Work backwards through confirmation levels
    for (const confs of sortedConfs) {
      const txsAtConf = blockMap.get(confs)!;

      // Undo transactions at this level to get balance before them
      for (const tx of txsAtConf) {
        if (tx.category === 'receive' || tx.category === 'generate' || tx.category === 'immature') {
          balance -= tx.amount;
        } else if (tx.category === 'send') {
          balance -= tx.amount; // amount is negative for sends
        }
      }

      balanceHistory.push({ confs, balance: Math.max(0, balance) });
    }

    // Reverse to get chronological order (oldest first)
    balanceHistory.reverse();

    // Limit to max 10 points for cleaner display
    const maxPoints = 10;
    let displayHistory = balanceHistory;
    if (balanceHistory.length > maxPoints) {
      const step = Math.ceil(balanceHistory.length / maxPoints);
      displayHistory = balanceHistory.filter(
        (_, i) => i % step === 0 || i === balanceHistory.length - 1
      );
    }

    // Calculate SVG coordinates (new viewBox: 0 0 280 100)
    const width = 280;
    const height = 100;
    const paddingY = 5;
    const chartHeight = height - paddingY * 2;

    const balances = displayHistory.map(p => p.balance);
    const minBalance = Math.min(...balances);
    const maxBalance = Math.max(...balances);
    const balanceRange = maxBalance - minBalance || 1;

    const points = displayHistory.map((p, i) => {
      const x = (i / (displayHistory.length - 1 || 1)) * width;
      const y = paddingY + chartHeight - ((p.balance - minBalance) / balanceRange) * chartHeight;
      return { x, y, balance: p.balance };
    });

    // Create x-axis labels
    const labels = displayHistory.map(p => {
      const minutesAgo = p.confs * 2;
      if (minutesAgo === 0) return 'Now';
      if (minutesAgo < 60) return `-${minutesAgo}m`;
      const hours = Math.floor(minutesAgo / 60);
      if (hours < 24) return `-${hours}h`;
      const days = Math.floor(hours / 24);
      return `-${days}d`;
    });

    // Create y-axis labels (5 labels from max to min)
    const yLabels = [
      this.formatChartValue(maxBalance),
      this.formatChartValue(minBalance + balanceRange * 0.75),
      this.formatChartValue(minBalance + balanceRange * 0.5),
      this.formatChartValue(minBalance + balanceRange * 0.25),
      this.formatChartValue(minBalance),
    ];

    this.chartPoints.set(points);
    this.chartLabels.set(labels);
    this.yAxisLabels.set(yLabels);
  }

  private formatChartValue(value: number): string {
    if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'k';
    } else if (value >= 1) {
      return value.toFixed(2);
    } else {
      return value.toFixed(4);
    }
  }

  getChartLinePath(): string {
    const points = this.chartPoints();
    if (points.length < 2) return '';

    // Create smooth curve using cubic bezier
    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const tension = 0.3;

      // Control points for smooth curve
      const cp1x = prev.x + (curr.x - prev.x) * tension;
      const cp1y = prev.y;
      const cp2x = curr.x - (curr.x - prev.x) * tension;
      const cp2y = curr.y;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
    }

    return path;
  }

  getChartAreaPath(): string {
    const points = this.chartPoints();
    if (points.length < 2) return '';

    const height = 100;
    const bottomY = height;

    // Start from bottom left
    let path = `M ${points[0].x} ${bottomY}`;

    // Line up to first point
    path += ` L ${points[0].x} ${points[0].y}`;

    // Smooth curve through all points
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const tension = 0.3;

      const cp1x = prev.x + (curr.x - prev.x) * tension;
      const cp1y = prev.y;
      const cp2x = curr.x - (curr.x - prev.x) * tension;
      const cp2y = curr.y;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
    }

    // Close the path
    path += ` L ${points[points.length - 1].x} ${bottomY} Z`;

    return path;
  }

  getGridXPositions(): number[] {
    const points = this.chartPoints();
    if (points.length < 2) return [];
    // Return x positions for vertical grid lines
    return points.map(p => p.x);
  }

  // Balance methods
  getTotalAll(): number {
    return this.totalBalance() + this.pendingBalance() + this.immatureBalance();
  }

  formatBtcx(amount: number): string {
    return amount.toFixed(8);
  }

  // Blockchain info methods
  getChainName(): string {
    const info = this.blockchainInfo();
    if (!info?.chain) return 'Unknown';

    const chain = info.chain.toLowerCase();
    if (chain === 'main') return 'Mainnet';
    if (chain === 'test' || chain === 'testnet') return 'Testnet';
    if (chain === 'regtest') return 'Regtest';
    return info.chain;
  }

  getSyncProgress(): string {
    const state = this.syncState();
    return state.percent.toFixed(2);
  }

  getSyncStateWithProgress(): string {
    const state = this.syncState();

    switch (state.phase) {
      case 'connecting':
        return this.i18n.get('sync_connecting');

      case 'header_sync':
        return this.i18n.get('sync_headers_progress', {
          percent: state.percent.toFixed(1),
          headers: state.headers.toLocaleString(),
          target: state.targetHeight.toLocaleString(),
        });

      case 'block_sync':
        return this.i18n.get('sync_blocks_progress', {
          percent: state.percent.toFixed(1),
          blocks: state.blocks.toLocaleString(),
          headers: state.headers.toLocaleString(),
        });

      case 'synced':
        return this.i18n.get('synced');

      default:
        return this.i18n.get('unknown');
    }
  }

  getNetworkCapacity(): string {
    return this.blockchainState.getNetworkCapacityFormatted();
  }

  getLastBlockTime(): string {
    return this.blockchainState.getLastBlockTimeFormatted();
  }

  // Transaction methods
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

  getAmountClass(tx: WalletTransaction): string {
    switch (tx.category) {
      case 'receive':
      case 'generate':
        return 'incoming';
      case 'send':
        return 'outgoing';
      case 'immature':
        return 'immature';
      default:
        return '';
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

  // Pagination
  updateTransactionPage(): void {
    const pageIndex = this.paginator ? this.paginator.pageIndex : 0;
    const pageSize = this.paginator ? this.paginator.pageSize : this.txPageSize;
    const start = pageIndex * pageSize;
    const end = start + pageSize;
    this.transactions.set(this.allTransactions().slice(start, end));
  }

  onPageChange(event: PageEvent): void {
    this.txPageSize = event.pageSize;
    this.updateTransactionPage();
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
    // Navigate to contacts with the address
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

      // Refresh wallet service for balance and transaction updates
      this.walletService.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('bump_fee_error');
      this.notification.error(message);
    }
  }
}
