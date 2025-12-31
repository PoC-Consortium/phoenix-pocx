import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { I18nPipe } from '../../../core/i18n';

export interface PassphraseDialogData {
  walletName: string;
  timeout?: number;
}

export interface PassphraseDialogResult {
  passphrase: string;
  timeout: number;
}

/**
 * PassphraseDialogComponent prompts the user to enter their wallet passphrase.
 * Used to unlock encrypted wallets for signing transactions.
 *
 * Usage:
 * const dialogRef = dialog.open(PassphraseDialogComponent, {
 *   data: { walletName: 'My Wallet', timeout: 5 }
 * });
 * dialogRef.afterClosed().subscribe((result: PassphraseDialogResult | null) => {
 *   if (result) {
 *     // Use result.passphrase and result.timeout
 *   }
 * });
 */
@Component({
  selector: 'app-passphrase-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    I18nPipe,
  ],
  template: `
    <h2 mat-dialog-title>{{ 'unlock_wallet' | i18n }}</h2>

    <mat-dialog-content>
      <p class="unlock-message">{{ 'wallet_locked_message' | i18n }}</p>
      @if (walletName) {
        <p class="wallet-name">{{ walletName }}</p>
      }

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ 'passphrase' | i18n }}</mat-label>
        <input
          matInput
          [type]="showPassphrase() ? 'text' : 'password'"
          [(ngModel)]="passphrase"
          (keyup.enter)="onSubmit()"
          autocomplete="off"
          cdkFocusInitial
        />
        <button
          mat-icon-button
          matSuffix
          type="button"
          (click)="toggleShowPassphrase()"
          [attr.aria-label]="(showPassphrase() ? 'hide_passphrase' : 'show_passphrase') | i18n"
        >
          <mat-icon>{{ showPassphrase() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
      </mat-form-field>

      <p class="unlock-note">{{ 'unlock_timeout_note' | i18n: { seconds: timeout } }}</p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        {{ 'cancel' | i18n }}
      </button>
      <button mat-raised-button color="primary" (click)="onSubmit()" [disabled]="!canSubmit()">
        {{ 'unlock' | i18n }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .unlock-message {
        color: rgba(0, 0, 0, 0.6);
        margin-bottom: 8px;
      }

      .wallet-name {
        font-weight: 600;
        font-size: 16px;
        margin-bottom: 16px;
      }

      .full-width {
        width: 100%;
      }

      .unlock-note {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.54);
        margin-top: 8px;
      }

      :host-context(.dark-theme) {
        .unlock-message {
          color: rgba(255, 255, 255, 0.7);
        }

        .unlock-note {
          color: rgba(255, 255, 255, 0.6);
        }
      }
    `,
  ],
})
export class PassphraseDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PassphraseDialogComponent>);
  private readonly data = inject<PassphraseDialogData>(MAT_DIALOG_DATA);

  passphrase = '';
  walletName: string;
  timeout: number;

  showPassphrase = signal(false);

  constructor() {
    this.walletName = this.data?.walletName ?? '';
    this.timeout = this.data?.timeout ?? 5;
  }

  canSubmit(): boolean {
    return this.passphrase.length > 0;
  }

  onSubmit(): void {
    if (this.canSubmit()) {
      this.dialogRef.close({
        passphrase: this.passphrase,
        timeout: this.timeout,
      } as PassphraseDialogResult);
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }

  toggleShowPassphrase(): void {
    this.showPassphrase.update(v => !v);
  }
}
