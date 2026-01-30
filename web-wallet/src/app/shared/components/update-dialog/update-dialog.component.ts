import { Component, Inject } from '@angular/core';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { I18nPipe } from '../../../core/i18n';
import { WalletUpdateInfo } from '../../../core/services/app-update.service';
import { ElectronService } from '../../../core/services/electron.service';

@Component({
  selector: 'app-update-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, I18nPipe],
  template: `
    <div class="update-dialog">
      @if (data.available) {
        <!-- Update available -->
        <h2 mat-dialog-title>
          <mat-icon class="update-icon">system_update</mat-icon>
          {{ 'update_available' | i18n }}
        </h2>

        <mat-dialog-content>
          <div class="version-info">
            <div class="version-row">
              <span class="label">{{ 'current_version' | i18n }}:</span>
              <span class="version current">{{ data.currentVersion }}</span>
            </div>
            <div class="version-row">
              <span class="label">{{ 'new_version' | i18n }}:</span>
              <span class="version new">{{ data.latestVersion }}</span>
            </div>
          </div>

          @if (data.releaseNotes) {
            <div class="release-notes">
              <h4>{{ 'release_notes' | i18n }}</h4>
              <div class="notes-content">{{ data.releaseNotes }}</div>
            </div>
          }
        </mat-dialog-content>

        <mat-dialog-actions align="end">
          <button mat-button (click)="onRemindLater()">
            {{ 'remind_later' | i18n }}
          </button>
          <button mat-raised-button color="primary" (click)="onDownload()">
            <mat-icon>open_in_new</mat-icon>
            {{ 'download_from_github' | i18n }}
          </button>
        </mat-dialog-actions>
      } @else {
        <!-- Already on latest -->
        <h2 mat-dialog-title class="up-to-date">
          <mat-icon class="update-icon">check_circle</mat-icon>
          {{ 'up_to_date' | i18n }}
        </h2>

        <mat-dialog-content>
          <div class="version-info">
            <div class="version-row">
              <span class="label">{{ 'current_version' | i18n }}:</span>
              <span class="version current">{{ data.currentVersion }}</span>
            </div>
            <div class="version-row">
              <span class="label">{{ 'latest_version' | i18n }}:</span>
              <span class="version latest">{{ data.latestVersion }}</span>
            </div>
          </div>
        </mat-dialog-content>

        <mat-dialog-actions align="end">
          <button mat-raised-button color="primary" mat-dialog-close>
            {{ 'close' | i18n }}
          </button>
        </mat-dialog-actions>
      }
    </div>
  `,
  styles: [
    `
      .update-dialog {
        min-width: 400px;
        max-width: 500px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
        padding: 16px 24px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;

        .update-icon {
          font-size: 28px;
          width: 28px;
          height: 28px;
        }
      }

      mat-dialog-content {
        padding: 24px !important;
        max-height: 400px;
      }

      .version-info {
        background: #f5f7fa;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
      }

      .version-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;

        &:not(:last-child) {
          border-bottom: 1px solid #e0e0e0;
        }

        .label {
          color: #666;
          font-size: 13px;
        }

        .version {
          font-family: monospace;
          font-weight: 600;
          font-size: 14px;

          &.current {
            color: #666;
          }

          &.new {
            color: #4caf50;
          }

          &.latest {
            color: #4caf50;
          }
        }
      }

      h2[mat-dialog-title].up-to-date {
        background: linear-gradient(135deg, #2e7d32 0%, #4caf50 100%);
      }

      .release-notes {
        margin-top: 16px;

        h4 {
          margin: 0 0 8px 0;
          font-size: 13px;
          font-weight: 600;
          color: rgb(0, 35, 65);
          text-transform: uppercase;
        }

        .notes-content {
          max-height: 200px;
          overflow-y: auto;
          padding: 12px;
          background: #fafafa;
          border-radius: 4px;
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
          color: #333;
        }
      }

      mat-dialog-actions {
        padding: 16px 24px !important;
        gap: 8px;

        button mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          margin-right: 4px;
        }
      }

      // Dark theme
      :host-context(.dark-theme) {
        .version-info {
          background: #333;
        }

        .version-row {
          border-color: #444;

          .label {
            color: #aaa;
          }

          .version.current {
            color: #aaa;
          }
        }

        .release-notes {
          h4 {
            color: #90caf9;
          }

          .notes-content {
            background: #333;
            color: #ddd;
          }
        }
      }
    `,
  ],
})
export class UpdateDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<UpdateDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: WalletUpdateInfo,
    private electronService: ElectronService
  ) {}

  onRemindLater(): void {
    this.dialogRef.close({ dismissed: true });
  }

  onDownload(): void {
    if (this.data.releaseUrl) {
      this.electronService.openExternal(this.data.releaseUrl);
    }
    this.dialogRef.close(null);
  }
}
