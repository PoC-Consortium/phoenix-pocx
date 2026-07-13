import { Component, inject, signal, OnInit, OnDestroy, ViewChild } from '@angular/core';

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
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { StepHeaderComponent, MnemonicEntryComponent } from '../../../../shared/components';
import type { MnemonicEntryState } from '../../../../shared/components';
import {
  WalletManagerService,
  RestoreBranchReport,
} from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { selectIsTestnet } from '../../../../store/settings/settings.selectors';
import { NodeService } from '../../../../node/services/node.service';
import {
  BtcxWalletService,
  BtcxRestoreResult,
  BtcxDescriptorPolicy,
  BTCX_COIN_TYPE,
} from '../../../../core/services/btcx-wallet.service';

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
    I18nPipe,
    StepHeaderComponent,
    MnemonicEntryComponent,
  ],
  template: `
    <div class="import-wallet-container">
      <mat-card class="import-card">
        @if (!imported()) {
          <app-step-header
            [title]="getCurrentStepTitle()"
            [currentStep]="currentStep()"
            [totalSteps]="3"
          ></app-step-header>
        }

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
                  (ngModelChange)="onWalletNameChange()"
                  placeholder="My Wallet"
                  [disabled]="importing()"
                />
                @if (walletNameConflict()) {
                  <mat-error>{{ 'wallet_name_conflict' | i18n }}</mat-error>
                } @else if (walletNameInvalid()) {
                  <mat-error>{{ 'wallet_name_invalid_local' | i18n }}</mat-error>
                } @else {
                  <mat-hint>{{
                    (isRemote() ? 'wallet_name_hint_local' : 'wallet_name_hint') | i18n
                  }}</mat-hint>
                }
              </mat-form-field>
              <div class="step-actions">
                <button mat-button routerLink="/auth">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="
                    !walletName || walletNameConflict() || walletNameInvalid() || importing()
                  "
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

              <app-mnemonic-entry
                [disabled]="importing()"
                (changed)="onMnemonicChanged($event)"
              ></app-mnemonic-entry>

              <!-- BIP39 Passphrase Option (25th word) — Core wallets only;
                   the local BDK wallet derives with an empty BIP39
                   passphrase by design. -->
              <div class="passphrase-section" [hidden]="isRemote()">
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
                  [disabled]="!mnemonicValid() || importing() || !bip39PassphraseValid()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Success: wallet imported, branch report -->
          @if (imported()) {
            <div class="step-content success-content">
              <mat-icon class="success-icon">check_circle</mat-icon>
              <h3>{{ 'wallet_imported_success' | i18n: { name: walletName } }}</h3>
              @if (branchReport(); as report) {
                @if (report.fresh) {
                  <p class="info-text">{{ 'restore_no_history' | i18n }}</p>
                } @else if (report.legacy.length > 0 || report.pocx.length > 0) {
                  <p class="info-text">
                    {{ 'restore_history_found' | i18n: { branches: branchList(report) } }}
                  </p>
                }
              }
              <div class="step-actions">
                <button mat-raised-button color="primary" (click)="goToDashboard()">
                  {{ 'dashboard' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 3: Wallet Encryption (Core passphrase / local seed-at-rest) -->
          @if (currentStep() === 3 && !imported()) {
            <div class="step-content">
              <p class="info-text">
                {{
                  (isRemote() ? 'wallet_encryption_info_local' : 'wallet_encryption_info') | i18n
                }}
              </p>

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
                {{ (isRemote() ? 'restore_probe_info' : 'rescan_info') | i18n }}
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

      .success-content {
        text-align: center;

        .success-icon {
          color: #4caf50;
          font-size: 40px;
          width: 40px;
          height: 40px;
        }

        h3 {
          margin: 8px 0 16px;
          font-size: 16px;
          font-weight: 500;
        }

        .step-actions {
          justify-content: center;
        }
      }
    `,
  ],
})
export class ImportWalletComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly store = inject(Store);
  private readonly walletManager = inject(WalletManagerService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  private readonly nodeService = inject(NodeService);
  private readonly btcxWallet = inject(BtcxWalletService);

  /** Remote (Electrum) mode: local BDK wallet, Electrum restore probing. */
  readonly isRemote = this.nodeService.isRemote;

  /** Remote mode: the name fails the local store's naming rules. */
  readonly walletNameInvalid = signal(false);

  // Get testnet flag from settings store
  private readonly isTestnet = toSignal(this.store.select(selectIsTestnet), { initialValue: true });

  // Step management
  currentStep = signal(1);
  private readonly stepTitles = ['wallet_name', 'recovery_phrase', 'wallet_encryption_title'];

  walletName = '';
  importing = signal(false);

  // Success state: wallet imported, best-effort branch report shown.
  imported = signal(false);
  branchReport = signal<RestoreBranchReport | null>(null);

  // Existing wallet names (for conflict check on step 1)
  private readonly existingWalletNames = signal<string[]>([]);
  readonly walletNameConflict = signal(false);

  // Mnemonic input (via shared MnemonicEntryComponent)
  private mnemonic = '';
  readonly mnemonicValid = signal(false);
  @ViewChild(MnemonicEntryComponent) private mnemonicEntry?: MnemonicEntryComponent;

  // BIP39 Passphrase (25th word)
  useBip39Passphrase = false;
  passphrase = '';
  passphraseConfirm = '';

  // Bitcoin Core Wallet Encryption
  useWalletEncryption = false;
  walletPassword = '';
  walletPasswordConfirm = '';

  ngOnInit(): void {
    this.walletManager
      .listAllWallets()
      .then(names => this.existingWalletNames.set(names))
      // RPC unreachable — skip the check; commit-time RPC will surface the real error.
      .catch(() => undefined);
  }

  onWalletNameChange(): void {
    const target = this.walletName.trim().toLowerCase();
    this.walletNameConflict.set(
      target.length > 0 && this.existingWalletNames().some(n => n.toLowerCase() === target)
    );
    // Local wallets: mirror the Rust-side rules on the name that actually
    // gets sent (case is preserved, Core-style; uniqueness is checked
    // case-insensitively above), so violations show before the commit step.
    const raw = this.walletName.trim();
    this.walletNameInvalid.set(
      this.isRemote() && raw.length > 0 && !/^[A-Za-z0-9_-]{1,32}$/.test(raw)
    );
  }

  getCurrentStepTitle(): string {
    return this.i18n.get(this.stepTitles[this.currentStep() - 1]);
  }

  onMnemonicChanged(state: MnemonicEntryState): void {
    this.mnemonic = state.mnemonic;
    this.mnemonicValid.set(state.valid);
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
      const mnemonic = this.mnemonic;

      if (this.isRemote()) {
        // Remote (Electrum) mode: the backend probes EVERY derivation
        // branch the seed's history could live on over Electrum before
        // importing, and opens the best hit. The optional password
        // encrypts the seed at rest.
        const name = this.walletName.trim();
        const passphrase =
          this.useWalletEncryption && this.walletPassword ? this.walletPassword : undefined;
        const result = await this.btcxWallet.restore(mnemonic, passphrase, name);
        this.branchReport.set(this.mapBtcxRestore(result));
        const loaded = await this.walletManager.refreshLoadedWallets();
        if (loaded.includes(name)) {
          this.walletManager.setActiveWallet(name);
        }
      } else {
        // Only use BIP39 passphrase if checkbox is enabled
        const mnemonicPassphrase = this.useBip39Passphrase ? this.passphrase : undefined;

        const result = await this.walletManager.createWalletFromMnemonic({
          walletName: this.walletName,
          mnemonic,
          mnemonicPassphrase,
          isTestnet: this.isTestnet(),
          rescan: true, // Always rescan for imported wallets
          restore: true, // POCX branch active + funded legacy branches watched
        });

        if (!result.success) {
          throw new Error(result.errors?.join(', ') || 'Import failed');
        }

        // Which branches the restore-time UTXO scan found coins on (null
        // when the scan could not run — the note is simply skipped then).
        this.branchReport.set(result.branchReport ?? null);

        // Encrypt wallet if requested
        if (this.useWalletEncryption && this.walletPassword) {
          await this.walletManager.encryptWallet(this.walletName, this.walletPassword);
        }
      }

      this.clearSecrets();
      this.importing.set(false);
      this.imported.set(true);
    } catch (error) {
      console.error('Failed to import wallet:', error);
      // Tauri command rejections are plain strings, not Error instances —
      // surface them instead of a generic message.
      const errorMessage =
        error instanceof Error ? error.message : String(error) || 'Failed to import wallet';
      this.snackBar.open(errorMessage, this.i18n.get('dismiss'), { duration: 5000 });
      this.importing.set(false);
    }
  }

  /**
   * Map the remote restore's probe hits onto the same branch-report shape
   * the Core path renders. Only coin type 0' is legacy; the current branch
   * is the BTCX coin type on mainnet or 1' on testnet/regtest.
   */
  private mapBtcxRestore(result: BtcxRestoreResult): RestoreBranchReport {
    const coin = (ct: number) => (ct === BTCX_COIN_TYPE ? 'BTCX' : `${ct}'`);
    const label = (p: BtcxDescriptorPolicy) =>
      `${p.kind === 'bip84' ? "84'" : "86'"}/${coin(p.coinType)}`;
    return {
      legacy: result.hits.filter(h => h.policy.coinType === 0).map(h => label(h.policy)),
      pocx: result.hits.filter(h => h.policy.coinType !== 0).map(h => label(h.policy)),
      fresh: result.fresh,
    };
  }

  /** Compact era-labelled list, e.g. "legacy desktop (84'/0'), mobile (84'/BTCX)". */
  branchList(report: RestoreBranchReport): string {
    const parts: string[] = [];
    if (report.legacy.length > 0) {
      parts.push(`${this.i18n.get('restore_branch_legacy')} (${report.legacy.join(', ')})`);
    }
    if (report.pocx.length > 0) {
      parts.push(`${this.i18n.get('restore_branch_pocx')} (${report.pocx.join(', ')})`);
    }
    return parts.join(', ');
  }

  goToDashboard(): void {
    void this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.clearSecrets();
  }

  private clearSecrets(): void {
    this.mnemonic = '';
    this.mnemonicValid.set(false);
    this.mnemonicEntry?.reset();
    this.passphrase = '';
    this.passphraseConfirm = '';
    this.useBip39Passphrase = false;
    this.walletPassword = '';
    this.walletPasswordConfirm = '';
    this.useWalletEncryption = false;
  }
}
