import { Component, inject } from '@angular/core';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe } from '../../../core/i18n';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string; // Optional third button
  type?: 'info' | 'warning' | 'danger';
  showSpinner?: boolean; // Show a loading spinner instead of icon
  hideActions?: boolean; // Hide action buttons (for progress dialogs)
}

/**
 * ConfirmDialogComponent displays a confirmation dialog with customizable
 * title, message, and button text.
 *
 * Usage:
 * const dialogRef = dialog.open(ConfirmDialogComponent, {
 *   data: {
 *     title: 'Confirm Delete',
 *     message: 'Are you sure you want to delete this wallet?',
 *     confirmText: 'Delete',
 *     type: 'danger'
 *   }
 * });
 * dialogRef.afterClosed().subscribe((confirmed: boolean) => {
 *   if (confirmed) {
 *     // Proceed with action
 *   }
 * });
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, I18nPipe],
  template: `
    <h2 mat-dialog-title class="dialog-title" [class]="type">
      @if (showSpinner) {
        <mat-spinner diameter="24" class="title-spinner"></mat-spinner>
      } @else if (type === 'warning') {
        <mat-icon class="title-icon warning">warning</mat-icon>
      } @else if (type === 'danger') {
        <mat-icon class="title-icon danger">error</mat-icon>
      } @else {
        <mat-icon class="title-icon info">info</mat-icon>
      }
      {{ title }}
    </h2>

    <mat-dialog-content>
      <p class="dialog-message">{{ message }}</p>
    </mat-dialog-content>

    @if (!hideActions) {
      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()">
          {{ cancelText || ('cancel' | i18n) }}
        </button>
        @if (secondaryText) {
          <button mat-stroked-button color="warn" (click)="onSecondary()">
            {{ secondaryText }}
          </button>
        }
        <button
          mat-raised-button
          [color]="type === 'danger' ? 'warn' : 'primary'"
          (click)="onConfirm()"
        >
          {{ confirmText || ('confirm' | i18n) }}
        </button>
      </mat-dialog-actions>
    }
  `,
  styles: [
    `
      .dialog-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .title-icon {
        &.info {
          color: #2196f3;
        }
        &.warning {
          color: #ff9800;
        }
        &.danger {
          color: #f44336;
        }
      }

      .title-spinner {
        margin-right: 4px;
      }

      .dialog-message {
        color: rgba(0, 0, 0, 0.7);
        line-height: 1.6;
        white-space: pre-line;
      }

      :host-context(.dark-theme) {
        .dialog-message {
          color: rgba(255, 255, 255, 0.8);
        }
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ConfirmDialogComponent>);
  private readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;
  type: 'info' | 'warning' | 'danger';
  showSpinner: boolean;
  hideActions: boolean;

  constructor() {
    this.title = this.data?.title ?? 'Confirm';
    this.message = this.data?.message ?? '';
    this.confirmText = this.data?.confirmText;
    this.cancelText = this.data?.cancelText;
    this.secondaryText = this.data?.secondaryText;
    this.type = this.data?.type ?? 'info';
    this.showSpinner = this.data?.showSpinner ?? false;
    this.hideActions = this.data?.hideActions ?? false;
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }

  onSecondary(): void {
    this.dialogRef.close('secondary');
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
