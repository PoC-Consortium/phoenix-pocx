import { Component, inject } from '@angular/core';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { QRCodeComponent } from 'angularx-qrcode';
import { I18nPipe } from '../../../../core/i18n';

export interface PsbtQrDialogData {
  base64: string;
}

/** QR codes hold ~2,900 chars at low error correction; beyond that we bail out */
const QR_MAX_CHARS = 2600;

/**
 * Shows a PSBT as a QR code for air-gapped transfer to another device.
 * Large PSBTs (many inputs / legacy UTXOs) exceed single-QR capacity —
 * animated multi-part QR (BBQr / UR) is a future enhancement.
 */
@Component({
  selector: 'app-psbt-qr-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, QRCodeComponent, I18nPipe],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">qr_code_2</mat-icon>
      {{ 'psbt_qr_title' | i18n }}
    </h2>

    <mat-dialog-content>
      @if (fits) {
        <div class="qr-wrap">
          <qrcode
            [qrdata]="data.base64"
            [width]="300"
            [errorCorrectionLevel]="'L'"
            [margin]="2"
          ></qrcode>
        </div>
        <p class="hint">{{ 'psbt_qr_hint' | i18n }}</p>
      } @else {
        <div class="too-large">
          <mat-icon>qr_code_2</mat-icon>
          <p>{{ 'psbt_qr_too_large' | i18n }}</p>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-raised-button color="primary" mat-dialog-close>
        {{ 'close' | i18n }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .title-icon {
        margin-right: 8px;
        vertical-align: middle;
        color: #1976d2;
      }

      .qr-wrap {
        display: flex;
        justify-content: center;
        padding: 8px;
        background: white;
        border-radius: 8px;
      }

      .hint {
        text-align: center;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.54);
        margin: 12px 0 0;
      }

      .too-large {
        text-align: center;
        padding: 24px;
        color: rgba(0, 0, 0, 0.54);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.4;
        }

        p {
          margin: 12px 0 0;
          font-size: 13px;
          max-width: 320px;
        }
      }
    `,
  ],
})
export class PsbtQrDialogComponent {
  readonly data: PsbtQrDialogData = inject(MAT_DIALOG_DATA);
  readonly fits = this.data.base64.length <= QR_MAX_CHARS;
}
