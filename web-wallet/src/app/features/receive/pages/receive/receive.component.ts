import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QRCodeComponent } from 'angularx-qrcode';
import { Subject } from 'rxjs';
import { takeUntil, skip } from 'rxjs/operators';
import { I18nPipe } from '../../../../core/i18n';
import { ClipboardService, NotificationService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';

interface AddressInfo {
  address: string;
  purpose: string;
  isUsed: boolean;
  txCount: number;
  label: string;
}

type AddressMode = 'existing' | 'generate';

/**
 * ReceiveComponent - Compact payment request form
 */
@Component({
  selector: 'app-receive',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    QRCodeComponent,
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
          <h1>{{ 'receive' | i18n }}</h1>
        </div>
      </div>

      <!-- Content -->
      <div class="content">
        <div class="receive-card">
          <!-- Address Selection -->
          <div class="form-section">
            <div class="address-mode-row">
              <mat-radio-group [(ngModel)]="addressMode" (change)="onAddressModeChange()">
                <mat-radio-button value="existing">{{
                  'use_existing_address' | i18n
                }}</mat-radio-button>
                <div class="generate-option">
                  <mat-radio-button value="generate">{{
                    'generate_new_address' | i18n
                  }}</mat-radio-button>
                  @if (addressMode === 'generate') {
                    <button
                      type="button"
                      class="regenerate-btn"
                      (click)="generateNewAddress()"
                      [disabled]="isGenerating()"
                      [title]="'generate_new' | i18n"
                    >
                      @if (isGenerating()) {
                        <mat-spinner diameter="18"></mat-spinner>
                      } @else {
                        <mat-icon>refresh</mat-icon>
                      }
                    </button>
                  }
                </div>
              </mat-radio-group>
            </div>

            @if (addressMode === 'existing') {
              @if (!isLoadingAddresses()) {
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>{{ 'select_address' | i18n }}</mat-label>
                  <mat-select [(ngModel)]="selectedAddress">
                    @for (addr of existingAddresses(); track addr.address) {
                      <mat-option [value]="addr.address">
                        <span class="address-option"
                          >{{ addr.address }}{{ getAddressDisplayLabel(addr) }}</span
                        >
                      </mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              } @else {
                <div class="loading-inline">
                  <mat-spinner diameter="20"></mat-spinner>
                  <span>{{ 'loading_addresses' | i18n }}</span>
                </div>
              }
            }
          </div>

          <!-- Amount -->
          <div class="form-section">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'amount_optional' | i18n }}</mat-label>
              <input
                matInput
                type="number"
                [(ngModel)]="amount"
                placeholder="0.00000000"
                step="0.00000001"
                min="0"
                autocomplete="off"
              />
              <span matTextSuffix>BTCX</span>
            </mat-form-field>
          </div>

          <!-- Label -->
          <div class="form-section">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'label_optional' | i18n }}</mat-label>
              <input
                matInput
                [(ngModel)]="label"
                [placeholder]="'label_placeholder' | i18n"
                maxlength="50"
                autocomplete="off"
              />
            </mat-form-field>
          </div>

          <!-- QR Code Section -->
          @if (currentAddress()) {
            <div class="qr-section">
              <div class="qr-code-container">
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
                <span class="info-label">{{ 'address' | i18n }}:</span>
                <div
                  class="info-value-row copyable"
                  (click)="copyAddress()"
                  [matTooltip]="'copy' | i18n"
                >
                  <span class="address-value">{{ currentAddress() }}</span>
                  <mat-icon class="copy-icon">content_copy</mat-icon>
                </div>
              </div>

              <div class="info-row">
                <span class="info-label">{{ 'payment_uri' | i18n }}:</span>
                <div
                  class="info-value-row copyable"
                  (click)="copyPaymentUri()"
                  [matTooltip]="'copy' | i18n"
                >
                  <span class="uri-value">{{ paymentUri() }}</span>
                  <mat-icon class="copy-icon">content_copy</mat-icon>
                </div>
              </div>
            </div>
          } @else {
            <div class="no-address">
              <mat-icon>qr_code</mat-icon>
              <span>{{ 'select_or_generate_address' | i18n }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

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
      }

      .back-button {
        color: rgba(255, 255, 255, 0.9);
      }

      .content {
        padding: 24px;
        display: flex;
        justify-content: center;
      }

      .receive-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        max-width: 500px;
        width: 100%;
        padding: 16px 20px;
        overflow: hidden;
        box-sizing: border-box;
      }

      .form-section {
        margin-bottom: 12px;
      }

      .full-width {
        width: 100%;
      }

      /* Address mode */
      .address-mode-row {
        margin-bottom: 12px;

        mat-radio-group {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
        }

        .generate-option {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .regenerate-btn {
          width: 28px;
          height: 28px;
          min-width: 28px;
          max-width: 28px;
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            color: #1976d2;
          }

          mat-spinner {
            margin: 0;
          }

          &:hover {
            background: rgba(25, 118, 210, 0.08);
          }

          &:disabled {
            cursor: default;
            opacity: 0.6;

            &:hover {
              background: transparent;
            }
          }
        }

        ::ng-deep .mat-mdc-radio-button .mdc-label {
          font-size: 14px;
        }
      }

      /* Address dropdown option - full width */
      .address-option {
        font-family: monospace;
        font-size: 12px;
        white-space: nowrap;
      }

      ::ng-deep .mat-mdc-select-panel {
        max-width: none !important;
      }

      /* Selected address in trigger - monospace to fit */
      ::ng-deep .mat-mdc-select-value-text {
        font-family: monospace;
        font-size: 14px;
      }

      .loading-inline {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        color: #666;
        font-size: 13px;
      }

      /* Compact form fields */
      ::ng-deep {
        .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }

        .mat-mdc-text-field-wrapper {
          padding: 0 12px;
        }

        .mat-mdc-form-field-infix {
          min-height: 40px;
          padding-top: 8px;
          padding-bottom: 8px;
        }

        .mdc-floating-label {
          top: 50% !important;
          transform: translateY(-50%) !important;
        }

        .mdc-floating-label--float-above {
          top: 0 !important;
          transform: translateY(-34%) scale(0.75) !important;
        }
      }

      /* QR Section */
      .qr-section {
        text-align: center;
        padding-top: 8px;
      }

      .qr-code-container {
        display: inline-block;
        padding: 12px;
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 16px;
      }

      .info-row {
        text-align: left;
        margin-bottom: 12px;

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
        transition: background 0.2s;

        &:hover {
          background: #e8eef5;
        }

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
        font-size: 14px;
        font-weight: 500;
        color: #002341;
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

      /* No address state */
      .no-address {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 32px 0;
        color: rgba(0, 0, 0, 0.38);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: 8px;
        }

        span {
          font-size: 13px;
        }
      }

      /* Dark theme */
      :host-context(.dark-theme) {
        .page-layout {
          background: #303030;
        }

        .receive-card {
          background: #424242;
        }

        .info-row .info-label {
          color: #aaa;
        }

        .info-value-row {
          background: #333;

          &:hover {
            background: #3a3a3a;
          }
        }

        .address-value {
          color: #90caf9;
        }

        .no-address {
          color: rgba(255, 255, 255, 0.38);
        }
      }

      /* Responsive */
      @media (max-width: 500px) {
        .address-mode-row mat-radio-group {
          flex-direction: column;
          gap: 8px;
        }
      }
    `,
  ],
})
export class ReceiveComponent implements OnInit, OnDestroy {
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly clipboard = inject(ClipboardService);
  private readonly notification = inject(NotificationService);
  private readonly location = inject(Location);
  private readonly destroy$ = new Subject<void>();

  addressMode: AddressMode = 'existing';
  existingAddresses = signal<AddressInfo[]>([]);
  selectedAddress = '';
  isLoadingAddresses = signal(false);
  generatedAddress = signal('');
  isGenerating = signal(false);
  amount: number | null = null;
  label = '';

  currentAddress(): string {
    return this.addressMode === 'existing' ? this.selectedAddress : this.generatedAddress();
  }

  paymentUri(): string {
    const address = this.currentAddress();
    if (!address) return '';

    let uri = `btcx:${address}`;
    const params: string[] = [];
    if (this.amount && this.amount > 0) params.push(`amount=${this.amount}`);
    if (this.label?.trim()) params.push(`label=${encodeURIComponent(this.label.trim())}`);
    if (params.length > 0) uri += '?' + params.join('&');
    return uri;
  }

  ngOnInit(): void {
    this.loadExistingAddresses();

    // Subscribe to wallet changes to reload addresses
    this.walletManager.activeWallet$
      .pipe(
        skip(1), // Skip initial value since we already loaded
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.selectedAddress = '';
        this.generatedAddress.set('');
        this.addressMode = 'existing';
        this.loadExistingAddresses();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  async loadExistingAddresses(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    this.isLoadingAddresses.set(true);
    try {
      const addressMap = await this.walletRpc.getAddressesByLabel(walletName, '');
      const addresses: AddressInfo[] = [];

      for (const [address, info] of Object.entries(addressMap)) {
        if (this.isBech32Address(address)) {
          try {
            const addrInfo = await this.walletRpc.getAddressInfo(walletName, address);
            addresses.push({
              address,
              purpose: (info as { purpose?: string }).purpose || 'receive',
              isUsed: addrInfo.ismine && addrInfo.labels && addrInfo.labels.length > 0,
              txCount: 0,
              label: addrInfo.labels?.[0] || '',
            });
          } catch {
            addresses.push({
              address,
              purpose: (info as { purpose?: string }).purpose || 'receive',
              isUsed: false,
              txCount: 0,
              label: '',
            });
          }
        }
      }

      this.existingAddresses.set(addresses);
      if (addresses.length > 0) {
        this.selectedAddress = addresses[addresses.length - 1].address;
      }
    } catch (error) {
      console.error('Failed to load addresses:', error);
    } finally {
      this.isLoadingAddresses.set(false);
    }
  }

  async generateNewAddress(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    this.isGenerating.set(true);
    try {
      const address = await this.walletRpc.getNewAddress(walletName, this.label || '', 'bech32');
      this.generatedAddress.set(address);
      await this.loadExistingAddresses();
    } catch (error) {
      console.error('Failed to generate address:', error);
      this.notification.error('error_generating_address');
    } finally {
      this.isGenerating.set(false);
    }
  }

  onAddressModeChange(): void {
    if (this.addressMode === 'generate' && !this.generatedAddress()) {
      this.generateNewAddress();
    }
  }

  async copyAddress(): Promise<void> {
    const address = this.currentAddress();
    if (address) await this.clipboard.copyAddress(address);
  }

  async copyPaymentUri(): Promise<void> {
    const uri = this.paymentUri();
    if (uri) {
      await this.clipboard.copy(uri);
      this.notification.success('payment_uri_copied');
    }
  }

  private isBech32Address(address: string): boolean {
    const lower = address.toLowerCase();
    return (
      lower.startsWith('bc1q') ||
      lower.startsWith('tb1q') ||
      lower.startsWith('pocx1q') ||
      lower.startsWith('tpocx1q')
    );
  }

  getAddressDisplayLabel(addr: AddressInfo): string {
    const parts: string[] = [];
    if (addr.label) parts.push(addr.label);
    if (addr.purpose === 'receive' && !addr.isUsed) parts.push('never used');
    return parts.length > 0 ? ` (${parts.join(' - ')})` : '';
  }
}
