import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QRCodeComponent } from 'angularx-qrcode';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService } from '../../../../shared/services';
import { buildPaymentUri } from '../../../../bitcoin/utils/payment-uri';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';

/**
 * WalletReceiveComponent - current receive address with QR and copy.
 */
@Component({
  selector: 'app-wallet-receive',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    QRCodeComponent,
    I18nPipe,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="receive" />

    <div class="page">
      <div class="card">
        @if (spendOnly()) {
          <!-- Legacy (v30) pockets are SPEND-ONLY: receiving into the
               retired coin-0' branch is exactly what the compartment
               redesign exists to stop. No address is even fetched. -->
          <div class="spend-only">
            <mat-icon class="spend-only-icon">block</mat-icon>
            <p>{{ 'mwallet_receive_v30_blocked' | i18n }}</p>
          </div>
        } @else if (address()) {
          <div class="qr-container">
            <qrcode
              [qrdata]="paymentUri()"
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

          <!-- BIP21 payment URI (desktop-parity) — what the QR encodes. -->
          <div class="info-row">
            <span class="info-label">{{ 'payment_uri' | i18n }}</span>
            <div class="info-value-row" (click)="copyPaymentUri()" [matTooltip]="'copy' | i18n">
              <span class="uri-value">{{ paymentUri() }}</span>
              <mat-icon class="copy-icon">content_copy</mat-icon>
            </div>
          </div>

          @if (wallet.singleAddress()) {
            <!-- Single-address (wpkh(WIF)) wallet: there IS no other
                 address — "new address" would hand back the same one, so
                 the button gives way to an honest hint. -->
            <p class="single-hint">{{ 'mwallet_receive_single_hint' | i18n }}</p>
          } @else {
            <button
              mat-stroked-button
              class="full-width"
              [disabled]="loading()"
              (click)="newAddress()"
            >
              <mat-icon>refresh</mat-icon>
              {{ 'generate_new_address' | i18n }}
            </button>
          }
        } @else if (loading()) {
          <div class="loading-inline">
            <mat-spinner diameter="28"></mat-spinner>
          </div>
        } @else {
          <p class="error-text">{{ 'mwallet_address_failed' | i18n }}</p>
          <button mat-stroked-button class="full-width" (click)="loadCurrentAddress()">
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

      .uri-value {
        font-family: monospace;
        font-size: 12px;
        color: #1976d2;
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

      .single-hint {
        color: rgba(0, 0, 0, 0.6);
        font-size: 12px;
        margin: 0;
      }

      .spend-only {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 16px 8px;

        .spend-only-icon {
          font-size: 40px;
          width: 40px;
          height: 40px;
          color: #b26a00;
        }

        p {
          margin: 0;
          font-size: 14px;
          color: rgba(0, 0, 0, 0.7);
          line-height: 1.5;
        }
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

        .uri-value {
          color: #90caf9;
        }

        .single-hint {
          color: rgba(255, 255, 255, 0.6);
        }

        .spend-only p {
          color: rgba(255, 255, 255, 0.7);
        }
      }
    `,
  ],
})
export class WalletReceiveComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly clipboard = inject(ClipboardService);

  readonly address = signal('');
  readonly loading = signal(false);

  /**
   * The active pocket is a legacy v30 (coin type 0') branch — spend-only.
   * Receiving is blocked so funds never land back in the retired branch.
   */
  readonly spendOnly = computed(() => this.wallet.descriptorPolicy()?.coinType === 0);

  /** Canonical BIP21 URI for the shown address (what the QR encodes). */
  paymentUri(): string {
    return buildPaymentUri({ address: this.address() });
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    await this.wallet.initialize();
    // Never fetch (and thus reveal) an address for a spend-only pocket.
    if (this.spendOnly()) return;
    await this.loadCurrentAddress();
  }

  /**
   * Entering the page shows the CURRENT address (last revealed, still
   * unused — desktop behavior), never burning a fresh one per visit.
   */
  async loadCurrentAddress(): Promise<void> {
    await this.fetch(() => this.wallet.currentAddress());
  }

  /** The explicit "new address" button: reveal a fresh address. */
  async newAddress(): Promise<void> {
    await this.fetch(() => this.wallet.newAddress());
  }

  private async fetch(get: () => Promise<string>): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      this.address.set(await get());
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

  async copyPaymentUri(): Promise<void> {
    const uri = this.paymentUri();
    if (uri) await this.clipboard.copy(uri, 'payment_uri_copied');
  }
}
