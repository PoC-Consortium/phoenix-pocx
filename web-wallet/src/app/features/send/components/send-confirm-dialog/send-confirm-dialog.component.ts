import { Component, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { I18nPipe } from '../../../../core/i18n';

export interface SendConfirmDialogData {
  recipientAddress: string;
  amount: number;
  fee: number;
  total: number;
  subtractFee: boolean;
}

/**
 * Confirmation dialog for sending Bitcoin.
 * Shows transaction details and asks for final confirmation.
 */
@Component({
  selector: 'app-send-confirm-dialog',
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
      {{ 'confirm_transaction' | i18n }}
    </h2>

    <mat-dialog-content>
      <p class="confirm-message">{{ 'confirm_send_message' | i18n }}</p>

      <div class="detail-row recipient-row">
        <span class="label">{{ 'recipient' | i18n }}:</span>
        <span class="address-full">{{ data.recipientAddress }}</span>
      </div>

      <div class="detail-row">
        <span class="label">{{ 'amount' | i18n }}:</span>
        <span class="value">{{ data.amount | number: '1.8-8' }} BTC</span>
      </div>

      <div class="detail-row">
        <span class="label">{{ 'fee' | i18n }}:</span>
        <span class="value">{{ data.fee | number: '1.8-8' }} BTC</span>
      </div>

      <mat-divider></mat-divider>

      <div class="detail-row total">
        <span class="label">{{ 'total' | i18n }}:</span>
        <span class="value">{{ data.total | number: '1.8-8' }} BTC</span>
      </div>

      @if (data.subtractFee) {
        <p class="note">{{ 'subtract_fee_hint' | i18n }}</p>
      }

      <div class="warning-box">
        <mat-icon>info</mat-icon>
        <span>{{ 'transaction_irreversible' | i18n }}</span>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancel()">
        {{ 'cancel' | i18n }}
      </button>
      <button mat-raised-button color="primary" (click)="confirm()">
        <mat-icon>send</mat-icon>
        {{ 'confirm_send' | i18n }}
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
          color: #ff9800;
          font-size: 28px;
          width: 28px;
          height: 28px;
        }
      }

      mat-dialog-content {
        padding: 0 24px 16px;
      }

      .confirm-message {
        margin: 0 0 16px 0;
        color: #666;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;

        .label {
          color: #666;
        }

        .value {
          font-family: monospace;
          font-weight: 500;
          color: rgb(0, 35, 65);
        }

        &.recipient-row {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;

          .address-full {
            font-family: monospace;
            font-size: 13px;
            color: rgb(0, 35, 65);
            word-break: break-all;
            background: #f5f7fa;
            padding: 8px 12px;
            border-radius: 4px;
            width: 100%;
            box-sizing: border-box;
          }
        }

        &.total {
          padding-top: 16px;

          .label,
          .value {
            font-size: 16px;
            font-weight: 600;
          }
        }
      }

      mat-divider {
        margin: 8px 0;
      }

      .note {
        font-size: 12px;
        color: #666;
        font-style: italic;
        margin: 8px 0;
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
        .value,
        .address-full {
          color: #ffffff;
        }

        .address-full {
          background: #333;
        }

        .warning-box {
          background: #4a3000;
        }
      }
    `,
  ],
})
export class SendConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<SendConfirmDialogComponent>);
  readonly data: SendConfirmDialogData = inject(MAT_DIALOG_DATA);

  cancel(): void {
    this.dialogRef.close(false);
  }

  confirm(): void {
    this.dialogRef.close(true);
  }
}
