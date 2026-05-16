import { Component, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { I18nPipe } from '../../../../core/i18n';

export interface AbandonTxDialogData {
  txid: string;
  amount: number;
  address?: string;
}

export interface AbandonTxDialogResult {
  confirmed: boolean;
}

@Component({
  selector: 'app-abandon-tx-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    I18nPipe,
    DecimalPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">warning</mat-icon>
      {{ 'abandon_tx_confirm_title' | i18n }}
    </h2>

    <mat-dialog-content>
      <p class="description">{{ 'abandon_tx_confirm_body' | i18n }}</p>

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
      </div>

      <div class="warning-box">
        <mat-icon>info</mat-icon>
        <span>{{ 'abandon_tx_mempool_hint' | i18n }}</span>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancel()">
        {{ 'cancel' | i18n }}
      </button>
      <button mat-raised-button color="warn" (click)="confirm()">
        <mat-icon>delete_forever</mat-icon>
        {{ 'abandon_tx' | i18n }}
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
          color: #e65100;
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

      .warning-box {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: #fff3e0;
        border-radius: 8px;
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
        .value {
          color: #ffffff;
        }

        .tx-info {
          background: #333;
        }

        .warning-box {
          background: #4a3000;
        }
      }
    `,
  ],
})
export class AbandonTxDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AbandonTxDialogComponent>);
  readonly data: AbandonTxDialogData = inject(MAT_DIALOG_DATA);

  cancel(): void {
    this.dialogRef.close({ confirmed: false } as AbandonTxDialogResult);
  }

  confirm(): void {
    this.dialogRef.close({ confirmed: true } as AbandonTxDialogResult);
  }
}
