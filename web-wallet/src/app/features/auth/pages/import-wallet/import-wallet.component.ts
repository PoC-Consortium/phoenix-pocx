import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { DescriptorService } from '../../../../bitcoin/services/wallet/descriptor.service';
import { selectIsTestnet } from '../../../../store/settings/settings.selectors';

/**
 * ImportWalletComponent guides users through importing an existing Bitcoin wallet.
 * Steps:
 * 1. Enter wallet name
 * 2. Enter recovery phrase (24 words) + optional BIP39 passphrase (25th word)
 * 3. Optional Bitcoin Core wallet encryption
 */
@Component({
  selector: 'app-import-wallet',
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
    MatCheckboxModule,
    MatSnackBarModule,
    MatProgressBarModule,
    MatAutocompleteModule,
    MatTooltipModule,
    I18nPipe,
  ],
  template: `
    <div class="import-wallet-container">
      <mat-card class="import-card">
        <!-- Custom Step Header -->
        <div class="step-header">
          <span class="step-title">{{ getCurrentStepTitle() }}</span>
          <div class="step-indicators">
            @for (step of [1, 2, 3]; track step) {
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

        @if (importing()) {
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
                  [disabled]="importing()"
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
                  [disabled]="!walletName || importing()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 2: Enter Recovery Phrase + Optional BIP39 Passphrase -->
          @if (currentStep() === 2) {
            <div class="step-content">
              <p class="info-text">{{ 'import_mnemonic_description' | i18n }}</p>

              <!-- Word length selector -->
              <div class="word-length-selector">
                <button
                  mat-stroked-button
                  [class.active]="wordCount === 12"
                  (click)="setWordCount(12)"
                  [disabled]="importing()"
                >
                  12 {{ 'words' | i18n }}
                </button>
                <button
                  mat-stroked-button
                  [class.active]="wordCount === 24"
                  (click)="setWordCount(24)"
                  [disabled]="importing()"
                >
                  24 {{ 'words' | i18n }}
                </button>
              </div>

              <div class="mnemonic-input-grid" [class.words-12]="wordCount === 12">
                @for (word of mnemonicWords; track $index; let i = $index) {
                  <div class="word-input-chip">
                    <span class="word-index">{{ i + 1 }}</span>
                    <input
                      class="word-input"
                      [(ngModel)]="mnemonicWords[i]"
                      [disabled]="importing()"
                      [matAutocomplete]="auto"
                      (input)="updateSuggestions(i, mnemonicWords[i])"
                      (blur)="validateWord(i)"
                      autocomplete="off"
                      spellcheck="false"
                    />
                    <mat-autocomplete
                      #auto="matAutocomplete"
                      (optionSelected)="onWordSelected(i, $event.option.value)"
                    >
                      @for (suggestion of wordSuggestions[i]; track suggestion) {
                        <mat-option [value]="suggestion">{{ suggestion }}</mat-option>
                      }
                    </mat-autocomplete>
                    @if (wordErrors[i]) {
                      <mat-icon class="word-error-icon" matTooltip="{{ 'invalid_word' | i18n }}"
                        >error</mat-icon
                      >
                    }
                  </div>
                }
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
                      [disabled]="importing()"
                    />
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>{{ 'confirm_bip39_passphrase' | i18n }}</mat-label>
                    <input
                      matInput
                      type="password"
                      [(ngModel)]="passphraseConfirm"
                      [disabled]="importing()"
                    />
                    @if (passphrase !== passphraseConfirm && passphraseConfirm) {
                      <mat-error>{{ 'passphrase_mismatch' | i18n }}</mat-error>
                    }
                  </mat-form-field>
                }
              </div>

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="importing()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!isMnemonicValid() || importing() || !bip39PassphraseValid()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 3: Bitcoin Core Wallet Encryption -->
          @if (currentStep() === 3) {
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
                    [disabled]="importing()"
                  />
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>{{ 'confirm_wallet_password' | i18n }}</mat-label>
                  <input
                    matInput
                    type="password"
                    [(ngModel)]="walletPasswordConfirm"
                    [disabled]="importing()"
                  />
                  @if (walletPassword !== walletPasswordConfirm && walletPasswordConfirm) {
                    <mat-error>{{ 'password_mismatch' | i18n }}</mat-error>
                  }
                </mat-form-field>
              }

              <p class="info-text hint">
                <mat-icon>info</mat-icon>
                {{ 'rescan_info' | i18n }}
              </p>

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="importing()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="importing() || !walletEncryptionValid()"
                  (click)="importWallet()"
                >
                  @if (importing()) {
                    {{ 'importing' | i18n }}...
                  } @else {
                    {{ 'import_wallet' | i18n }}
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
      .import-wallet-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #eceff1;
      }

      .import-card {
        width: 100%;
        max-width: 700px;
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

      .info-text.small,
      .warning-text.small {
        font-size: 12px;
        margin-bottom: 12px;
      }

      .info-text.hint {
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

      /* Word length selector */
      .word-length-selector {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;

        button {
          flex: 1;

          &.active {
            background: #1e3a5f;
            color: white;
          }
        }
      }

      /* Mnemonic input grid */
      .mnemonic-input-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 16px;

        &.words-12 {
          grid-template-columns: repeat(3, 1fr);
        }
      }

      .word-input-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        background: #ffffff;
        border-radius: 4px;
        border: 1px solid transparent;
        position: relative;
        min-width: 0;
        overflow: hidden;

        &:focus-within {
          border-color: #1e3a5f;
          background: white;
        }
      }

      .word-index {
        color: rgba(0, 0, 0, 0.4);
        font-size: 11px;
        min-width: 16px;
        flex-shrink: 0;
        font-family: 'Roboto Mono', monospace;
      }

      .word-input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-family: 'Roboto Mono', monospace;
        font-weight: 500;
        font-size: 13px;
        min-width: 0;
        width: 0;
      }

      .word-error-icon {
        color: #f44336;
        font-size: 16px;
        width: 16px;
        height: 16px;
        position: absolute;
        right: 8px;
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

      .step-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }

      @media (max-width: 599px) {
        .mnemonic-input-grid {
          grid-template-columns: repeat(3, 1fr);

          &.words-12 {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        .step-header {
          flex-direction: column;
          gap: 12px;
          text-align: center;
        }
      }

      @media (max-width: 400px) {
        .mnemonic-input-grid {
          grid-template-columns: repeat(2, 1fr);

          &.words-12 {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      }
    `,
  ],
})
export class ImportWalletComponent implements OnInit {
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
  private readonly stepTitles = ['wallet_name', 'recovery_phrase', 'wallet_encryption_title'];

  walletName = '';
  importing = signal(false);

  // Mnemonic input
  wordCount = 24;
  mnemonicWords: string[] = [];
  wordSuggestions: string[][] = [];
  wordErrors: boolean[] = [];

  // BIP39 Passphrase (25th word)
  useBip39Passphrase = false;
  passphrase = '';
  passphraseConfirm = '';

  // Bitcoin Core Wallet Encryption
  useWalletEncryption = false;
  walletPassword = '';
  walletPasswordConfirm = '';

  ngOnInit(): void {
    this.initializeWordArrays();
  }

  private initializeWordArrays(): void {
    this.mnemonicWords = new Array(this.wordCount).fill('');
    this.wordSuggestions = new Array(this.wordCount).fill(null).map(() => []);
    this.wordErrors = new Array(this.wordCount).fill(false);
  }

  getCurrentStepTitle(): string {
    return this.i18n.get(this.stepTitles[this.currentStep() - 1]);
  }

  setWordCount(count: 12 | 24): void {
    if (this.wordCount === count) return;
    this.wordCount = count;
    this.initializeWordArrays();
  }

  nextStep(): void {
    if (this.currentStep() < 3) {
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  updateSuggestions(index: number, value: string): void {
    if (value && value.length >= 1) {
      this.wordSuggestions[index] = this.descriptorService.getWordSuggestions(value, 8);
    } else {
      this.wordSuggestions[index] = [];
    }
    // Clear error when typing
    this.wordErrors[index] = false;
  }

  onWordSelected(index: number, word: string): void {
    this.mnemonicWords[index] = word;
    this.wordSuggestions[index] = [];
    this.wordErrors[index] = false;
  }

  validateWord(index: number): void {
    const word = this.mnemonicWords[index]?.trim().toLowerCase();
    if (word) {
      const wordlist = this.descriptorService.getWordlist();
      this.wordErrors[index] = !wordlist.includes(word);
    } else {
      this.wordErrors[index] = false;
    }
  }

  isMnemonicValid(): boolean {
    const wordlist = this.descriptorService.getWordlist();
    const filledWords = this.mnemonicWords.filter(w => w.trim().length > 0);

    // All words must be filled
    if (filledWords.length !== this.wordCount) return false;

    // All words must be valid BIP39 words
    return this.mnemonicWords.every(word => {
      const trimmed = word.trim().toLowerCase();
      return wordlist.includes(trimmed);
    });
  }

  bip39PassphraseValid(): boolean {
    if (!this.useBip39Passphrase) return true;
    return this.passphrase === this.passphraseConfirm;
  }

  walletEncryptionValid(): boolean {
    if (!this.useWalletEncryption) return true;
    return this.walletPassword.length > 0 && this.walletPassword === this.walletPasswordConfirm;
  }

  async importWallet(): Promise<void> {
    if (this.importing()) return;

    this.importing.set(true);

    try {
      // Build mnemonic from words
      const mnemonic = this.mnemonicWords.map(w => w.trim().toLowerCase()).join(' ');

      // Only use BIP39 passphrase if checkbox is enabled
      const mnemonicPassphrase = this.useBip39Passphrase ? this.passphrase : undefined;

      const result = await this.walletManager.createWalletFromMnemonic({
        walletName: this.walletName,
        mnemonic,
        mnemonicPassphrase,
        isTestnet: this.isTestnet(),
        rescan: true, // Always rescan for imported wallets
      });

      if (!result.success) {
        throw new Error(result.errors?.join(', ') || 'Import failed');
      }

      // Encrypt wallet if requested
      if (this.useWalletEncryption && this.walletPassword) {
        await this.walletManager.encryptWallet(this.walletName, this.walletPassword);
      }

      this.snackBar.open(
        this.i18n.get('wallet_imported_success', { name: this.walletName }),
        undefined,
        { duration: 3000 }
      );
      this.router.navigate(['/dashboard']);
    } catch (error) {
      console.error('Failed to import wallet:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to import wallet';
      this.snackBar.open(errorMessage, this.i18n.get('dismiss'), { duration: 5000 });
      this.importing.set(false);
    }
  }
}
