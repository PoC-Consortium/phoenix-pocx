import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe } from '../../../../core/i18n';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { BackendRouterService } from '../../../../core/backend/backend-router.service';

export interface CpfpDialogData {
  parentTxid: string;
  vout: number;
  /** Amount received by this output, in BTC. */
  receivedAmount: number;
  walletName: string;
}

export interface CpfpDialogResult {
  confirmed: boolean;
  /** The child transaction's own fee rate, sat/vB. */
  childFeeRate?: number;
}

interface FeeOption {
  label: string;
  blocks: number;
  /** Target PACKAGE fee rate, sat/vB. */
  feeRate: number | null;
  timeEstimate: string;
}

const SATS_PER_BTC = 100_000_000;

@Component({
  selector: 'app-cpfp-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    I18nPipe,
    DecimalPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">bolt</mat-icon>
      {{ 'cpfp_title' | i18n }}
    </h2>

    <mat-dialog-content>
      <p class="description">{{ 'cpfp_description' | i18n }}</p>

      <!-- Parent Transaction Info -->
      <div class="tx-info">
        <div class="info-row">
          <span class="label">{{ 'transaction_id' | i18n }}:</span>
          <span class="value txid"
            >{{ data.parentTxid | slice: 0 : 16 }}...{{ data.parentTxid | slice: -16 }}</span
          >
        </div>
        <div class="info-row">
          <span class="label">{{ 'amount' | i18n }}:</span>
          <span class="value">{{ data.receivedAmount | number: '1.8-8' }} BTCX</span>
        </div>
      </div>

      <mat-divider></mat-divider>

      @if (isLoading()) {
        <div class="loading-fees">
          <mat-spinner diameter="20"></mat-spinner>
          <span>{{ 'loading_fee_estimates' | i18n }}</span>
        </div>
      } @else if (loadError()) {
        <div class="warning-box">
          <mat-icon>warning</mat-icon>
          <span>{{ loadError() }}</span>
        </div>
      } @else {
        <!-- Fee Options -->
        <div class="fee-section">
          <h3 class="section-title">{{ 'cpfp_package_fee' | i18n }}</h3>

          <div class="fee-options">
            @for (option of feeOptions(); track option.label) {
              <button
                mat-stroked-button
                [class.selected]="selectedFeeOption() === option"
                (click)="selectFeeOption(option)"
                [disabled]="option.feeRate === null && option.label !== 'fee_custom'"
              >
                <div class="fee-option">
                  <span class="fee-label">{{ option.label | i18n }}</span>
                  @if (option.label === 'fee_custom') {
                    <mat-icon class="custom-icon">tune</mat-icon>
                  } @else if (option.feeRate !== null) {
                    <span class="fee-rate">{{ option.feeRate | number: '1.3-3' }} sat/vB</span>
                    <span class="fee-time">{{ option.timeEstimate }}</span>
                  } @else {
                    <span class="fee-rate">--</span>
                  }
                </div>
              </button>
            }
          </div>

          <!-- Custom Fee Input -->
          @if (selectedFeeOption()?.label === 'fee_custom') {
            <div class="custom-fee-input">
              <mat-form-field appearance="outline">
                <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
                <input
                  matInput
                  type="number"
                  [ngModel]="customFeeRate()"
                  (ngModelChange)="onCustomFeeChange($event)"
                  [min]="minRate()"
                  step="0.001"
                  autocomplete="off"
                />
              </mat-form-field>
            </div>
          }

          <!-- Package Summary -->
          <div class="fee-summary">
            <div class="summary-row">
              <span class="label">{{ 'cpfp_parent_fee' | i18n }}:</span>
              <span class="value">{{ parentFeeBtc() | number: '1.8-8' }} BTCX</span>
            </div>
            <div class="summary-row">
              <span class="label">{{ 'cpfp_child_fee' | i18n }}:</span>
              <span class="value highlight">{{ childFeeBtc() | number: '1.8-8' }} BTCX</span>
            </div>
            <div class="summary-row">
              <span class="label">{{ 'cpfp_effective_rate' | i18n }}:</span>
              <span class="value">{{ effectivePackageRate() | number: '1.3-3' }} sat/vB</span>
            </div>
            <mat-divider></mat-divider>
            <div class="summary-row">
              <span class="label">{{ 'total' | i18n }}:</span>
              <span class="value increase">{{ totalFeeBtc() | number: '1.8-8' }} BTCX</span>
            </div>
          </div>

          @if (insufficient()) {
            <div class="warning-box">
              <mat-icon>warning</mat-icon>
              <span>{{ 'cpfp_insufficient' | i18n }}</span>
            </div>
          }
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancel()">
        {{ 'cancel' | i18n }}
      </button>
      <button mat-raised-button color="primary" (click)="confirm()" [disabled]="!canConfirm()">
        <mat-icon>bolt</mat-icon>
        {{ 'speed_up_cpfp' | i18n }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      h2 {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
        padding: 16px 24px;
        color: rgb(0, 35, 65);

        .title-icon {
          color: #1976d2;
          font-size: 28px;
          width: 28px;
          height: 28px;
        }
      }

      mat-dialog-content {
        padding: 0 24px 16px;
        max-height: 70vh;
      }

      .description {
        margin: 0 0 16px 0;
        color: #666;
        font-size: 14px;
      }

      .tx-info {
        background: #f5f7fa;
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 16px;

        .info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;

          .label {
            color: #666;
            font-size: 13px;
          }

          .value {
            font-family: monospace;
            font-size: 13px;
            color: rgb(0, 35, 65);

            &.txid {
              font-size: 11px;
            }
          }
        }
      }

      mat-divider {
        margin: 16px 0;
      }

      .fee-section {
        .section-title {
          font-size: 14px;
          font-weight: 600;
          color: rgb(0, 35, 65);
          margin: 0 0 12px 0;
        }
      }

      .loading-fees {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px;
        justify-content: center;
        color: #666;
      }

      .fee-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;

        button {
          flex: 1;
          min-width: 100px;
          height: auto;
          padding: 8px 4px;
          border-color: #e0e0e0;

          &.selected {
            border-color: #1976d2;
            background: rgba(25, 118, 210, 0.08);
          }

          .fee-option {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;

            .fee-label {
              font-weight: 600;
              font-size: 12px;
              color: rgb(0, 35, 65);
            }

            .fee-rate {
              font-size: 13px;
              font-weight: 500;
              color: #1976d2;
              font-family: monospace;
            }

            .fee-time {
              font-size: 10px;
              color: #888;
            }

            .custom-icon {
              font-size: 20px;
              height: 20px;
              width: 20px;
              color: #666;
            }
          }
        }
      }

      .custom-fee-input {
        margin-bottom: 16px;

        mat-form-field {
          width: 100%;
          max-width: 180px;
        }
      }

      .fee-summary {
        background: #e3f2fd;
        border-radius: 8px;
        padding: 12px 16px;

        .summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;

          .label {
            color: #666;
            font-size: 13px;
          }

          .value {
            font-family: monospace;
            font-weight: 500;
            font-size: 13px;
            color: rgb(0, 35, 65);

            &.highlight {
              color: #1976d2;
            }

            &.increase {
              color: #4caf50;
              font-weight: 600;
            }
          }
        }

        mat-divider {
          margin: 8px 0;
        }
      }

      .warning-box {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: #fff3e0;
        border-radius: 8px;
        margin-top: 16px;
        color: #e65100;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          flex-shrink: 0;
        }

        span {
          font-size: 13px;
        }
      }

      mat-dialog-actions {
        padding: 16px 24px;
        gap: 12px;

        button {
          min-width: 100px;

          mat-icon {
            margin-right: 8px;
          }
        }
      }

      :host-context(.dark-theme) {
        h2,
        .section-title,
        .value {
          color: #ffffff;
        }

        .tx-info {
          background: #333;
        }

        .fee-summary {
          background: #1a3a5c;
        }

        .fee-options button {
          border-color: #555;

          &.selected {
            background: rgba(25, 118, 210, 0.2);
          }
        }

        .warning-box {
          background: #4a3000;
        }
      }
    `,
  ],
})
export class CpfpDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<CpfpDialogComponent>);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly backendRouter = inject(BackendRouterService);
  readonly data: CpfpDialogData = inject(MAT_DIALOG_DATA);

  isLoading = signal(true);
  loadError = signal<string | null>(null);

  /** Parent vsize (vB) and its own fee (BTC), from getmempoolentry. */
  private readonly parentVsize = signal(0);
  parentFeeBtc = signal(0);

  /** Coin feerate floor (sat/vB); child rate is never offered below it. */
  minRate = signal(1);

  /** Rough child tx size — a single-input, single-output P2WPKH spend. */
  private readonly CHILD_VSIZE = 150;

  feeOptions = signal<FeeOption[]>([
    { label: 'fee_slow', blocks: 144, feeRate: null, timeEstimate: '~60 min' },
    { label: 'fee_normal', blocks: 6, feeRate: null, timeEstimate: '~30 min' },
    { label: 'fee_fast', blocks: 1, feeRate: null, timeEstimate: '~10 min' },
    { label: 'fee_custom', blocks: 6, feeRate: null, timeEstimate: '' },
  ]);

  selectedFeeOption = signal<FeeOption | null>(null);
  customFeeRate = signal<number | null>(null);

  private parentFeeSats = computed(() => this.parentFeeBtc() * SATS_PER_BTC);

  /** Chosen target PACKAGE feerate (sat/vB), or null when custom is empty. */
  private targetPackageRate = computed<number | null>(() => {
    const opt = this.selectedFeeOption();
    if (!opt) return null;
    const rate = opt.label === 'fee_custom' ? this.customFeeRate() : opt.feeRate;
    return rate ?? null;
  });

  /**
   * The child's own fee rate (sat/vB) needed to lift the WHOLE package to the
   * target rate R: requiredChildFee = R·(vsize_p+vsize_c) − fee_p, spread over
   * the child's vsize. Floored to the coin minimum so the child clears relay.
   */
  childRate = computed<number | null>(() => {
    const R = this.targetPackageRate();
    if (R === null) return null;
    const requiredChildFee = Math.max(
      0,
      R * (this.parentVsize() + this.CHILD_VSIZE) - this.parentFeeSats()
    );
    const rate = requiredChildFee / this.CHILD_VSIZE;
    return Math.max(rate, this.minRate());
  });

  /** Child fee in sats at the (floored) child rate. */
  private childFeeSats = computed(() => {
    const r = this.childRate();
    return r === null ? 0 : r * this.CHILD_VSIZE;
  });

  childFeeBtc = computed(() => this.childFeeSats() / SATS_PER_BTC);

  totalFeeBtc = computed(() => this.parentFeeBtc() + this.childFeeBtc());

  /** Realised package feerate once the child fee is applied. */
  effectivePackageRate = computed(() => {
    const totalVsize = this.parentVsize() + this.CHILD_VSIZE;
    if (totalVsize === 0) return 0;
    return (this.parentFeeSats() + this.childFeeSats()) / totalVsize;
  });

  private receivedSats = computed(() => Math.round(this.data.receivedAmount * SATS_PER_BTC));

  /** The received output can't cover the child fee it must pay. */
  insufficient = computed(() => this.childFeeSats() > 0 && this.receivedSats() <= this.childFeeSats());

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      // Coin floor first — presets and the custom default are floored to it.
      try {
        const estimates = await this.backendRouter.wallet().feeEstimates();
        if (estimates.minSatPerVb > 0) this.minRate.set(estimates.minSatPerVb);
      } catch {
        // Keep the 1 sat/vB default.
      }

      // Parent vsize + fee drive the package math — required for CPFP.
      const parent = await this.backendRouter
        .wallet()
        .getCpfpParentInfo(this.data.walletName, this.data.parentTxid);
      this.parentVsize.set(parent.vsize);
      this.parentFeeBtc.set(parent.fee);

      // Prefill custom with the coin floor so it always holds a sane rate.
      this.customFeeRate.set(this.minRate());

      const options = this.feeOptions();
      for (const option of options) {
        if (option.label === 'fee_custom') continue;
        try {
          const result = await this.blockchainRpc.estimateSmartFee(option.blocks);
          if (result.feerate) {
            // BTC/kvB -> sat/vB at 0.001 resolution.
            option.feeRate = Math.round(result.feerate * SATS_PER_BTC) / 1000;
          }
        } catch {
          // Leave null — the chip disables itself.
        }
        // Never offer a preset below the coin floor (0.001 resolution).
        const floored = Math.max(option.feeRate ?? 0, this.minRate());
        option.feeRate = Math.round(floored * 1000) / 1000;
      }
      this.feeOptions.set([...options]);

      // Default to the normal preset.
      this.selectedFeeOption.set(options[1]);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  selectFeeOption(option: FeeOption): void {
    this.selectedFeeOption.set(option);
  }

  onCustomFeeChange(value: number | null): void {
    this.customFeeRate.set(value);
  }

  canConfirm(): boolean {
    const rate = this.childRate();
    return rate !== null && rate > 0 && !this.insufficient() && !this.loadError();
  }

  cancel(): void {
    this.dialogRef.close({ confirmed: false } as CpfpDialogResult);
  }

  confirm(): void {
    const rate = this.childRate();
    if (rate === null) return;
    this.dialogRef.close({
      confirmed: true,
      // 0.001 sat/vB resolution, matching the fee surfaces elsewhere.
      childFeeRate: Math.round(rate * 1000) / 1000,
    } as CpfpDialogResult);
  }
}
