import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { MiningService } from '../../services/mining.service';
import { PlotPlan } from '../../models/mining.models';

/**
 * Plan Viewer Dialog
 *
 * Displays the full plot plan as a scrollable list with:
 * - Color-coded task types (resume=purple, plot=blue, add_miner=green)
 * - Current task highlighted
 * - Completed tasks with checkmark
 * - Stats summary at top
 */
@Component({
  selector: 'app-plan-viewer-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon>assignment</mat-icon>
      Plotting Plan
    </h2>

    <mat-dialog-content class="dialog-content">
      @if (plan(); as plan) {
        <!-- Stats Summary -->
        <div class="plan-stats">
          <div class="stat">
            <span class="stat-label">Tasks</span>
            <span class="stat-value">{{ stats()?.completedTasks ?? 0 }}/{{ stats()?.totalTasks ?? 0 }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Remaining</span>
            <span class="stat-value">{{ formatTib(stats()?.remainingTib ?? 0) }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">ETA</span>
            <span class="stat-value">{{ eta() }}</span>
          </div>
          <div class="stat status-badge" [class]="uiState()">
            {{ formatStatus(uiState()) }}
          </div>
        </div>

        <!-- Plan Items Section -->
        @if (plan.items.length > 0) {
          <div class="section-header">
            <mat-icon>playlist_play</mat-icon>
            Tasks ({{ plan.items.length }})
          </div>
          <div class="plan-items">
            @for (item of plan.items; track $index; let i = $index) {
              <div
                class="plan-item"
                [class.current]="isItemCurrent(i, plan)"
                [class.completed]="i < currentIndex() && !isItemCurrent(i, plan)"
                [class.stopping]="isItemStopping(i, plan)"
              >
                <div class="item-index">{{ i + 1 }}</div>

                @if (i < currentIndex() && !isItemCurrent(i, plan)) {
                  <mat-icon class="status-icon done">check_circle</mat-icon>
                } @else if (isItemCurrent(i, plan)) {
                  <mat-icon class="status-icon running">play_circle</mat-icon>
                } @else if (isItemStopping(i, plan)) {
                  <mat-icon class="status-icon stopping">stop_circle</mat-icon>
                } @else {
                  <mat-icon class="status-icon pending">radio_button_unchecked</mat-icon>
                }

                <div class="item-content">
                  @switch (item.type) {
                    @case ('resume') {
                      <span class="badge resume">Resume</span>
                      <span class="item-path">{{ formatPath(item.path) }}</span>
                      <span class="item-detail">{{ item.sizeGib }} GiB</span>
                    }
                    @case ('plot') {
                      <span class="badge plot">Plot</span>
                      <span class="item-path">{{ formatPath(item.path) }}</span>
                      <span class="item-detail">{{ item.warps }} GiB</span>
                      @if (item.batchId !== undefined) {
                        <span class="item-batch" matTooltip="Parallel batch {{ item.batchId + 1 }}">
                          B{{ item.batchId + 1 }}
                        </span>
                      }
                    }
                    @case ('add_to_miner') {
                      <span class="badge add-miner">Add Miner</span>
                      <span class="item-path">{{ formatPath(item.path) }}</span>
                    }
                  }
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="empty-state">
            <mat-icon>info_outline</mat-icon>
            <p>No tasks in the plan. All drives are either finished or have no allocated space.</p>
          </div>
        }
      } @else {
        <div class="empty-state">
          <mat-icon>info_outline</mat-icon>
          <p>No plan has been generated yet.</p>
          <p class="hint">Configure drives and start plotting to generate a plan.</p>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 16px 24px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    }

    .dialog-content {
      padding: 16px 24px;
      max-height: 60vh;
      overflow-y: auto;
    }

    .plan-stats {
      display: flex;
      gap: 24px;
      padding: 12px 16px;
      background: rgba(0, 0, 0, 0.04);
      border-radius: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      color: rgba(0, 0, 0, 0.54);
      letter-spacing: 0.5px;
    }

    .stat-value {
      font-size: 16px;
      font-weight: 500;
    }

    .status-badge {
      margin-left: auto;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;

      &.pending { background: #e3f2fd; color: #1976d2; }
      &.running { background: #e8f5e9; color: #388e3c; }
      &.stopping { background: #fff3e0; color: #f57c00; }
      &.completed { background: #e8f5e9; color: #2e7d32; }
      &.invalid { background: #ffebee; color: #c62828; }
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(0, 0, 0, 0.6);
      margin: 16px 0 8px;
    }

    .plan-items {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .plan-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      transition: background-color 0.2s;

      &:hover {
        background: rgba(0, 0, 0, 0.04);
      }

      &.current {
        background: rgba(76, 175, 80, 0.12);
        border-left: 3px solid #4caf50;
      }

      &.completed {
        opacity: 0.6;
      }

      &.stopping {
        background: rgba(255, 152, 0, 0.12);
        border-left: 3px solid #ff9800;
      }
    }

    .item-index {
      width: 24px;
      text-align: center;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.4);
    }

    .status-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;

      &.done { color: #4caf50; }
      &.running { color: #4caf50; }
      &.stopping { color: #ff9800; }
      &.pending { color: rgba(0, 0, 0, 0.26); }
    }

    .item-content {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    .badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;

      &.resume { background: #e1bee7; color: #7b1fa2; }
      &.plot { background: #bbdefb; color: #1565c0; }
      &.add-miner { background: #c8e6c9; color: #2e7d32; }
    }

    .item-path {
      font-family: 'Roboto Mono', monospace;
      font-size: 13px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-detail {
      font-size: 12px;
      color: rgba(0, 0, 0, 0.54);
      white-space: nowrap;
    }

    .item-batch {
      padding: 2px 6px;
      background: rgba(0, 0, 0, 0.08);
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      color: rgba(0, 0, 0, 0.54);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 32px;
      text-align: center;
      color: rgba(0, 0, 0, 0.54);

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      p {
        margin: 0;
      }

      .hint {
        font-size: 13px;
        margin-top: 8px;
        opacity: 0.7;
      }
    }

    /* Dark theme support */
    :host-context(.dark-theme) {
      .plan-stats {
        background: rgba(255, 255, 255, 0.08);
      }

      .stat-label {
        color: rgba(255, 255, 255, 0.5);
      }

      .section-header {
        color: rgba(255, 255, 255, 0.6);
      }

      .plan-item:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      .item-index {
        color: rgba(255, 255, 255, 0.4);
      }

      .status-icon.pending {
        color: rgba(255, 255, 255, 0.26);
      }

      .item-detail {
        color: rgba(255, 255, 255, 0.54);
      }

      .item-batch {
        background: rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.54);
      }

      .empty-state {
        color: rgba(255, 255, 255, 0.54);
      }

      .dialog-title {
        border-bottom-color: rgba(255, 255, 255, 0.12);
      }
    }
  `],
})
export class PlanViewerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PlanViewerDialogComponent>);
  private readonly miningService = inject(MiningService);

  readonly plan = this.miningService.plotPlan;
  readonly stats = this.miningService.planStats;
  readonly eta = this.miningService.planEta;
  readonly currentIndex = this.miningService.currentPlanIndex;
  readonly uiState = this.miningService.plotterUIState;

  formatPath(path: string): string {
    // Show just the drive letter on Windows or last directory segment
    if (path.length <= 20) return path;
    const parts = path.split(/[/\\]/);
    if (parts.length >= 2) {
      return `${parts[0]}\\...\\${parts[parts.length - 1]}`;
    }
    return path;
  }

  formatTib(tib: number): string {
    if (tib >= 1) {
      return `${tib.toFixed(1)} TiB`;
    }
    const gib = tib * 1024;
    return `${gib.toFixed(0)} GiB`;
  }

  formatStatus(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  /**
   * Check if an item at the given index is part of the currently running batch.
   * Returns true if:
   * - The plotter is running (plotting state)
   * - The item is a 'plot' type with a batchId
   * - The batchId matches the batchId of the item at currentIndex
   */
  isInCurrentBatch(index: number, plan: PlotPlan): boolean {
    if (this.uiState() !== 'plotting') return false;

    const idx = this.currentIndex();
    const currentItem = plan.items[idx];
    const checkItem = plan.items[index];

    // Both must be plot items with batchIds
    if (currentItem?.type !== 'plot' || checkItem?.type !== 'plot') return false;
    if (currentItem.batchId === undefined || checkItem.batchId === undefined) return false;

    // Same batch ID means they're in the same batch
    return currentItem.batchId === checkItem.batchId;
  }

  /**
   * Check if item should show as "current" (running or in current batch)
   */
  isItemCurrent(index: number, plan: PlotPlan): boolean {
    if (this.uiState() !== 'plotting') return false;
    return index === this.currentIndex() || this.isInCurrentBatch(index, plan);
  }

  /**
   * Check if item should show as "stopping" (in current batch when stopping)
   * This is only visible briefly while the batch finishes after soft stop.
   */
  isItemStopping(index: number, plan: PlotPlan): boolean {
    if (this.uiState() !== 'stopping') return false;

    const idx = this.currentIndex();

    // Current item is stopping
    if (index === idx) return true;

    // Check if in same batch as current item
    const currentItem = plan.items[idx];
    const checkItem = plan.items[index];
    if (currentItem?.type === 'plot' && checkItem?.type === 'plot' &&
        currentItem.batchId !== undefined && checkItem.batchId !== undefined) {
      return currentItem.batchId === checkItem.batchId;
    }

    return false;
  }

  close(): void {
    this.dialogRef.close();
  }
}
