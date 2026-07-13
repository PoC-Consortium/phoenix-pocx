import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import {
  MnemonicEntryComponent,
  MnemonicEntryState,
} from '../../../../shared/components/mnemonic-entry/mnemonic-entry.component';

/** Payload of the upgrade dialog: the wallet to upgrade. */
export interface UpgradeWalletDialogData {
  walletName: string;
}

/**
 * UpgradeWalletDialogComponent — guided v30→v31 upgrade for a Core (desktop
 * managed/external) wallet.
 *
 * A calm explainer, the shared mnemonic-entry grid plus an optional BIP39
 * passphrase field, and Upgrade/Cancel. On Upgrade it re-verifies the seed
 * and imports the BTCX coin-type branch via
 * `WalletManagerService.upgradeWalletToV31`. A mismatched seed
 * (`upgrade_seed_mismatch`) surfaces inline without closing; the rescan can
 * take a while, so the actions show a spinner while it runs. Closes with
 * `true` on success so the caller clears the badge / refreshes the list.
 */
@Component({
  selector: 'app-upgrade-wallet-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MnemonicEntryComponent,
    I18nPipe,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon class="title-icon">upgrade</mat-icon>
      {{ 'wallet_upgrade_title' | i18n }}
    </h2>

    <mat-dialog-content>
      <p class="dialog-body">{{ 'wallet_upgrade_body' | i18n }}</p>

      <app-mnemonic-entry [disabled]="upgrading()" (changed)="onMnemonicChange($event)" />

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ 'mwallet_passphrase_optional' | i18n }}</mat-label>
        <input
          matInput
          type="password"
          [(ngModel)]="passphrase"
          [disabled]="upgrading()"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
        />
      </mat-form-field>

      @if (error()) {
        <p class="error-text">
          <mat-icon>error_outline</mat-icon>
          {{ error() }}
        </p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button [disabled]="upgrading()" (click)="onCancel()">
        {{ 'cancel' | i18n }}
      </button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="!mnemonicValid() || upgrading()"
        (click)="onUpgrade()"
      >
        @if (upgrading()) {
          <mat-spinner diameter="20"></mat-spinner>
        } @else {
          <mat-icon>upgrade</mat-icon>
        }
        {{ 'wallet_upgrade_cta' | i18n }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .dialog-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .title-icon {
        color: #ff9800;
      }

      .dialog-body {
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.6;
        margin-bottom: 16px;
      }

      mat-dialog-content {
        max-width: 560px;
      }

      .full-width {
        width: 100%;
      }

      .error-text {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #f44336;
        font-size: 13px;
        margin: 4px 0 0;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      mat-dialog-actions button mat-spinner {
        display: inline-block;
        margin-right: 8px;
      }

      :host-context(.dark-theme) {
        .dialog-body {
          color: rgba(255, 255, 255, 0.8);
        }
      }
    `,
  ],
})
export class UpgradeWalletDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UpgradeWalletDialogComponent>);
  private readonly data = inject<UpgradeWalletDialogData>(MAT_DIALOG_DATA);
  private readonly walletManager = inject(WalletManagerService);
  private readonly i18n = inject(I18nService);

  /** Latest mnemonic-entry state (phrase + BIP39 validity). */
  private mnemonic = '';
  readonly mnemonicValid = signal(false);

  passphrase = '';

  readonly upgrading = signal(false);
  readonly error = signal<string | null>(null);

  onMnemonicChange(state: MnemonicEntryState): void {
    this.mnemonic = state.mnemonic;
    this.mnemonicValid.set(state.valid);
    // Editing the phrase clears a stale mismatch message.
    if (this.error()) this.error.set(null);
  }

  async onUpgrade(): Promise<void> {
    if (!this.mnemonicValid() || this.upgrading()) return;

    this.upgrading.set(true);
    this.error.set(null);
    try {
      await this.walletManager.upgradeWalletToV31(
        this.data.walletName,
        this.mnemonic,
        this.passphrase || undefined
      );
      this.dialogRef.close(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : `${err}`;
      // The backend throws `upgrade_seed_mismatch` for a wrong seed; any
      // other failure surfaces its raw message.
      this.error.set(
        message === 'upgrade_seed_mismatch'
          ? this.i18n.get('wallet_upgrade_seed_mismatch')
          : message
      );
    } finally {
      this.upgrading.set(false);
    }
  }

  onCancel(): void {
    if (this.upgrading()) return;
    this.dialogRef.close(false);
  }
}
