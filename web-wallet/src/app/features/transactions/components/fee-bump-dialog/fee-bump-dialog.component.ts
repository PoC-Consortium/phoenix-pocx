import { Component, inject, signal, OnInit } from '@angular/core';
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

export interface FeeBumpDialogData {
  txid: string;
  originalFee: number;
  amount: number;
  address?: string;
}

export interface FeeBumpDialogResult {
  confirmed: boolean;
  confTarget?: number;
  feeRate?: number;
}

interface FeeOption {
  label: string;
  blocks: number;
  feeRate: number | null;
  timeEstimate: string;
}

@Component({
  selector: 'app-fee-bump-dialog',
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
      <mat-icon class="title-icon">speed</mat-icon>
      {{ 'bump_fee_title' | i18n }}
    </h2>

    <mat-dialog-content>
      <p class="description">{{ 'bump_fee_description' | i18n }}</p>

      <!-- Original Transaction Info -->
      <div class="tx-info">
        <div class="info-row">
          <span class="label">{{ 'transaction_id' | i18n }}:</span>
          <span class="value txid"
            >{{ data.txid | slice: 0 : 16 }}...{{ data.txid | slice: -16 }}</span
          >
        </div>
        @if (data.address) {
          <div class="info-row">
            <span class="label">{{ 'recipient' | i18n }}:</span>
            <span class="value address"
              >{{ data.address | slice: 0 : 12 }}...{{ data.address | slice: -12 }}</span
            >
          </div>
        }
        <div class="info-row">
          <span class="label">{{ 'amount' | i18n }}:</span>
          <span class="value">{{ data.amount | number: '1.8-8' }} BTCX</span>
        </div>
        <div class="info-row">
          <span class="label">{{ 'original_fee' | i18n }}:</span>
          <span class="value">{{ data.originalFee | number: '1.8-8' }} BTCX</span>
        </div>
      </div>

      <mat-divider></mat-divider>

      <!-- Fee Options -->
      <div class="fee-section">
        <h3 class="section-title">{{ 'new_fee' | i18n }}</h3>

        @if (isLoadingFees()) {
          <div class="loading-fees">
            <mat-spinner diameter="20"></mat-spinner>
            <span>{{ 'loading_fee_estimates' | i18n }}</span>
          </div>
        } @else {
          <div class="fee-options">
            @for (option of feeOptions; track option.label) {
              <button
                mat-stroked-button
                [class.selected]="selectedFeeOption === option"
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
          @if (selectedFeeOption?.label === 'fee_custom') {
            <div class="custom-fee-input">
              <mat-form-field appearance="outline">
                <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
                <input
                  matInput
                  type="number"
                  [(ngModel)]="customFeeRate"
                  (ngModelChange)="onCustomFeeChange()"
                  [min]="minBumpRate()"
                  step="0.001"
                  autocomplete="off"
                />
              </mat-form-field>
            </div>
          }

          <!-- Fee Summary -->
          <div class="fee-summary">
            <div class="summary-row">
              <span class="label">{{ 'original_fee' | i18n }}:</span>
              <span class="value">{{ data.originalFee | number: '1.8-8' }} BTCX</span>
            </div>
            <div class="summary-row">
              <span class="label">{{ 'new_fee' | i18n }}:</span>
              <span class="value highlight">{{ getEstimatedNewFee() | number: '1.8-8' }} BTCX</span>
            </div>
            <mat-divider></mat-divider>
            <div class="summary-row">
              <span class="label">{{ 'fee_increase' | i18n }}:</span>
              <span class="value increase">+{{ getFeeIncrease() | number: '1.8-8' }} BTCX</span>
            </div>
          </div>

          @if (belowMinBump()) {
            <div class="warning-box">
              <mat-icon>warning</mat-icon>
              <span>{{ 'new_fee_must_be_higher' | i18n }}</span>
            </div>
          }
        }
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancel()">
        {{ 'cancel' | i18n }}
      </button>
      <button mat-raised-button color="primary" (click)="confirm()" [disabled]="!canConfirm()">
        <mat-icon>speed</mat-icon>
        {{ 'bump_fee' | i18n }}
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

            &.txid,
            &.address {
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
export class FeeBumpDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<FeeBumpDialogComponent>);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  readonly data: FeeBumpDialogData = inject(MAT_DIALOG_DATA);

  isLoadingFees = signal(false);
  customFeeRate: number | null = null;

  feeOptions: FeeOption[] = [
    { label: 'fee_slow', blocks: 144, feeRate: null, timeEstimate: '~60 min' },
    { label: 'fee_normal', blocks: 6, feeRate: null, timeEstimate: '~30 min' },
    { label: 'fee_fast', blocks: 1, feeRate: null, timeEstimate: '~10 min' },
    { label: 'fee_custom', blocks: 6, feeRate: null, timeEstimate: '' },
  ];

  selectedFeeOption: FeeOption | null = null;

  /**
   * Smallest feerate that yields a valid RBF replacement (BIP-125 rule 3/4).
   * Computed from the original tx's real feerate; presets and the custom
   * default are floored to it so the first bump attempt isn't rejected.
   */
  minBumpRate = signal(1);

  // Estimate transaction size for fee calculation (typical P2WPKH: ~170 vbytes)
  private readonly estimatedVBytes = 170;

  /** Core's default `incrementalrelayfee`, in sat/vB (BIP-125 rule 4). */
  private readonly INCREMENTAL_RELAY_SAT_VB = 1;

  ngOnInit(): void {
    this.loadFeeEstimates();
  }

  async loadFeeEstimates(): Promise<void> {
    this.isLoadingFees.set(true);
    try {
      // Establish the minimum valid bump first. On a chain that sits at the
      // feerate floor the network estimates equal the original tx's rate, so
      // without this floor every preset would be rejected on the first attempt.
      await this.computeMinBumpRate();

      // Prefill custom with the minimum valid bump — kept even if the estimate
      // fetch below throws (e.g. no Core RPC), so custom always has a sane rate.
      this.customFeeRate = this.minBumpRate();

      for (const option of this.feeOptions) {
        if (option.label === 'fee_custom') continue;
        const result = await this.blockchainRpc.estimateSmartFee(option.blocks);
        if (result.feerate) {
          // feerate is in BTC/kvB, convert to sat/vB (0.001 resolution)
          option.feeRate = Math.round(result.feerate * 100000000) / 1000;
        }
        // Never offer a preset below a valid bump — floor it (0.001 resolution).
        const floored = Math.max(option.feeRate ?? 0, this.minBumpRate());
        option.feeRate = Math.round(floored * 1000) / 1000;
      }

      // Default to normal fee (already floored to a valid bump).
      this.selectedFeeOption = this.feeOptions[1];
    } catch (error) {
      console.error('Failed to load fee estimates:', error);
    } finally {
      this.isLoadingFees.set(false);
    }
  }

  /**
   * Derive the smallest feerate that yields a valid RBF replacement from the
   * original tx's real feerate (original fee ÷ its vsize). Fetches the tx's
   * vsize; falls back to a typical P2WPKH size if it can't (e.g. remote mode).
   * Adds a comfortable margin — the greater of the incremental relay fee or
   * 10% — so the first attempt clears BIP-125 rule 4 even with vsize drift.
   */
  private async computeMinBumpRate(): Promise<void> {
    const originalFeeSats = this.data.originalFee * 100000000;
    let vsize = this.estimatedVBytes;
    try {
      const raw = await this.blockchainRpc.getRawTransaction(this.data.txid, true);
      if (typeof raw !== 'string' && raw.vsize > 0) {
        vsize = raw.vsize;
      }
    } catch {
      // Original tx not fetchable (e.g. remote/Electrum mode) — keep the
      // typical-size fallback; the user can still adjust via custom.
    }
    const originalRate = originalFeeSats / vsize;
    const margin = Math.max(this.INCREMENTAL_RELAY_SAT_VB, originalRate * 0.1);
    // Round the floor UP to 0.001 so it never lands just under the requirement.
    this.minBumpRate.set(Math.ceil((originalRate + margin) * 1000) / 1000);
  }

  selectFeeOption(option: FeeOption): void {
    this.selectedFeeOption = option;
    if (option.label === 'fee_custom' && this.customFeeRate) {
      option.feeRate = this.customFeeRate;
    }
  }

  onCustomFeeChange(): void {
    if (this.selectedFeeOption?.label === 'fee_custom' && this.customFeeRate) {
      this.selectedFeeOption.feeRate = this.customFeeRate;
    }
  }

  getEstimatedNewFee(): number {
    const feeRate =
      this.selectedFeeOption?.label === 'fee_custom'
        ? this.customFeeRate
        : this.selectedFeeOption?.feeRate;

    if (feeRate === null || feeRate === undefined) return 0;

    const feeInSats = feeRate * this.estimatedVBytes;
    return feeInSats / 100000000;
  }

  getFeeIncrease(): number {
    const newFee = this.getEstimatedNewFee();
    return newFee - this.data.originalFee;
  }

  /** Selected feerate, or null when custom is empty. */
  private selectedRate(): number | null {
    const rate =
      this.selectedFeeOption?.label === 'fee_custom'
        ? this.customFeeRate
        : this.selectedFeeOption?.feeRate;
    return rate ?? null;
  }

  /** True when the chosen rate is below the minimum valid RBF bump. */
  belowMinBump(): boolean {
    const rate = this.selectedRate();
    return rate === null || rate < this.minBumpRate();
  }

  canConfirm(): boolean {
    return !this.belowMinBump();
  }

  cancel(): void {
    this.dialogRef.close({ confirmed: false } as FeeBumpDialogResult);
  }

  confirm(): void {
    const feeRate =
      this.selectedFeeOption?.label === 'fee_custom'
        ? this.customFeeRate
        : this.selectedFeeOption?.feeRate;

    this.dialogRef.close({
      confirmed: true,
      confTarget: this.selectedFeeOption?.blocks,
      feeRate: feeRate ?? undefined,
    } as FeeBumpDialogResult);
  }
}
