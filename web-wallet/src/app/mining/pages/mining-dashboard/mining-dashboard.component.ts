import { Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { I18nPipe, I18nService } from '../../../core/i18n';
import { AppModeService } from '../../../core/services/app-mode.service';
import { invoke } from '@tauri-apps/api/core';
import { MiningService } from '../../services';
import {
  MiningStatus,
  PlottingStatus,
  ChainConfig,
  DriveConfig,
  calculateNetworkCapacityTib,
  formatCapacity,
} from '../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { PlanViewerDialogComponent } from '../../components/plan-viewer-dialog/plan-viewer-dialog.component';

@Component({
  selector: 'app-mining-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatDialogModule,
    MatTooltipModule,
    MatIconModule,
    MatCheckboxModule,
    I18nPipe,
  ],
  template: `
    <div class="dashboard">
      <div class="main-content">
        <!-- Summary Cards Row -->
        <div class="summary-cards">
          <!-- Mining Status Card -->
          <div class="summary-card mining-status-card">
            <div class="card-header">
              <span class="card-title"
                ><mat-icon>hardware</mat-icon>{{ 'mining_status' | i18n }}</span
              >
            </div>
            <div class="status-row">
              <span class="status-indicator" [class]="getStatusIndicatorClass()"></span>
              <span class="status-text">{{ getStatusText() }}</span>
              <button
                class="btn btn-icon"
                [class.btn-stop]="isRunning()"
                [class.btn-start]="!isRunning()"
                (click)="toggleMining()"
                [title]="
                  isRunning() ? ('mining_stop_mining' | i18n) : ('mining_start_mining' | i18n)
                "
              >
                <span class="btn-label">{{
                  isRunning() ? ('mining_stop' | i18n) : ('mining_start' | i18n)
                }}</span>
                <span class="btn-icon-glyph">{{ isRunning() ? '■' : '▶' }}</span>
              </button>
            </div>
            <div class="card-sub">{{ getCurrentChainInfo() }}</div>
            @if (isScanning()) {
              <div class="progress-container">
                <div class="progress-label">
                  <span>{{ 'mining_scan_progress' | i18n }}</span>
                  <span>{{ getScanProgress() }}%</span>
                </div>
                <div class="progress-bar-sm">
                  <div class="progress-fill scanning" [style.width.%]="getScanProgress()"></div>
                </div>
              </div>
            }
          </div>

          <!-- Best Deadline Card -->
          <div class="summary-card best-deadline-card">
            <div class="card-header">
              <span class="card-title"
                ><mat-icon>timer</mat-icon>{{ 'mining_best_deadline' | i18n }}</span
              >
            </div>
            <div class="deadline-value">{{ bestDeadlineDisplay() }}</div>
            <div class="card-sub">{{ bestDeadlineInfoDisplay() }}</div>
            @if (currentRoundDeadlines().length > 0) {
              <div class="account-list">
                @for (deadline of currentRoundDeadlines(); track deadline.id) {
                  <div class="account-item">
                    <span class="account-id" [title]="deadline.account">{{
                      deadline.account
                    }}</span>
                    <span class="account-deadline">{{ formatDeadline(deadline.deadline) }}</span>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Capacity Card -->
          <div class="summary-card capacity-card">
            <div class="card-header">
              <span class="card-title"
                ><mat-icon>storage</mat-icon>{{ 'mining_capacity' | i18n }}</span
              >
              @if (miningService.isDevMode()) {
                <mat-checkbox
                  class="sim-checkbox"
                  [checked]="miningService.simulationMode()"
                  (change)="toggleSimulationMode($event.checked)"
                  [matTooltip]="'mining_sim_tooltip' | i18n"
                  >{{ 'mining_sim' | i18n }}</mat-checkbox
                >
              }
            </div>

            <!-- Upper Section: Total capacity and status -->
            <div class="capacity-upper">
              <div class="capacity-value">{{ totalPlotSize() }}</div>
              <div class="capacity-status">
                @if (isAllComplete()) {
                  <span class="status-legend">{{ 'mining_ready_for_mining' | i18n }}</span>
                } @else {
                  <span class="status-item ready"
                    ><span class="dot">●</span> {{ formatTib(getReadyTib()) }}
                    {{ 'mining_ready' | i18n | lowercase }}</span
                  >
                  <span class="status-item plotted"
                    ><span class="dot">●</span> {{ formatTib(getPlottedTib()) }}
                    {{ 'mining_plotted' | i18n | lowercase }}</span
                  >
                  <span class="status-item to-plot"
                    ><span class="dot">○</span> {{ formatTib(getToPlotTib()) }}
                    {{ 'mining_to_plot' | i18n }}</span
                  >
                }
              </div>
            </div>

            <div class="capacity-divider"></div>

            <!-- Lower Section: Plotter controls -->
            <div class="capacity-lower">
              @if (isStopping()) {
                <!-- Stopping State: Disabled button | Progress -->
                <div class="plotter-active stopping">
                  <button
                    class="btn btn-icon btn-stop"
                    disabled
                    [title]="'mining_stopping_after_batch' | i18n"
                  >
                    <span class="btn-label">{{ 'mining_stopping' | i18n }}</span>
                    <span class="btn-icon-glyph">⏳</span>
                  </button>
                  <div class="plotter-info">
                    <div class="plotter-info-row">
                      <span class="task-info">{{ 'mining_finishing_batch' | i18n }}</span>
                      <span class="speed-info">{{ getPlottingSpeed() }}</span>
                    </div>
                    <div class="progress-bar-sm">
                      <div
                        class="progress-fill stopping"
                        [style.width.%]="getPlottingProgress()"
                      ></div>
                    </div>
                  </div>
                </div>
              } @else if (isPlotting()) {
                <!-- Plotting State: Button | Progress -->
                <div class="plotter-active">
                  <button
                    class="btn btn-icon btn-stop"
                    (click)="togglePlotting()"
                    [title]="'mining_stop_plotting' | i18n"
                  >
                    <span class="btn-label">{{ 'mining_stop' | i18n }}</span>
                    <span class="btn-icon-glyph">■</span>
                  </button>
                  <div class="plotter-info">
                    <div class="plotter-info-row">
                      <span class="task-info">{{
                        'mining_task' | i18n: { current: getCurrentTask(), total: getTotalTasks() }
                      }}</span>
                      <span class="speed-info">{{ getPlottingSpeed() }}</span>
                    </div>
                    <div class="progress-bar-sm">
                      <div
                        class="progress-fill plotting"
                        [style.width.%]="getPlottingProgress()"
                      ></div>
                    </div>
                    <div class="eta-info">{{ 'mining_eta' | i18n }} {{ planEta() }}</div>
                  </div>
                </div>
              } @else if (canStartPlan() || hasQueuedDrives()) {
                <!-- Ready State: Start Button | Info -->
                <div class="plotter-idle">
                  <button
                    class="btn btn-icon btn-start"
                    (click)="togglePlotting()"
                    [title]="'mining_start_plotting' | i18n"
                  >
                    <span class="btn-label">{{ 'mining_start' | i18n }}</span>
                    <span class="btn-icon-glyph">▶</span>
                  </button>
                  <span class="queue-info">{{
                    canStartPlan()
                      ? getRemainingSize() + ' ' + ('mining_in_plan' | i18n)
                      : ('mining_ready_to_plot' | i18n) + ' ' + getQueuedSize()
                  }}</span>
                </div>
              } @else {
                <!-- Complete State: Info -->
                <div class="plotter-complete">
                  <span class="complete-info"
                    >{{ drives().length }}
                    {{
                      drives().length !== 1 ? ('mining_drives' | i18n) : ('mining_drive' | i18n)
                    }}</span
                  >
                </div>
              }
            </div>
          </div>

          <!-- Effective Capacity Card -->
          <div class="summary-card effective-capacity-card">
            <div class="card-header">
              <span class="card-title"
                ><mat-icon>trending_up</mat-icon>{{ 'mining_effective_capacity' | i18n }}</span
              >
              <span class="capacity-value">{{ calculatedEffectiveCapacity() }}</span>
            </div>
            @if (sparklineData().length > 1) {
              <div class="eff-chart-container">
                <div class="y-axis-labels">
                  @for (label of capacityYAxisLabels(); track $index) {
                    <span class="y-label">{{ label }}</span>
                  }
                </div>
                <div class="chart-area">
                  <svg viewBox="0 0 280 100" preserveAspectRatio="none" class="capacity-chart">
                    <defs>
                      <linearGradient id="capacityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:rgba(129, 199, 132, 0.3)" />
                        <stop offset="100%" style="stop-color:rgba(129, 199, 132, 0.02)" />
                      </linearGradient>
                    </defs>
                    <!-- Grid lines -->
                    @for (y of [20, 40, 60, 80]; track y) {
                      <line
                        [attr.x1]="0"
                        [attr.y1]="y"
                        [attr.x2]="280"
                        [attr.y2]="y"
                        stroke="rgba(255,255,255,0.1)"
                        stroke-width="1"
                      />
                    }
                    <!-- Chart area and line -->
                    <path [attr.d]="getCapacityAreaPath()" fill="url(#capacityGradient)" />
                    <path
                      [attr.d]="getCapacityLinePath()"
                      fill="none"
                      stroke="#81c784"
                      stroke-width="2"
                    />
                  </svg>
                  <div class="chart-labels">
                    @for (label of capacityXAxisLabels(); track $index) {
                      <span class="chart-label">{{ label }}</span>
                    }
                  </div>
                </div>
              </div>
            } @else if (sparklineData().length === 1) {
              <div class="chart-placeholder">
                <span class="single-value">{{ calculatedEffectiveCapacity() }}</span>
                <span class="placeholder-text">{{ 'mining_collecting_data' | i18n }}</span>
              </div>
            } @else {
              <div class="chart-placeholder">
                <span class="placeholder-text">{{ 'mining_no_deadline_data' | i18n }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Detail Sections: Left Stack + Right Drives -->
        <div class="detail-row">
          <!-- Left Column: Chains + Deadline History stacked -->
          <div class="left-stack">
            <!-- Chain Details -->
            <div class="section">
              <div class="section-header">
                <span class="section-title">{{ 'mining_active_chains' | i18n }}</span>
                <button
                  class="icon-btn"
                  (click)="navigateToSetup(0)"
                  [title]="'mining_configure_chains' | i18n"
                >
                  <mat-icon>link</mat-icon>
                </button>
              </div>
              <div class="section-content">
                <table class="chains-table">
                  <thead>
                    <tr>
                      <th>{{ 'mining_chain' | i18n }}</th>
                      <th>{{ 'height' | i18n }}</th>
                      <th>{{ 'difficulty' | i18n }}</th>
                      <th>{{ 'mining_pow_scale' | i18n }}</th>
                      <th>{{ 'status' | i18n }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (chain of enabledChains(); track chain.name) {
                      <tr>
                        <td
                          [matTooltip]="getChainTooltip(chain.name)"
                          matTooltipClass="chain-tooltip"
                        >
                          {{ chain.name }}
                        </td>
                        <td>{{ getChainHeight(chain.name) }}</td>
                        <td>{{ getChainDifficulty(chain.name) }}</td>
                        <td>{{ getChainCompression(chain.name) }}</td>
                        <td>
                          <span class="status-dot" [class]="getChainStatusClass(chain.name)"></span
                          >{{ getChainStatus(chain.name) }}
                        </td>
                      </tr>
                    }
                    @if (enabledChains().length === 0) {
                      <tr>
                        <td colspan="5" class="empty-row">
                          {{ 'mining_no_chains_configured' | i18n }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Best Deadline History -->
            <div class="section deadline-history-section">
              <div class="section-header">
                <span class="section-title">{{ 'mining_best_deadline_history' | i18n }}</span>
                <div class="header-actions">
                  <div class="chain-filter">
                    <select [ngModel]="chainFilter()" (ngModelChange)="chainFilter.set($event)">
                      <option value="all">{{ 'mining_all_chains' | i18n }}</option>
                      @for (chain of enabledChains(); track chain.name) {
                        <option [value]="chain.name">{{ chain.name }}</option>
                      }
                    </select>
                  </div>
                  <button
                    class="export-btn"
                    (click)="exportCSV()"
                    [title]="'mining_export_to_csv' | i18n"
                  >
                    {{ 'mining_export_csv' | i18n }}
                  </button>
                </div>
              </div>
              <div class="section-content">
                <table class="deadline-table">
                  <thead>
                    <tr>
                      <th>{{ 'time' | i18n }}</th>
                      <th>{{ 'block_height' | i18n }}</th>
                      <th>{{ 'mining_chain' | i18n }}</th>
                      <th>{{ 'account' | i18n }}</th>
                      <th>{{ 'mining_best_deadline' | i18n }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (deadline of filteredDeadlines(); track deadline.id) {
                      <tr>
                        <td class="time-col">{{ formatTime(deadline.timestamp) }}</td>
                        <td>#{{ deadline.height.toLocaleString() }}</td>
                        <td>{{ deadline.chainName }}</td>
                        <td class="account-col" [title]="deadline.account">
                          {{ deadline.account }}
                        </td>
                        <td class="deadline-col">
                          {{ formatDeadline(deadline.deadline) }}
                        </td>
                      </tr>
                    }
                    @if (filteredDeadlines().length === 0) {
                      <tr>
                        <td colspan="5" class="empty-row">
                          {{ 'mining_no_deadlines_found' | i18n }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Right Column: Drives -->
          <div class="right-column">
            <div class="section drives-section">
              <div class="section-header">
                <span class="section-title">{{ 'mining_drives_title' | i18n }}</span>
                <div class="header-buttons">
                  @if (hasActivePlan()) {
                    <button
                      class="icon-btn"
                      (click)="openPlanViewer()"
                      [title]="'mining_plot_plan' | i18n"
                    >
                      <mat-icon>assignment</mat-icon>
                    </button>
                  }
                  <button
                    class="icon-btn"
                    (click)="refreshDriveStats()"
                    [title]="'mining_refresh_drive_stats' | i18n"
                  >
                    <mat-icon>refresh</mat-icon>
                  </button>
                  <button
                    class="icon-btn"
                    (click)="navigateToSetup(1)"
                    [title]="'mining_plotter_settings' | i18n"
                  >
                    <mat-icon>memory</mat-icon>
                  </button>
                  <button
                    class="icon-btn"
                    (click)="navigateToSetup(2)"
                    [title]="'mining_drive_settings' | i18n"
                  >
                    <mat-icon>storage</mat-icon>
                  </button>
                </div>
              </div>
              <div class="section-content">
                <table>
                  <thead>
                    <tr>
                      <th>{{ 'mining_path' | i18n }}</th>
                      <th>{{ 'status' | i18n }}</th>
                      <th>{{ 'mining_plotted' | i18n }}</th>
                      <th>{{ 'mining_allocated' | i18n }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (drive of drives(); track drive.path) {
                      <tr>
                        <td>{{ drive.path }}</td>
                        <td>
                          <span class="status-dot" [class]="getDriveStatusClass(drive)"></span
                          >{{ getDriveStatus(drive) }}
                        </td>
                        <td>
                          @if (isDrivePlotting(drive)) {
                            <div class="mini-progress-wrapper">
                              <div class="mini-progress">
                                <div
                                  class="fill plotting"
                                  [style.width.%]="getDrivePlottingProgress(drive)"
                                ></div>
                              </div>
                              <span>{{ getDrivePlottedSize(drive) }}</span>
                            </div>
                          } @else {
                            {{ getDrivePlottedSize(drive) }}
                          }
                        </td>
                        <td>{{ formatDriveSize(drive.allocatedGib) }}</td>
                      </tr>
                    }
                    @if (drives().length === 0) {
                      <tr>
                        <td colspan="4" class="empty-row">
                          {{ 'mining_no_drives_configured' | i18n }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="section activity-section">
          <div class="section-header">
            <span class="section-title">{{ 'mining_recent_activity' | i18n }}</span>
            <div class="log-filters">
              <button
                class="log-filter"
                [class.active]="logFilters().all"
                (click)="toggleLogFilter('all')"
              >
                {{ 'all' | i18n }}
              </button>
              <button
                class="log-filter"
                [class.active]="logFilters().info"
                data-filter="info"
                (click)="toggleLogFilter('info')"
              >
                {{ 'info' | i18n }}
              </button>
              <button
                class="log-filter"
                [class.active]="logFilters().warn"
                data-filter="warn"
                (click)="toggleLogFilter('warn')"
              >
                {{ 'warning' | i18n }}
              </button>
              <button
                class="log-filter"
                [class.active]="logFilters().error"
                data-filter="error"
                (click)="toggleLogFilter('error')"
              >
                {{ 'error' | i18n }}
              </button>
            </div>
          </div>
          <div class="section-content">
            <div class="activity-log">
              @for (log of activityLogs(); track log.id) {
                <div class="log-entry">
                  <span class="log-time">{{ formatTime(log.timestamp) }}</span>
                  <span class="log-message" [class]="log.type">{{ log.message }}</span>
                </div>
              }
              @if (activityLogs().length === 0) {
                <div class="log-entry">
                  <span class="log-time">--:--:--</span>
                  <span class="log-message">{{ 'mining_no_activity_yet' | i18n }}</span>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- First-run overlay -->
        @if (showFirstRun()) {
          <div class="overlay show">
            <div class="first-run-card">
              <h2>{{ 'mining_welcome' | i18n }}</h2>
              <p>{{ 'mining_welcome_message' | i18n }}</p>
              <button class="btn btn-primary" [routerLink]="setupRoute()">
                {{ 'mining_get_started' | i18n }}
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .dashboard {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        min-height: 0;
      }

      .main-content {
        flex: 1;
        padding: 16px;
        overflow-y: auto; /* Allow scrolling when content exceeds viewport */
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        gap: 12px;
        position: relative;
        min-height: 0; /* Allow flex children to shrink */
      }

      /* Always show scrollbar when content overflows */
      .main-content::-webkit-scrollbar {
        width: 8px;
      }

      .main-content::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 4px;
      }

      .main-content::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.3);
        border-radius: 4px;
      }

      .main-content::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.5);
      }

      /* Mobile/small screens: ensure content has intrinsic height for scrolling */
      @media (max-height: 700px) {
        .main-content {
          display: block; /* Switch from flex to block for proper scroll behavior */
          padding: 16px;
        }

        .main-content > * {
          margin-bottom: 12px;
        }

        .main-content > *:last-child {
          margin-bottom: 0;
        }
      }

      /* Mobile width: switch to block layout for proper stacking */
      @media (max-width: 900px) {
        .main-content {
          display: block;
          padding: 12px;
        }

        .main-content > * {
          margin-bottom: 12px;
        }

        .main-content > *:last-child {
          margin-bottom: 0;
        }
      }

      /* Summary Cards Grid */
      .summary-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        flex-shrink: 0;
        min-height: fit-content; /* Ensure cards don't collapse */
      }

      @media (max-width: 1100px) {
        .summary-cards {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 600px) {
        .summary-cards {
          grid-template-columns: 1fr;
        }
      }

      .summary-card {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        position: relative;
        min-height: 100px; /* Prevent cards from collapsing */
        min-width: 0; /* Allow cards to shrink in grid */
      }

      .summary-card .card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 10px;
      }

      .summary-card .card-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.7);
      }

      .summary-card .card-title mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: rgba(255, 255, 255, 0.7);
      }

      .sim-checkbox {
        position: absolute;
        right: 0;
        top: 0;
        font-size: 11px;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        line-height: 1 !important;
      }

      .sim-checkbox ::ng-deep {
        .mdc-form-field {
          height: auto !important;
        }

        .mdc-form-field > label {
          color: rgba(255, 255, 255, 0.8) !important;
          font-size: 11px;
          letter-spacing: 0.5px;
          padding-left: 4px !important;
        }

        .mdc-checkbox {
          padding: 0 !important;
          margin: 0 !important;
          width: 16px !important;
          height: 16px !important;
        }

        .mdc-checkbox__background {
          border-color: rgba(255, 255, 255, 0.6) !important;
          width: 14px !important;
          height: 14px !important;
          top: 1px !important;
          left: 1px !important;
        }

        .mdc-checkbox--selected .mdc-checkbox__background {
          background-color: #4caf50 !important;
          border-color: #4caf50 !important;
        }
      }

      .capacity-card .card-header {
        position: relative;
      }

      .summary-card .card-sub {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        margin-top: 4px;
      }

      /* Mining Status Card */
      .mining-status-card .status-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      .status-indicator {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-indicator.active {
        background: #4caf50;
        box-shadow: 0 0 8px #4caf50;
        animation: pulse 2s infinite;
      }
      .status-indicator.scanning {
        background: #42a5f5;
        box-shadow: 0 0 8px #42a5f5;
      }
      .status-indicator.stopped {
        background: #9e9e9e;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.6;
        }
      }

      .status-text {
        font-size: 14px;
        font-weight: 500;
        color: #ffffff;
      }

      .btn {
        padding: 8px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-start {
        background: #4caf50;
        color: white;
      }

      .btn-start:hover {
        background: #43a047;
      }

      .btn-stop {
        background: #d32f2f;
        color: white;
      }

      .btn-stop:hover {
        background: #c62828;
      }

      .btn-icon {
        padding: 4px 10px;
        margin-left: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        gap: 2px;
      }

      .btn-label {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .btn-icon-glyph {
        font-size: 14px;
        line-height: 1;
      }

      .progress-container {
        margin-top: 8px;
      }

      .progress-label {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 4px;
      }

      .progress-bar-sm {
        height: 5px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s;
      }

      .progress-fill.scanning {
        background: linear-gradient(90deg, #42a5f5, #1976d2);
      }
      .progress-fill.plotting {
        background: linear-gradient(90deg, #ff9800, #e65100);
      }
      .progress-fill.stopping {
        background: linear-gradient(90deg, #ff5722, #d84315);
      }

      /* Best Deadline Card */
      .best-deadline-card .deadline-value {
        font-size: 28px;
        font-weight: 700;
        color: #81c784;
      }

      .account-list {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.15);
      }

      .account-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
        font-size: 10px;
      }

      .account-id {
        font-family: 'Consolas', monospace;
        color: #64b5f6;
        word-break: break-all;
        flex: 1;
        min-width: 0;
      }

      .account-deadline {
        font-weight: 500;
        color: #81c784;
        flex-shrink: 0;
        margin-left: 8px;
      }

      /* Capacity Card */
      .capacity-card {
        display: flex;
        flex-direction: column;
      }

      .capacity-upper {
        padding-bottom: 8px;
      }

      .capacity-value {
        font-size: 26px;
        font-weight: 600;
        color: #81c784;
        line-height: 1.2;
      }

      .capacity-status {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 6px;
      }

      .status-item {
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .status-item .dot {
        font-size: 10px;
      }

      .status-item.ready {
        color: #81c784;
      }
      .status-item.plotted {
        color: #4fc3f7;
      }
      .status-item.to-plot {
        color: rgba(255, 255, 255, 0.5);
      }

      .status-legend {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
      }

      .capacity-divider {
        height: 1px;
        background: rgba(255, 255, 255, 0.15);
        margin: 8px 0;
      }

      .capacity-lower {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      /* Plotter Active State (plotting) */
      .plotter-active {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
      }

      .plotter-info {
        flex: 1;
        min-width: 0;
      }

      .plotter-info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }

      .task-info {
        font-size: 11px;
        color: #ffffff;
        font-weight: 500;
      }

      .speed-info {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.7);
      }

      .eta-info {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 4px;
      }

      /* Plotter Idle State (queued) */
      .plotter-idle {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
      }

      .queue-info {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.8);
        flex: 1;
      }

      /* Plotter Complete State */
      .plotter-complete {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
      }

      .complete-info {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.6);
        flex: 1;
      }

      .header-buttons {
        display: flex;
        gap: 4px;
      }

      .icon-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: rgba(255, 255, 255, 0.8);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .icon-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }

      .icon-btn mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      /* Effective Capacity Card */
      .effective-capacity-card {
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .capacity-value {
          font-size: 16px;
          font-weight: 600;
          color: #81c784;
        }
      }

      .eff-chart-container {
        display: flex;
        flex-direction: row;
        min-height: 80px;
        gap: 4px;
        margin-top: 8px;
        padding: 0 8px 0 0; /* Add right padding to balance y-axis labels */

        .y-axis-labels {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 2px 0;
          width: 28px; /* Fixed width, just enough for labels like "2.5T" */
          flex-shrink: 0;

          .y-label {
            font-size: 9px;
            color: rgba(255, 255, 255, 0.5);
            text-align: right;
            line-height: 1;
          }
        }

        .chart-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;

          .capacity-chart {
            flex: 1;
            width: 100%;
            min-height: 60px;
          }

          .chart-labels {
            display: flex;
            justify-content: space-between;
            padding: 2px 0 0 0;

            .chart-label {
              font-size: 9px;
              color: rgba(255, 255, 255, 0.5);
            }
          }
        }
      }

      .chart-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 80px;
        margin-top: 8px;

        .single-value {
          font-size: 24px;
          font-weight: 600;
          color: #81c784;
        }

        .placeholder-text {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 4px;
        }
      }

      /* Detail Sections Row - Two Column Layout aligned with summary cards */
      .detail-row {
        display: grid;
        grid-template-columns: 1fr 1fr; /* Match 2+2 of 4-column summary cards */
        gap: 16px; /* Same gap as summary-cards */
        flex: 5; /* Take 5x space compared to activity section's 3x */
        flex-shrink: 0; /* Don't shrink below min-height */
        min-height: 250px; /* Minimum height for detail sections */
      }

      .left-stack {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }

      .left-stack .section:first-child {
        flex: 2; /* Active Chains: 40% */
        min-height: 120px;
      }

      .left-stack .deadline-history-section {
        flex: 3; /* Best Deadline: 60% */
        min-height: 150px;
      }

      .right-column {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .right-column .drives-section {
        flex: 1;
        min-height: 150px;
      }

      @media (max-width: 900px) {
        .detail-row {
          grid-template-columns: 1fr;
          gap: 12px;
        }

        /* On mobile, stack left-stack sections and drives vertically */
        .left-stack {
          order: 1;
        }

        .right-column {
          order: 2;
        }

        /* Ensure sections have proper height when stacked */
        .left-stack .section:first-child {
          min-height: 140px;
          max-height: 200px;
        }

        .left-stack .deadline-history-section {
          min-height: 180px;
          max-height: 280px;
        }

        .right-column .drives-section {
          min-height: 150px;
          max-height: 250px;
        }
      }

      /* Small screens: use fixed heights instead of flex ratios */
      @media (max-height: 700px) {
        .detail-row {
          flex: none;
          min-height: auto;
        }

        .left-stack .section:first-child {
          flex: none;
          height: 150px;
          min-height: 150px;
        }

        .left-stack .deadline-history-section {
          flex: none;
          height: 200px;
          min-height: 200px;
        }

        .right-column .drives-section {
          flex: none;
          height: 200px;
          min-height: 200px;
        }
      }

      .section {
        background: #ffffff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        flex-shrink: 0;
      }

      .section-title {
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #ffffff;
      }

      .section-content {
        padding: 10px 14px;
        flex: 1;
        overflow-y: auto;
        overflow-x: auto; /* Allow horizontal scroll for tables on small screens */
      }

      table {
        width: 100%;
        min-width: 300px; /* Minimum width to prevent column collapse */
        border-collapse: collapse;
      }

      /* Fixed column widths for Active Chains table */
      table.chains-table {
        table-layout: fixed;
      }

      table.chains-table th:nth-child(1) {
        width: 35%;
      } /* Chain */
      table.chains-table th:nth-child(2) {
        width: 15%;
      } /* Height */
      table.chains-table th:nth-child(3) {
        width: 15%;
      } /* Difficulty */
      table.chains-table th:nth-child(4) {
        width: 15%;
      } /* PoW Scale */
      table.chains-table th:nth-child(5) {
        width: 20%;
      } /* Status */

      th {
        text-align: left;
        padding: 5px 6px;
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgb(0, 35, 65);
        border-bottom: 1px solid #e0e0e0;
      }

      td {
        padding: 5px 6px;
        font-size: 11px;
        border-bottom: 1px solid #f0f0f0;
        color: rgb(0, 35, 65);
      }

      tr:last-child td {
        border-bottom: none;
      }

      .empty-row {
        text-align: center;
        color: #888;
        padding: 16px !important;
      }

      .status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-right: 5px;
      }

      .status-dot.active {
        background: #4caf50;
        box-shadow: 0 0 4px #4caf50;
      }
      .status-dot.plotting {
        background: #ff9800;
        box-shadow: 0 0 4px #ff9800;
      }
      .status-dot.stopping {
        background: #ff5722;
        box-shadow: 0 0 4px #ff5722;
      }
      .status-dot.queued {
        background: #9e9e9e;
      }
      .status-dot.scanning {
        background: #42a5f5;
        box-shadow: 0 0 4px #42a5f5;
      }
      .status-dot.ready {
        background: #4caf50;
      }

      .mini-progress-wrapper {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .mini-progress {
        width: 40px;
        height: 4px;
        background: #e0e0e0;
        border-radius: 2px;
        overflow: hidden;
      }

      .mini-progress .fill {
        height: 100%;
        border-radius: 2px;
      }

      .mini-progress .fill.plotting {
        background: #ff9800;
      }

      /* Deadline History */
      .deadline-history-section .section-content {
        overflow-y: auto;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .chain-filter select {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #ffffff;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
      }

      .chain-filter select option {
        background: #1e3a5f;
        color: #ffffff;
      }

      .export-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.9);
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 10px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .export-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .deadline-table .time-col {
        font-family: 'Consolas', monospace;
        color: #888888;
        font-size: 10px;
      }

      .deadline-table .account-col {
        font-family: 'Consolas', monospace;
        color: #1565c0;
        font-size: 10px;
        word-break: break-all;
        max-width: 280px;
      }

      .deadline-table .deadline-col {
        font-weight: 500;
      }

      /* Activity Section */
      .activity-section {
        flex: 3; /* Take 3x space compared to detail-row's 5x (~37.5%) */
        flex-shrink: 0; /* Don't shrink below min-height */
        min-height: 120px;
        position: relative;
        z-index: 1;
      }

      /* Small screens: fixed height for activity */
      @media (max-height: 700px) {
        .activity-section {
          flex: none;
          height: 150px;
          min-height: 150px;
        }
      }

      /* Mobile: ensure activity section doesn't overlap */
      @media (max-width: 900px) {
        .activity-section {
          flex: none;
          min-height: 140px;
          max-height: 200px;
          margin-top: 4px;
        }
      }

      .activity-section .section-content {
        overflow-y: auto;
      }

      /* Drives section scrollable */
      .drives-section .section-content {
        overflow-y: auto;
      }

      .log-filters {
        display: flex;
        gap: 4px;
      }

      .log-filter {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: rgba(255, 255, 255, 0.5);
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .log-filter:hover {
        background: rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.8);
      }

      .log-filter.active {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }

      .log-filter[data-filter='info'].active {
        background: rgba(100, 181, 246, 0.3);
        color: #64b5f6;
      }

      .log-filter[data-filter='warn'].active {
        background: rgba(255, 183, 77, 0.3);
        color: #ffb74d;
      }

      .log-filter[data-filter='error'].active {
        background: rgba(229, 115, 115, 0.3);
        color: #e57373;
      }

      .activity-log {
        flex: 1;
        overflow-y: auto;
        max-height: 200px;
      }

      .log-entry {
        display: flex;
        gap: 10px;
        padding: 4px 0;
        font-size: 11px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .log-entry:last-child {
        border-bottom: none;
      }

      .log-time {
        color: #888888;
        font-family: 'Consolas', monospace;
        min-width: 55px;
        font-size: 11px;
      }

      .log-message {
        color: #999999;
        font-family: 'Consolas', monospace;
      }

      .log-message.info {
        color: #999999;
      }
      .log-message.warn {
        color: #ffb74d;
      }
      .log-message.warning {
        color: #ffb74d;
      }
      .log-message.error {
        color: #e57373;
      }

      /* First-run overlay */
      .overlay {
        display: none;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 100;
        justify-content: center;
        align-items: center;
      }

      .overlay.show {
        display: flex;
      }

      .first-run-card {
        background: #ffffff;
        border-radius: 12px;
        padding: 32px;
        max-width: 450px;
        text-align: center;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      }

      .first-run-card h2 {
        font-size: 22px;
        font-weight: 500;
        margin-bottom: 10px;
        color: rgb(0, 35, 65);
      }

      .first-run-card p {
        color: #666666;
        margin-bottom: 20px;
        line-height: 1.5;
        font-size: 14px;
      }

      .btn-primary {
        background: #1976d2;
        color: white;
      }

      .btn-primary:hover {
        background: #1565c0;
      }

      /* Chain tooltip styling - needs ::ng-deep for Material overlay */
      ::ng-deep .chain-tooltip {
        white-space: pre-line;
        font-family: 'Consolas', monospace;
        font-size: 11px;
        max-width: 500px;
      }
    `,
  ],
})
export class MiningDashboardComponent implements OnInit, OnDestroy {
  readonly miningService = inject(MiningService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);
  private readonly appMode = inject(AppModeService);

  /** Setup route path - differs between wallet mode and mining-only mode */
  readonly setupRoute = computed(() =>
    this.appMode.isMiningOnly() ? '/miner/setup' : '/mining/setup'
  );

  readonly miningStatus = signal<MiningStatus | null>(null);
  readonly plottingStatus = signal<PlottingStatus | null>(null);
  // Use service signals directly for real-time miner event updates
  readonly recentDeadlines = this.miningService.minerDeadlines;
  readonly currentBlock = this.miningService.minerCurrentBlock;
  readonly configured = signal(false);
  readonly stateLoaded = signal(false);
  readonly enabledChains = signal<ChainConfig[]>([]);
  readonly drives = signal<DriveConfig[]>([]);
  /** Android storage permission state */
  readonly hasStoragePermission = signal(true);
  // Activity logs from service (survives navigation, auto-cleanup > 1 day)
  private readonly _allActivityLogs = this.miningService.activityLogs;

  // Log filter state (reactive)
  readonly logFilters = signal({ all: true, info: true, warn: true, error: true });

  // Map log types to filter categories
  private readonly LOG_TYPE_TO_CATEGORY: Record<string, string> = {
    info: 'info',
    warn: 'warn',
    warning: 'warn', // Alias for consistency
    error: 'error',
  };

  // Filtered activity logs
  readonly activityLogs = computed(() => {
    const filters = this.logFilters();
    const logs = this._allActivityLogs();

    // If 'all' is active, show everything
    if (filters.all) {
      return logs;
    }

    // Filter based on category
    return logs.filter(log => {
      const category = this.LOG_TYPE_TO_CATEGORY[log.type] || 'info';
      return (filters as Record<string, boolean>)[category] ?? true;
    });
  });

  readonly totalPlotSize = signal('0 GiB');
  readonly readySize = signal('0 GiB');
  readonly pendingFiles = signal(0);
  // Use service's cache directly so updates propagate automatically
  readonly driveInfos = this.miningService.driveInfoCache;

  // Plot plan computed values from service
  readonly plotPlan = this.miningService.plotPlan;
  readonly planStats = this.miningService.planStats;
  readonly planEta = this.miningService.planEta;

  // Effective capacity from service cache (survives navigation)
  readonly sparklineData = this.miningService.capacityHistory;
  readonly calculatedEffectiveCapacity = this.miningService.effectiveCapacityFormatted;

  // Chart axis labels
  readonly capacityYAxisLabels = computed(() => {
    const data = this.sparklineData();
    if (data.length < 2) return [];

    const capacities = data.map(d => d.capacity);
    const min = Math.min(...capacities);
    const max = Math.max(...capacities);
    const range = max - min || 0.1;

    return [
      this.formatCapacityShort(max),
      this.formatCapacityShort(min + range * 0.5),
      this.formatCapacityShort(min),
    ];
  });

  readonly capacityXAxisLabels = computed(() => {
    const data = this.sparklineData();
    if (data.length < 2) return [];

    // Use actual timestamps from deadline history
    const oldestTs = data[0].timestamp;
    const newestTs = data[data.length - 1].timestamp;
    const totalMs = newestTs - oldestTs;

    const formatTimeAgo = (ms: number): string => {
      const minutes = Math.round(ms / 60000);
      if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
      if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
      if (minutes > 0) return `${minutes}m`;
      return 'Now';
    };

    const oldest = formatTimeAgo(totalMs);
    const middle = formatTimeAgo(Math.round(totalMs / 2));

    if (data.length <= 10) return [oldest, 'Now'];
    return [oldest, middle, 'Now'];
  });

  // Latest best deadline = first entry in recentDeadlines (most recent)
  // Same data source as history table - O(1) read
  readonly latestBestDeadline = computed(() => {
    const deadlines = this.recentDeadlines();
    return deadlines.length > 0 ? deadlines[0] : null;
  });

  // Current round deadlines for account list (one per chain)
  // Only check first ~10 entries since current round is always at front
  readonly currentRoundDeadlines = computed(() => {
    const deadlines = this.recentDeadlines();
    const blocks = this.currentBlock();
    return deadlines.slice(0, 10).filter(d => {
      const block = blocks[d.chainName];
      return block && d.height === block.height;
    });
  });

  // Formatted best deadline value for display
  readonly bestDeadlineDisplay = computed(() => {
    const best = this.latestBestDeadline();
    if (!best) return '--';
    return this.formatDeadline(best.deadline);
  });

  // Best deadline info line
  readonly bestDeadlineInfoDisplay = computed(() => {
    const best = this.latestBestDeadline();
    if (!best) return this.i18n.get('mining_no_deadlines_this_round');
    return `${best.chainName} • ${this.i18n.get('block')} ${best.height.toLocaleString()}`;
  });

  readonly chainFilter = signal('all');

  // Filtered deadlines - computed for proper memoization (not recalced on every CD cycle)
  readonly filteredDeadlines = computed(() => {
    const all = this.recentDeadlines();
    const filter = this.chainFilter();
    if (filter === 'all') return all;
    return all.filter(d => d.chainName === filter);
  });

  async ngOnInit(): Promise<void> {
    // Check storage permission on Android (required before accessing plot files)
    if (this.appMode.isMobile()) {
      await this.checkStoragePermission();
    }

    // Load initial state once (config, drives, etc.)
    await this.loadState();
    // Load drive stats once on init
    await this.loadDriveStats();

    // Initialize plotting (first start flow - generates plan if needed)
    await this.miningService.initializePlotting();

    // Initialize mining (recovers listeners if miner already running)
    await this.miningService.initializeMining();

    // Ensure service is listening to plotter events (idempotent)
    if (this.miningService.plotterRunning()) {
      await this.miningService.setupPlotterEventListeners();
    }
    // No polling needed - all updates come through Tauri event listeners
    // which update service signals (minerDeadlines, minerCurrentBlock, etc.)
  }

  ngOnDestroy(): void {
    // No polling to clean up - event listeners are managed by MiningService
  }

  private async loadState(): Promise<void> {
    try {
      const state = await this.miningService.getState();
      this.miningStatus.set(state.miningStatus);

      // plottingStatus type comes from backend, progress/speed come from service's
      // global plottingProgress signal (updated by event listeners).
      // Use backend for type and filePath, but getPlottingProgress/getPlottingSpeed
      // read from the service's global state.
      this.plottingStatus.set(state.plottingStatus);

      // Note: recentDeadlines and currentBlock now read from service's miner event signals
      // (minerDeadlines, minerCurrentBlock) for real-time updates instead of polling
      this.configured.set(state.isConfigured);

      if (state.config) {
        this.enabledChains.set((state.config.chains || []).filter(c => c.enabled));
        this.drives.set(state.config.drives || []);

        // Calculate totals from cached driveInfos (no scanning during poll)
        let totalAllocated = 0;
        for (const drive of state.config.drives || []) {
          totalAllocated += drive.allocatedGib;
        }
        this.totalPlotSize.set(this.formatSize(totalAllocated));
      }

      this.stateLoaded.set(true);
    } catch (error) {
      console.error('Failed to load mining state:', error);
      this.stateLoaded.set(true); // Still mark as loaded even on error
    }
  }

  /**
   * Load drive stats from service cache (scanned once, not on every navigation).
   */
  private async loadDriveStats(): Promise<void> {
    await this.miningService.ensureDriveInfoLoaded();
    this.updateDriveStatsFromCache();
  }

  /**
   * Update local stats from service cache.
   */
  private updateDriveStatsFromCache(): void {
    const driveInfoMap = this.miningService.driveInfoCache();
    let totalPlotted = 0;
    let pendingCount = 0;

    for (const drive of this.drives()) {
      const info = driveInfoMap.get(drive.path);
      if (info) {
        totalPlotted += info.completeSizeGib;
        const remaining = drive.allocatedGib - info.completeSizeGib - info.incompleteSizeGib;
        if (remaining > 0) pendingCount++;
      }
    }

    this.readySize.set(this.formatSize(totalPlotted));
    // Note: effectiveCapacity is now calculated from deadline history (not plotted size)
    this.pendingFiles.set(pendingCount);
  }

  /**
   * Manual refresh of all drive stats and regenerate plan if needed.
   */
  async refreshDriveStats(): Promise<void> {
    this.miningService.invalidateDriveCache();
    await this.loadDriveStats();
    await this.miningService.refreshPlotterState();
  }

  private formatSize(gib: number): string {
    if (gib >= 1024) {
      return `${(gib / 1024).toFixed(1)} TiB`;
    }
    return `${gib.toFixed(0)} GiB`;
  }

  showFirstRun(): boolean {
    // Only show after state is loaded and if not configured
    return this.stateLoaded() && !this.configured();
  }

  isRunning(): boolean {
    // Use event-driven state for instant UI updates (no polling needed)
    return this.miningService.minerRunning();
  }

  isScanning(): boolean {
    // Use event-driven state for real-time updates
    if (!this.miningService.minerRunning()) return false;
    const scanProgress = this.miningService.minerScanProgress();
    return scanProgress.progress > 0 && scanProgress.progress < 100;
  }

  getStatusIndicatorClass(): string {
    // Use event-driven state for real-time updates
    if (!this.miningService.minerRunning()) {
      return 'stopped';
    }
    const scanProgress = this.miningService.minerScanProgress();
    if (scanProgress.progress > 0 && scanProgress.progress < 100) {
      return 'scanning';
    }
    return 'active';
  }

  getStatusText(): string {
    // Use event-driven state for real-time updates
    if (!this.miningService.minerRunning()) {
      return this.i18n.get('mining_stopped');
    }
    const scanProgress = this.miningService.minerScanProgress();
    if (scanProgress.progress > 0 && scanProgress.progress < 100) {
      return this.i18n.get('mining_scanning_plots');
    }
    return this.i18n.get('mining_active');
  }

  getCurrentChainInfo(): string {
    // Use event-driven state for real-time updates
    const scanProgress = this.miningService.minerScanProgress();
    if (this.miningService.minerRunning() && scanProgress.chain) {
      return `${scanProgress.chain} • Block ${scanProgress.height?.toLocaleString()}`;
    }
    const chains = this.enabledChains();
    if (chains.length > 0) {
      return this.i18n.get('mining_chains_configured', { count: chains.length });
    }
    return this.i18n.get('mining_no_chains_configured');
  }

  getScanProgress(): number {
    // Use event-driven state for real-time updates
    const scanProgress = this.miningService.minerScanProgress();
    return Math.round(scanProgress.progress);
  }

  formatDeadline(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
  }

  /**
   * Format capacity value for Y-axis labels (short format)
   * e.g., 2.5T, 500G, 100M
   */
  formatCapacityShort(tib: number): string {
    if (tib >= 1) {
      return `${tib.toFixed(1)}T`;
    }
    const gib = tib * 1024;
    if (gib >= 1) {
      return `${gib.toFixed(0)}G`;
    }
    const mib = gib * 1024;
    return `${mib.toFixed(0)}M`;
  }

  /**
   * Generate SVG path for effective capacity line with bezier curves.
   * SVG viewBox is 0 0 280 100, with data area from y=10 to y=90
   */
  getCapacityLinePath(): string {
    const data = this.sparklineData();
    if (data.length < 2) return '';

    const width = 280;
    const minY = 10;
    const maxY = 90;
    const dataRange = maxY - minY;

    // Find min/max for scaling
    const capacities = data.map(d => d.capacity);
    const min = Math.min(...capacities);
    const max = Math.max(...capacities);
    const range = max - min || 0.1; // Avoid division by zero

    // Calculate points
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      // Invert Y because SVG Y increases downward
      const y = maxY - ((d.capacity - min) / range) * dataRange;
      return { x, y };
    });

    // Generate bezier curve path (matching main dashboard style)
    const tension = 0.3;
    let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      // Control points for cubic bezier
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }

    return path;
  }

  /**
   * Generate SVG path for effective capacity area fill with bezier curves.
   * Extends the line path to close the area at the bottom.
   */
  getCapacityAreaPath(): string {
    const linePath = this.getCapacityLinePath();
    if (!linePath) return '';

    const data = this.sparklineData();
    const width = 280;
    const bottomY = 100;

    // Get the last X coordinate (should be width)
    const lastX = ((data.length - 1) / (data.length - 1)) * width;

    // Close the path by going to bottom-right, bottom-left, then back to start
    return `${linePath} L${lastX.toFixed(1)},${bottomY} L0,${bottomY} Z`;
  }

  getPlottingSpeed(): string {
    // Use the service's global plotting progress (persists across navigation)
    const progress = this.miningService.plottingProgress();
    if (progress.speedMibS > 0) {
      return `${progress.speedMibS.toFixed(0)} MiB/s`;
    }
    return '';
  }

  getPlottingProgress(): number {
    // Use the service's global plotting progress (persists across navigation)
    return this.miningService.plottingProgress().progress;
  }

  getChainHeight(chainName: string): string {
    const block = this.currentBlock()[chainName];
    return block ? block.height.toLocaleString() : '--';
  }

  getChainDifficulty(chainName: string): string {
    const block = this.currentBlock()[chainName];
    if (!block) return '--';

    // Look up chain config to get blockTimeSeconds
    const chain = this.enabledChains().find(c => c.name === chainName);
    if (!chain) return '--';

    const capacityTib = calculateNetworkCapacityTib(block.baseTarget, chain.blockTimeSeconds);
    return formatCapacity(capacityTib);
  }

  getChainStatusClass(chainName: string): string {
    // Use miner event signals for real-time status
    if (!this.miningService.minerRunning()) {
      return 'queued'; // Miner not running
    }

    const scanProgress = this.miningService.minerScanProgress();
    if (
      scanProgress.chain === chainName &&
      scanProgress.progress < 100 &&
      scanProgress.totalWarps > 0
    ) {
      return 'scanning';
    }

    // Check if chain is in queue
    const queue = this.miningService.minerQueue();
    if (queue.some(q => q.chain === chainName)) {
      return 'queued';
    }

    return 'active'; // Ready for mining
  }

  getChainStatus(chainName: string): string {
    // Use miner event signals for real-time status
    if (!this.miningService.minerRunning()) {
      return this.i18n.get('mining_stopped');
    }

    const scanProgress = this.miningService.minerScanProgress();
    if (
      scanProgress.chain === chainName &&
      scanProgress.progress < 100 &&
      scanProgress.totalWarps > 0
    ) {
      return this.i18n.get('mining_scanning', { percent: scanProgress.progress.toFixed(0) });
    }

    // Check if chain is in queue
    const queue = this.miningService.minerQueue();
    if (queue.some(q => q.chain === chainName)) {
      return this.i18n.get('mining_queued');
    }

    return this.i18n.get('mining_ready');
  }

  getChainCompression(chainName: string): string {
    const block = this.currentBlock()[chainName];
    return block?.compressionRange || '--';
  }

  getChainTooltip(chainName: string): string {
    const block = this.currentBlock()[chainName];
    if (!block) return '';

    return `${this.i18n.get('gen_sig')}: ${block.genSig}\n${this.i18n.get('base_target')}: ${block.baseTarget}\n${this.i18n.get('scoop')}: ${block.scoop}`;
  }

  /**
   * Get drive status class for styling.
   * - ready: Drive is fully plotted, ready for mining
   * - plotting: Drive is currently being plotted
   * - stopping: Drive is finishing before stop
   * - queued: Drive needs more plotting before mining
   */
  getDriveStatusClass(drive: DriveConfig): string {
    if (this.isDrivePlotting(drive)) {
      if (this.miningService.plotterUIState() === 'stopping') return 'stopping';
      return 'plotting';
    }
    if (this.isDriveReady(drive)) return 'ready';
    return 'queued';
  }

  /**
   * Get human-readable drive status.
   * Ready = will be in mining
   * Plotting = currently being plotted
   * Stopping = finishing current task before stopping
   * Queued = not yet mining, needs more plotting
   */
  getDriveStatus(drive: DriveConfig): string {
    if (this.isDrivePlotting(drive)) {
      // Show "Stopping" if we're in stopping state
      if (this.miningService.plotterUIState() === 'stopping')
        return this.i18n.get('mining_stopping');
      return this.i18n.get('mining_plotting');
    }
    if (this.isDriveReady(drive)) return this.i18n.get('mining_ready');
    return this.i18n.get('mining_queued');
  }

  /**
   * Check if a drive is fully plotted and ready for mining.
   * A drive is ready when complete (.pocx) files >= allocated size.
   * Incomplete (.tmp) files don't count - they're not usable for mining.
   */
  private isDriveReady(drive: DriveConfig): boolean {
    const info = this.driveInfos().get(drive.path);
    if (!info) return false;
    return info.completeSizeGib >= drive.allocatedGib;
  }

  isDrivePlotting(drive: DriveConfig): boolean {
    // Use new simplified state - drive is "plotting" in both plotting and stopping states
    const uiState = this.miningService.plotterUIState();
    if (uiState !== 'plotting' && uiState !== 'stopping') return false;

    const plan = this.plotPlan();
    const currentIndex = this.miningService.currentPlanIndex();
    if (!plan || currentIndex >= plan.items.length) return false;

    // Get current item
    const currentItem = plan.items[currentIndex];

    // For add_to_miner, no specific drive is active
    if (currentItem.type === 'add_to_miner') {
      return false;
    }

    // For resume items, check path directly
    if (currentItem.type === 'resume') {
      return currentItem.path === drive.path || drive.path.startsWith(currentItem.path);
    }

    // For plot items, check all items in the same batch
    const batchId = currentItem.batchId;
    for (let i = currentIndex; i < plan.items.length; i++) {
      const item = plan.items[i];
      if (item.type === 'plot' && item.batchId === batchId) {
        if (item.path === drive.path || drive.path.startsWith(item.path)) {
          return true;
        }
      } else {
        break; // Different batch or non-plot item
      }
    }
    return false;
  }

  getDrivePlottingProgress(drive: DriveConfig): number {
    if (!this.isDrivePlotting(drive)) return 0;
    // Use the service's global plotting progress (persists across navigation)
    return this.miningService.plottingProgress().progress;
  }

  formatDriveSize(gib: number): string {
    if (gib === 0) return '—';
    if (gib >= 1024) {
      return `${(gib / 1024).toFixed(1)} TiB`;
    }
    return `${gib.toFixed(0)} GiB`;
  }

  getDrivePlottedSize(drive: DriveConfig): string {
    const info = this.driveInfos().get(drive.path);
    if (!info) return '—';
    // Only count complete (.pocx) files - incomplete (.tmp) don't count as plotted
    if (info.completeSizeGib === 0) return '0 GiB';
    return this.formatDriveSize(info.completeSizeGib);
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  exportCSV(): void {
    const deadlines = this.filteredDeadlines();
    const headers = [
      this.i18n.get('time'),
      this.i18n.get('block'),
      this.i18n.get('mining_chain'),
      this.i18n.get('account'),
      this.i18n.get('deadline'),
    ];
    const rows = deadlines.map(d => [
      this.formatTime(d.timestamp),
      `#${d.height}`,
      d.chainName,
      d.account,
      this.formatDeadline(d.deadline),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'deadline_history.csv';
    link.click();
  }

  toggleLogFilter(filter: string): void {
    const current = this.logFilters();
    if (filter === 'all') {
      const newState = !current.all;
      this.logFilters.set({ all: newState, info: newState, warn: newState, error: newState });
    } else {
      const updated = { ...current, all: false };
      (updated as Record<string, boolean>)[filter] = !(current as Record<string, boolean>)[filter];
      this.logFilters.set(updated);
    }
  }

  async toggleMining(): Promise<void> {
    if (this.isRunning()) {
      await this.miningService.stopMiner();
    } else {
      await this.miningService.startMiner();
    }
    // Service logs timing internally; just sync local UI state
    await this.loadState();
  }

  /**
   * Navigate to setup wizard with preloaded data.
   * Step 0 = Chains (needs devices for CPU info)
   * Step 1 = Plotter/GPU (needs devices)
   * Step 2 = Drives (needs drives + drive info)
   */
  async navigateToSetup(step: number): Promise<void> {
    // Preload relevant data based on step
    const loadPromises: Promise<void>[] = [this.miningService.refreshState()];

    if (step === 0 || step === 1) {
      // Chains and Plotter steps need device info (CPU/GPU)
      loadPromises.push(this.miningService.refreshDevices());
    }
    if (step === 2) {
      // Drives step needs drive info for configured drives
      const drivePaths = this.drives().map(d => d.path);
      if (drivePaths.length > 0) {
        loadPromises.push(this.miningService.fetchDriveInfoBatch(drivePaths));
      }
    }

    // Wait for all data to load
    await Promise.all(loadPromises);

    // Navigate to setup with step parameter
    this.router.navigate([this.setupRoute()], { queryParams: { step } });
  }

  // Plotter methods
  isPlotting(): boolean {
    // Use new simplified state from PlotterRuntime instead of MiningState.plottingStatus
    // This is consistent with isStopping() which also uses plotterUIState()
    return this.miningService.plotterUIState() === 'plotting';
  }

  isStopping(): boolean {
    // Use new simplified state
    return this.miningService.plotterUIState() === 'stopping';
  }

  /**
   * Check if user can start plotting.
   * Returns true if plan exists and plotter is not running (ready state).
   */
  canStartPlan(): boolean {
    return this.miningService.plotterUIState() === 'ready';
  }

  getRemainingSize(): string {
    const plan = this.plotPlan();
    const currentIndex = this.miningService.currentPlanIndex();
    if (!plan) return '0 GiB';
    let remaining = 0;
    for (let i = currentIndex; i < plan.items.length; i++) {
      const item = plan.items[i];
      if (item.type === 'plot') {
        remaining += item.warps;
      } else if (item.type === 'resume') {
        remaining += item.sizeGib;
      }
    }
    if (remaining >= 1024) {
      return `${(remaining / 1024).toFixed(1)} TiB`;
    }
    return `${remaining} GiB`;
  }

  /**
   * Check if there are any drives that need plotting.
   */
  hasQueuedDrives(): boolean {
    return this.drives().some(drive => !this.isDriveReady(drive));
  }

  /**
   * Get total size of queued drives that need plotting.
   */
  getQueuedSize(): string {
    let totalGib = 0;
    for (const drive of this.drives()) {
      if (!this.isDriveReady(drive) && !this.isDrivePlotting(drive)) {
        const info = this.driveInfos().get(drive.path);
        const plotted = info ? info.completeSizeGib : 0; // Only complete files, .tmp needs resume
        totalGib += drive.allocatedGib - plotted;
      }
    }
    return this.formatSize(totalGib);
  }

  /**
   * Check if all drives are complete (no queued work).
   */
  isAllComplete(): boolean {
    return this.drives().length > 0 && !this.hasQueuedDrives() && !this.isPlotting();
  }

  /**
   * Get TiB of ready (complete) drives.
   */
  getReadyTib(): number {
    let totalGib = 0;
    for (const drive of this.drives()) {
      if (this.isDriveReady(drive)) {
        totalGib += drive.allocatedGib;
      }
    }
    return totalGib / 1024;
  }

  /**
   * Get TiB of completed plots on drives that aren't fully done yet.
   * (Plotted but drive still has more work to do)
   */
  getPlottedTib(): number {
    let totalGib = 0;
    for (const drive of this.drives()) {
      if (!this.isDriveReady(drive)) {
        const info = this.driveInfos().get(drive.path);
        if (info) {
          totalGib += info.completeSizeGib;
        }
      }
    }
    return totalGib / 1024;
  }

  /**
   * Get TiB remaining to be plotted (allocated - ready - plotted).
   * Combines plotting and queued into a single "to plot" value.
   */
  getToPlotTib(): number {
    let totalGib = 0;
    for (const drive of this.drives()) {
      if (!this.isDriveReady(drive)) {
        const info = this.driveInfos().get(drive.path);
        const plotted = info ? info.completeSizeGib : 0; // Only complete files, .tmp needs resume
        const remaining = drive.allocatedGib - plotted;
        totalGib += Math.max(0, remaining);
      }
    }
    return totalGib / 1024;
  }

  /**
   * Format TiB value for display.
   */
  formatTib(tib: number): string {
    if (tib >= 1) {
      return `${tib.toFixed(1)} TiB`;
    }
    const gib = tib * 1024;
    return `${gib.toFixed(0)} GiB`;
  }

  /**
   * Get current task number (1-based).
   */
  getCurrentTask(): number {
    const stats = this.planStats();
    return stats ? stats.completedTasks + 1 : 1;
  }

  /**
   * Get total number of tasks in plan.
   */
  getTotalTasks(): number {
    const stats = this.planStats();
    return stats ? stats.totalTasks : 0;
  }

  async toggleSimulationMode(enabled: boolean): Promise<void> {
    await this.miningService.toggleSimulationMode(enabled);
    if (enabled) {
      this.miningService.addActivityLog('info', this.i18n.get('mining_simulation_enabled'));
    } else {
      this.miningService.addActivityLog('info', this.i18n.get('mining_simulation_disabled'));
    }
  }

  async togglePlotting(): Promise<void> {
    const uiState = this.miningService.plotterUIState();

    if (uiState === 'plotting' || uiState === 'stopping') {
      // Show confirmation dialog before stopping
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '420px',
        data: {
          title: this.i18n.get('mining_stop_plotting_title'),
          message: this.i18n.get('mining_stop_plotting_message'),
          confirmText: this.i18n.get('mining_soft_stop'),
          secondaryText: this.i18n.get('mining_hard_stop'),
          cancelText: this.i18n.get('cancel'),
          type: 'warning',
        },
      });

      dialogRef.afterClosed().subscribe(async (result: boolean | string) => {
        if (result === true) {
          // Soft stop - finish current batch, keep plan
          await this.miningService.softStopPlotPlan();
          this.miningService.addActivityLog('info', this.i18n.get('mining_soft_stop_requested'));
          await this.miningService.refreshPlotterState();
        } else if (result === 'secondary') {
          // Hard stop - finish current item, clear plan, regenerate
          await this.miningService.hardStopPlotPlan();
          this.miningService.addActivityLog('warning', this.i18n.get('mining_hard_stop_aborted'));
          await this.miningService.refreshPlotterState();
        }
      });
    } else {
      // Start plotting with plan
      await this.startPlottingWithPlan();
    }
  }

  private async startPlottingWithPlan(): Promise<void> {
    // Validate plotting address before starting
    const config = await this.miningService.getConfig();
    const plottingAddress = config?.plottingAddress?.trim() || '';

    if (!plottingAddress) {
      this.dialog
        .open(ConfirmDialogComponent, {
          width: '400px',
          data: {
            title: this.i18n.get('mining_plotting_address_required'),
            message: this.i18n.get('mining_plotting_address_required_message'),
            confirmText: this.i18n.get('mining_go_to_setup'),
            cancelText: this.i18n.get('cancel'),
          },
        })
        .afterClosed()
        .subscribe((result: boolean) => {
          if (result) {
            this.navigateToSetup(0);
          }
        });
      return;
    }

    // Validate address format (bech32)
    const addressInfo = await this.miningService.validateAddress(plottingAddress);
    if (!addressInfo.valid) {
      this.dialog
        .open(ConfirmDialogComponent, {
          width: '400px',
          data: {
            title: this.i18n.get('mining_invalid_plotting_address'),
            message: this.i18n.get('mining_invalid_plotting_address_message', {
              address: plottingAddress,
            }),
            confirmText: this.i18n.get('mining_go_to_setup'),
            cancelText: this.i18n.get('cancel'),
          },
        })
        .afterClosed()
        .subscribe((result: boolean) => {
          if (result) {
            this.navigateToSetup(0);
          }
        });
      return;
    }

    // On Windows, check if running elevated (required for optimal disk I/O)
    // Skip elevation check in simulation mode since no disk writes occur
    const platform = await this.miningService.getPlatform();
    if (platform === 'win32' && !this.miningService.simulationMode()) {
      const isElevated = await this.miningService.isElevated();
      if (!isElevated) {
        // Ask user if they want to restart with elevation
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: this.i18n.get('mining_admin_recommended'),
            message: this.i18n.get('mining_admin_recommended_message'),
            confirmText: this.i18n.get('mining_restart_as_admin'),
            secondaryText: this.i18n.get('mining_continue_anyway'),
            cancelText: this.i18n.get('cancel'),
          },
        });

        const result = await dialogRef.afterClosed().toPromise();
        if (result === true) {
          // User wants to restart elevated
          const restarted = await this.miningService.restartElevated();
          if (restarted) {
            // App is restarting, this instance will close
            return;
          }
          // Restart failed or was cancelled by UAC
          this.miningService.addActivityLog('warning', this.i18n.get('mining_elevation_cancelled'));
        } else if (result === 'secondary') {
          this.miningService.addActivityLog(
            'info',
            this.i18n.get('mining_continuing_without_admin')
          );
        } else {
          // User cancelled - don't start plotting
          return;
        }
      }
    }

    // Ensure we have a plan (generate if needed)
    let plan = this.plotPlan();
    if (!plan) {
      plan = await this.miningService.generatePlotPlan();
      if (!plan) {
        // No work to do or error
        return;
      }
    }

    // Check if plan has items
    if (plan.items.length === 0) {
      return;
    }

    // Start the plan execution
    const firstItem = await this.miningService.startPlotPlan();
    if (firstItem) {
      await this.miningService.refreshPlotterState();

      // Execute the first batch - this will trigger events that drive the rest
      // The plotter:item-complete event handler in service will call executeNextBatch()
      await this.miningService.executeNextBatch();
    }
  }

  /**
   * Check if there's an active plan (ready, plotting, or stopping)
   * Used to show the plan viewer button
   */
  hasActivePlan(): boolean {
    const state = this.miningService.plotterUIState();
    return state === 'ready' || state === 'plotting' || state === 'stopping';
  }

  openPlanViewer(): void {
    this.dialog.open(PlanViewerDialogComponent, {
      width: '600px',
      maxHeight: '80vh',
    });
  }

  /**
   * Check if app has "All files access" permission on Android.
   * This is required to detect plot files created by other apps.
   * Logs all steps to Recent Activity for debugging.
   */
  private async checkStoragePermission(): Promise<void> {
    this.miningService.addActivityLog('info', 'Android: Checking storage permission...');

    try {
      const hasAccess = await invoke<boolean>('plugin:storage-permission|has_all_files_access');
      this.hasStoragePermission.set(hasAccess);

      if (hasAccess) {
        this.miningService.addActivityLog('info', 'Android: Storage permission granted');
      } else {
        this.miningService.addActivityLog('warn', 'Android: Storage permission NOT granted');

        // Show permission request dialog
        const message = this.i18n.get('setup_storage_permission_required');
        const fallbackMessage =
          'This app needs "All files access" permission to detect and read plot files. Tap OK to open Settings and enable it for Phoenix.';

        if (confirm(message || fallbackMessage)) {
          this.miningService.addActivityLog('info', 'Android: User accepted permission prompt');
          await this.requestStoragePermission();
        } else {
          this.miningService.addActivityLog('warn', 'Android: User declined permission prompt');
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.miningService.addActivityLog('error', `Android: Permission check failed - ${errorMsg}`);
      console.error('Failed to check storage permission:', err);
      // Don't assume permission on error - leave as false so user knows there's an issue
      this.hasStoragePermission.set(false);
    }
  }

  /**
   * Request "All files access" permission by opening system settings.
   * Logs progress to Recent Activity.
   */
  private async requestStoragePermission(): Promise<void> {
    try {
      this.miningService.addActivityLog(
        'info',
        'Android: Opening system settings for permission...'
      );
      await invoke('plugin:storage-permission|request_all_files_access');

      // After returning from settings, re-check permission
      this.miningService.addActivityLog('info', 'Android: Returned from settings, re-checking...');
      setTimeout(async () => {
        try {
          const hasAccess = await invoke<boolean>('plugin:storage-permission|has_all_files_access');
          this.hasStoragePermission.set(hasAccess);
          if (hasAccess) {
            this.miningService.addActivityLog('info', 'Android: Permission now granted!');
          } else {
            this.miningService.addActivityLog('warn', 'Android: Permission still not granted');
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.miningService.addActivityLog('error', `Android: Re-check failed - ${errorMsg}`);
        }
      }, 1000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.miningService.addActivityLog('error', `Android: Failed to open settings - ${errorMsg}`);
      console.error('Failed to request storage permission:', err);
      alert(
        'Could not open Settings. Please enable "All files access" for Phoenix manually in Settings > Privacy > Files and media.'
      );
    }
  }
}
