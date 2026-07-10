import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { I18nPipe } from '../../../core/i18n';

export interface TypedConfirmDialogData {
  title: string;
  message: string;
  /** The exact text the user must type back to arm the confirm button. */
  requiredText: string;
  /** Label of the type-it-back input. */
  inputLabel: string;
  confirmText?: string;
  cancelText?: string;
}

/**
 * TypedConfirmDialogComponent — a danger confirmation gated by typing an
 * exact text back (e.g. a wallet's name before deleting it). The confirm
 * button stays disabled until the input matches `requiredText`
 * case-SENSITIVELY — the same comparison the `btcx_wallet_delete` backend
 * enforces on its `confirm_name` argument.
 *
 * Closes with the typed text on confirm (callers pass it through to the
 * backend so the backend re-checks the very string the user typed) and
 * `undefined` on cancel.
 */
@Component({
  selector: 'app-typed-confirm-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    I18nPipe,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon class="title-icon">error</mat-icon>
      {{ data.title }}
    </h2>

    <mat-dialog-content>
      <p class="dialog-message">{{ data.message }}</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ data.inputLabel }}</mat-label>
        <input
          matInput
          [(ngModel)]="typed"
          (ngModelChange)="onTypedChange()"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          cdkFocusInitial
        />
        <mat-hint>{{ data.requiredText }}</mat-hint>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        {{ data.cancelText || ('cancel' | i18n) }}
      </button>
      <button mat-raised-button color="warn" [disabled]="!matches()" (click)="onConfirm()">
        {{ data.confirmText || ('confirm' | i18n) }}
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
        color: #f44336;
      }

      .dialog-message {
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.6;
        white-space: pre-line;
      }

      .full-width {
        width: 100%;
      }

      :host-context(.dark-theme) {
        .dialog-message {
          color: rgba(255, 255, 255, 0.8);
        }
      }
    `,
  ],
})
export class TypedConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<TypedConfirmDialogComponent>);
  readonly data = inject<TypedConfirmDialogData>(MAT_DIALOG_DATA);

  typed = '';
  readonly matches = signal(false);

  onTypedChange(): void {
    this.matches.set(this.typed === this.data.requiredText);
  }

  onConfirm(): void {
    if (this.matches()) {
      this.dialogRef.close(this.typed);
    }
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }
}
