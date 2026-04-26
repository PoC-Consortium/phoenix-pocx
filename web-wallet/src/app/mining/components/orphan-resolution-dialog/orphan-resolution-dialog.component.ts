import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MiningService } from '../../services/mining.service';
import { OrphanFile, OrphanReason } from '../../models/mining.models';
import { I18nPipe, I18nService } from '../../../core/i18n';

/**
 * Orphan Resolution Dialog
 *
 * Surfaced when plan generation finds .tmp files whose embedded address or
 * compression don't match the current config. Plotting is blocked until the
 * user deletes each file (or restores matching settings and re-saves config).
 *
 * Why fail-fast instead of silently orphaning: the v2 plotter reconstructs the
 * .tmp filename from the active address+compression. A mismatch means it can't
 * find the existing file → starts a fresh plot under the new name → the old
 * .tmp lingers as wasted disk space. Deleting up-front is the only safe option.
 */
@Component({
  selector: 'app-orphan-resolution-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    I18nPipe,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon color="warn">warning</mat-icon>
      {{ 'orphan_dialog_title' | i18n }}
    </h2>

    <mat-dialog-content class="dialog-content">
      <p class="explanation">{{ 'orphan_dialog_explanation' | i18n }}</p>

      @if (orphanDrives(); as drives) {
        @if (drives.length === 0) {
          <div class="resolved-state">
            <mat-icon color="primary">check_circle</mat-icon>
            <span>{{ 'orphan_all_resolved' | i18n }}</span>
          </div>
        } @else {
          @for (drive of drives; track drive.path) {
            <div class="drive-block">
              <div class="drive-header">
                <mat-icon>folder</mat-icon>
                <span class="drive-path">{{ drive.path }}</span>
                <span class="drive-label">{{ drive.label }}</span>
              </div>
              <ul class="orphan-list">
                @for (orphan of drive.orphans; track orphan.filename) {
                  <li class="orphan-item">
                    <div class="orphan-meta">
                      <span class="orphan-filename" [title]="orphan.filename">{{
                        orphan.filename
                      }}</span>
                      <span class="orphan-size">{{ orphan.sizeGib.toFixed(1) }} GiB</span>
                      <span class="orphan-reason">{{ formatReason(orphan) }}</span>
                    </div>
                    <button
                      mat-stroked-button
                      color="warn"
                      [disabled]="deleting().has(orphan.filename)"
                      (click)="deleteOrphan(drive.path, orphan)"
                    >
                      @if (deleting().has(orphan.filename)) {
                        <mat-progress-spinner diameter="16" mode="indeterminate" />
                      } @else {
                        <mat-icon>delete</mat-icon>
                      }
                      {{ 'delete' | i18n }}
                    </button>
                  </li>
                }
              </ul>
            </div>
          }
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">{{ 'close' | i18n }}</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .dialog-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
      }
      .dialog-content {
        min-width: 480px;
        max-width: 720px;
      }
      .explanation {
        color: var(--mat-sys-on-surface-variant);
        margin-bottom: 1rem;
      }
      .resolved-state {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem;
        font-weight: 500;
      }
      .drive-block {
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 8px;
        padding: 0.75rem 1rem;
        margin-bottom: 0.75rem;
      }
      .drive-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 500;
        margin-bottom: 0.5rem;
      }
      .drive-path {
        font-family: monospace;
      }
      .drive-label {
        color: var(--mat-sys-on-surface-variant);
        font-weight: normal;
        font-size: 0.85em;
      }
      .orphan-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .orphan-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.5rem 0;
        border-top: 1px dashed var(--mat-sys-outline-variant);
      }
      .orphan-item:first-child {
        border-top: none;
      }
      .orphan-meta {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        min-width: 0;
        flex: 1;
      }
      .orphan-filename {
        font-family: monospace;
        font-size: 0.85em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .orphan-size {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.85em;
      }
      .orphan-reason {
        color: var(--mat-sys-error);
        font-size: 0.85em;
      }
    `,
  ],
})
export class OrphanResolutionDialogComponent {
  private readonly miningService = inject(MiningService);
  private readonly dialogRef = inject(MatDialogRef<OrphanResolutionDialogComponent>);
  private readonly i18n = inject(I18nService);

  /** Filenames currently being deleted, keyed by filename (unique within the dialog scope). */
  readonly deleting = signal<Set<string>>(new Set());

  /** Reactive view of the blocker, so the list updates as files are deleted. */
  readonly orphanDrives = computed(() => this.miningService.orphanBlocker() ?? []);

  formatReason(orphan: OrphanFile): string {
    const expected = orphan.expected;
    const actual = orphan.actual;
    const key: Record<OrphanReason, string> =
      orphan.reason === 'address_mismatch'
        ? { address_mismatch: 'orphan_reason_address', compression_mismatch: '' }
        : { compression_mismatch: 'orphan_reason_compression', address_mismatch: '' };
    return this.i18n.get(key[orphan.reason], { expected, actual });
  }

  async deleteOrphan(dirPath: string, orphan: OrphanFile): Promise<void> {
    this.deleting.update(set => {
      const next = new Set(set);
      next.add(orphan.filename);
      return next;
    });
    try {
      await this.miningService.deleteOrphan(dirPath, orphan.filename);
    } finally {
      this.deleting.update(set => {
        const next = new Set(set);
        next.delete(orphan.filename);
        return next;
      });
    }
  }

  close(): void {
    this.miningService.dismissOrphanBlocker();
    this.dialogRef.close();
  }
}
