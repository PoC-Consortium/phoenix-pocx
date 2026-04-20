import { Component, inject, signal, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import { BtcxPipe, ByteSizePipe } from '../../../../shared/pipes';
import { HashRefComponent } from '../../../../shared/components';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import {
  WalletRpcService,
  WalletTransaction,
} from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import {
  BlockchainRpcService,
  Transaction,
  TransactionInput,
  TransactionOutput,
} from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import {
  FeeBumpDialogComponent,
  FeeBumpDialogData,
  FeeBumpDialogResult,
} from '../../components/fee-bump-dialog/fee-bump-dialog.component';

interface FullTransaction {
  wallet: WalletTransaction & { hex?: string };
  raw: Transaction | null;
}

type InputReference =
  | { kind: 'coinbase' }
  | {
      kind: 'spend';
      txid: string;
      vout: number;
      address: string | null;
      amount: number | null;
    };

type OutputReference =
  | { kind: 'address'; address: string }
  | { kind: 'op_return' }
  | { kind: 'unknown' };

@Component({
  selector: 'app-transaction-detail',
  standalone: true,
  imports: [
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    I18nPipe,
    ByteSizePipe,
    BtcxPipe,
    HashRefComponent,
  ],
  template: `
    <div class="page-layout">
      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'transaction_details' | i18n }}</h1>
        </div>
      </div>

      <div class="content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="48"></mat-spinner>
            <p>{{ 'loading' | i18n }}...</p>
          </div>
        } @else if (error()) {
          <div class="error-container">
            <mat-icon>search_off</mat-icon>
            <p>{{ error() }}</p>
            <button mat-raised-button color="primary" (click)="goBack()">
              <mat-icon>arrow_back</mat-icon>
              {{ 'go_back' | i18n }}
            </button>
          </div>
        } @else if (tx()) {
          <div class="details-container">
            <!-- Summary Card -->
            <div class="summary-card">
              <div class="summary-header">
                <div class="txid-row">
                  <span class="label">{{ 'transaction_id' | i18n }}</span>
                  <app-hash-ref
                    [value]="tx()!.wallet.txid"
                    kind="txid"
                    [link]="false"
                    [truncate]="false"
                  />
                </div>
                <div class="status-row">
                  <span class="status-badge" [class]="getConfirmationClass()">
                    {{ getConfirmationStatus() }}
                  </span>
                  @if (isRbfEligible()) {
                    <span class="rbf-badge" [matTooltip]="'transaction_replaceable' | i18n">
                      <mat-icon>speed</mat-icon>
                      {{ 'rbf_enabled' | i18n }}
                    </span>
                  }
                  <span class="timestamp">{{ formatDate(tx()!.wallet.time) }}</span>
                  @if (canBumpFee()) {
                    <button mat-stroked-button class="bump-fee-btn" (click)="openBumpFeeDialog()">
                      <mat-icon>speed</mat-icon>
                      {{ 'bump_fee' | i18n }}
                    </button>
                  }
                </div>
              </div>

              <!-- Metrics Grid -->
              <div class="metrics-grid">
                <div class="metric">
                  <span class="metric-label">{{ 'amount' | i18n }}</span>
                  <span class="metric-value amount-badge" [class]="getAmountClass()">
                    {{ tx()!.wallet.amount >= 0 ? '+' : '' }}{{ tx()!.wallet.amount | btcx }} BTCX
                  </span>
                </div>
                @if (tx()!.wallet.fee !== undefined && tx()!.wallet.fee !== null) {
                  <div class="metric">
                    <span class="metric-label">{{ 'fee' | i18n }}</span>
                    <span class="metric-value fee"
                      >{{ Math.abs(tx()!.wallet.fee!) | btcx }} BTCX</span
                    >
                  </div>
                }
                @if (tx()!.raw?.size) {
                  <div class="metric">
                    <span class="metric-label">{{ 'size' | i18n }}</span>
                    <span class="metric-value">{{ tx()!.raw!.size | byteSize }}</span>
                  </div>
                }
                @if (tx()!.raw?.vsize) {
                  <div class="metric">
                    <span class="metric-label">{{ 'virtual_size' | i18n }}</span>
                    <span class="metric-value">{{ tx()!.raw!.vsize }} vB</span>
                  </div>
                }
                @if (feeRate() > 0) {
                  <div class="metric">
                    <span class="metric-label">{{ 'fee_rate' | i18n }}</span>
                    <span class="metric-value">{{ feeRate().toFixed(2) }} sat/vB</span>
                  </div>
                }
                @if (tx()!.raw?.weight) {
                  <div class="metric">
                    <span class="metric-label">{{ 'weight' | i18n }}</span>
                    <span class="metric-value">{{ tx()!.raw!.weight }} WU</span>
                  </div>
                }
              </div>
            </div>

            <!-- Inputs and Outputs -->
            @if (tx()!.raw) {
              <div class="io-section">
                <div class="io-container">
                  <!-- Inputs -->
                  <div class="io-card">
                    <h3 class="section-title">
                      {{ 'inputs' | i18n }}
                      <span class="count">({{ tx()!.raw!.vin.length || 0 }})</span>
                    </h3>
                    <div class="io-list">
                      @for (vin of tx()!.raw!.vin; track $index; let i = $index) {
                        @let ref = getInputReference(vin);
                        <div class="io-item">
                          <div class="io-index">#{{ i }}</div>
                          <div class="io-details">
                            @if (ref.kind === 'coinbase') {
                              <span class="io-coinbase">Coinbase</span>
                            } @else {
                              <app-hash-ref
                                [value]="ref.txid"
                                kind="txid"
                                [suffix]="':' + ref.vout"
                                [link]="false"
                              />
                              @if (ref.address) {
                                <app-hash-ref
                                  [value]="ref.address"
                                  kind="address"
                                  [truncate]="false"
                                />
                              }
                              @if (ref.amount !== null && ref.amount > 0) {
                                <div class="io-amount">{{ ref.amount | btcx }} BTCX</div>
                              }
                            }
                          </div>
                        </div>
                      }
                      @if (totalInput() > 0) {
                        <div class="io-total">
                          <span class="total-label">{{ 'total' | i18n }}</span>
                          <span class="total-value">{{ totalInput() | btcx }} BTCX</span>
                        </div>
                      }
                    </div>
                  </div>

                  <!-- Arrow -->
                  <div class="io-arrow">
                    <mat-icon>arrow_forward</mat-icon>
                  </div>

                  <!-- Outputs -->
                  <div class="io-card">
                    <h3 class="section-title">
                      {{ 'outputs' | i18n }}
                      <span class="count">({{ tx()!.raw!.vout.length || 0 }})</span>
                    </h3>
                    <div class="io-list">
                      @for (vout of tx()!.raw!.vout; track vout.n) {
                        @let out = getOutputReference(vout);
                        <div class="io-item">
                          <div class="io-index">#{{ vout.n }}</div>
                          <div class="io-details">
                            @switch (out.kind) {
                              @case ('address') {
                                <app-hash-ref
                                  [value]="out.address"
                                  kind="address"
                                  [truncate]="false"
                                />
                              }
                              @case ('op_return') {
                                <span class="io-coinbase">OP_RETURN</span>
                              }
                              @case ('unknown') {
                                <span class="io-coinbase">Unknown</span>
                              }
                            }
                            <div class="io-amount">{{ vout.value | btcx }} BTCX</div>
                          </div>
                        </div>
                      }
                      <div class="io-total">
                        <span class="total-label">{{ 'total' | i18n }}</span>
                        <span class="total-value">{{ totalOutput() | btcx }} BTCX</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            }

            <!-- Block Info -->
            @if (tx()!.wallet.blockhash) {
              <div class="details-card">
                <h3 class="section-title">{{ 'block_info' | i18n }}</h3>
                <div class="detail-grid">
                  <div class="detail-item full-width">
                    <span class="label">{{ 'block_hash' | i18n }}</span>
                    <app-hash-ref
                      [value]="tx()!.wallet.blockhash!"
                      kind="blockhash"
                      [truncate]="false"
                    />
                  </div>
                  @if (tx()!.wallet.blockheight) {
                    <div class="detail-item">
                      <span class="label">{{ 'block_height' | i18n }}</span>
                      <span class="value">{{ tx()!.wallet.blockheight }}</span>
                    </div>
                  }
                  @if (tx()!.wallet.blocktime) {
                    <div class="detail-item">
                      <span class="label">{{ 'block_time' | i18n }}</span>
                      <span class="value">{{ formatDate(tx()!.wallet.blocktime!) }}</span>
                    </div>
                  }
                  @if (tx()!.wallet.blockindex !== undefined) {
                    <div class="detail-item">
                      <span class="label">{{ 'block_index' | i18n }}</span>
                      <span class="value">{{ tx()!.wallet.blockindex }}</span>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Technical Details -->
            <div class="details-card">
              <h3 class="section-title">{{ 'technical_details' | i18n }}</h3>
              <div class="detail-grid">
                @if (tx()!.raw?.version !== undefined) {
                  <div class="detail-item">
                    <span class="label">{{ 'version' | i18n }}</span>
                    <span class="value">{{ tx()!.raw!.version }}</span>
                  </div>
                }
                @if (tx()!.raw?.locktime !== undefined) {
                  <div class="detail-item">
                    <span class="label">{{ 'locktime' | i18n }}</span>
                    <span class="value">{{ tx()!.raw!.locktime }}</span>
                  </div>
                }
                <div class="detail-item">
                  <span class="label">{{ 'time_received' | i18n }}</span>
                  <span class="value">{{ formatDate(tx()!.wallet.timereceived) }}</span>
                </div>
                @if (tx()!.wallet.wtxid && tx()!.wallet.wtxid !== tx()!.wallet.txid) {
                  <div class="detail-item full-width">
                    <span class="label">{{ 'wtxid' | i18n }}</span>
                    <app-hash-ref [value]="tx()!.wallet.wtxid!" kind="plain" [truncate]="false" />
                  </div>
                }
              </div>
            </div>

            <!-- Raw Hex -->
            @if (tx()!.wallet.hex) {
              <div class="details-card">
                <h3 class="section-title">{{ 'raw_transaction' | i18n }}</h3>
                <div class="detail-grid">
                  <div class="detail-item full-width">
                    <app-hash-ref
                      [value]="tx()!.wallet.hex!"
                      kind="plain"
                      [startChars]="32"
                      [endChars]="24"
                    />
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .page-layout {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        align-items: center;

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;

          h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 300;
          }
        }

        .back-button {
          color: white;
        }
      }

      .content {
        padding: 24px;
        overflow-y: auto;
      }

      .loading-container,
      .error-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 300px;
        text-align: center;
        color: rgba(0, 0, 0, 0.54);

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          margin-bottom: 16px;
        }

        p {
          margin: 16px 0;
        }
      }

      .details-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 1200px;
        margin: 0 auto;
      }

      // Summary Card
      .summary-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px 24px;

        .summary-header {
          margin-bottom: 20px;

          .txid-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            flex-wrap: wrap;

            .label {
              font-size: 12px;
              color: #666;
              text-transform: uppercase;
            }

            .txid {
              font-family: monospace;
              font-size: 13px;
              color: #1565c0;
              cursor: pointer;
              word-break: break-all;
              flex: 1;
              min-width: 200px;

              &:hover {
                text-decoration: underline;
              }
            }
          }

          .status-row {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;

            .timestamp {
              font-size: 13px;
              color: #666;
            }

            .rbf-badge {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              padding: 4px 10px;
              border-radius: 10px;
              font-size: 11px;
              font-weight: 500;
              background: #e3f2fd;
              color: #1565c0;

              mat-icon {
                font-size: 14px;
                width: 14px;
                height: 14px;
              }
            }

            .bump-fee-btn {
              height: 32px;
              padding: 0 12px;
              font-size: 12px;
              border-color: #1976d2;
              color: #1976d2;

              mat-icon {
                font-size: 16px;
                width: 16px;
                height: 16px;
                margin-right: 4px;
              }

              &:hover {
                background: rgba(25, 118, 210, 0.08);
              }
            }
          }
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 16px;

          .metric {
            display: flex;
            flex-direction: column;
            gap: 4px;

            .metric-label {
              font-size: 11px;
              color: #888;
              text-transform: uppercase;
            }

            .metric-value {
              font-size: 14px;
              font-weight: 500;
              color: rgb(0, 35, 65);

              &.fee {
                font-family: monospace;
                color: #666;
              }
            }
          }
        }
      }

      .amount-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 10px;
        font-weight: 600;
        font-family: monospace;
        font-size: 13px;
        background: #e6e6f2;
        color: rgb(0, 35, 65);

        &.incoming {
          background: #cdffcd;
          color: #007f00;
        }

        &.outgoing {
          background: #ffe0e0;
          color: #d30000;
        }
      }

      .status-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 500;

        &.confirmed {
          background: #cdffcd;
          color: #007f00;
        }

        &.confirming {
          background: #fff0d0;
          color: #b36800;
        }

        &.pending {
          background: #e6e6f2;
          color: rgb(0, 35, 65);
          animation: pulse 2s ease-in-out infinite;
        }
      }

      // Inputs/Outputs Section
      .io-section {
        .io-container {
          display: flex;
          gap: 16px;
          align-items: flex-start;

          @media (max-width: 900px) {
            flex-direction: column;

            .io-arrow {
              transform: rotate(90deg);
              align-self: center;
            }
          }
        }

        .io-card {
          flex: 1;
          background: #ffffff;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          padding: 16px 20px;
          min-width: 0;

          .section-title {
            font-size: 14px;
            font-weight: 600;
            color: rgb(0, 35, 65);
            margin: 0 0 12px 0;

            .count {
              font-weight: 400;
              color: #888;
            }
          }
        }

        .io-arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px 8px;
          color: #1976d2;

          mat-icon {
            font-size: 32px;
            width: 32px;
            height: 32px;
          }
        }

        .io-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .io-item {
          display: flex;
          gap: 12px;
          padding: 8px 12px;
          background: #f8fafc;
          border-radius: 4px;

          .io-index {
            font-size: 11px;
            color: #888;
            font-family: monospace;
            min-width: 24px;
          }

          .io-details {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;

            .io-address {
              font-family: monospace;
              font-size: 12px;
              color: #1565c0;
              cursor: pointer;
              word-break: break-all;

              &:hover {
                text-decoration: underline;
              }
            }

            .io-address.io-prevref {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              color: rgba(0, 0, 0, 0.6);
              cursor: default;

              &:hover {
                text-decoration: none;
              }

              .prevref-text {
                cursor: pointer;

                &:hover {
                  text-decoration: underline;
                }
              }

              .prevref-open {
                width: 24px;
                height: 24px;
                line-height: 24px;
                padding: 0;

                mat-icon {
                  font-size: 16px;
                  width: 16px;
                  height: 16px;
                }
              }
            }

            .io-address.io-coinbase {
              color: rgba(0, 0, 0, 0.6);
              cursor: default;

              &:hover {
                text-decoration: none;
              }
            }

            .io-amount {
              font-family: monospace;
              font-size: 13px;
              font-weight: 500;
              color: rgb(0, 35, 65);
            }
          }
        }

        .io-total {
          display: flex;
          justify-content: space-between;
          padding: 12px;
          border-top: 1px solid #e8e8e8;
          margin-top: 8px;

          .total-label {
            font-size: 12px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
          }

          .total-value {
            font-family: monospace;
            font-size: 14px;
            font-weight: 600;
            color: rgb(0, 35, 65);
          }
        }
      }

      // Details Cards
      .details-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 16px 20px;

        .section-title {
          font-size: 14px;
          font-weight: 600;
          color: rgb(0, 35, 65);
          margin: 0 0 16px 0;
          padding-bottom: 8px;
          border-bottom: 2px solid #1976d2;
          display: inline-block;
        }

        .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;

          .detail-item {
            display: flex;
            flex-direction: column;
            gap: 4px;

            &.full-width {
              grid-column: 1 / -1;
            }

            .label {
              font-size: 11px;
              color: #888;
              text-transform: uppercase;
            }

            .value {
              font-size: 13px;
              color: rgb(0, 35, 65);
              word-break: break-all;

              &.hash {
                font-family: monospace;
                font-size: 12px;
                color: #1565c0;
                cursor: pointer;

                &:hover {
                  text-decoration: underline;
                }
              }
            }
          }
        }
      }

      // Raw Hex
      .raw-hex-container {
        background: #f5f7fa;
        border: 1px solid #e8e8e8;
        border-radius: 4px;
        padding: 12px;
        position: relative;

        code {
          font-family: monospace;
          font-size: 11px;
          word-break: break-all;
          color: #333;
          display: block;
          max-height: 100px;
          overflow-y: auto;
          padding-right: 40px;
        }

        .copy-btn {
          position: absolute;
          top: 4px;
          right: 4px;
        }
      }

      .copy-btn {
        width: 28px;
        height: 28px;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: #666;
        }

        &:hover mat-icon {
          color: #1976d2;
        }
      }

      @keyframes pulse {
        0% {
          opacity: 1;
        }
        50% {
          opacity: 0.6;
        }
        100% {
          opacity: 1;
        }
      }

      // Dark theme
      :host-context(.dark-theme) {
        .summary-card,
        .io-card,
        .details-card {
          background: #424242;
        }

        .summary-header .txid-row .label,
        .summary-header .status-row .timestamp,
        .metrics-grid .metric-label,
        .io-item .io-index,
        .io-total .total-label,
        .detail-grid .detail-item .label {
          color: #aaa;
        }

        .summary-header .txid-row .txid,
        .io-item .io-details .io-address,
        .detail-grid .detail-item .value.hash {
          color: #90caf9;
        }

        .metrics-grid .metric-value,
        .io-item .io-details .io-amount,
        .io-total .total-value,
        .detail-grid .detail-item .value,
        .section-title {
          color: #fff;
        }

        .io-item {
          background: #333;
        }

        .raw-hex-container {
          background: #333;
          border-color: #555;

          code {
            color: #ddd;
          }
        }
      }
    `,
  ],
})
export class TransactionDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly dialog = inject(MatDialog);

  Math = Math;

  loading = signal(true);
  error = signal<string | null>(null);
  tx = signal<FullTransaction | null>(null);
  totalInput = signal(0);
  totalOutput = signal(0);
  feeRate = signal(0);

  ngOnInit(): void {
    const txid = this.route.snapshot.paramMap.get('txid');
    if (txid) {
      this.loadTransaction(txid);
    } else {
      this.error.set('No transaction ID provided');
      this.loading.set(false);
    }
  }

  async loadTransaction(txid: string): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) {
      this.error.set('No wallet selected');
      this.loading.set(false);
      return;
    }

    try {
      // Get wallet transaction (includes hex)
      const walletTx = await this.walletRpc.getTransaction(walletName, txid);

      // Try to get raw transaction with prevout info (verbosity=2)
      let rawTx: Transaction | null = null;
      try {
        // Try verbosity 2 first (includes prevout data in Bitcoin Core 24+)
        rawTx = (await this.blockchainRpc.getRawTransaction(txid, true)) as Transaction;
      } catch {
        // If getrawtransaction fails, decode from wallet hex
        if (walletTx.hex) {
          try {
            rawTx = await this.blockchainRpc.decodeRawTransaction(walletTx.hex);
          } catch (e2) {
            console.warn('Failed to decode raw transaction:', e2);
          }
        }
      }

      // Try to fill in prevout for any input that is missing it. Core can return
      // a mix (some vins carry prevout, others don't) so each input is decided
      // on its own merits inside populatePrevoutData.
      if (rawTx && rawTx.vin && rawTx.vin.length > 0) {
        await this.populatePrevoutData(walletName, rawTx);
      }

      this.tx.set({ wallet: walletTx, raw: rawTx });
      this.computeValues();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load transaction';
      this.error.set(message);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Fetch previous transactions to populate prevout data for inputs
   */
  private async populatePrevoutData(walletName: string, rawTx: Transaction): Promise<void> {
    for (const vin of rawTx.vin) {
      // Already carries prevout (came through verbose getrawtransaction) — nothing to do.
      if (vin.prevout?.scriptPubKey) {
        continue;
      }
      // Skip coinbase inputs
      if (!vin.txid || vin.txid === '0'.repeat(64) || vin.coinbase) {
        continue;
      }

      try {
        // Try to get the previous transaction from wallet first
        const prevTx = await this.walletRpc.getTransaction(walletName, vin.txid);
        if (prevTx?.hex) {
          const decodedPrev = await this.blockchainRpc.decodeRawTransaction(prevTx.hex);
          if (decodedPrev?.vout && vin.vout !== undefined && decodedPrev.vout[vin.vout]) {
            const prevVout = decodedPrev.vout[vin.vout];
            vin.prevout = {
              generated: false,
              height: 0,
              value: prevVout.value,
              scriptPubKey: prevVout.scriptPubKey,
            };
          }
        }
      } catch {
        // Previous transaction not in wallet, try getrawtransaction
        try {
          const prevRawTx = (await this.blockchainRpc.getRawTransaction(
            vin.txid,
            true
          )) as Transaction;
          if (prevRawTx?.vout && vin.vout !== undefined && prevRawTx.vout[vin.vout]) {
            const prevVout = prevRawTx.vout[vin.vout];
            vin.prevout = {
              generated: false,
              height: 0,
              value: prevVout.value,
              scriptPubKey: prevVout.scriptPubKey,
            };
          }
        } catch {
          console.warn(`Could not fetch prevout for input ${vin.txid}:${vin.vout}`);
        }
      }
    }
  }

  private computeValues(): void {
    const transaction = this.tx();
    if (!transaction?.raw) return;

    // Calculate total input (from prevout values if available)
    const totalIn = transaction.raw.vin.reduce((sum, vin) => {
      const value = vin.prevout?.value ?? 0;
      return sum + value;
    }, 0);
    this.totalInput.set(totalIn);

    // Calculate total output
    const totalOut = transaction.raw.vout.reduce((sum, vout) => sum + vout.value, 0);
    this.totalOutput.set(totalOut);

    // Calculate fee rate (sat/vB)
    if (transaction.wallet.fee && transaction.raw.vsize) {
      const feeSats = Math.abs(transaction.wallet.fee) * 100000000;
      this.feeRate.set(feeSats / transaction.raw.vsize);
    }
  }

  goBack(): void {
    this.location.back();
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString(this.i18n.currentLanguageCode(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  getAmountClass(): string {
    const transaction = this.tx();
    if (!transaction) return '';
    return transaction.wallet.amount >= 0 ? 'incoming' : 'outgoing';
  }

  getConfirmationStatus(): string {
    const transaction = this.tx();
    if (!transaction) return '';

    if (transaction.wallet.confirmations === 0) {
      return this.i18n.get('pending');
    } else if (transaction.wallet.confirmations < 6) {
      return `${transaction.wallet.confirmations} ${this.i18n.get('confirmations_short') || 'conf.'}`;
    } else {
      return `${transaction.wallet.confirmations} (${this.i18n.get('confirmed')})`;
    }
  }

  getConfirmationClass(): string {
    const transaction = this.tx();
    if (!transaction) return '';

    if (transaction.wallet.confirmations === 0) {
      return 'pending';
    } else if (transaction.wallet.confirmations < 6) {
      return 'confirming';
    } else {
      return 'confirmed';
    }
  }

  /**
   * Describe an input for rendering. Every non-coinbase input is represented as
   * a `spend` referencing a prev-tx output; the prevout's address and value are
   * included when they were resolvable, and left null otherwise.
   */
  getInputReference(vin: TransactionInput): InputReference {
    if (vin.coinbase || !vin.txid || vin.txid === '0'.repeat(64)) {
      return { kind: 'coinbase' };
    }
    return {
      kind: 'spend',
      txid: vin.txid,
      vout: vin.vout ?? 0,
      address: vin.prevout?.scriptPubKey?.address ?? null,
      amount: vin.prevout?.value ?? null,
    };
  }

  getOutputReference(vout: TransactionOutput): OutputReference {
    if (vout.scriptPubKey?.address) {
      return { kind: 'address', address: vout.scriptPubKey.address };
    }
    if (vout.scriptPubKey?.type === 'nulldata') {
      return { kind: 'op_return' };
    }
    return { kind: 'unknown' };
  }

  isRbfEligible(): boolean {
    const transaction = this.tx();
    if (!transaction) return false;
    return transaction.wallet.bip125_replaceable === 'yes';
  }

  canBumpFee(): boolean {
    const transaction = this.tx();
    if (!transaction) return false;
    return (
      transaction.wallet.confirmations === 0 &&
      transaction.wallet.bip125_replaceable === 'yes' &&
      transaction.wallet.category === 'send'
    );
  }

  async openBumpFeeDialog(): Promise<void> {
    const transaction = this.tx();
    if (!transaction) return;

    const dialogRef = this.dialog.open(FeeBumpDialogComponent, {
      width: '500px',
      data: {
        txid: transaction.wallet.txid,
        originalFee: Math.abs(transaction.wallet.fee ?? 0),
        amount: Math.abs(transaction.wallet.amount),
        address: transaction.wallet.address,
      } as FeeBumpDialogData,
    });

    const result = (await firstValueFrom(dialogRef.afterClosed())) as
      | FeeBumpDialogResult
      | undefined;
    if (result?.confirmed) {
      await this.executeBumpFee(transaction.wallet.txid, result);
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

      // Refresh wallet service for balance updates
      this.walletService.refresh();

      // Navigate to the new transaction
      this.loadTransaction(result.txid);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('bump_fee_error');
      this.notification.error(message);
    }
  }
}
