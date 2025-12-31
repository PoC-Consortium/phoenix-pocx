import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';

/**
 * WatchOnlyComponent guides users through creating a watch-only wallet.
 * Steps:
 * 1. Enter wallet name
 * 2. Enter Bitcoin address to watch
 */
@Component({
  selector: 'app-watch-only',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatProgressBarModule,
    I18nPipe,
  ],
  template: `
    <div class="watch-only-container">
      <mat-card class="watch-only-card">
        <!-- Custom Step Header -->
        <div class="step-header">
          <span class="step-title">{{ getCurrentStepTitle() }}</span>
          <div class="step-indicators">
            @for (step of [1, 2]; track step) {
              <span
                class="step-dot"
                [class.active]="currentStep() === step"
                [class.completed]="currentStep() > step"
              >
                {{ step }}
              </span>
            }
          </div>
        </div>

        @if (creating()) {
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        }

        <mat-card-content>
          <!-- Step 1: Wallet Name -->
          @if (currentStep() === 1) {
            <div class="step-content">
              <p class="info-text">{{ 'watch_only_description' | i18n }}</p>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'wallet_name' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="walletName"
                  placeholder="My Watch Wallet"
                  [disabled]="creating()"
                />
                <mat-hint>{{ 'wallet_name_hint' | i18n }}</mat-hint>
              </mat-form-field>
              <div class="step-actions">
                <button mat-button routerLink="/auth">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!walletName || creating()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 2: Enter Address -->
          @if (currentStep() === 2) {
            <div class="step-content">
              <p class="info-text">{{ 'watch_only_address_description' | i18n }}</p>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'address' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="address"
                  [placeholder]="addressPlaceholder"
                  [disabled]="creating()"
                  (ngModelChange)="validateAddress()"
                />
                @if (addressError()) {
                  <mat-error>{{ 'invalid_address' | i18n }}</mat-error>
                }
                <mat-hint>{{ 'watch_only_address_hint' | i18n }}</mat-hint>
              </mat-form-field>

              <div class="address-info">
                @if (addressType()) {
                  <div class="address-type-badge">
                    <mat-icon>check_circle</mat-icon>
                    <span>{{ addressType() }}</span>
                  </div>
                }
              </div>

              <p class="info-text hint">
                <mat-icon>info</mat-icon>
                {{ 'rescan_info' | i18n }}
              </p>

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="creating() || !isAddressValid()"
                  (click)="createWatchOnlyWallet()"
                >
                  @if (creating()) {
                    {{ 'creating' | i18n }}...
                  } @else {
                    {{ 'create_wallet' | i18n }}
                  }
                </button>
              </div>
            </div>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .watch-only-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #eceff1;
      }

      .watch-only-card {
        width: 100%;
        max-width: 600px;
      }

      /* Custom step header */
      .step-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        border-radius: 4px 4px 0 0;
      }

      .step-title {
        font-size: 18px;
        font-weight: 500;
      }

      .step-indicators {
        display: flex;
        gap: 8px;
      }

      .step-dot {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 500;
        background: rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.7);

        &.active {
          background: white;
          color: #1e3a5f;
        }

        &.completed {
          background: rgba(255, 255, 255, 0.4);
          color: white;
        }
      }

      .step-content {
        padding: 24px;
      }

      .full-width {
        width: 100%;
      }

      .info-text {
        color: rgba(0, 0, 0, 0.6);
        margin-bottom: 16px;

        &.hint {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 13px;
          background: rgba(33, 150, 243, 0.08);
          padding: 12px;
          border-radius: 4px;
          margin-top: 16px;

          mat-icon {
            color: #2196f3;
            font-size: 18px;
            width: 18px;
            height: 18px;
            flex-shrink: 0;
          }
        }
      }

      .address-info {
        margin: 16px 0;
      }

      .address-type-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(76, 175, 80, 0.1);
        color: #4caf50;
        border-radius: 16px;
        font-size: 13px;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }

      .step-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }

      @media (max-width: 599px) {
        .step-header {
          flex-direction: column;
          gap: 12px;
          text-align: center;
        }
      }
    `,
  ],
})
export class WatchOnlyComponent {
  private readonly router = inject(Router);
  private readonly walletManager = inject(WalletManagerService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);

  // Step management
  currentStep = signal(1);
  private readonly stepTitles = ['wallet_name', 'address'];

  walletName = '';
  address = '';
  creating = signal(false);
  addressError = signal<string | null>(null);
  addressType = signal<string | null>(null);

  // Address placeholder based on network (testnet for now)
  addressPlaceholder = 'tpocx1q... or rpocx1q...';

  getCurrentStepTitle(): string {
    return this.i18n.get(this.stepTitles[this.currentStep() - 1]);
  }

  nextStep(): void {
    if (this.currentStep() < 2) {
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  validateAddress(): void {
    const addr = this.address.trim();

    if (!addr) {
      this.addressError.set(null);
      this.addressType.set(null);
      return;
    }

    // Bitcoin-PoCX address validation patterns
    // Based on chainparams.cpp from PoC-Consortium/bitcoin
    const patterns = {
      // PoCX Mainnet (HRP: pocx, P2PKH version: 0x55, P2SH version: 0x5A)
      'Mainnet P2PKH': /^[VW][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
      'Mainnet P2SH': /^[XY][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
      'Mainnet Bech32 (SegWit)': /^pocx1q[a-z0-9]{38,58}$/,
      'Mainnet Bech32m (Taproot)': /^pocx1p[a-z0-9]{38,58}$/,

      // PoCX Testnet (HRP: tpocx, P2PKH version: 0x7F, P2SH version: 0x84)
      'Testnet P2PKH': /^[st][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
      'Testnet P2SH': /^[uv][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
      'Testnet Bech32 (SegWit)': /^tpocx1q[a-z0-9]{38,58}$/,
      'Testnet Bech32m (Taproot)': /^tpocx1p[a-z0-9]{38,58}$/,

      // PoCX Regtest (HRP: rpocx, P2PKH version: 0x6F, P2SH version: 0xC4)
      'Regtest P2PKH': /^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
      'Regtest P2SH': /^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/,
      'Regtest Bech32 (SegWit)': /^rpocx1q[a-z0-9]{38,58}$/,
      'Regtest Bech32m (Taproot)': /^rpocx1p[a-z0-9]{38,58}$/,
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(addr)) {
        this.addressError.set(null);
        this.addressType.set(type);
        return;
      }
    }

    this.addressError.set('invalid_bitcoin_address');
    this.addressType.set(null);
  }

  isAddressValid(): boolean {
    return !!this.address.trim() && !this.addressError() && !!this.addressType();
  }

  async createWatchOnlyWallet(): Promise<void> {
    if (this.creating()) return;

    this.creating.set(true);

    try {
      await this.walletManager.createWatchOnlyWallet({
        walletName: this.walletName,
        address: this.address.trim(),
        rescan: true,
      });

      this.snackBar.open(
        this.i18n.get('wallet_created_success', { name: this.walletName }),
        undefined,
        { duration: 3000 }
      );
      this.router.navigate(['/dashboard']);
    } catch (error) {
      console.error('Failed to create watch-only wallet:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create wallet';
      this.snackBar.open(errorMessage, this.i18n.get('dismiss'), { duration: 5000 });
      this.creating.set(false);
    }
  }
}
