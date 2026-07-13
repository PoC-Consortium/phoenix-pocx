import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { HashTruncatePipe } from '../../../../shared/pipes';
import { ClipboardService, Contact, ContactsStoreService } from '../../../../shared/services';
import { validatePocxAddress } from '../../../../bitcoin/utils/address-validation';
import {
  BtcxWalletService,
  BtcxFeeEstimates,
  BtcxSendRequest,
} from '../../../../core/services/btcx-wallet.service';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';

type SendStage = 'form' | 'review' | 'success';

interface FeePreset {
  labelKey: string;
  /** Confirmation target in blocks (null = custom). */
  target: number | null;
}

/** Assumed vsize for the fee preview (typical 1-in/2-out P2WPKH send). */
const PREVIEW_VSIZE_VB = 141;

/**
 * F5 (audit Batch A): sanity ceiling for a SERVER-resolved preset fee rate,
 * in sat/vB. This chain's floor is ~1 sat/vB, so 200 is already extreme — a
 * preset resolving above it means a faulty or hostile Electrum server is
 * inflating the estimate. Above this the review step demands an explicit
 * extra confirmation instead of silently accepting it. (A user-typed CUSTOM
 * rate is the user's own choice and is never gated by this.) The hard crate
 * cap (10,000 sat/vB) is the backstop; this is the user-facing guard.
 */
const SANE_PRESET_MAX_SAT_VB = 200;

/**
 * WalletSendComponent - mobile send flow.
 *
 * Form (address, amount + MAX/send-all, fee preset or custom sat/vB) ->
 * review (amount, fee rate, estimated fee, total) -> send -> txid.
 */
@Component({
  selector: 'app-wallet-send',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
    MatCheckboxModule,
    DecimalPipe,
    HashTruncatePipe,
    I18nPipe,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="send" [backLink]="null" (back)="onBack()">
      <!-- Desktop send header's available-balance chip, stacked for width -->
      <div class="balance-display">
        <span class="balance-label">{{ 'balance_available' | i18n }}</span>
        <span class="balance-value"> {{ spendableSat() / 100000000 | number: '1.8-8' }} BTCX </span>
      </div>
    </app-mwallet-page-header>

    <div class="page">
      @if (stage() === 'success') {
        <div class="card success-card">
          <mat-icon class="success-icon">check_circle</mat-icon>
          <h3>{{ 'transaction_sent' | i18n }}</h3>
          <div class="info-row">
            <span class="info-label">{{ 'transaction_id' | i18n }}</span>
            <div class="info-value-row" (click)="copyTxid()" [matTooltip]="'copy' | i18n">
              <span class="mono">{{ sentTxid() }}</span>
              <mat-icon class="copy-icon">content_copy</mat-icon>
            </div>
          </div>
          <div class="button-row">
            <button mat-stroked-button routerLink="/wallet/history">
              {{ 'transactions' | i18n }}
            </button>
            <button mat-raised-button color="primary" (click)="reset()">
              {{ 'send_another' | i18n }}
            </button>
          </div>
        </div>
      } @else if (stage() === 'review') {
        <div class="card">
          <h3>{{ 'mwallet_review' | i18n }}</h3>

          <div class="summary-grid">
            <div class="summary-row">
              <span class="summary-label">{{ 'recipient' | i18n }}</span>
              <span class="summary-value mono small">{{ address.trim() }}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">{{ 'amount' | i18n }}</span>
              <span class="summary-value">
                {{ effectiveAmountSat() / 100000000 | number: '1.8-8' }} BTCX
              </span>
            </div>
            <div class="summary-row">
              <span class="summary-label">{{ 'fee_rate' | i18n }}</span>
              <span class="summary-value">{{ reviewFeeRateLabel() }}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">{{ 'estimated_fee' | i18n }}</span>
              <span class="summary-value">
                ~{{ estimatedFeeSat() / 100000000 | number: '1.8-8' }} BTCX ({{
                  estimatedFeeSat() | number: '1.0-0'
                }}
                sats)
              </span>
            </div>
            <mat-divider></mat-divider>
            <div class="summary-row total">
              <span class="summary-label">{{ 'total' | i18n }}</span>
              <span class="summary-value">
                @if (sendAll) {
                  {{ effectiveAmountSat() / 100000000 | number: '1.8-8' }} BTCX
                } @else {
                  ~{{ (effectiveAmountSat() + estimatedFeeSat()) / 100000000 | number: '1.8-8' }}
                  BTCX
                }
              </span>
            </div>
          </div>

          @if (sendAll) {
            <p class="hint-text">{{ 'mwallet_send_all_note' | i18n }}</p>
          }
          <p class="hint-text small">{{ 'mwallet_fee_estimated_note' | i18n }}</p>

          <!-- Desktop confirm dialog's irreversibility note -->
          <div class="warning-box">
            <mat-icon>info</mat-icon>
            <span>{{ 'transaction_irreversible' | i18n }}</span>
          </div>

          <!-- F5: server-resolved preset fee is abnormally high — demand an
               explicit extra confirmation before allowing the send. -->
          @if (isHighPresetFee()) {
            <div class="warning-box high-fee">
              <mat-icon>report</mat-icon>
              <div class="high-fee-body">
                <span>
                  {{
                    'fee_high_warning'
                      | i18n: { rate: (previewFeeRate() ?? 0 | number: '1.0-2') ?? '0' }
                  }}
                </span>
                <mat-checkbox
                  class="high-fee-ack"
                  [checked]="highFeeAcknowledged()"
                  (change)="highFeeAcknowledged.set($event.checked)"
                >
                  {{ 'fee_high_ack' | i18n }}
                </mat-checkbox>
              </div>
            </div>
          }

          @if (sendError()) {
            <p class="error-text">{{ 'mwallet_send_failed' | i18n }}: {{ sendError() }}</p>
          }

          <div class="button-row">
            <button mat-stroked-button [disabled]="sending()" (click)="stage.set('form')">
              {{ 'back' | i18n }}
            </button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="sending() || (isHighPresetFee() && !highFeeAcknowledged())"
              (click)="send()"
            >
              @if (sending()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                <mat-icon>send</mat-icon>
              }
              {{ 'send' | i18n }}
            </button>
          </div>
        </div>
      } @else {
        <div class="card">
          <!-- Recipient -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'recipient_address' | i18n }}</mat-label>
            <input
              matInput
              [(ngModel)]="address"
              (ngModelChange)="validateAddress()"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
            />
            @if (addressValid()) {
              <mat-icon matSuffix class="suffix-valid">check_circle</mat-icon>
            }
            @if (contacts().length > 0) {
              <button
                mat-icon-button
                matSuffix
                type="button"
                [matMenuTriggerFor]="contactsMenu"
                [matTooltip]="'select_contact' | i18n"
              >
                <mat-icon>contacts</mat-icon>
              </button>
            }
          </mat-form-field>
          <mat-menu #contactsMenu="matMenu">
            @for (contact of contacts(); track contact.id) {
              <button mat-menu-item (click)="selectContact(contact)">
                <div class="contact-option">
                  <span class="contact-option-name">{{ contact.name }}</span>
                  <span class="contact-option-address">
                    {{ contact.address | hashTruncate: 14 : 8 }}
                  </span>
                </div>
              </button>
            }
          </mat-menu>
          @let addrErr = addressError();
          @if (addrErr) {
            <p class="error-text">{{ addrErr.key | i18n: addrErr.params }}</p>
          }

          <!-- Amount -->
          <div class="amount-row">
            <mat-form-field appearance="outline" class="amount-field">
              <mat-label>{{ 'amount' | i18n }} (BTCX)</mat-label>
              <input
                matInput
                type="number"
                [(ngModel)]="amount"
                [disabled]="sendAll"
                placeholder="0.00000000"
                step="0.00000001"
                min="0"
                autocomplete="off"
              />
            </mat-form-field>
            <button
              mat-stroked-button
              class="max-button"
              [class.selected]="sendAll"
              (click)="toggleSendAll()"
              [matTooltip]="'mwallet_send_all' | i18n"
            >
              {{ 'max_button' | i18n }}
            </button>
          </div>
          @if (sendAll) {
            <p class="hint-text small">{{ 'mwallet_send_all_note' | i18n }}</p>
          }
          @if (insufficient()) {
            <p class="error-text">{{ 'insufficient_balance' | i18n }}</p>
          }

          <!-- Fee -->
          <h3 class="section-title">{{ 'fee' | i18n }}</h3>
          <div class="fee-options">
            @for (preset of presets; track preset.labelKey) {
              <button
                mat-stroked-button
                class="fee-option"
                [class.selected]="selectedPreset() === preset"
                [disabled]="preset.target !== null && presetRate(preset) === null"
                (click)="selectPreset(preset)"
              >
                <span class="fee-label">{{ preset.labelKey | i18n }}</span>
                @if (preset.target !== null) {
                  <span class="fee-rate">
                    @if (presetRate(preset) !== null) {
                      {{ presetRate(preset) | number: '1.3-3' }} sat/vB
                    } @else {
                      --
                    }
                  </span>
                }
              </button>
            }
          </div>

          @if (selectedPreset().target === null) {
            <mat-form-field appearance="outline" class="full-width custom-fee">
              <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
              <input
                matInput
                type="number"
                [(ngModel)]="customFeeRate"
                min="0.1"
                step="0.001"
                autocomplete="off"
              />
            </mat-form-field>
          }

          <!-- Live estimate (the desktop send page's .fee-summary line) -->
          <div class="fee-summary">
            <span class="fee-summary-label">{{ 'estimated_fee' | i18n }}:</span>
            <span class="fee-summary-value">
              {{ estimatedFeeSat() / 100000000 | number: '1.8-8' }} BTCX ({{
                estimatedFeeSat() | number: '1.0-0'
              }}
              sats)
            </span>
          </div>

          <!-- Inline summary (the desktop send page's summary section) -->
          @if (effectiveAmountSat() > 0) {
            <div class="summary-grid form-summary">
              <div class="summary-row">
                <span class="summary-label">{{ 'amount' | i18n }}</span>
                <span class="summary-value">
                  {{ effectiveAmountSat() / 100000000 | number: '1.8-8' }} BTCX
                </span>
              </div>
              <div class="summary-row">
                <span class="summary-label">{{ 'estimated_fee' | i18n }}</span>
                <span class="summary-value">
                  ~{{ estimatedFeeSat() / 100000000 | number: '1.8-8' }} BTCX
                </span>
              </div>
              <mat-divider></mat-divider>
              <div class="summary-row total">
                <span class="summary-label">{{ 'total' | i18n }}</span>
                <span class="summary-value" [class.error]="insufficient()">
                  @if (sendAll) {
                    {{ effectiveAmountSat() / 100000000 | number: '1.8-8' }} BTCX
                  } @else {
                    ~{{ (effectiveAmountSat() + estimatedFeeSat()) / 100000000 | number: '1.8-8' }}
                    BTCX
                  }
                </span>
              </div>
            </div>
          }

          <div class="button-row">
            <button mat-stroked-button routerLink="/wallet">
              {{ 'cancel' | i18n }}
            </button>
            <button mat-raised-button color="primary" [disabled]="!canReview()" (click)="review()">
              {{ 'mwallet_review' | i18n }}
            </button>
          </div>
        </div>
      }
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

      /* Desktop send header's .balance-display, stacked to fit a phone. */
      .balance-display {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        background: rgba(255, 255, 255, 0.1);
        padding: 4px 10px;
        border-radius: 8px;
        min-width: 0;

        .balance-label {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        .balance-value {
          font-size: 12px;
          font-weight: 600;
          font-family: monospace;
          color: white;
          white-space: nowrap;
        }
      }

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;

        h3 {
          margin: 0 0 12px;
          font-size: 15px;
          font-weight: 500;
        }
      }

      .section-title {
        margin: 16px 0 8px !important;
      }

      .full-width {
        width: 100%;
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 12px;

        &.small {
          font-size: 12px;
        }
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      .suffix-valid {
        color: #4caf50;
      }

      .amount-row {
        display: flex;
        gap: 8px;
        align-items: flex-start;

        .amount-field {
          flex: 1;
        }

        .max-button {
          height: 40px;
          margin-top: 8px;
          flex-shrink: 0;

          &.selected {
            background: rgba(25, 118, 210, 0.12);
            border-color: #1976d2;
            color: #1976d2;
          }
        }
      }

      .fee-options {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        margin-bottom: 12px;
      }

      .fee-option {
        padding: 4px 2px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.3;
        height: auto;

        /* Material wraps the projected content in .mdc-button__label, so the
           flex column above cannot stack the two spans — make them blocks
           and keep the rate on one line: "Slow" / "1 sat/vB". */
        .fee-label {
          display: block;
          font-size: 12px;
        }

        .fee-rate {
          display: block;
          white-space: nowrap;
          font-size: 10px;
          color: rgba(0, 0, 0, 0.5);
        }

        &.selected {
          background: rgba(25, 118, 210, 0.12);
          border-color: #1976d2;

          .fee-label {
            color: #1976d2;
          }
        }
      }

      /* Live fee line (desktop send page's .fee-summary). */
      .fee-summary {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        margin-bottom: 12px;

        .fee-summary-label {
          color: rgba(0, 0, 0, 0.6);
          flex-shrink: 0;
        }

        .fee-summary-value {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      }

      .form-summary {
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        padding-top: 10px;
      }

      /* Desktop confirm dialog's irreversibility note, mobile-sized. */
      .warning-box {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        background: rgba(255, 152, 0, 0.1);
        font-size: 12px;
        margin-bottom: 12px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #f57c00;
          flex-shrink: 0;
        }
      }

      /* F5: the high-fee warning is a stronger, red-tinted alert with an
         inline acknowledgement checkbox. */
      .warning-box.high-fee {
        align-items: flex-start;
        background: rgba(244, 67, 54, 0.12);

        mat-icon {
          color: #e53935;
        }

        .high-fee-body {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .high-fee-ack {
          font-size: 12px;
        }
      }

      .button-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
      }

      .summary-grid {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 13px;

        .summary-label {
          color: rgba(0, 0, 0, 0.6);
          flex-shrink: 0;
        }

        .summary-value {
          text-align: right;
          font-variant-numeric: tabular-nums;

          &.small {
            font-size: 11px;
          }

          &.error {
            color: #c62828;
          }
        }

        &.total {
          font-weight: 600;
        }
      }

      .mono {
        font-family: monospace;
        word-break: break-all;
      }

      .contact-option {
        display: flex;
        flex-direction: column;
        line-height: 1.3;

        .contact-option-name {
          font-size: 14px;
        }

        .contact-option-address {
          font-size: 11px;
          font-family: monospace;
          color: rgba(0, 0, 0, 0.55);
        }
      }

      .success-card {
        text-align: center;

        .success-icon {
          color: #4caf50;
          font-size: 40px;
          width: 40px;
          height: 40px;
        }
      }

      .info-row {
        text-align: left;
        margin: 12px 0 16px;

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
        font-size: 12px;

        .copy-icon {
          font-size: 18px;
          height: 18px;
          width: 18px;
          color: #1976d2;
          flex-shrink: 0;
          margin-left: 8px;
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text,
        .summary-row .summary-label,
        .fee-summary .fee-summary-label {
          color: rgba(255, 255, 255, 0.6);
        }

        .form-summary {
          border-top-color: rgba(255, 255, 255, 0.12);
        }

        .warning-box {
          background: rgba(255, 152, 0, 0.16);

          mat-icon {
            color: #ffb74d;
          }
        }

        .warning-box.high-fee {
          background: rgba(244, 67, 54, 0.2);

          mat-icon {
            color: #ef9a9a;
          }
        }

        .summary-row .summary-value.error {
          color: #ef9a9a;
        }

        .fee-option .fee-rate {
          color: rgba(255, 255, 255, 0.5);
        }

        .info-value-row {
          background: #333;
        }
      }
    `,
  ],
})
export class WalletSendComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly i18n = inject(I18nService);
  private readonly clipboard = inject(ClipboardService);
  private readonly contactsStore = inject(ContactsStoreService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Address book entries of the wallet's network (picker suffix). */
  readonly contacts = computed(() => this.contactsStore.forNetwork(this.wallet.network()));

  readonly presets: FeePreset[] = [
    { labelKey: 'fee_slow', target: 144 },
    { labelKey: 'fee_normal', target: 6 },
    { labelKey: 'fee_fast', target: 1 },
    { labelKey: 'fee_custom', target: null },
  ];

  readonly stage = signal<SendStage>('form');
  readonly estimates = signal<BtcxFeeEstimates | null>(null);
  readonly selectedPreset = signal<FeePreset>(this.presets[1]);
  readonly addressValid = signal(false);
  readonly addressError = signal<{ key: string; params?: Record<string, string> } | null>(null);
  readonly sending = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly sentTxid = signal('');
  /** F5: the user has acknowledged an abnormally-high preset fee. */
  readonly highFeeAcknowledged = signal(false);

  address = '';
  amount: number | null = null;
  sendAll = false;
  customFeeRate: number | null = null;

  readonly spendableSat = computed(() => this.wallet.balance()?.spendableSat ?? 0);

  ngOnInit(): void {
    // Prefill from ?address= (contacts "send to", same as desktop).
    const prefill = this.route.snapshot.queryParamMap.get('address');
    if (prefill) {
      this.address = prefill;
    }
    this.contactsStore.load();
    void this.init();
  }

  private async init(): Promise<void> {
    await this.wallet.initialize();
    if (this.address) {
      this.validateAddress();
    }
    if (this.wallet.walletActive()) {
      await this.wallet.refreshBalance();
      try {
        const estimates = await this.wallet.fetchFeeEstimates();
        this.estimates.set(estimates);
        this.customFeeRate = estimates.minSatPerVb;
      } catch (err) {
        console.error('Failed to fetch fee estimates:', err);
      }
    }
  }

  /**
   * Header back: review steps back to the form; the form goes to the
   * Dashboard (/wallet) — never history-back, so deep entries (e.g. a
   * contacts "send to" hand-off) still land somewhere coherent.
   */
  onBack(): void {
    if (this.stage() === 'review') {
      this.stage.set('form');
    } else {
      void this.router.navigate(['/wallet']);
    }
  }

  validateAddress(): void {
    const result = validatePocxAddress(this.address);
    this.addressValid.set(false);
    switch (result.kind) {
      case 'empty':
        this.addressError.set(null);
        break;
      case 'invalid_format':
        this.addressError.set({ key: 'address_invalid_format' });
        break;
      case 'invalid_checksum':
        this.addressError.set({ key: 'address_invalid_checksum' });
        break;
      case 'valid':
        if (result.network !== this.wallet.network()) {
          this.addressError.set({
            key: 'address_wrong_network',
            params: {
              addressNetwork: this.i18n.get(result.network),
              appNetwork: this.i18n.get(this.wallet.network()),
            },
          });
        } else {
          this.addressError.set(null);
          this.addressValid.set(true);
        }
        break;
    }
  }

  selectContact(contact: Contact): void {
    this.address = contact.address;
    this.validateAddress();
  }

  toggleSendAll(): void {
    this.sendAll = !this.sendAll;
    // Fill the (now read-only) field with what will be swept — leaving it
    // empty made MAX look like a no-op. Display only: the actual send uses
    // the sendAll flag, the fee comes out of the swept amount.
    this.amount = this.sendAll ? this.spendableSat() / 100_000_000 : null;
  }

  presetRate(preset: FeePreset): number | null {
    const estimates = this.estimates();
    if (!estimates || preset.target === null) return null;
    if (preset.target <= 1) return estimates.fast;
    if (preset.target <= 6) return estimates.normal;
    return estimates.slow;
  }

  selectPreset(preset: FeePreset): void {
    this.selectedPreset.set(preset);
    // F5: a changed preset invalidates any prior high-fee acknowledgement.
    this.highFeeAcknowledged.set(false);
    if (preset.target === null && this.customFeeRate === null) {
      this.customFeeRate = this.minFeeRate();
    }
  }

  minFeeRate(): number {
    return this.estimates()?.minSatPerVb ?? 1;
  }

  /** The feerate the review preview uses, in sat/vB. */
  previewFeeRate(): number {
    const preset = this.selectedPreset();
    if (preset.target === null) {
      return Math.max(this.customFeeRate ?? this.minFeeRate(), 0);
    }
    return this.presetRate(preset) ?? this.minFeeRate();
  }

  /**
   * F5: true when a SERVER-resolved PRESET fee rate exceeds the sane
   * ceiling. Custom (user-typed) rates are the user's own choice and are
   * never flagged — only server-driven presets can be inflated by a faulty
   * or hostile Electrum server.
   */
  isHighPresetFee(): boolean {
    if (this.selectedPreset().target === null) return false;
    return this.previewFeeRate() > SANE_PRESET_MAX_SAT_VB;
  }

  reviewFeeRateLabel(): string {
    const preset = this.selectedPreset();
    const rate = this.previewFeeRate();
    const name = this.i18n.get(preset.labelKey);
    return `${name} · ${rate.toFixed(2)} sat/vB`;
  }

  amountSat(): number {
    if (this.amount === null || !isFinite(this.amount) || this.amount <= 0) return 0;
    return Math.round(this.amount * 100_000_000);
  }

  effectiveAmountSat(): number {
    return this.sendAll ? this.spendableSat() : this.amountSat();
  }

  estimatedFeeSat(): number {
    return Math.ceil(this.previewFeeRate() * PREVIEW_VSIZE_VB);
  }

  insufficient(): boolean {
    if (this.sendAll) return this.spendableSat() === 0;
    const sat = this.amountSat();
    return sat > 0 && sat + this.estimatedFeeSat() > this.spendableSat();
  }

  canReview(): boolean {
    if (!this.addressValid() || this.insufficient()) return false;
    if (this.sendAll) return this.spendableSat() > 0;
    if (this.amountSat() <= 0) return false;
    if (this.selectedPreset().target === null) {
      return this.customFeeRate !== null && this.customFeeRate > 0;
    }
    return true;
  }

  review(): void {
    if (!this.canReview()) return;
    this.sendError.set(null);
    // F5: each visit to review re-requires acknowledgement of a high fee.
    this.highFeeAcknowledged.set(false);
    this.stage.set('review');
  }

  async send(): Promise<void> {
    if (this.sending()) return;
    // F5: never send an abnormally-high preset fee without acknowledgement
    // (the button is already disabled — this is the belt-and-suspenders gate).
    if (this.isHighPresetFee() && !this.highFeeAcknowledged()) return;
    this.sending.set(true);
    this.sendError.set(null);

    const preset = this.selectedPreset();
    const request: BtcxSendRequest = {
      address: this.address.trim(),
      ...(this.sendAll ? { sendAll: true } : { amountSat: this.amountSat() }),
      ...(preset.target === null
        ? { feeRateSatVb: this.customFeeRate ?? this.minFeeRate() }
        : { feeTarget: preset.target }),
    };

    try {
      const txid = await this.wallet.send(request);
      this.sentTxid.set(txid);
      this.stage.set('success');
    } catch (err) {
      console.error('Send failed:', err);
      this.sendError.set(`${err}`);
    } finally {
      this.sending.set(false);
    }
  }

  async copyTxid(): Promise<void> {
    const txid = this.sentTxid();
    if (txid) await this.clipboard.copyTxid(txid);
  }

  reset(): void {
    this.address = '';
    this.amount = null;
    this.sendAll = false;
    this.addressValid.set(false);
    this.addressError.set(null);
    this.sendError.set(null);
    this.sentTxid.set('');
    this.stage.set('form');
    void this.wallet.refreshBalance();
  }
}
