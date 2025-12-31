import { Component, inject, signal, OnInit } from '@angular/core';

import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { DescriptorService } from '../../../../bitcoin/services/wallet/descriptor.service';
import { selectIsTestnet } from '../../../../store/settings/settings.selectors';

/**
 * CreateWalletComponent guides users through creating a new Bitcoin wallet.
 * Steps:
 * 1. Enter wallet name
 * 2. Generate and display mnemonic + optional BIP39 passphrase (25th word)
 * 3. Verify mnemonic (confirm 3 random words)
 * 4. Optional Bitcoin Core wallet encryption
 */
@Component({
  selector: 'app-create-wallet',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSnackBarModule,
    MatProgressBarModule,
    MatAutocompleteModule,
    I18nPipe
],
  template: `
    <div class="create-wallet-container">
      <mat-card class="create-card">
        <!-- Custom Step Header -->
        <div class="step-header">
          <span class="step-title">{{ getCurrentStepTitle() }}</span>
          <div class="step-indicators">
            @for (step of [1, 2, 3, 4]; track step) {
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
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'wallet_name' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="walletName"
                  placeholder="My Wallet"
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

          <!-- Step 2: Generate Mnemonic + Optional BIP39 Passphrase -->
          @if (currentStep() === 2) {
            <div class="step-content">
              <p class="warning-text">
                <mat-icon>warning</mat-icon>
                {{ 'backup_warning' | i18n }}
              </p>

              <div class="mnemonic-display">
                @for (word of mnemonicWords(); track $index) {
                  <div class="word-chip">
                    <span class="word-index">{{ $index + 1 }}</span>
                    <span class="word-text">{{ word }}</span>
                  </div>
                }
              </div>

              <div class="mnemonic-actions">
                <button mat-stroked-button (click)="generateMnemonic()">
                  <mat-icon>refresh</mat-icon>
                  {{ 'generate_new' | i18n }}
                </button>
              </div>

              <!-- BIP39 Passphrase Option (25th word) -->
              <div class="passphrase-section">
                <mat-checkbox [(ngModel)]="useBip39Passphrase" class="passphrase-checkbox">
                  {{ 'use_bip39_passphrase' | i18n }}
                </mat-checkbox>

                @if (useBip39Passphrase) {
                  <p class="info-text small">{{ 'bip39_passphrase_info' | i18n }}</p>

                  <p class="warning-text small">
                    <mat-icon>warning</mat-icon>
                    {{ 'bip39_passphrase_warning' | i18n }}
                  </p>

                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>{{ 'bip39_passphrase' | i18n }}</mat-label>
                    <input
                      matInput
                      type="password"
                      [(ngModel)]="passphrase"
                      [disabled]="creating()"
                    />
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>{{ 'confirm_bip39_passphrase' | i18n }}</mat-label>
                    <input
                      matInput
                      type="password"
                      [(ngModel)]="passphraseConfirm"
                      [disabled]="creating()"
                    />
                    @if (passphrase !== passphraseConfirm && passphraseConfirm) {
                      <mat-error>{{ 'passphrase_mismatch' | i18n }}</mat-error>
                    }
                  </mat-form-field>
                }
              </div>

              <mat-checkbox [(ngModel)]="mnemonicWrittenDown" class="confirm-checkbox">
                {{ 'confirm_backup_written' | i18n }}
              </mat-checkbox>

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!mnemonicWrittenDown || creating() || !bip39PassphraseValid()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 3: Verify Mnemonic -->
          @if (currentStep() === 3) {
            <div class="step-content">
              <p class="info-text">{{ 'verify_backup_instruction' | i18n }}</p>

              @for (idx of verifyIndices; track idx; let i = $index) {
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>{{ 'word_number' | i18n: { number: idx + 1 } }}</mat-label>
                  <input
                    matInput
                    [(ngModel)]="verifyWords[i]"
                    [disabled]="creating()"
                    [matAutocomplete]="auto"
                    (input)="updateSuggestions(i, verifyWords[i])"
                    autocomplete="off"
                  />
                  <mat-autocomplete
                    #auto="matAutocomplete"
                    (optionSelected)="onWordSelected(i, $event.option.value)"
                  >
                    @for (word of wordSuggestions[i]; track word) {
                      <mat-option [value]="word">{{ word }}</mat-option>
                    }
                  </mat-autocomplete>
                  @if (verifyWords[i] && verifyWords[i] !== mnemonicWords()[idx]) {
                    <mat-error>{{ 'incorrect_word' | i18n }}</mat-error>
                  }
                </mat-form-field>
              }

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!verificationPassed() || creating()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 4: Bitcoin Core Wallet Encryption -->
          @if (currentStep() === 4) {
            <div class="step-content">
              <p class="info-text">{{ 'wallet_encryption_info' | i18n }}</p>

              <mat-checkbox [(ngModel)]="useWalletEncryption" class="encryption-checkbox">
                {{ 'encrypt_wallet' | i18n }}
              </mat-checkbox>

              @if (useWalletEncryption) {
                <p class="warning-text">
                  <mat-icon>warning</mat-icon>
                  {{ 'wallet_encryption_warning' | i18n }}
                </p>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>{{ 'wallet_password' | i18n }}</mat-label>
                  <input
                    matInput
                    type="password"
                    [(ngModel)]="walletPassword"
                    [disabled]="creating()"
                  />
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>{{ 'confirm_wallet_password' | i18n }}</mat-label>
                  <input
                    matInput
                    type="password"
                    [(ngModel)]="walletPasswordConfirm"
                    [disabled]="creating()"
                  />
                  @if (walletPassword !== walletPasswordConfirm && walletPasswordConfirm) {
                    <mat-error>{{ 'password_mismatch' | i18n }}</mat-error>
                  }
                </mat-form-field>
              }

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="creating() || !walletEncryptionValid()"
                  (click)="createWallet()"
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
      .create-wallet-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #eceff1;
      }

      .create-card {
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

      .warning-text {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        color: #e65100;
        background: rgba(255, 152, 0, 0.1);
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 16px;
        font-size: 13px;

        mat-icon {
          flex-shrink: 0;
          color: #ff9800;
        }
      }

      .info-text {
        color: rgba(0, 0, 0, 0.6);
        margin-bottom: 16px;
      }

      .mnemonic-display {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 16px;
      }

      .word-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #ffffff;
        border-radius: 4px;
        font-family: 'Roboto Mono', monospace;
      }

      .word-index {
        color: rgba(0, 0, 0, 0.4);
        font-size: 12px;
        min-width: 20px;
      }

      .word-text {
        font-weight: 500;
      }

      .mnemonic-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      .confirm-checkbox {
        margin: 16px 0;
      }

      .passphrase-section {
        margin: 16px 0;
        padding: 16px;
        background: rgba(0, 0, 0, 0.02);
        border-radius: 4px;
        border: 1px solid rgba(0, 0, 0, 0.08);
      }

      .passphrase-checkbox,
      .encryption-checkbox {
        display: block;
        margin-bottom: 12px;
      }

      .info-text.small,
      .warning-text.small {
        font-size: 12px;
        margin-bottom: 12px;
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
        .mnemonic-display {
          grid-template-columns: repeat(3, 1fr);
        }

        .mnemonic-actions {
          flex-direction: column;
        }

        .step-header {
          flex-direction: column;
          gap: 12px;
          text-align: center;
        }
      }

      @media (max-width: 400px) {
        .mnemonic-display {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `,
  ],
})
export class CreateWalletComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly store = inject(Store);
  private readonly walletManager = inject(WalletManagerService);
  private readonly descriptorService = inject(DescriptorService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);

  // Get testnet flag from settings store
  private readonly isTestnet = toSignal(this.store.select(selectIsTestnet), { initialValue: true });

  // Step management
  currentStep = signal(1);
  private readonly stepTitles = [
    'wallet_name',
    'backup_phrase',
    'verify_backup',
    'wallet_encryption_title',
  ];

  walletName = '';
  mnemonicWrittenDown = false;
  creating = signal(false);
  mnemonic = '';
  mnemonicWords = signal<string[]>([]);

  // BIP39 Passphrase (25th word)
  useBip39Passphrase = false;
  passphrase = '';
  passphraseConfirm = '';

  // Bitcoin Core Wallet Encryption
  useWalletEncryption = false;
  walletPassword = '';
  walletPasswordConfirm = '';

  // Verification
  verifyIndices: number[] = [];
  verifyWords: string[] = ['', '', ''];
  wordSuggestions: string[][] = [[], [], []];

  ngOnInit(): void {
    this.generateMnemonic();
  }

  getCurrentStepTitle(): string {
    return this.i18n.get(this.stepTitles[this.currentStep() - 1]);
  }

  nextStep(): void {
    if (this.currentStep() < 4) {
      // Generate verification indices when moving to step 3
      if (this.currentStep() === 2) {
        this.selectVerificationIndices();
      }
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  generateMnemonic(): void {
    this.mnemonic = this.walletManager.generateMnemonic(256);
    this.mnemonicWords.set(this.mnemonic.split(' '));
    this.mnemonicWrittenDown = false;
    this.verifyWords = ['', '', ''];
    // Reset BIP39 passphrase when generating new mnemonic
    this.useBip39Passphrase = false;
    this.passphrase = '';
    this.passphraseConfirm = '';
  }

  private selectVerificationIndices(): void {
    // Select 3 random indices for verification
    const indices: number[] = [];
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * 24);
      if (!indices.includes(idx)) {
        indices.push(idx);
      }
    }
    this.verifyIndices = indices.sort((a, b) => a - b);
    this.verifyWords = ['', '', ''];
  }

  verificationPassed(): boolean {
    return this.verifyIndices.every(
      (idx, i) =>
        this.verifyWords[i].toLowerCase().trim() === this.mnemonicWords()[idx].toLowerCase()
    );
  }

  updateSuggestions(index: number, value: string): void {
    if (value && value.length >= 1) {
      this.wordSuggestions[index] = this.descriptorService.getWordSuggestions(value, 8);
    } else {
      this.wordSuggestions[index] = [];
    }
  }

  onWordSelected(index: number, word: string): void {
    this.verifyWords[index] = word;
    this.wordSuggestions[index] = [];
  }

  bip39PassphraseValid(): boolean {
    // Valid if not using passphrase, or if using and both match
    if (!this.useBip39Passphrase) return true;
    return this.passphrase === this.passphraseConfirm;
  }

  walletEncryptionValid(): boolean {
    // Valid if not using encryption, or if using and passwords match (and not empty)
    if (!this.useWalletEncryption) return true;
    return this.walletPassword.length > 0 && this.walletPassword === this.walletPasswordConfirm;
  }

  async createWallet(): Promise<void> {
    if (this.creating()) return;

    this.creating.set(true);

    try {
      // Only use BIP39 passphrase if checkbox is enabled
      const mnemonicPassphrase = this.useBip39Passphrase ? this.passphrase : undefined;

      const result = await this.walletManager.createWalletFromMnemonic({
        walletName: this.walletName,
        mnemonic: this.mnemonic,
        mnemonicPassphrase,
        isTestnet: this.isTestnet(),
        rescan: false,
      });

      if (!result.success) {
        throw new Error(result.errors?.join(', ') || 'Import failed');
      }

      // Encrypt wallet if requested
      if (this.useWalletEncryption && this.walletPassword) {
        await this.walletManager.encryptWallet(this.walletName, this.walletPassword);
      }

      this.snackBar.open(
        this.i18n.get('wallet_created_success', { name: this.walletName }),
        undefined,
        { duration: 3000 }
      );
      this.router.navigate(['/dashboard']);
    } catch (error) {
      console.error('Failed to create wallet:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create wallet';
      this.snackBar.open(errorMessage, this.i18n.get('dismiss'), { duration: 5000 });
      this.creating.set(false);
    }
  }
}
