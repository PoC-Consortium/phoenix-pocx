import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { Subject } from 'rxjs';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService, BlockExplorerService } from '../../../../shared/services';
import {
  BlockchainRpcService,
  Transaction,
} from '../../../../bitcoin/services/rpc/blockchain-rpc.service';

@Component({
  selector: 'app-transaction-details',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatExpansionModule,
    I18nPipe,
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

      <!-- Content -->
      <div class="content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="48"></mat-spinner>
            <p>{{ 'loading_transaction' | i18n }}</p>
          </div>
        } @else if (error()) {
          <div class="error-container">
            <mat-icon>error</mat-icon>
            <p>{{ error() }}</p>
            <button mat-stroked-button (click)="goBack()">{{ 'go_back' | i18n }}</button>
          </div>
        } @else if (tx()) {
          <!-- Summary Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'summary' | i18n }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="detail-row">
                <span class="label">{{ 'txid' | i18n }}</span>
                <div class="value hash-value">
                  <span (click)="copyToClipboard(tx()!.txid)" [matTooltip]="'copy' | i18n">{{
                    tx()!.txid
                  }}</span>
                  <mat-icon
                    class="copy-icon"
                    (click)="copyToClipboard(tx()!.txid)"
                    [matTooltip]="'copy' | i18n"
                    >content_copy</mat-icon
                  >
                  <mat-icon
                    class="explorer-icon"
                    (click)="openTransactionInExplorer(tx()!.txid)"
                    [matTooltip]="'view_tx_in_explorer' | i18n"
                    >open_in_new</mat-icon
                  >
                </div>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'status' | i18n }}</span>
                <span class="value">
                  @if (tx()!.confirmations && tx()!.confirmations! > 0) {
                    <span class="status-badge confirmed"
                      >{{ 'confirmed' | i18n }} ({{ tx()!.confirmations }})</span
                    >
                  } @else {
                    <span class="status-badge pending">{{ 'pending' | i18n }}</span>
                  }
                </span>
              </div>
              @if (tx()!.time) {
                <div class="detail-row">
                  <span class="label">{{ 'timestamp' | i18n }}</span>
                  <span class="value">{{ formatDate(tx()!.time!) }}</span>
                </div>
              }
              <div class="detail-row">
                <span class="label">{{ 'size' | i18n }}</span>
                <span class="value">{{ tx()!.size }} bytes</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'virtual_size' | i18n }}</span>
                <span class="value">{{ tx()!.vsize }} vB</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'weight' | i18n }}</span>
                <span class="value">{{ tx()!.weight }} WU</span>
              </div>
              @if (calculatedFee() !== null) {
                <div class="detail-row">
                  <span class="label">{{ 'fee' | i18n }}</span>
                  <span class="value mono">{{ formatBtcx(calculatedFee()!) }} BTCX</span>
                </div>
                <div class="detail-row">
                  <span class="label">{{ 'fee_rate' | i18n }}</span>
                  <span class="value mono">{{ calculateFeeRate() }} sat/vB</span>
                </div>
              }
            </mat-card-content>
          </mat-card>

          <!-- Inputs Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'inputs' | i18n }} ({{ tx()!.vin.length }})</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              @for (input of tx()!.vin; track $index; let i = $index) {
                <div class="io-row">
                  <div class="io-index">{{ i }}</div>
                  <div class="io-content">
                    @if (input.coinbase) {
                      <div class="io-address coinbase">
                        <mat-icon>stars</mat-icon>
                        <span>{{ 'coinbase' | i18n }} ({{ 'block_reward' | i18n }})</span>
                      </div>
                    } @else {
                      <div class="io-address">
                        <span
                          (click)="copyToClipboard(getInputAddress(input))"
                          [matTooltip]="'copy' | i18n"
                          >{{ getInputAddress(input) }}</span
                        >
                        <mat-icon
                          class="copy-icon"
                          (click)="copyToClipboard(getInputAddress(input))"
                          [matTooltip]="'copy' | i18n"
                          >content_copy</mat-icon
                        >
                        @if (input.prevout?.scriptPubKey?.address) {
                          <mat-icon
                            class="explorer-icon"
                            (click)="openAddressInExplorer(input.prevout!.scriptPubKey!.address!)"
                            [matTooltip]="'view_address_in_explorer' | i18n"
                            >open_in_new</mat-icon
                          >
                        }
                      </div>
                      @if (input.prevout?.value !== undefined) {
                        <div class="io-amount">{{ formatBtcx(input.prevout!.value) }} BTCX</div>
                      }
                    }
                  </div>
                </div>
              }
              @if (totalInput() !== null) {
                <div class="io-total">
                  <span class="label">{{ 'total_input' | i18n }}</span>
                  <span class="value mono">{{ formatBtcx(totalInput()!) }} BTCX</span>
                </div>
              }
            </mat-card-content>
          </mat-card>

          <!-- Outputs Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'outputs' | i18n }} ({{ tx()!.vout.length }})</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              @for (output of tx()!.vout; track output.n) {
                <div class="io-row">
                  <div class="io-index">{{ output.n }}</div>
                  <div class="io-content">
                    <div class="io-address">
                      <span
                        (click)="copyToClipboard(output.scriptPubKey.address || 'N/A')"
                        [matTooltip]="'copy' | i18n"
                        >{{ output.scriptPubKey.address || 'OP_RETURN / Non-standard' }}</span
                      >
                      @if (output.scriptPubKey.address) {
                        <mat-icon
                          class="copy-icon"
                          (click)="copyToClipboard(output.scriptPubKey.address)"
                          [matTooltip]="'copy' | i18n"
                          >content_copy</mat-icon
                        >
                        <mat-icon
                          class="explorer-icon"
                          (click)="openAddressInExplorer(output.scriptPubKey.address)"
                          [matTooltip]="'view_address_in_explorer' | i18n"
                          >open_in_new</mat-icon
                        >
                      }
                    </div>
                    <div class="io-amount">{{ formatBtcx(output.value) }} BTCX</div>
                  </div>
                </div>
              }
              <div class="io-total">
                <span class="label">{{ 'total_output' | i18n }}</span>
                <span class="value mono">{{ formatBtcx(totalOutput()) }} BTCX</span>
              </div>
            </mat-card-content>
          </mat-card>

          <!-- Block Info Section (if confirmed) -->
          @if (tx()!.blockhash) {
            <mat-card class="detail-card">
              <mat-card-header>
                <mat-card-title>{{ 'block_info' | i18n }}</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <div class="detail-row">
                  <span class="label">{{ 'block_hash' | i18n }}</span>
                  <div class="value link-value">
                    <span (click)="viewBlock(tx()!.blockhash!)">{{
                      truncateHash(tx()!.blockhash!, 16, 12)
                    }}</span>
                    <mat-icon
                      class="link-icon"
                      (click)="viewBlock(tx()!.blockhash!)"
                      [matTooltip]="'view_details' | i18n"
                      >chevron_right</mat-icon
                    >
                    <mat-icon
                      class="explorer-icon"
                      (click)="openBlockInExplorer(tx()!.blockhash!)"
                      [matTooltip]="'view_block_in_explorer' | i18n"
                      >open_in_new</mat-icon
                    >
                  </div>
                </div>
                @if (tx()!.blocktime) {
                  <div class="detail-row">
                    <span class="label">{{ 'block_time' | i18n }}</span>
                    <span class="value">{{ formatDate(tx()!.blocktime!) }}</span>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          }

          <!-- Technical Details Section -->
          <mat-card class="detail-card">
            <mat-card-header>
              <mat-card-title>{{ 'technical_details' | i18n }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="detail-row">
                <span class="label">{{ 'version' | i18n }}</span>
                <span class="value mono">{{ tx()!.version }}</span>
              </div>
              <div class="detail-row">
                <span class="label">{{ 'locktime' | i18n }}</span>
                <span class="value mono">{{ tx()!.locktime }}</span>
              </div>
              @if (tx()!.hash !== tx()!.txid) {
                <div class="detail-row">
                  <span class="label">{{ 'wtxid' | i18n }}</span>
                  <div
                    class="value hash-value small"
                    (click)="copyToClipboard(tx()!.hash)"
                    [matTooltip]="'copy' | i18n"
                  >
                    <span>{{ truncateHash(tx()!.hash, 16, 12) }}</span>
                    <mat-icon class="copy-icon">content_copy</mat-icon>
                  </div>
                </div>
              }
            </mat-card-content>
          </mat-card>

          <!-- Raw Transaction Section -->
          @if (tx()!.hex) {
            <mat-expansion-panel class="raw-panel">
              <mat-expansion-panel-header>
                <mat-panel-title>{{ 'raw_transaction' | i18n }}</mat-panel-title>
              </mat-expansion-panel-header>
              <div
                class="raw-hex"
                (click)="copyToClipboard(tx()!.hex!)"
                [matTooltip]="'copy' | i18n"
              >
                {{ tx()!.hex }}
              </div>
            </mat-expansion-panel>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .page-layout {
        min-height: 100vh;
        background: #f5f5f5;
      }

      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 16px;

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 300;
        }

        .back-button {
          color: white;
        }
      }

      .content {
        padding: 24px;
        max-width: 900px;
        margin: 0 auto;
      }

      .loading-container,
      .error-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 64px;
        color: rgba(0, 0, 0, 0.54);

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          margin-bottom: 16px;
        }

        p {
          margin-bottom: 16px;
        }
      }

      .error-container mat-icon {
        color: #f44336;
      }

      .detail-card {
        margin-bottom: 16px;

        mat-card-header {
          padding: 16px 16px 0;

          mat-card-title {
            font-size: 14px;
            font-weight: 600;
            color: #002341;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        }

        mat-card-content {
          padding: 16px;
        }
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #f0f0f0;

        &:last-child {
          border-bottom: none;
        }

        .label {
          font-size: 13px;
          color: #666;
          flex-shrink: 0;
          margin-right: 16px;
        }

        .value {
          font-size: 13px;
          color: #002341;
          text-align: right;
          word-break: break-all;

          &.mono {
            font-family: monospace;
          }
        }

        .hash-value {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          color: #1976d2;
          font-family: monospace;
          font-size: 12px;

          &:hover {
            color: #1565c0;
          }

          &.small {
            font-size: 11px;
          }

          .copy-icon,
          .explorer-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
            opacity: 0.7;
            cursor: pointer;

            &:hover {
              opacity: 1;
            }
          }
        }

        .link-value {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          color: #1976d2;
          font-family: monospace;
          font-size: 12px;

          &:hover {
            color: #1565c0;
            text-decoration: underline;
          }

          .link-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }
      }

      .status-badge {
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;

        &.confirmed {
          background: #e8f5e9;
          color: #2e7d32;
        }

        &.pending {
          background: #fff3e0;
          color: #ef6c00;
        }
      }

      /* Input/Output rows */
      .io-row {
        display: flex;
        padding: 12px 0;
        border-bottom: 1px solid #f0f0f0;

        &:last-of-type {
          border-bottom: none;
        }

        .io-index {
          width: 32px;
          font-size: 12px;
          color: #999;
          font-family: monospace;
        }

        .io-content {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;

          .io-address {
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: monospace;
            font-size: 12px;
            color: #1976d2;
            cursor: pointer;
            word-break: break-all;

            &:hover {
              color: #1565c0;
            }

            &.coinbase {
              color: #ff9800;
              cursor: default;

              mat-icon {
                font-size: 16px;
                width: 16px;
                height: 16px;
              }
            }

            .copy-icon {
              font-size: 14px;
              width: 14px;
              height: 14px;
              opacity: 0.7;
              flex-shrink: 0;
            }
          }

          .io-amount {
            font-family: monospace;
            font-size: 13px;
            font-weight: 500;
            color: #002341;
            white-space: nowrap;
          }
        }
      }

      .io-total {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        margin-top: 8px;
        background: #f5f7fa;
        border-radius: 4px;

        .label {
          font-size: 13px;
          font-weight: 600;
          color: #002341;
        }

        .value {
          font-size: 14px;
          font-weight: 600;
          color: #002341;
        }
      }

      /* Raw transaction panel */
      .raw-panel {
        margin-bottom: 16px;

        mat-panel-title {
          font-size: 14px;
          font-weight: 600;
          color: #002341;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .raw-hex {
          font-family: monospace;
          font-size: 11px;
          word-break: break-all;
          background: #f5f7fa;
          padding: 16px;
          border-radius: 4px;
          cursor: pointer;
          color: #666;
          max-height: 200px;
          overflow-y: auto;

          &:hover {
            background: #e8eef5;
          }
        }
      }

      /* Dark theme */
      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

        .detail-card {
          background: #424242;

          mat-card-title {
            color: #90caf9;
          }
        }

        .detail-row {
          border-bottom-color: #555;

          .label {
            color: #aaa;
          }

          .value {
            color: #fff;
          }

          .hash-value,
          .link-value {
            color: #90caf9;

            &:hover {
              color: #bbdefb;
            }
          }
        }

        .status-badge {
          &.confirmed {
            background: #1b5e20;
            color: #a5d6a7;
          }

          &.pending {
            background: #e65100;
            color: #ffcc80;
          }
        }

        .io-row {
          border-bottom-color: #555;

          .io-content {
            .io-address {
              color: #90caf9;

              &:hover {
                color: #bbdefb;
              }
            }

            .io-amount {
              color: #fff;
            }
          }
        }

        .io-total {
          background: #333;

          .label,
          .value {
            color: #fff;
          }
        }

        .raw-panel {
          background: #424242;

          mat-panel-title {
            color: #90caf9;
          }

          .raw-hex {
            background: #333;
            color: #aaa;

            &:hover {
              background: #3a3a3a;
            }
          }
        }
      }
    `,
  ],
})
export class TransactionDetailsComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly clipboard = inject(ClipboardService);
  private readonly blockExplorer = inject(BlockExplorerService);
  private readonly destroy$ = new Subject<void>();

  loading = signal(true);
  error = signal<string | null>(null);
  tx = signal<Transaction | null>(null);

  ngOnInit(): void {
    const txid = this.route.snapshot.paramMap.get('txid');
    if (txid) {
      this.loadTransaction(txid);
    } else {
      this.error.set('No transaction ID provided');
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  async loadTransaction(txid: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const transaction = (await this.blockchainRpc.getRawTransaction(txid, true)) as Transaction;
      this.tx.set(transaction);
    } catch (err) {
      console.error('Failed to load transaction:', err);
      this.error.set('Failed to load transaction. It may not exist or the node is unavailable.');
    } finally {
      this.loading.set(false);
    }
  }

  viewBlock(blockhash: string): void {
    this.router.navigate(['/blocks', blockhash]);
  }

  copyToClipboard(text: string): void {
    this.clipboard.copy(text);
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  formatBtcx(amount: number): string {
    return amount.toFixed(8);
  }

  truncateHash(hash: string, startChars = 16, endChars = 12): string {
    if (!hash || hash.length <= startChars + endChars + 3) return hash;
    return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
  }

  getInputAddress(input: Transaction['vin'][0]): string {
    if (input.prevout?.scriptPubKey?.address) {
      return input.prevout.scriptPubKey.address;
    }
    if (input.txid) {
      return `${this.truncateHash(input.txid, 12, 8)}:${input.vout}`;
    }
    return 'Unknown';
  }

  totalInput(): number | null {
    const transaction = this.tx();
    if (!transaction) return null;

    let total = 0;
    let hasValue = false;

    for (const input of transaction.vin) {
      if (input.prevout?.value !== undefined) {
        total += input.prevout.value;
        hasValue = true;
      }
    }

    return hasValue ? total : null;
  }

  totalOutput(): number {
    const transaction = this.tx();
    if (!transaction) return 0;

    return transaction.vout.reduce((sum, output) => sum + output.value, 0);
  }

  calculatedFee(): number | null {
    const input = this.totalInput();
    if (input === null) return null;
    return input - this.totalOutput();
  }

  calculateFeeRate(): string {
    const fee = this.calculatedFee();
    const transaction = this.tx();
    if (fee === null || !transaction) return '-';

    const feeInSats = fee * 100000000;
    const rate = feeInSats / transaction.vsize;
    return rate.toFixed(2);
  }

  openTransactionInExplorer(txid: string): void {
    this.blockExplorer.openTransaction(txid);
  }

  openAddressInExplorer(address: string): void {
    this.blockExplorer.openAddress(address);
  }

  openBlockInExplorer(hash: string): void {
    this.blockExplorer.openBlock(hash);
  }
}
