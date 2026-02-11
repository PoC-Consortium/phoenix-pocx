import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { Subject } from 'rxjs';
import { I18nPipe, I18nService } from '../../../../core/i18n';

interface Contact {
  id: string;
  name: string;
  address: string;
  notes?: string;
  createdAt: number;
}
import { AddressDisplayComponent } from '../../../../shared';
import { NotificationService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { SendConfirmDialogComponent } from '../../components/send-confirm-dialog/send-confirm-dialog.component';

interface FeeOption {
  label: string;
  blocks: number;
  feeRate: number | null;
  estimatedFee: number | null;
  timeEstimate: string;
}

/**
 * SendComponent allows users to send Bitcoin.
 *
 * Features:
 * - Single-step send form with summary
 * - Recipient address input with validation
 * - Amount input with max button
 * - Fee estimation with priority options
 * - RBF (Replace-By-Fee) option
 * - Subtract fee from amount option
 * - Confirmation dialog before sending
 */
@Component({
  selector: 'app-send',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatDialogModule,
    MatMenuModule,
    I18nPipe,
    AddressDisplayComponent,
    DecimalPipe,
  ],
  template: `
    <div class="page-layout">
      <!-- Header with gradient background -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'send' | i18n }}</h1>
        </div>
        <div class="header-right">
          <div class="balance-display">
            <span class="balance-label">{{ 'balance_available' | i18n }}:</span>
            <span class="balance-value"
              >{{ availableBalance() | number: '1.8-8' }} {{ currencySymbol() }}</span
            >
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="content">
        @if (showSuccess()) {
          <!-- Success State -->
          <div class="success-card">
            <div class="success-icon">
              <mat-icon>check_circle</mat-icon>
            </div>
            <h2>{{ 'transaction_sent' | i18n }}</h2>
            <p class="txid-label">{{ 'transaction_id' | i18n }}:</p>
            <app-address-display [address]="sentTxid()" [shortForm]="false" [showCopyButton]="true">
            </app-address-display>

            <div class="success-buttons">
              <button mat-stroked-button routerLink="/transactions">
                <mat-icon>history</mat-icon>
                {{ 'view_transactions' | i18n }}
              </button>
              <button mat-raised-button color="primary" (click)="resetForm()">
                <mat-icon>add</mat-icon>
                {{ 'send_another' | i18n }}
              </button>
            </div>
          </div>
        } @else {
          <!-- Send Form -->
          <div class="send-card">
            <!-- Recipient Section -->
            <div class="form-section">
              <h3 class="section-title">{{ 'recipient' | i18n }}</h3>
              <div class="recipient-row">
                <mat-form-field appearance="outline" class="recipient-field">
                  <mat-label>{{ 'recipient_address' | i18n }}</mat-label>
                  <input
                    matInput
                    [(ngModel)]="recipientAddress"
                    placeholder="tb1q... / m... / n..."
                    (blur)="validateAddress()"
                    autocomplete="off"
                  />
                  @if (addressError()) {
                    <mat-error>{{ addressError() }}</mat-error>
                  }
                  @if (addressValid()) {
                    <mat-hint class="valid-hint">
                      <mat-icon class="small-icon">check_circle</mat-icon>
                      {{ 'address_valid' | i18n }}
                    </mat-hint>
                  }
                </mat-form-field>
                <button
                  mat-stroked-button
                  class="contacts-button"
                  [matMenuTriggerFor]="contactsMenu"
                  [disabled]="!hasContacts()"
                  [matTooltip]="'select_contact' | i18n"
                >
                  <mat-icon>contacts</mat-icon>
                </button>
                <mat-menu #contactsMenu="matMenu">
                  @for (contact of contacts(); track contact.address) {
                    <button mat-menu-item (click)="selectContact(contact)">
                      <mat-icon>person</mat-icon>
                      <span class="contact-menu-item">
                        <span class="contact-name">{{ contact.name }}</span>
                        <small class="contact-address">{{ contact.address }}</small>
                      </span>
                    </button>
                  }
                </mat-menu>
              </div>
            </div>

            <!-- Amount Section -->
            <div class="form-section">
              <h3 class="section-title">{{ 'amount' | i18n }}</h3>
              <div class="amount-row">
                <mat-form-field appearance="outline" class="amount-field">
                  <mat-label>{{ 'amount' | i18n }} ({{ currencySymbol() }})</mat-label>
                  <input
                    matInput
                    type="number"
                    [(ngModel)]="amount"
                    placeholder="0.00000000"
                    step="0.00000001"
                    min="0"
                    (ngModelChange)="updateEstimatedFee()"
                    autocomplete="off"
                  />
                  <span matTextSuffix class="currency-suffix">{{ currencySymbol() }}</span>
                </mat-form-field>
                <button
                  mat-stroked-button
                  class="max-button"
                  (click)="setMaxAmount()"
                  [matTooltip]="'use_all_funds' | i18n"
                >
                  <mat-icon>all_inclusive</mat-icon>
                  {{ 'max_button' | i18n }}
                </button>
              </div>
            </div>

            <!-- Fee Section -->
            <div class="form-section">
              <div class="section-header">
                <h3 class="section-title">{{ 'fee' | i18n }}</h3>
                <button
                  mat-icon-button
                  class="refresh-button"
                  (click)="refreshFeeEstimates()"
                  [disabled]="isLoadingFees()"
                  [matTooltip]="'refresh_fees' | i18n"
                >
                  <mat-icon [class.spinning]="isLoadingFees()">refresh</mat-icon>
                </button>
              </div>

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
                        <span class="fee-rate">{{ option.feeRate | number: '1.0-0' }} sat/vB</span>
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
                      min="1"
                      step="1"
                      autocomplete="off"
                    />
                  </mat-form-field>
                </div>
              }

              <div class="fee-summary">
                <span class="fee-label">{{ 'estimated_fee' | i18n }}:</span>
                <span class="fee-value">
                  {{ selectedFeeOption?.estimatedFee ?? 0 | number: '1.8-8' }}
                  {{ currencySymbol() }} ({{ getEstimatedFeeSats() | number: '1.0-0' }}
                  sats)
                </span>
              </div>
            </div>

            <!-- Options Section -->
            <div class="form-section options-section">
              <h3 class="section-title">{{ 'options' | i18n }}</h3>

              <div class="option-row">
                <div class="option-info">
                  <span class="option-label">{{ 'subtract_fee_from_amount' | i18n }}</span>
                  <span class="option-hint">{{ 'subtract_fee_hint' | i18n }}</span>
                </div>
                <mat-slide-toggle [(ngModel)]="subtractFee"></mat-slide-toggle>
              </div>

              <div class="option-row">
                <div class="option-info">
                  <span class="option-label">{{ 'replace_by_fee' | i18n }}</span>
                  <span class="option-hint">{{ 'rbf_hint' | i18n }}</span>
                </div>
                <mat-slide-toggle [(ngModel)]="enableRbf"></mat-slide-toggle>
              </div>
            </div>

            <!-- Summary Section -->
            <div class="form-section summary-section">
              <h3 class="section-title">{{ 'summary' | i18n }}</h3>
              <div class="summary-grid">
                <div class="summary-row">
                  <span class="summary-label">{{ 'amount' | i18n }}:</span>
                  <span class="summary-value"
                    >{{ getDisplayAmount() | number: '1.8-8' }} {{ currencySymbol() }}</span
                  >
                </div>
                <div class="summary-row">
                  <span class="summary-label">{{ 'fee' | i18n }}:</span>
                  <span class="summary-value"
                    >{{ selectedFeeOption?.estimatedFee ?? 0 | number: '1.8-8' }}
                    {{ currencySymbol() }}</span
                  >
                </div>
                <mat-divider></mat-divider>
                <div class="summary-row total">
                  <span class="summary-label">{{ 'total' | i18n }}:</span>
                  <span class="summary-value" [class.error]="!hasSufficientBalance()">
                    {{ getTotalAmount() | number: '1.8-8' }} {{ currencySymbol() }}
                  </span>
                </div>
              </div>

              @if (!hasSufficientBalance()) {
                <div class="balance-warning">
                  <mat-icon>warning</mat-icon>
                  <span>{{ 'insufficient_balance' | i18n }}</span>
                </div>
              }
            </div>

            <!-- Error Display -->
            @if (sendError()) {
              <div class="error-banner">
                <mat-icon>error</mat-icon>
                <span>{{ sendError() }}</span>
              </div>
            }

            <!-- Submit Section -->
            <div class="form-section submit-section">
              <div class="submit-row">
                <button mat-stroked-button (click)="goBack()">
                  {{ 'cancel' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!canSubmit() || sending()"
                  (click)="confirmAndSend()"
                >
                  @if (sending()) {
                    <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                  } @else {
                    <mat-icon>send</mat-icon>
                  }
                  <span>{{ 'send' | i18n }}</span>
                </button>
              </div>
            </div>
          </div>
        }
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
        min-height: 100%;
      }

      // Header styling - blue gradient like old design
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;

          h1 {
            margin: 0;
            font-weight: 300;
            font-size: 24px;
          }

          .back-button {
            color: rgba(255, 255, 255, 0.9);

            &:hover {
              background: rgba(255, 255, 255, 0.1);
            }
          }
        }

        .header-right {
          .balance-display {
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 16px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 8px;

            .balance-label {
              font-size: 12px;
              color: rgba(255, 255, 255, 0.7);
            }

            .balance-value {
              font-size: 14px;
              font-weight: 600;
              font-family: monospace;
              color: white;
            }
          }
        }
      }

      .content {
        padding: 24px;
        display: flex;
        justify-content: center;
        flex: 1;
      }

      .send-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        max-width: 600px;
        width: 100%;
        padding: 16px 20px;
      }

      // Form sections - ultra compact layout
      .form-section {
        margin-bottom: 4px;

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 4px;

          .section-title {
            border-bottom: none;
            padding-bottom: 0;
            margin-bottom: 0;
          }

          .refresh-button {
            width: 24px;
            height: 24px;
            min-width: 24px;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;

            mat-icon {
              font-size: 16px;
              width: 16px;
              height: 16px;
              line-height: 16px;
              color: #666;
              margin: 0;

              &.spinning {
                animation: spin 1s linear infinite;
              }
            }

            &:hover mat-icon {
              color: #1976d2;
            }
          }
        }

        .section-title {
          font-size: 13px;
          font-weight: 600;
          color: rgb(0, 35, 65);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0 0 4px 0;
        }

        // Compact mat-form-field
        ::ng-deep {
          .mat-mdc-form-field-subscript-wrapper {
            min-height: 0;
            height: auto;
          }

          .mat-mdc-form-field-hint-wrapper,
          .mat-mdc-form-field-error-wrapper {
            padding: 0 12px;
          }

          .mat-mdc-text-field-wrapper {
            padding: 0 12px;
          }

          .mat-mdc-form-field-infix {
            min-height: 40px;
            padding-top: 8px;
            padding-bottom: 8px;
          }

          // Center the floating label vertically
          .mdc-floating-label {
            top: 50% !important;
            transform: translateY(-50%) !important;
          }

          .mdc-floating-label--float-above {
            top: 0 !important;
            transform: translateY(-34%) scale(0.75) !important;
          }
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .full-width {
        width: 100%;
      }

      .valid-hint {
        color: #4caf50;
        display: flex;
        align-items: center;
        gap: 4px;

        .small-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }

      // Recipient section
      .recipient-row {
        display: flex;
        gap: 8px;
        align-items: flex-start;

        .recipient-field {
          flex: 1;
        }

        .contacts-button {
          height: 40px;
          width: 40px;
          min-width: 40px;
          padding: 0;
          border-color: rgba(0, 0, 0, 0.12);

          // Center icon within MDC button structure
          ::ng-deep .mdc-button__label {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          mat-icon {
            color: #666;
            margin: 0;
            font-size: 20px;
            width: 20px;
            height: 20px;
          }

          &:hover:not([disabled]) {
            background: rgba(0, 0, 0, 0.04);
            border-color: rgba(0, 0, 0, 0.38);

            mat-icon {
              color: #333;
            }
          }

          &[disabled] {
            mat-icon {
              color: rgba(0, 0, 0, 0.26);
            }
          }
        }
      }

      .contact-menu-item {
        display: flex;
        flex-direction: column;
        margin-left: 8px;

        .contact-name {
          font-weight: 500;
        }

        .contact-address {
          font-size: 11px;
          color: #888;
          font-family: monospace;
          max-width: 250px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      // Amount section
      .amount-row {
        display: flex;
        gap: 12px;
        align-items: flex-start;

        .amount-field {
          flex: 1;
        }

        .max-button {
          height: 40px;
          min-width: 70px;
          color: #666;
          border-color: rgba(0, 0, 0, 0.12);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;

          mat-icon {
            margin-right: 4px;
            font-size: 16px;
            height: 16px;
            width: 16px;
          }

          &:hover {
            background: rgba(0, 0, 0, 0.04);
            border-color: rgba(0, 0, 0, 0.38);
            color: #333;
          }
        }
      }

      .currency-suffix {
        color: #666;
        font-weight: 500;
      }

      // Fee section
      .fee-options {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 6px;

        button {
          flex: 1;
          min-width: 85px;
          height: auto;
          padding: 4px 2px;
          border-color: #e0e0e0;

          &.selected {
            border-color: #1976d2;
            background: rgba(25, 118, 210, 0.08);
          }

          .fee-option {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1px;

            .fee-label {
              font-weight: 600;
              font-size: 11px;
              color: rgb(0, 35, 65);
            }

            .fee-rate {
              font-size: 12px;
              font-weight: 500;
              color: #1976d2;
              font-family: monospace;
            }

            .fee-time {
              font-size: 10px;
              color: #888;
            }

            .custom-icon {
              font-size: 18px;
              height: 18px;
              width: 18px;
              color: #666;
            }
          }
        }
      }

      .custom-fee-input {
        margin-bottom: 4px;

        mat-form-field {
          max-width: 180px;
        }
      }

      .fee-summary {
        display: flex;
        justify-content: space-between;
        padding: 6px 10px;
        background: #f5f7fa;
        border-radius: 4px;
        margin-bottom: 14px;

        .fee-label {
          color: #666;
          font-size: 13px;
        }

        .fee-value {
          font-family: monospace;
          font-weight: 500;
          font-size: 13px;
          color: rgb(0, 35, 65);
        }
      }

      // Options section
      .options-section {
        .option-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid #f0f0f0;

          &:last-child {
            border-bottom: none;
          }

          .option-info {
            display: flex;
            flex-direction: column;
            gap: 4px;

            .option-label {
              font-weight: 500;
              color: rgb(0, 35, 65);
            }

            .option-hint {
              font-size: 12px;
              color: #888;
            }
          }
        }
      }

      // Summary section
      .summary-section {
        background: #f9fafb;
        padding: 12px 16px;
        border-radius: 8px;
        margin-top: 16px;

        .section-title {
          border-bottom: none;
          padding-bottom: 0;
          font-size: 13px;
        }
      }

      .summary-grid {
        .summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;

          .summary-label {
            color: #666;
            font-size: 13px;
          }

          .summary-value {
            font-family: monospace;
            font-weight: 500;
            font-size: 13px;
            color: rgb(0, 35, 65);

            &.error {
              color: #f44336;
            }
          }

          &.total {
            padding-top: 8px;

            .summary-label,
            .summary-value {
              font-size: 15px;
              font-weight: 600;
            }
          }
        }

        mat-divider {
          margin: 4px 0;
        }
      }

      .balance-warning {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        padding: 12px;
        background: #fff3e0;
        border-radius: 4px;
        color: #e65100;

        mat-icon {
          font-size: 20px;
          height: 20px;
          width: 20px;
        }

        span {
          font-size: 13px;
          font-weight: 500;
        }
      }

      .error-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #ffebee;
        color: #c62828;
        border-radius: 4px;
        margin: 16px 0;

        mat-icon {
          flex-shrink: 0;
        }
      }

      // Submit section
      .submit-section {
        margin-top: 16px;
        margin-bottom: 0;
        padding-top: 16px;
        border-top: 1px solid #e8e8e8;
      }

      .submit-row {
        display: flex;
        justify-content: flex-end;
        gap: 12px;

        button {
          min-width: 120px;

          mat-icon {
            margin-right: 8px;
          }

          .button-spinner {
            display: inline-block;
            margin-right: 8px;
          }
        }
      }

      // Success state
      .success-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        max-width: 500px;
        width: 100%;
        padding: 48px 24px;
        text-align: center;

        .success-icon mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          color: #4caf50;
        }

        h2 {
          margin: 16px 0;
          color: rgb(0, 35, 65);
        }

        .txid-label {
          color: rgba(0, 0, 0, 0.54);
          margin: 16px 0 8px;
        }

        .success-buttons {
          display: flex;
          gap: 16px;
          justify-content: center;
          margin-top: 24px;

          button {
            min-width: 150px;
          }
        }
      }

      // Dark theme
      :host-context(.dark-theme) {
        .header {
          background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        }

        .send-card,
        .success-card {
          background: #424242;
        }

        .section-title,
        .option-label,
        .summary-value,
        h2 {
          color: #ffffff !important;
        }

        .section-header {
          border-bottom-color: #555 !important;
        }

        .fee-summary,
        .summary-section {
          background: #333;
        }

        .option-row {
          border-bottom-color: #555 !important;
        }

        .fee-options button {
          border-color: #555;

          &.selected {
            background: rgba(25, 118, 210, 0.2);
          }
        }

        .balance-warning {
          background: #4a3000;
        }

        .error-banner {
          background: #4a0000;
          color: #ff8a80;
        }
      }

      // Responsive
      @media (max-width: 600px) {
        .header {
          .balance-display {
            display: none;
          }
        }

        .fee-options button {
          min-width: 100%;
        }

        .amount-row {
          flex-direction: column;

          .max-button {
            width: 100%;
          }
        }

        .submit-row {
          flex-direction: column-reverse;

          button {
            width: 100%;
          }
        }

        .success-buttons {
          flex-direction: column;

          button {
            width: 100%;
          }
        }
      }
    `,
  ],
})
export class SendComponent implements OnInit, OnDestroy {
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);
  private readonly destroy$ = new Subject<void>();

  // Currency symbol - always BTCX for Bitcoin-PoCX
  currencySymbol = signal('BTCX');

  // Contacts from localStorage
  contacts = signal<Contact[]>([]);

  // Balance from centralized WalletService - auto-updates via polling
  availableBalance = computed(() => this.walletService.balance());
  addressValid = signal(false);
  addressError = signal<string | null>(null);
  sendError = signal<string | null>(null);
  sending = signal(false);
  sentTxid = signal('');
  showSuccess = signal(false);
  isLoadingFees = signal(false);

  recipientAddress = '';
  amount: number | null = null;
  subtractFee = false;
  enableRbf = true;
  customFeeRate: number | null = null;

  feeOptions: FeeOption[] = [
    { label: 'fee_slow', blocks: 144, feeRate: null, estimatedFee: null, timeEstimate: '~60 min' },
    { label: 'fee_normal', blocks: 6, feeRate: null, estimatedFee: null, timeEstimate: '~30 min' },
    { label: 'fee_fast', blocks: 1, feeRate: null, estimatedFee: null, timeEstimate: '~10 min' },
    { label: 'fee_custom', blocks: 6, feeRate: null, estimatedFee: null, timeEstimate: '' },
  ];

  selectedFeeOption: FeeOption | null = null;

  ngOnInit(): void {
    this.loadContacts();
    this.loadFeeEstimates();
    // Note: Balance is now handled by WalletService with auto-refresh

    // Check for prepopulated address from query param
    const toAddress = this.route.snapshot.queryParamMap.get('to');
    if (toAddress) {
      this.recipientAddress = toAddress;
      this.validateAddress();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  loadContacts(): void {
    const stored = localStorage.getItem('wallet_contacts');
    if (stored) {
      try {
        const contacts = JSON.parse(stored) as Contact[];
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        this.contacts.set(contacts);
      } catch {
        // Invalid data
      }
    }
  }

  async loadFeeEstimates(): Promise<void> {
    this.isLoadingFees.set(true);
    try {
      for (const option of this.feeOptions) {
        const result = await this.blockchainRpc.estimateSmartFee(option.blocks);
        if (result.feerate) {
          // feerate is in BTC/kvB, convert to sat/vB
          option.feeRate = Math.round((result.feerate * 100000000) / 1000);
        }
      }
      // Default to normal fee
      this.selectedFeeOption = this.feeOptions[1];
      this.updateEstimatedFee();
    } catch (error) {
      console.error('Failed to load fee estimates:', error);
    } finally {
      this.isLoadingFees.set(false);
    }
  }

  refreshFeeEstimates(): void {
    this.loadFeeEstimates();
  }

  async validateAddress(): Promise<void> {
    if (!this.recipientAddress) {
      this.addressValid.set(false);
      this.addressError.set(null);
      return;
    }

    try {
      const result = await this.blockchainRpc.validateAddress(this.recipientAddress);
      if (result.isvalid) {
        this.addressValid.set(true);
        this.addressError.set(null);
      } else {
        this.addressValid.set(false);
        this.addressError.set(this.i18n.get('invalid_address'));
      }
    } catch {
      this.addressValid.set(false);
      this.addressError.set(this.i18n.get('error_validating_address'));
    }
  }

  setMaxAmount(): void {
    const fee = this.selectedFeeOption?.estimatedFee ?? 0;
    const maxAmount = this.availableBalance() - fee;
    this.amount = Math.max(0, maxAmount);
    this.subtractFee = true;
  }

  // Contacts methods
  hasContacts(): boolean {
    return this.contacts().length > 0;
  }

  selectContact(contact: Contact): void {
    this.recipientAddress = contact.address;
    this.validateAddress();
  }

  selectFeeOption(option: FeeOption): void {
    this.selectedFeeOption = option;
    if (option.label === 'fee_custom' && this.customFeeRate) {
      option.feeRate = this.customFeeRate;
    }
    this.updateEstimatedFee();
  }

  onCustomFeeChange(): void {
    if (this.selectedFeeOption?.label === 'fee_custom' && this.customFeeRate) {
      this.selectedFeeOption.feeRate = this.customFeeRate;
      this.updateEstimatedFee();
    }
  }

  updateEstimatedFee(): void {
    if (!this.selectedFeeOption) return;

    // For custom fee, use the custom rate
    const feeRate =
      this.selectedFeeOption.label === 'fee_custom'
        ? this.customFeeRate
        : this.selectedFeeOption.feeRate;

    if (feeRate === null) return;

    // Estimate transaction size (P2WPKH with change output: ~170 vbytes for 1-in-2-out)
    const estimatedVBytes = 170;
    const feeInSats = feeRate * estimatedVBytes;
    this.selectedFeeOption.estimatedFee = feeInSats / 100000000;
  }

  getEstimatedFeeSats(): number {
    return Math.round((this.selectedFeeOption?.estimatedFee ?? 0) * 100000000);
  }

  getDisplayAmount(): number {
    return this.amount ?? 0;
  }

  getTotalAmount(): number {
    const fee = this.selectedFeeOption?.estimatedFee ?? 0;
    if (this.subtractFee) {
      return this.amount ?? 0;
    }
    return (this.amount ?? 0) + fee;
  }

  hasSufficientBalance(): boolean {
    return this.getTotalAmount() <= this.availableBalance();
  }

  canSubmit(): boolean {
    // For custom fee, ensure we have a valid rate
    const hasFeeRate =
      this.selectedFeeOption?.label === 'fee_custom'
        ? this.customFeeRate !== null && this.customFeeRate > 0
        : this.selectedFeeOption?.feeRate !== null;

    return !!(
      this.recipientAddress &&
      this.addressValid() &&
      this.amount &&
      this.amount > 0 &&
      this.selectedFeeOption &&
      hasFeeRate &&
      this.hasSufficientBalance()
    );
  }

  async confirmAndSend(): Promise<void> {
    if (!this.canSubmit()) return;

    const dialogRef = this.dialog.open(SendConfirmDialogComponent, {
      width: '450px',
      data: {
        recipientAddress: this.recipientAddress,
        amount: this.amount,
        fee: this.selectedFeeOption?.estimatedFee ?? 0,
        total: this.getTotalAmount(),
        subtractFee: this.subtractFee,
      },
    });

    const confirmed = await dialogRef.afterClosed().toPromise();
    if (confirmed) {
      await this.sendTransaction();
    }
  }

  async sendTransaction(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName || !this.amount) return;

    this.sending.set(true);
    this.sendError.set(null);

    try {
      // Use explicit fee_rate when available (custom or estimated), conf_target as fallback
      const feeRate =
        this.selectedFeeOption?.label === 'fee_custom'
          ? this.customFeeRate ?? undefined
          : this.selectedFeeOption?.feeRate ?? undefined;

      const txid = await this.walletRpc.sendToAddress(
        walletName,
        this.recipientAddress,
        this.amount,
        {
          subtractFeeFromAmount: this.subtractFee,
          replaceable: this.enableRbf,
          confTarget: this.selectedFeeOption?.blocks ?? 6,
          feeRate,
        }
      );

      this.sentTxid.set(txid);
      this.showSuccess.set(true);
      this.notification.success(this.i18n.get('transaction_sent'));
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.get('transaction_failed');
      this.sendError.set(message);
    } finally {
      this.sending.set(false);
    }
  }

  resetForm(): void {
    this.recipientAddress = '';
    this.amount = null;
    this.subtractFee = false;
    this.enableRbf = true;
    this.selectedFeeOption = this.feeOptions[1];
    this.addressValid.set(false);
    this.addressError.set(null);
    this.sendError.set(null);
    this.sentTxid.set('');
    this.showSuccess.set(false);
    // Trigger refresh of balance after sending
    this.walletService.refresh();
  }
}
