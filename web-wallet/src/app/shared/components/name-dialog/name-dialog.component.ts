import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { I18nPipe } from '../../../core/i18n';

export interface NameDialogData {
  title: string;
  /** Label of the name input. */
  inputLabel: string;
  /** Prefilled value (e.g. the current name when renaming). */
  initialValue?: string;
  /** Optional hint under the input (e.g. the allowed character set). */
  hint?: string;
  confirmText?: string;
  cancelText?: string;
  /**
   * Validate the TRIMMED value: return a user-visible error to block the
   * confirm button, or null when the value is acceptable.
   */
  validate?: (value: string) => string | null;
}

/**
 * NameDialogComponent — a small non-destructive name-input dialog (the
 * TypedConfirmDialog's benign sibling): one text field with caller-supplied
 * validation, confirm disabled while empty/invalid/unchanged.
 *
 * Closes with the trimmed name on confirm and `undefined` on cancel. Used
 * by the mobile wallet settings' rename flow (backend:
 * `btcx_wallet_rename`).
 */
@Component({
  selector: 'app-name-dialog',
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
      <mat-icon class="title-icon">edit</mat-icon>
      {{ data.title }}
    </h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ data.inputLabel }}</mat-label>
        <input
          matInput
          [(ngModel)]="value"
          (ngModelChange)="onValueChange()"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          cdkFocusInitial
        />
        @if (data.hint) {
          <mat-hint>{{ data.hint }}</mat-hint>
        }
      </mat-form-field>
      @if (error(); as err) {
        <!-- mat-error only shows on control-level invalidity; the
             caller-supplied rule renders here instead. -->
        <p class="error-text">{{ err }}</p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        {{ data.cancelText || ('cancel' | i18n) }}
      </button>
      <button mat-raised-button color="primary" [disabled]="!canConfirm()" (click)="onConfirm()">
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
        color: #1976d2;
      }

      .full-width {
        width: 100%;
        margin-top: 8px;
      }

      .error-text {
        color: #c62828;
        font-size: 12px;
        margin: 8px 0 0;
      }

      :host-context(.dark-theme) {
        .error-text {
          color: #ef9a9a;
        }
      }
    `,
  ],
})
export class NameDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<NameDialogComponent>);
  readonly data = inject<NameDialogData>(MAT_DIALOG_DATA);

  value = this.data.initialValue ?? '';
  readonly error = signal<string | null>(null);

  onValueChange(): void {
    const trimmed = this.value.trim();
    this.error.set(trimmed ? (this.data.validate?.(trimmed) ?? null) : null);
  }

  canConfirm(): boolean {
    const trimmed = this.value.trim();
    return trimmed.length > 0 && trimmed !== (this.data.initialValue ?? '') && !this.error();
  }

  onConfirm(): void {
    if (this.canConfirm()) {
      this.dialogRef.close(this.value.trim());
    }
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }
}
