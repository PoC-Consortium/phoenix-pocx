import { Component, Inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { I18nPipe } from '../../../core/i18n';
import { UpdateInfo, UpdateAsset } from '../../../core/services/electron.service';

@Component({
  selector: 'app-update-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    I18nPipe,
  ],
  template: `
    <div class="update-dialog">
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
            <span class="version new">{{ data.newVersion }}</span>
          </div>
          <div class="version-row">
            <span class="label">{{ 'platform' | i18n }}:</span>
            <span class="platform">{{ data.os }}</span>
          </div>
        </div>

        @if (data.assets.length > 1) {
          <mat-form-field appearance="outline" class="asset-select">
            <mat-label>{{ 'select_download' | i18n }}</mat-label>
            <mat-select [(value)]="selectedAsset">
              @for (asset of data.assets; track asset.url) {
                <mat-option [value]="asset">
                  {{ asset.name }} ({{ formatSize(asset.size) }})
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        } @else if (data.assets.length === 1) {
          <div class="single-asset">
            <mat-icon>download</mat-icon>
            <span>{{ data.assets[0].name }}</span>
            <span class="size">({{ formatSize(data.assets[0].size) }})</span>
          </div>
        } @else {
          <div class="no-assets">
            <mat-icon>warning</mat-icon>
            <span>{{ 'no_download_available' | i18n }}</span>
          </div>
        }

        @if (data.releaseNotes) {
          <div class="release-notes">
            <h4>{{ 'release_notes' | i18n }}</h4>
            <div class="notes-content">{{ data.releaseNotes }}</div>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <a mat-stroked-button [href]="data.releaseUrl" target="_blank" class="release-link">
          <mat-icon>open_in_new</mat-icon>
          {{ 'view_on_github' | i18n }}
        </a>
        <button mat-button (click)="onCancel()">
          {{ 'later' | i18n }}
        </button>
        <button
          mat-raised-button
          color="primary"
          [disabled]="!canDownload()"
          (click)="onDownload()"
        >
          <mat-icon>download</mat-icon>
          {{ 'download' | i18n }}
        </button>
      </mat-dialog-actions>
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
        }

        .platform {
          font-weight: 500;
          color: rgb(0, 35, 65);
        }
      }

      .asset-select {
        width: 100%;
        margin-bottom: 16px;
      }

      .single-asset {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: #e3f2fd;
        border-radius: 8px;
        margin-bottom: 16px;
        color: #1565c0;

        mat-icon {
          color: #1565c0;
        }

        .size {
          color: #666;
          font-size: 12px;
        }
      }

      .no-assets {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: #fff3e0;
        border-radius: 8px;
        margin-bottom: 16px;
        color: #e65100;

        mat-icon {
          color: #e65100;
        }
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
          max-height: 150px;
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

        .release-link {
          margin-right: auto;
          text-decoration: none;

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            margin-right: 4px;
          }
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

          .platform {
            color: #90caf9;
          }
        }

        .single-asset {
          background: #1e3a5f;
        }

        .no-assets {
          background: #3e2723;
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
  selectedAsset: UpdateAsset | null = null;

  constructor(
    public dialogRef: MatDialogRef<UpdateDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: UpdateInfo
  ) {
    // Pre-select first asset if only one
    if (data.assets.length === 1) {
      this.selectedAsset = data.assets[0];
    }
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  canDownload(): boolean {
    return this.data.assets.length === 1 || this.selectedAsset !== null;
  }

  onDownload(): void {
    const asset = this.selectedAsset || this.data.assets[0];
    if (asset) {
      this.dialogRef.close(asset.url);
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
