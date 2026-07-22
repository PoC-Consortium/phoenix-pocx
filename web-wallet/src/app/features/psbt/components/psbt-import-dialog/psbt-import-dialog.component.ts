import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { PsbtService } from '../../services/psbt.service';

export interface PsbtImportDialogData {
  /** i18n key for the dialog title (import vs combine wording) */
  titleKey: string;
}

/**
 * Dialog for bringing a PSBT into the app: paste Base64 or open a .psbt file.
 * Used both for the initial import and for combining a co-signer's copy.
 * Closes with the Base64 string, or undefined on cancel.
 */
@Component({
  selector: 'app-psbt-import-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    I18nPipe,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">file_open</mat-icon>
      {{ data.titleKey | i18n }}
    </h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline" class="paste-field">
        <mat-label>{{ 'psbt_paste_base64' | i18n }}</mat-label>
        <textarea
          matInput
          rows="6"
          [(ngModel)]="pasted"
          (ngModelChange)="error.set(null)"
          spellcheck="false"
          class="mono"
        ></textarea>
      </mat-form-field>

      <div class="or-row">
        <span class="or-line"></span>
        <span class="or-text">{{ 'psbt_or' | i18n }}</span>
        <span class="or-line"></span>
      </div>

      <button mat-stroked-button class="file-button" (click)="fileInput.click()">
        <mat-icon>upload_file</mat-icon>
        {{ 'psbt_open_file' | i18n }}
      </button>
      <input #fileInput type="file" accept=".psbt,.txt" hidden (change)="onFileSelected($event)" />
      @if (fileName()) {
        <div class="file-name mono">{{ fileName() }}</div>
      }

      @if (error()) {
        <div class="error-banner">
          <mat-icon>error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="dialogRef.close()">{{ 'cancel' | i18n }}</button>
      <button mat-raised-button color="primary" [disabled]="!pasted.trim()" (click)="confirm()">
        <mat-icon>arrow_forward</mat-icon>
        {{ 'psbt_load' | i18n }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      @use 'breakpoints' as bp;

      .title-icon {
        margin-right: 8px;
        vertical-align: middle;
        color: #1976d2;
      }

      mat-dialog-content {
        min-width: 420px;
        max-width: 520px;
      }

      @include bp.phone {
        mat-dialog-content {
          min-width: unset;
        }
      }

      .paste-field {
        width: 100%;

        textarea {
          font-family: 'Roboto Mono', monospace;
          font-size: 12px;
          word-break: break-all;
        }
      }

      .or-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 4px 0 12px;

        .or-line {
          flex: 1;
          height: 1px;
          background: rgba(0, 0, 0, 0.12);
        }

        .or-text {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.54);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
      }

      .file-button {
        width: 100%;

        mat-icon {
          margin-right: 8px;
        }
      }

      .file-name {
        margin-top: 8px;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.54);
        text-align: center;
      }

      .error-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        margin-top: 12px;
        background: #ffebee;
        color: #c62828;
        border-radius: 4px;
        font-size: 13px;

        mat-icon {
          flex-shrink: 0;
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .mono {
        font-family: 'Roboto Mono', monospace;
      }
    `,
  ],
})
export class PsbtImportDialogComponent {
  readonly dialogRef = inject(MatDialogRef<PsbtImportDialogComponent>);
  readonly data: PsbtImportDialogData = inject(MAT_DIALOG_DATA);
  private readonly psbtService = inject(PsbtService);
  private readonly i18n = inject(I18nService);

  pasted = '';
  fileName = signal<string | null>(null);
  error = signal<string | null>(null);

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      this.pasted = await this.psbtService.readPsbtFile(file);
      this.fileName.set(file.name);
      this.error.set(null);
    } catch {
      this.error.set(this.i18n.get('psbt_invalid_file'));
    }
  }

  confirm(): void {
    const base64 = this.pasted.replace(/\s+/g, '');
    if (!this.psbtService.looksLikeBase64Psbt(base64)) {
      this.error.set(this.i18n.get('psbt_invalid_base64'));
      return;
    }
    this.dialogRef.close(base64);
  }
}
