import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QRCodeComponent } from 'angularx-qrcode';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService } from '../../../../shared/services';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';

/**
 * WalletReceiveComponent - current receive address with QR and copy.
 */
@Component({
  selector: 'app-wallet-receive',
  standalone: true,
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    QRCodeComponent,
    I18nPipe,
  ],
  template: `
    <div class="page">
      <div class="header-row">
        <button mat-icon-button routerLink="/wallet">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h2>{{ 'receive' | i18n }}</h2>
      </div>

      <div class="card">
        @if (address()) {
          <div class="qr-container">
            <qrcode
              [qrdata]="address()"
              [width]="200"
              [errorCorrectionLevel]="'M'"
              [margin]="1"
              [colorDark]="'#1E3A5F'"
              [colorLight]="'#FFFFFF'"
            ></qrcode>
          </div>

          <div class="info-row">
            <span class="info-label">{{ 'address' | i18n }}</span>
            <div class="info-value-row" (click)="copyAddress()" [matTooltip]="'copy' | i18n">
              <span class="address-value">{{ address() }}</span>
              <mat-icon class="copy-icon">content_copy</mat-icon>
            </div>
          </div>

          <button
            mat-stroked-button
            class="full-width"
            [disabled]="loading()"
            (click)="newAddress()"
          >
            <mat-icon>refresh</mat-icon>
            {{ 'generate_new_address' | i18n }}
          </button>
        } @else if (loading()) {
          <div class="loading-inline">
            <mat-spinner diameter="28"></mat-spinner>
          </div>
        } @else {
          <p class="error-text">{{ 'mwallet_address_failed' | i18n }}</p>
          <button mat-stroked-button class="full-width" (click)="newAddress()">
            <mat-icon>refresh</mat-icon>
            {{ 'retry' | i18n }}
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .page {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 480px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
      }

      .header-row {
        display: flex;
        align-items: center;
        gap: 8px;

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 500;
        }
      }

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;
        text-align: center;
      }

      .qr-container {
        display: inline-block;
        padding: 12px;
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 16px;
      }

      .info-row {
        text-align: left;
        margin-bottom: 16px;

        .info-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
      }

      .info-value-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: #f5f7fa;
        border-radius: 6px;
        cursor: pointer;

        .copy-icon {
          font-size: 18px;
          height: 18px;
          width: 18px;
          color: #1976d2;
          flex-shrink: 0;
          margin-left: 8px;
        }
      }

      .address-value {
        font-family: monospace;
        font-size: 13px;
        word-break: break-all;
        text-align: left;
        flex: 1;
      }

      .loading-inline {
        display: flex;
        justify-content: center;
        padding: 24px 0;
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      .full-width {
        width: 100%;
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .info-value-row {
          background: #333;
        }

        .address-value {
          color: #90caf9;
        }
      }
    `,
  ],
})
export class WalletReceiveComponent implements OnInit {
  private readonly wallet = inject(BtcxWalletService);
  private readonly clipboard = inject(ClipboardService);

  readonly address = signal('');
  readonly loading = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    await this.wallet.initialize();
    await this.newAddress();
  }

  async newAddress(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      this.address.set(await this.wallet.newAddress());
    } catch (err) {
      console.error('Failed to get receive address:', err);
      this.address.set('');
    } finally {
      this.loading.set(false);
    }
  }

  async copyAddress(): Promise<void> {
    const address = this.address();
    if (address) await this.clipboard.copyAddress(address);
  }
}
