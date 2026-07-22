import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FitRowsDirective, FitTextDirective } from '../../../../shared/directives';
import { TxRowComponent } from '../../../mobile-wallet/components/tx-row/tx-row.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  WalletTransaction,
  WalletRpcService,
} from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BackendRouterService } from '../../../../core/backend/backend-router.service';
import { AppModeService } from '../../../../core/services/app-mode.service';
import { ViewportService } from '../../../../core/services/viewport.service';
import {
  BtcxWalletService,
  BtcxWalletTx,
  RECENT_TX_LIMIT,
} from '../../../../core/services/btcx-wallet.service';
import { NodeService } from '../../../../node/services/node.service';
import { BlockchainStateService } from '../../../../bitcoin/services/blockchain-state.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import {
  ClipboardService,
  ContactsStoreService,
  NotificationService,
  BlockExplorerService,
} from '../../../../shared/services';
import { BtcxPipe } from '../../../../shared/pipes';
import {
  FeeBumpDialogComponent,
  FeeBumpDialogData,
  FeeBumpDialogResult,
} from '../../../transactions/components/fee-bump-dialog/fee-bump-dialog.component';
import {
  AbandonTxDialogComponent,
  AbandonTxDialogData,
  AbandonTxDialogResult,
} from '../../../transactions/components/abandon-tx-dialog/abandon-tx-dialog.component';
import { MiningService } from '../../../../mining/services';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    FitRowsDirective,
    FitTextDirective,
    TxRowComponent,
    MatTooltipModule,
    I18nPipe,
    DecimalPipe,
    BtcxPipe,
  ],
  template: `
    <!-- Nodeless-shell states (mobile / wallet-only): the btcx wallet may
         need onboarding, an unlock, or an Electrum server before there is
         anything to dash-board. Core-mode shells never enter this branch
         (their auth flow gates the route instead). Ported verbatim from the
         retired WalletHomeComponent. -->
    @if (nodelessGate()) {
      <div class="nodeless-state">
        @if (!btcxWallet.initialized() && btcxWallet.isLoading()) {
          <div class="state-loading">
            <mat-spinner diameter="36"></mat-spinner>
          </div>
        } @else if (btcxWallet.seedState() === 'none') {
          <!-- Onboarding entry -->
          <div class="state-card">
            <h2>{{ 'mwallet_onboarding_title' | i18n }}</h2>
            <p class="hint-text">{{ 'mwallet_onboarding_intro' | i18n }}</p>

            <button
              mat-raised-button
              color="primary"
              class="full-width"
              routerLink="/wallet/create"
            >
              <mat-icon>add</mat-icon>
              {{ 'mwallet_create_wallet' | i18n }}
            </button>
            <p class="option-hint">{{ 'mwallet_create_wallet_hint' | i18n }}</p>

            <button mat-stroked-button class="full-width" routerLink="/wallet/restore">
              <mat-icon>restore</mat-icon>
              {{ 'mwallet_restore_wallet' | i18n }}
            </button>
            <p class="option-hint">{{ 'mwallet_restore_wallet_hint' | i18n }}</p>
          </div>
        } @else if (btcxWallet.seedState() === 'locked') {
          <!-- Unlock form -->
          <div class="state-card">
            <h2>{{ 'mwallet_locked_title' | i18n }}</h2>
            <p class="hint-text">{{ 'mwallet_locked_hint' | i18n }}</p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'mwallet_passphrase_label' | i18n }}</mat-label>
              <input
                matInput
                type="password"
                [(ngModel)]="unlockPassphrase"
                (keyup.enter)="unlock()"
                autocomplete="off"
              />
            </mat-form-field>

            @if (unlockError()) {
              <p class="error-text">{{ 'mwallet_unlock_failed' | i18n }}</p>
            }

            <button
              mat-raised-button
              color="primary"
              class="full-width"
              [disabled]="!unlockPassphrase || unlocking()"
              (click)="unlock()"
            >
              @if (unlocking()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                <mat-icon>lock_open</mat-icon>
              }
              {{ 'unlock' | i18n }}
            </button>
          </div>
        } @else {
          <!-- No Electrum server configured -->
          <div class="state-card empty-card">
            <mat-icon class="empty-icon">cloud_off</mat-icon>
            <h3>{{ 'mwallet_no_server_title' | i18n }}</h3>
            <p class="hint-text">{{ 'mwallet_no_server_hint' | i18n }}</p>
            <button mat-stroked-button routerLink="/wallet/settings">
              <mat-icon>settings</mat-icon>
              {{ 'mwallet_server_settings' | i18n }}
            </button>
          </div>
        }
      </div>
    } @else {
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
            @if (isLoadingBlockchain() && !hasLoadedBlockchain()) {
              <div class="loading-state">
                <mat-spinner diameter="24"></mat-spinner>
                <span>{{ 'loading_blockchain_info' | i18n }}</span>
              </div>
            } @else if (blockchainInfo()) {
              <div class="blockchain-info">
                <div class="info-item detail-only">
                  <span class="label">{{ 'chain' | i18n }}</span>
                  <span class="value">{{ getChainName() }}</span>
                </div>
                <!-- Core-only: sync status is IBD/verification semantics. In
                   Electrum mode it degenerates to a meaningless permanent
                   "Synced" (the toolbar bolt shows real Electrum health). -->
                @if (!isRemote()) {
                  <div class="info-item detail-only">
                    <span class="label">{{ 'status' | i18n }}</span>
                    <span
                      class="value"
                      [class.syncing]="syncState().phase !== 'synced'"
                      [class.synced]="syncState().phase === 'synced'"
                    >
                      {{ getSyncStateWithProgress() }}
                    </span>
                  </div>
                }
                <div class="info-item">
                  <span class="label">
                    {{ (viewport.phone() ? 'height' : 'current_block_height') | i18n }}
                  </span>
                  <span class="value">{{ blockchainInfo().blocks | number }}</span>
                </div>
                <div class="info-item">
                  <span class="label">{{ 'network_capacity' | i18n }}</span>
                  <span class="value">{{ getNetworkCapacity() }}</span>
                </div>
                <div class="info-item detail-only">
                  <span class="label">{{ 'last_block_time' | i18n }}</span>
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
            <button
              mat-icon-button
              class="coins-link-btn"
              (click)="goToCoins()"
              [matTooltip]="'coins_title' | i18n"
            >
              <mat-icon>toll</mat-icon>
            </button>
          </mat-card-header>
          <mat-card-content>
            <div class="total-balance" appFitText [fitTextMinPx]="16">
              <span class="amount">{{ getTotalAll() | btcx }}</span>
              <span class="unit">BTCX</span>
            </div>

            <div class="balance-breakdown">
              <div class="breakdown-item">
                <span class="label">{{ 'confirmed' | i18n }}:</span>
                <span class="value confirmed">{{ totalBalance() | btcx }} BTCX</span>
              </div>
              @if (pendingBalance() > 0) {
                <div class="breakdown-item">
                  <span class="label">{{ 'pending' | i18n }}:</span>
                  <span class="value pending">{{ pendingBalance() | btcx }} BTCX</span>
                </div>
              }
              @if (immatureBalance() > 0) {
                <div class="breakdown-item">
                  <span class="label">{{ 'immature' | i18n }}:</span>
                  <span class="value immature">{{ immatureBalance() | btcx }} BTCX</span>
                </div>
              }
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Send / Receive quick actions — the old mobile home's row; phone
             only (wider layouts reach them via the nav). -->
        @if (viewport.phone()) {
          <div class="actions-row">
            <button mat-raised-button color="primary" (click)="goSend()">
              <mat-icon>send</mat-icon>
              {{ 'send' | i18n }}
            </button>
            <button mat-raised-button (click)="goReceive()">
              <mat-icon>call_received</mat-icon>
              {{ 'receive' | i18n }}
            </button>
          </div>
        }

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
            @if (isLoadingTransactions() && !hasLoadedTransactions()) {
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
              <!-- Fit-based recent list (the old mobile-home pattern, now at every
                 width): the viewport flex-fills the card, FitRowsDirective
                 measures how many rows fit — that IS the list length; "view
                 all" goes to the full transactions/history page. The thead is
                 subtracted from the measure (desktop branch only; the phone
                 branch has none). -->
              <div
                class="tx-fit-viewport"
                appFitRows
                [fitRowSelector]="'.fit-row'"
                [fitHeaderSelector]="'thead'"
                [fitMinRows]="3"
                [fitMaxRows]="20"
                [fitFallbackRowPx]="viewport.phone() ? 96 : 46"
                (fitRows)="visibleTxCount.set($event)"
              >
                @if (viewport.phone()) {
                  <!-- Phone: the old mobile-home card list — the shared
                     app-mwallet-tx-row (icon, direction, amount, address,
                     time, status + row menu). Tap = the row's detail action. -->
                  @for (tx of phoneTransactions(); track trackTx(tx.src)) {
                    <div class="tx-item fit-row" (click)="viewTransactionDetails(tx.src)">
                      <app-mwallet-tx-row [tx]="tx.row" />
                    </div>
                  }
                } @else {
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
                      @for (tx of transactions(); track trackTx(tx)) {
                        <tr class="tx-row fit-row" [class.unconfirmed]="tx.confirmations === 0">
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
                              [attr.aria-label]="'actions' | i18n"
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
                              @if (!isRemote()) {
                                <button mat-menu-item (click)="viewTransactionDetails(tx)">
                                  <mat-icon>info</mat-icon>
                                  <span>{{ 'transaction_details' | i18n }}</span>
                                </button>
                              }
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
                }
              </div>
              <div class="view-all-row">
                <a (click)="viewAllTransactions()">{{ 'mwallet_view_all' | i18n }}</a>
              </div>
            }
          </mat-card-content>
        </mat-card>

        <!-- Mining nudge (nodeless, until mining is configured) — the wallet-side
           mirror of the setup wizard's create-wallet nudge. -->
        @if (showMiningHint()) {
          <mat-card class="mine-hint-card">
            <mat-card-content>
              <h3>{{ 'mwallet_mine_hint_title' | i18n }}</h3>
              <p class="hint-text">{{ 'mwallet_mine_hint_text' | i18n }}</p>
              <button mat-stroked-button routerLink="/miner/setup">
                <mat-icon>hardware</mat-icon>
                {{ 'mwallet_mine_setup' | i18n }}
              </button>
            </mat-card-content>
          </mat-card>
        }
      </div>
    }
  `,
  styles: [
    `
      @use 'breakpoints' as bp;

      /* Nodeless states (onboarding / unlock / no-server) — the retired
         mobile home's card look, centered in a 480px column at any width. */
      .nodeless-state {
        padding: 16px;

        .state-loading {
          display: flex;
          justify-content: center;
          padding: 48px 0;
        }

        .state-card {
          max-width: 480px;
          margin: 0 auto;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          padding: 16px;

          h2 {
            margin: 0 0 8px;
            font-size: 18px;
            font-weight: 500;
          }

          h3 {
            margin: 8px 0 4px;
            font-size: 15px;
            font-weight: 500;
          }
        }

        .empty-card {
          text-align: center;

          .empty-icon {
            font-size: 36px;
            width: 36px;
            height: 36px;
            color: rgba(0, 0, 0, 0.3);
          }
        }

        .hint-text {
          color: rgba(0, 0, 0, 0.6);
          font-size: 13px;
          margin: 0 0 16px;
        }

        .option-hint {
          color: rgba(0, 0, 0, 0.5);
          font-size: 12px;
          margin: 6px 0 16px;
        }

        .error-text {
          color: #c62828;
          font-size: 13px;
          margin: 0 0 12px;
        }

        .full-width {
          width: 100%;
        }
      }

      :host-context(.dark-theme) .nodeless-state .state-card {
        background: #424242;
        color: white;

        .hint-text {
          color: rgba(255, 255, 255, 0.7);
        }

        .option-hint {
          color: rgba(255, 255, 255, 0.5);
        }
      }

      /* Fill the routed content column (both shells are bounded flex columns)
         so the transactions card can flex into the leftover viewport height —
         the fit-based recent list needs a real height to measure. */
      :host {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .bitcoin-dashboard {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        /* Top cards fixed; the transactions row takes the leftover height
           (minmax 0 so it can shrink — the fit list sizes to it). */
        grid-template-rows: 250px minmax(0, 1fr);
        gap: 16px;
        padding: 16px;
        box-sizing: border-box;

        /* Two-card mode and below: the balance-history chart is dropped
           entirely (only status + balance remain in the top row), so a single
           250px row holds them and the transactions card follows. */
        @include bp.desktop-down {
          grid-template-columns: repeat(2, 1fr);
          grid-template-rows: 250px minmax(0, 1fr);

          .balance-chart-card {
            display: none;
          }

          /* Not enough width for the full txid alongside the other columns. */
          .transactions-table .col-txid {
            display: none;
          }
        }

        /* Single-card mode: simplify the Network card to just height +
           capacity (the old mobile dashboard). chain / status / last-block-time
           are the "detail-only" rows, hidden here. */
        @include bp.phone {
          grid-template-columns: 1fr;
          grid-template-rows: auto auto minmax(240px, 1fr);
          /* 12px page rhythm (old mobile). Card-density overrides live at
             the END of this stylesheet — they must FOLLOW the base card
             blocks to win their equal-specificity !important ties. */
          gap: 12px;
          padding: 12px;
          /* Room for the actions row: net, balance, actions, transactions. */
          grid-template-rows: auto auto auto minmax(240px, 1fr);

          /* .info-item qualifier beats the base ".blockchain-status-card
             .blockchain-info .info-item { display: flex }" rule, which ties a
             plain .detail-only selector on specificity and wins on order. */
          .blockchain-status-card .info-item.detail-only {
            display: none;
          }

          /* The old mobile network card: two compact stats side by side. */
          .blockchain-status-card .blockchain-info {
            grid-template-columns: repeat(2, auto);
            justify-content: space-between;

            .info-item .label {
              font-size: 10px;
              letter-spacing: 0.4px;
            }

            .info-item .value {
              font-size: 14px;
            }
          }
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

          .coins-link-btn {
            color: rgba(255, 255, 255, 0.8);

            &:hover {
              color: #ffffff;
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
          /* Size lives on the CONTAINER so appFitText can shrink it when the
             amount would overflow; the amount inherits, the unit stays fixed. */
          font-size: 32px;

          &.clickable {
            cursor: pointer;
          }

          .amount {
            font-size: inherit;
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

      .mine-hint-card {
        grid-column: 1 / -1;
        background: #ffffff !important;

        h3 {
          margin: 0 0 4px;
          font-size: 15px;
          font-weight: 500;
        }

        .hint-text {
          color: rgba(0, 0, 0, 0.6);
          font-size: 13px;
          margin: 0 0 12px;
        }
      }

      .transactions-card {
        grid-column: 1 / -1;
        min-height: 0;
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

        /* Bounded flex column (top-aligned, overriding the shared centered
           mat-card-content) so the fit viewport gets the leftover height. */
        mat-card-content {
          overflow: hidden;
          padding: 8px 16px 0 16px !important;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          min-height: 0;
        }

        /* The measured row viewport: basis 0 (height comes from the card, not
           the rows), overflow hidden — the fit-sized list never scrolls. */
        .tx-fit-viewport {
          flex: 1 1 0;
          min-height: 0;
          overflow: hidden;
        }

        /* Phone: the old mobile-home recent-list card rows. */
        .tx-item {
          padding: 6px 0;
          cursor: pointer;

          /* Stretch the row host to the card width (a bare custom element
             can end up inline-level/shrink-to-fit) so the row's
             space-between content right-aligns to the card edge. */
          app-mwallet-tx-row {
            display: block;
            width: 100%;
          }

          &:not(:last-of-type) {
            border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          }
        }

        /* The old mobile-home "view all" affordance, now at every width. */
        .view-all-row {
          display: flex;
          justify-content: flex-end;
          padding: 8px 0 6px;
          flex-shrink: 0;

          a {
            font-size: 13px;
            font-weight: 500;
            color: #1976d2;
            text-decoration: none;
            cursor: pointer;
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

      /* Quick actions row (phone): the old mobile home's Send/Receive pair. */
      .actions-row {
        display: flex;
        gap: 8px;

        button {
          flex: 1;
        }
      }

      /* ── Phone density (old mobile rhythm) ─────────────────────────────
         MUST stay the LAST block: the base card rules above use equally
         specific selectors (some with !important), and a same-specificity
         tie is decided by source order. */
      @include bp.phone {
        .blockchain-status-card mat-card-header,
        .total-balance-card mat-card-header,
        .transactions-card mat-card-header,
        .mine-hint-card mat-card-header {
          padding: 10px 16px 0 16px !important;
        }

        .blockchain-status-card mat-card-content,
        .total-balance-card mat-card-content {
          padding: 8px 16px 12px 16px !important;
        }

        .total-balance-card .total-balance {
          font-size: 28px;
          margin-bottom: 8px;
        }

        .total-balance-card .balance-breakdown {
          padding-top: 8px;

          .breakdown-item {
            padding: 2px 0;
          }
        }
      }
    `,
  ],
})
export class DashboardComponent implements AfterViewInit {
  // Inject centralized state services
  readonly blockchainState = inject(BlockchainStateService);
  readonly walletService = inject(WalletService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly backendRouter = inject(BackendRouterService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly notification = inject(NotificationService);
  private readonly blockExplorer = inject(BlockExplorerService);
  private readonly clipboard = inject(ClipboardService);
  private readonly injector = inject(Injector);
  private readonly dialog = inject(MatDialog);
  private readonly appMode = inject(AppModeService);
  private readonly nodeService = inject(NodeService);
  readonly viewport = inject(ViewportService);
  readonly btcxWallet = inject(BtcxWalletService);
  private readonly mining = inject(MiningService);
  private readonly contactsStore = inject(ContactsStoreService);

  /** Electrum/remote mode — Core-only rows (sync status) are hidden. */
  readonly isRemote = computed(() => this.nodeService.isRemote());

  /**
   * Nodeless-shell gate: the btcx wallet still needs onboarding, an unlock,
   * or an Electrum server — show the state card instead of the dashboard.
   * Always false in the Core-mode shells (their auth flow gates the route).
   */
  readonly nodelessGate = computed(() => {
    if (!this.appMode.isNodeless()) return false;
    if (!this.btcxWallet.initialized() && this.btcxWallet.isLoading()) return true;
    return this.btcxWallet.seedState() !== 'unlocked' || !this.btcxWallet.hasElectrumServer();
  });

  // Unlock form state (nodeless locked seed).
  unlockPassphrase = '';
  readonly unlocking = signal(false);
  readonly unlockError = signal(false);

  // Mining nudge: only in modes where mining can actually run, only once the
  // mining state has loaded (no flash for configured setups).
  private readonly miningStateLoaded = signal(false);
  readonly showMiningHint = computed(
    () =>
      this.appMode.isNodeless() &&
      this.appMode.miningEnabled() &&
      this.miningStateLoaded() &&
      !this.mining.isConfigured()
  );

  async unlock(): Promise<void> {
    if (!this.unlockPassphrase || this.unlocking()) return;
    this.unlocking.set(true);
    this.unlockError.set(false);
    try {
      await this.btcxWallet.unlock(this.unlockPassphrase);
      this.unlockPassphrase = '';
    } catch (err) {
      console.error('Unlock failed:', err);
      this.unlockError.set(true);
    } finally {
      this.unlocking.set(false);
    }
  }

  // Loading states derived from services
  isLoadingBlockchain = computed(() => this.blockchainState.isLoading());
  isLoadingTransactions = computed(() => this.walletService.isLoading());

  // True once each source has completed at least one refresh. Used to gate the
  // loading spinner so it only shows on the initial load — background refreshes
  // (15s/30s poll or btcx-wallet:sync) keep the existing content on screen
  // instead of flashing the spinner and remounting the card body.
  hasLoadedBlockchain = computed(() => this.blockchainState.lastUpdated() !== null);
  hasLoadedTransactions = computed(() => this.walletService.lastUpdated() !== null);

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
  // Fit-based recent list (the old mobile-home pattern at every width):
  // FitRowsDirective measures how many rows fit the card; that IS the list
  // length. The initial value only covers the first paint.
  readonly visibleTxCount = signal(6);
  readonly transactions = computed(() => this.allTransactions().slice(0, this.visibleTxCount()));
  /** Phone rows mapped for the shared mobile tx-row (source kept for actions). */
  readonly phoneTransactions = computed(() =>
    this.transactions().map(tx => ({ src: tx, row: this.toRowTx(tx) }))
  );

  // Chart data
  chartPoints = signal<{ x: number; y: number; balance: number }[]>([]);
  chartLabels = signal<string[]>([]);
  yAxisLabels = signal<string[]>([]);

  ngAfterViewInit(): void {
    // Nodeless shell bootstrap (the retired home's ngOnInit): fresh contacts
    // book for the row menus, wallet runtime up, the tx window pointed at the
    // recent slice, and the mining state for the nudge (only where the mining
    // backend exists — Android wallet-only has no such commands).
    if (this.appMode.isNodeless()) {
      this.contactsStore.load();
      void this.btcxWallet.initialize().then(() => {
        if (this.btcxWallet.walletActive()) {
          void this.btcxWallet.refreshTransactions(RECENT_TX_LIMIT);
        }
      });
      if (this.appMode.hasMiningBackend()) {
        void this.mining.getState().then(() => this.miningStateLoaded.set(true));
      }
    }

    effect(
      () => {
        const txs = this.allTransactions();
        if (txs.length === 0) return;
        this.updateBalanceChart(txs);
      },
      { injector: this.injector }
    );
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

  getChartLinePath = computed<string>(() => {
    const points = this.chartPoints();
    if (points.length < 2) return '';

    let path = `M ${points[0].x} ${points[0].y}`;
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
    return path;
  });

  getChartAreaPath = computed<string>(() => {
    const points = this.chartPoints();
    if (points.length < 2) return '';

    const bottomY = 100;
    let path = `M ${points[0].x} ${bottomY} L ${points[0].x} ${points[0].y}`;
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
    path += ` L ${points[points.length - 1].x} ${bottomY} Z`;
    return path;
  });

  getGridXPositions = computed<number[]>(() => {
    const points = this.chartPoints();
    if (points.length < 2) return [];
    return points.map(p => p.x);
  });

  // Balance methods
  getTotalAll(): number {
    return this.totalBalance() + this.pendingBalance() + this.immatureBalance();
  }

  /** Open the per-address "Coins & Addresses" view (shell-aware route). */
  goToCoins(): void {
    void this.router.navigate([this.appMode.pageRoute('/coins')]);
  }

  goSend(): void {
    void this.router.navigate([this.appMode.pageRoute('/send')]);
  }

  goReceive(): void {
    void this.router.navigate([this.appMode.pageRoute('/receive')]);
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
    const date = new Date(tx.time * 1000);
    return date.toLocaleDateString(this.i18n.currentLanguageCode(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatTxTime(tx: WalletTransaction): string {
    const date = new Date(tx.time * 1000);
    return date.toLocaleTimeString(this.i18n.currentLanguageCode(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Stable identity for a Core-shaped tx row (vout/category disambiguate). */
  trackTx(tx: WalletTransaction): string {
    return `${tx.txid}-${tx.vout}-${tx.category}`;
  }

  /** Full transactions/history page (shell-aware route). */
  viewAllTransactions(): void {
    void this.router.navigate([this.appMode.pageRoute('/transactions')]);
  }

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

  // Actions — all navigation goes through pageRoute() so the SAME component
  // links correctly under both shells (desktop `/x` vs nodeless `/wallet/x`).
  viewTransactionDetails(tx: WalletTransaction): void {
    // Details are a Core-RPC feature — in Electrum/remote mode (any shell)
    // the destination is the transactions/history LIST instead.
    if (this.isRemote()) {
      this.router.navigate([this.appMode.pageRoute('/transactions')]);
      return;
    }
    this.router.navigate(['/transactions', tx.txid]);
  }

  copyToClipboard(text: string): void {
    this.clipboard.copy(text);
  }

  addToContacts(tx: WalletTransaction): void {
    if (!tx.address) return;
    // Navigate to contacts with the address
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

      // Refresh wallet service for balance and transaction updates
      this.walletService.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('bump_fee_error');
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
      this.walletService.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('abandon_tx_error');
      this.notification.error(message);
    }
  }
}
