import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';

import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  StepHeaderComponent,
  MnemonicDisplayComponent,
  MnemonicEntryComponent,
} from '../../../../shared/components';
import type { MnemonicEntryState } from '../../../../shared/components';
import {
  WalletManagerService,
  WatchOnlyRescan,
  rescanToTimestamp,
} from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { DescriptorService } from '../../../../bitcoin/services/wallet/descriptor.service';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { selectIsTestnet } from '../../../../store/settings/settings.selectors';

interface CosignerEntry {
  keyExpression: string;
}

/**
 * MultisigWalletComponent guides users through creating (or rejoining) an
 * N-of-M multisig wallet. Every participant runs the same wizard with the
 * same set of keys and derives the identical wallet (sortedmulti makes the
 * key order irrelevant).
 *
 * Steps:
 * 1. Wallet name + policy (M of N)
 * 2. This participant's seed — freshly generated or restored
 * 3. Verify the seed (skipped visually when restoring)
 * 4. Exchange keys — share own xpub, collect N-1 co-signer xpubs
 * 5. Review, verify first addresses against co-signers, create
 */
@Component({
  selector: 'app-multisig-wallet',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatRadioModule,
    MatSnackBarModule,
    MatProgressBarModule,
    MatAutocompleteModule,
    MatTooltipModule,
    I18nPipe,
    StepHeaderComponent,
    MnemonicDisplayComponent,
    MnemonicEntryComponent,
  ],
  template: `
    <div class="create-wallet-container">
      <mat-card class="create-card">
        <app-step-header
          [title]="getCurrentStepTitle()"
          [currentStep]="currentStep()"
          [totalSteps]="5"
        ></app-step-header>

        @if (creating()) {
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        }

        <mat-card-content>
          <!-- Step 1: Name & Policy -->
          @if (currentStep() === 1) {
            <div class="step-content">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'wallet_name' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="walletName"
                  (ngModelChange)="onWalletNameChange()"
                  placeholder="treasury-2of3"
                  [disabled]="creating()"
                />
                @if (walletNameConflict()) {
                  <mat-error>{{ 'wallet_name_conflict' | i18n }}</mat-error>
                } @else {
                  <mat-hint>{{ 'wallet_name_hint' | i18n }}</mat-hint>
                }
              </mat-form-field>

              <div class="policy-row">
                <mat-form-field appearance="outline" class="policy-field">
                  <mat-label>{{ 'msig_required_signatures' | i18n }}</mat-label>
                  <mat-select [(ngModel)]="threshold" [disabled]="creating()">
                    @for (m of thresholdChoices(); track m) {
                      <mat-option [value]="m">{{ m }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <span class="policy-of">{{ 'msig_of' | i18n }}</span>
                <mat-form-field appearance="outline" class="policy-field">
                  <mat-label>{{ 'msig_total_keys' | i18n }}</mat-label>
                  <mat-select
                    [(ngModel)]="totalKeys"
                    (ngModelChange)="onTotalKeysChange()"
                    [disabled]="creating()"
                  >
                    @for (n of totalKeyChoices; track n) {
                      <mat-option [value]="n">{{ n }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>

              <p class="info-text">
                {{
                  'msig_policy_info'
                    | i18n: { threshold: threshold, total: totalKeys, cosigners: totalKeys - 1 }
                }}
              </p>

              <div class="procedure-box">
                <mat-icon>groups</mat-icon>
                <div>{{ 'msig_procedure_info' | i18n }}</div>
              </div>

              <div class="step-actions">
                <button mat-button routerLink="/auth">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!walletName || walletNameConflict() || creating()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 2: Your Seed -->
          @if (currentStep() === 2) {
            <div class="step-content">
              <mat-radio-group
                [(ngModel)]="seedMode"
                (ngModelChange)="onSeedModeChange()"
                class="seed-mode-group"
              >
                <mat-radio-button value="new">{{ 'msig_seed_new' | i18n }}</mat-radio-button>
                <mat-radio-button value="restore">{{
                  'msig_seed_restore' | i18n
                }}</mat-radio-button>
              </mat-radio-group>

              @if (seedMode === 'new') {
                <p class="warning-text">
                  <mat-icon>warning</mat-icon>
                  {{ 'msig_backup_warning' | i18n }}
                </p>

                <app-mnemonic-display
                  [words]="mnemonicWords()"
                  [disabled]="creating()"
                  (regenerate)="generateMnemonic()"
                ></app-mnemonic-display>

                <mat-checkbox [(ngModel)]="mnemonicWrittenDown" class="confirm-checkbox">
                  {{ 'confirm_backup_written' | i18n }}
                </mat-checkbox>
              } @else {
                <p class="info-text">{{ 'msig_restore_info' | i18n }}</p>
                <app-mnemonic-entry
                  [disabled]="creating()"
                  (changed)="onRestoreChanged($event)"
                ></app-mnemonic-entry>
              }

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!seedStepValid() || creating()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 3: Verify Seed -->
          @if (currentStep() === 3) {
            <div class="step-content">
              @if (seedMode === 'new') {
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
              } @else {
                <p class="info-text restored-note">
                  <mat-icon class="ok-icon">check_circle</mat-icon>
                  {{ 'msig_restore_no_verify' | i18n }}
                </p>
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

          <!-- Step 4: Exchange Keys -->
          @if (currentStep() === 4) {
            <div class="step-content">
              <div class="procedure-box">
                <mat-icon>groups</mat-icon>
                <div>{{ 'msig_exchange_info' | i18n }}</div>
              </div>

              <h3 class="section-label">{{ 'msig_your_key' | i18n }}</h3>
              <p class="info-text small">{{ 'msig_your_key_info' | i18n }}</p>
              <div class="key-box">
                <span class="key-text">{{ myKeyExpression() }}</span>
                <div class="key-actions">
                  <button
                    mat-icon-button
                    (click)="copyMyKey()"
                    [matTooltip]="'msig_copy_key' | i18n"
                  >
                    <mat-icon>content_copy</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    (click)="saveMyKey()"
                    [matTooltip]="'msig_save_key' | i18n"
                  >
                    <mat-icon>download</mat-icon>
                  </button>
                </div>
              </div>

              <h3 class="section-label cosigner-label">
                {{ 'msig_cosigner_keys' | i18n }}
                <span class="count" [class.complete]="cosigners().length === totalKeys - 1">
                  {{ cosigners().length }} / {{ totalKeys - 1 }}
                </span>
              </h3>
              <p class="info-text small">{{ 'msig_cosigner_info' | i18n }}</p>

              @if (cosigners().length < totalKeys - 1) {
                <div class="add-cosigner-row">
                  <mat-form-field appearance="outline" class="full-width cosigner-input">
                    <mat-label>{{ 'msig_paste_cosigner' | i18n }}</mat-label>
                    <input
                      matInput
                      [(ngModel)]="cosignerInput"
                      (ngModelChange)="cosignerError.set(null)"
                      (keydown.enter)="addCosigner()"
                      autocomplete="off"
                      spellcheck="false"
                    />
                    @if (cosignerError()) {
                      <mat-error>{{ cosignerError()! | i18n }}</mat-error>
                    }
                  </mat-form-field>
                  <button
                    mat-stroked-button
                    class="add-button"
                    [disabled]="!cosignerInput.trim()"
                    (click)="addCosigner()"
                  >
                    <mat-icon>add</mat-icon>
                    {{ 'msig_add' | i18n }}
                  </button>
                </div>
              }

              @for (cosigner of cosigners(); track cosigner.keyExpression; let i = $index) {
                <div class="cosigner-entry">
                  <mat-icon class="ok-icon">check_circle</mat-icon>
                  <div class="cosigner-body">
                    <span class="cosigner-name">{{ 'msig_cosigner_n' | i18n: { n: i + 1 } }}</span>
                    <span class="cosigner-key">{{ cosigner.keyExpression }}</span>
                  </div>
                  <button mat-icon-button (click)="removeCosigner(i)" [disabled]="creating()">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="cosigners().length !== totalKeys - 1 || creating()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 5: Review & Create -->
          @if (currentStep() === 5) {
            <div class="step-content">
              <div class="review-grid">
                <span class="review-label">{{ 'msig_policy' | i18n }}</span>
                <span class="review-value"
                  >{{ threshold }} {{ 'msig_of' | i18n }} {{ totalKeys }} · P2WSH
                  (sortedmulti)</span
                >
                <span class="review-label">{{ 'wallet_name' | i18n }}</span>
                <span class="review-value">{{ walletName }}</span>
                <span class="review-label">{{ 'msig_keys' | i18n }}</span>
                <span class="review-value"
                  >{{ 'msig_you' | i18n }} ({{ myFingerprint() }}) + {{ cosigners().length }}
                  {{ 'msig_cosigners' | i18n }}</span
                >
              </div>

              <!-- Address verification -->
              <div class="verify-box">
                <h3 class="section-label">{{ 'msig_verify_addresses' | i18n }}</h3>
                <p class="info-text small">{{ 'msig_verify_addresses_info' | i18n }}</p>
                @if (previewAddresses().length > 0) {
                  @for (address of previewAddresses(); track $index) {
                    <div class="preview-address">
                      <span class="addr-index">#{{ $index }}</span>
                      <span class="addr-text">{{ address }}</span>
                    </div>
                  }
                } @else {
                  <p class="info-text small">{{ 'msig_deriving_addresses' | i18n }}…</p>
                }
              </div>

              <button mat-stroked-button class="backup-button" (click)="saveDescriptorBackup()">
                <mat-icon>download</mat-icon>
                {{ 'msig_save_backup' | i18n }}
              </button>
              <p class="warning-text small">
                <mat-icon>warning</mat-icon>
                {{ 'msig_backup_note' | i18n }}
              </p>

              @if (seedMode === 'restore') {
                <div class="rescan-section">
                  <h3 class="section-label">{{ 'watch_only_rescan_label' | i18n }}</h3>
                  <mat-radio-group [(ngModel)]="rescanKind" class="rescan-group">
                    <mat-radio-button value="now">{{
                      'watch_only_rescan_now' | i18n
                    }}</mat-radio-button>
                    <mat-radio-button value="genesis">{{
                      'watch_only_rescan_genesis' | i18n
                    }}</mat-radio-button>
                  </mat-radio-group>
                </div>
              }

              <!-- Optional encryption -->
              <mat-checkbox [(ngModel)]="useWalletEncryption" class="encryption-checkbox">
                {{ 'encrypt_wallet' | i18n }}
              </mat-checkbox>

              @if (useWalletEncryption) {
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

              @if (createError()) {
                <p class="warning-text">
                  <mat-icon>error</mat-icon>
                  {{ createError() }}
                </p>
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
        max-width: 640px;
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

      .info-text.small,
      .warning-text.small {
        font-size: 12px;
        margin-bottom: 12px;
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

      // Step 1: policy
      .policy-row {
        display: flex;
        align-items: baseline;
        gap: 16px;
        margin-top: 8px;

        .policy-field {
          width: 160px;
        }

        .policy-of {
          color: rgba(0, 0, 0, 0.6);
          font-weight: 500;
        }
      }

      // Step 2: seed
      .seed-mode-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
      }

      .procedure-box {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: rgba(33, 150, 243, 0.06);
        border: 1px solid rgba(33, 150, 243, 0.25);
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
        font-size: 13px;
        color: rgba(0, 0, 0, 0.7);

        mat-icon {
          color: #1976d2;
          flex-shrink: 0;
        }
      }

      .confirm-checkbox {
        margin: 16px 0;
      }

      .restored-note {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .ok-icon {
        color: #4caf50;
      }

      // Step 4: keys
      .section-label {
        font-size: 13px;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.75);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 8px;
      }

      .cosigner-label {
        margin-top: 20px;
        display: flex;
        align-items: center;
        gap: 8px;

        .count {
          font-weight: 500;
          text-transform: none;
          color: #e65100;

          &.complete {
            color: #2e7d32;
          }
        }
      }

      .key-box {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(0, 0, 0, 0.03);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 4px;
        padding: 10px 12px;
        margin-bottom: 8px;

        .key-text {
          flex: 1;
          font-family: 'Roboto Mono', monospace;
          font-size: 11.5px;
          word-break: break-all;
        }

        .key-actions {
          display: flex;
          flex-shrink: 0;
        }
      }

      .add-cosigner-row {
        display: flex;
        gap: 8px;
        align-items: flex-start;

        .cosigner-input {
          flex: 1;
        }

        .add-button {
          height: 56px;

          mat-icon {
            margin-right: 4px;
          }
        }
      }

      .cosigner-entry {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 4px;
        margin-bottom: 6px;

        .cosigner-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .cosigner-name {
          font-size: 12px;
          font-weight: 600;
        }

        .cosigner-key {
          font-family: 'Roboto Mono', monospace;
          font-size: 11px;
          color: rgba(0, 0, 0, 0.6);
          word-break: break-all;
        }
      }

      // Step 5: review
      .review-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 16px;
        margin-bottom: 16px;

        .review-label {
          color: rgba(0, 0, 0, 0.6);
          font-size: 13px;
        }

        .review-value {
          font-size: 13px;
          font-weight: 500;
        }
      }

      .verify-box {
        background: rgba(33, 150, 243, 0.06);
        border: 1px solid rgba(33, 150, 243, 0.25);
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .preview-address {
        display: flex;
        gap: 10px;
        padding: 4px 0;
        font-family: 'Roboto Mono', monospace;
        font-size: 12px;

        .addr-index {
          color: rgba(0, 0, 0, 0.4);
        }

        .addr-text {
          word-break: break-all;
        }
      }

      .backup-button {
        margin-bottom: 8px;

        mat-icon {
          margin-right: 6px;
        }
      }

      .rescan-section {
        margin: 16px 0;

        .rescan-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
      }

      .encryption-checkbox {
        display: block;
        margin: 16px 0 12px;
      }

      .step-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }
    `,
  ],
})
export class MultisigWalletComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly store = inject(Store);
  private readonly walletManager = inject(WalletManagerService);
  private readonly descriptorService = inject(DescriptorService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);

  private readonly isTestnet = toSignal(this.store.select(selectIsTestnet), { initialValue: true });

  currentStep = signal(1);
  private readonly stepTitles = [
    'msig_step_policy',
    'msig_step_seed',
    'verify_backup',
    'msig_step_keys',
    'msig_step_review',
  ];

  // Step 1
  walletName = '';
  threshold = 2;
  totalKeys = 3;
  readonly totalKeyChoices = [2, 3, 4, 5, 6, 7];
  private readonly existingWalletNames = signal<string[]>([]);
  readonly walletNameConflict = signal(false);
  readonly thresholdChoices = computed(() => {
    void this.totalKeysVersion();
    return Array.from({ length: this.totalKeys }, (_, i) => i + 1);
  });
  private readonly totalKeysVersion = signal(0);

  // Step 2
  seedMode: 'new' | 'restore' = 'new';
  mnemonic = '';
  mnemonicWords = signal<string[]>([]);
  mnemonicWrittenDown = false;
  restoreMnemonic = '';
  readonly restoreMnemonicValid = signal(false);

  // Step 3
  verifyIndices: number[] = [];
  verifyWords: string[] = ['', '', ''];
  wordSuggestions: string[][] = [[], [], []];

  // Step 4
  readonly myKeyExpression = signal('');
  readonly myFingerprint = signal('');
  cosignerInput = '';
  readonly cosignerError = signal<string | null>(null);
  readonly cosigners = signal<CosignerEntry[]>([]);

  // Step 5
  readonly previewAddresses = signal<string[]>([]);
  rescanKind: 'now' | 'genesis' = 'genesis';
  useWalletEncryption = false;
  walletPassword = '';
  walletPasswordConfirm = '';
  readonly createError = signal<string | null>(null);

  creating = signal(false);

  async ngOnInit(): Promise<void> {
    this.generateMnemonic();
    try {
      const wallets = await this.walletManager.listAllWallets();
      this.existingWalletNames.set(wallets.map(name => name.toLowerCase()));
    } catch {
      // Node not reachable — conflict check degrades gracefully
    }
  }

  ngOnDestroy(): void {
    // Clear secrets from memory
    this.mnemonic = '';
    this.restoreMnemonic = '';
    this.mnemonicWords.set([]);
    this.walletPassword = '';
    this.walletPasswordConfirm = '';
  }

  getCurrentStepTitle(): string {
    return this.i18n.get(this.stepTitles[this.currentStep() - 1]);
  }

  // ============================================================
  // Navigation
  // ============================================================

  nextStep(): void {
    const step = this.currentStep();
    if (step === 3) {
      // Entering key exchange — derive this participant's key
      try {
        this.deriveMyKey();
      } catch {
        this.snackBar.open(this.i18n.get('msig_key_derivation_failed'), undefined, {
          duration: 4000,
        });
        return;
      }
    }
    if (step === 4) {
      void this.derivePreviewAddresses();
    }
    this.currentStep.set(step + 1);
  }

  prevStep(): void {
    this.currentStep.set(Math.max(1, this.currentStep() - 1));
  }

  // ============================================================
  // Step 1: Name & policy
  // ============================================================

  async onWalletNameChange(): Promise<void> {
    const name = this.walletName.trim().toLowerCase();
    this.walletNameConflict.set(!!name && this.existingWalletNames().includes(name));
  }

  onTotalKeysChange(): void {
    if (this.threshold > this.totalKeys) {
      this.threshold = this.totalKeys;
    }
    // Drop surplus co-signers if N was reduced
    if (this.cosigners().length > this.totalKeys - 1) {
      this.cosigners.set(this.cosigners().slice(0, this.totalKeys - 1));
    }
    this.totalKeysVersion.update(v => v + 1);
  }

  // ============================================================
  // Step 2/3: Seed
  // ============================================================

  generateMnemonic(): void {
    this.mnemonic = this.walletManager.generateMnemonic(256);
    this.mnemonicWords.set(this.descriptorService.mnemonicToWordArray(this.mnemonic));
    this.mnemonicWrittenDown = false;
    this.selectVerificationIndices();
  }

  onSeedModeChange(): void {
    this.verifyWords = ['', '', ''];
  }

  onRestoreChanged(state: MnemonicEntryState): void {
    this.restoreMnemonic = state.mnemonic;
    this.restoreMnemonicValid.set(state.valid);
  }

  seedStepValid(): boolean {
    return this.seedMode === 'new' ? this.mnemonicWrittenDown : this.restoreMnemonicValid();
  }

  /** The mnemonic in effect (generated or restored) */
  private activeMnemonic(): string {
    return this.seedMode === 'new' ? this.mnemonic : this.restoreMnemonic.trim().toLowerCase();
  }

  private selectVerificationIndices(): void {
    const indices = new Set<number>();
    while (indices.size < 3) {
      indices.add(Math.floor(Math.random() * 24));
    }
    this.verifyIndices = [...indices].sort((a, b) => a - b);
    this.verifyWords = ['', '', ''];
    this.wordSuggestions = [[], [], []];
  }

  updateSuggestions(index: number, value: string): void {
    this.wordSuggestions[index] = this.descriptorService.getWordSuggestions(value);
  }

  onWordSelected(index: number, word: string): void {
    this.verifyWords[index] = word;
  }

  verificationPassed(): boolean {
    if (this.seedMode === 'restore') return true;
    return this.verifyIndices.every((idx, i) => this.verifyWords[i] === this.mnemonicWords()[idx]);
  }

  // ============================================================
  // Step 4: Key exchange
  // ============================================================

  private deriveMyKey(): void {
    const key = this.descriptorService.deriveMultisigKey(this.activeMnemonic(), {
      isTestnet: this.isTestnet(),
    });
    this.myKeyExpression.set(key.keyExpression);
    this.myFingerprint.set(key.fingerprint);
  }

  async copyMyKey(): Promise<void> {
    await navigator.clipboard.writeText(this.myKeyExpression());
    this.snackBar.open(this.i18n.get('msig_key_copied'), undefined, { duration: 2500 });
  }

  saveMyKey(): void {
    const blob = new Blob([this.myKeyExpression()], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.walletName || 'multisig'}-key-${this.myFingerprint()}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  addCosigner(): void {
    const input = this.cosignerInput.trim();
    if (!input) return;
    try {
      const { keyExpression } = this.descriptorService.parseCosignerKey(input, this.isTestnet());
      if (keyExpression === this.myKeyExpression()) {
        this.cosignerError.set('msig_cosigner_is_own');
        return;
      }
      if (this.cosigners().some(c => c.keyExpression === keyExpression)) {
        this.cosignerError.set('msig_cosigner_duplicate');
        return;
      }
      this.cosigners.set([...this.cosigners(), { keyExpression }]);
      this.cosignerInput = '';
      this.cosignerError.set(null);
    } catch (error) {
      const key = error instanceof Error ? error.message : 'cosigner_key_invalid_format';
      this.cosignerError.set(`msig_${key}`);
    }
  }

  removeCosigner(index: number): void {
    this.cosigners.set(this.cosigners().filter((_, i) => i !== index));
  }

  // ============================================================
  // Step 5: Review & create
  // ============================================================

  private buildDescriptors() {
    return this.descriptorService.generateMultisigDescriptors({
      mnemonic: this.activeMnemonic(),
      isTestnet: this.isTestnet(),
      threshold: this.threshold,
      cosignerKeys: this.cosigners().map(c => c.keyExpression),
      timestamp: this.importTimestamp(),
    });
  }

  private importTimestamp(): number | 'now' {
    if (this.seedMode !== 'restore') return 'now';
    const rescan: WatchOnlyRescan = { kind: this.rescanKind };
    return rescanToTimestamp(rescan);
  }

  private async derivePreviewAddresses(): Promise<void> {
    this.previewAddresses.set([]);
    try {
      const { publicReceiveDescriptor } = this.buildDescriptors();
      const addresses = await this.walletRpc.deriveAddresses(publicReceiveDescriptor, [0, 2]);
      this.previewAddresses.set(addresses);
    } catch (error) {
      console.error('Address preview failed:', error);
    }
  }

  saveDescriptorBackup(): void {
    const { publicReceiveDescriptor, publicChangeDescriptor } = this.buildDescriptors();
    const content = [
      `# Phoenix PoCX multisig descriptor backup`,
      `# Wallet: ${this.walletName}`,
      `# Policy: ${this.threshold} of ${this.totalKeys} (P2WSH sortedmulti)`,
      `# Restoring requires a participant seed AND these descriptors (all xpubs).`,
      ``,
      `receive: ${publicReceiveDescriptor}`,
      `change:  ${publicChangeDescriptor}`,
      ``,
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.walletName || 'multisig'}-descriptors.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  walletEncryptionValid(): boolean {
    if (!this.useWalletEncryption) return true;
    return this.walletPassword.length > 0 && this.walletPassword === this.walletPasswordConfirm;
  }

  async createWallet(): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);

    try {
      const { importEntries } = this.buildDescriptors();
      await this.walletManager.createMultisigWallet({
        walletName: this.walletName.trim(),
        importEntries,
      });

      if (this.useWalletEncryption && this.walletPassword) {
        await this.walletManager.encryptWallet(this.walletName.trim(), this.walletPassword);
      }

      this.snackBar.open(
        this.i18n.get('wallet_created_success', { name: this.walletName.trim() }),
        undefined,
        { duration: 4000 }
      );
      this.router.navigate(['/dashboard']);
    } catch (error) {
      this.createError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.creating.set(false);
    }
  }
}
