import { Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MiningService } from '../../services';
import {
  MiningStatus,
  PlottingStatus,
  DeadlineEntry,
  ChainConfig,
  DriveConfig,
  calculateNetworkCapacityTib,
  calculateEffectiveCapacity,
  generateEffectiveCapacityHistory,
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
  ],
  template: `
    <div class="dashboard">
      <div class="main-content">
        <!-- Summary Cards Row -->
        <div class="summary-cards">
          <!-- Mining Status Card -->
          <div class="summary-card mining-status-card">
            <div class="card-header">
              <span class="card-title"><mat-icon>hardware</mat-icon>Mining Status</span>
            </div>
            <div class="status-row">
              <span class="status-indicator" [class]="getStatusIndicatorClass()"></span>
              <span class="status-text">{{ getStatusText() }}</span>
              <button
                class="btn btn-icon"
                [class.btn-stop]="isRunning()"
                [class.btn-start]="!isRunning()"
                (click)="toggleMining()"
                [title]="isRunning() ? 'Stop Mining' : 'Start Mining'"
              >
                <span class="btn-label">{{ isRunning() ? 'Stop' : 'Start' }}</span>
                <span class="btn-icon-glyph">{{ isRunning() ? '■' : '▶' }}</span>
              </button>
            </div>
            <div class="card-sub">{{ getCurrentChainInfo() }}</div>
            @if (miningStatus()?.type === 'scanning') {
              <div class="progress-container">
                <div class="progress-label">
                  <span>Scan Progress</span>
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
              <span class="card-title"><mat-icon>timer</mat-icon>Best Deadline</span>
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
              <span class="card-title"><mat-icon>storage</mat-icon>Capacity</span>
              @if (miningService.isDevMode()) {
                <mat-checkbox
                  class="sim-checkbox"
                  [checked]="miningService.simulationMode()"
                  (change)="toggleSimulationMode($event.checked)"
                  matTooltip="Simulation mode: plotter runs in benchmark mode (no disk writes)"
                  >Sim</mat-checkbox
                >
              }
            </div>

            <!-- Upper Section: Total capacity and status -->
            <div class="capacity-upper">
              <div class="capacity-value">{{ totalPlotSize() }}</div>
              <div class="capacity-status">
                @if (isAllComplete()) {
                  <span class="status-legend">ready for mining</span>
                } @else {
                  <span class="status-item ready"
                    ><span class="dot">●</span> {{ formatTib(getReadyTib()) }} ready</span
                  >
                  <span class="status-item plotted"
                    ><span class="dot">●</span> {{ formatTib(getPlottedTib()) }} plotted</span
                  >
                  <span class="status-item to-plot"
                    ><span class="dot">○</span> {{ formatTib(getToPlotTib()) }} to plot</span
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
                    title="Stopping after current batch..."
                  >
                    <span class="btn-label">Stopping</span>
                    <span class="btn-icon-glyph">⏳</span>
                  </button>
                  <div class="plotter-info">
                    <div class="plotter-info-row">
                      <span class="task-info">Finishing batch...</span>
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
                    title="Stop Plotting"
                  >
                    <span class="btn-label">Stop</span>
                    <span class="btn-icon-glyph">■</span>
                  </button>
                  <div class="plotter-info">
                    <div class="plotter-info-row">
                      <span class="task-info"
                        >Task {{ getCurrentTask() }}/{{ getTotalTasks() }}</span
                      >
                      <span class="speed-info">{{ getPlottingSpeed() }}</span>
                    </div>
                    <div class="progress-bar-sm">
                      <div
                        class="progress-fill plotting"
                        [style.width.%]="getPlottingProgress()"
                      ></div>
                    </div>
                    <div class="eta-info">ETA: {{ planEta() }}</div>
                  </div>
                </div>
              } @else if (canStartPlan() || hasQueuedDrives()) {
                <!-- Ready State: Start Button | Info -->
                <div class="plotter-idle">
                  <button
                    class="btn btn-icon btn-start"
                    (click)="togglePlotting()"
                    title="Start Plotting"
                  >
                    <span class="btn-label">Start</span>
                    <span class="btn-icon-glyph">▶</span>
                  </button>
                  <span class="queue-info">{{
                    canStartPlan()
                      ? getRemainingSize() + ' in plan'
                      : 'Ready to plot ' + getQueuedSize()
                  }}</span>
                </div>
              } @else {
                <!-- Complete State: Info -->
                <div class="plotter-complete">
                  <span class="complete-info"
                    >{{ drives().length }} drive{{ drives().length !== 1 ? 's' : '' }}</span
                  >
                </div>
              }
            </div>
          </div>

          <!-- Effective Capacity Card -->
          <div class="summary-card effective-capacity-card">
            <div class="card-header">
              <span class="card-title"><mat-icon>trending_up</mat-icon>Effective Capacity</span>
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
                <span class="placeholder-text">Collecting data...</span>
              </div>
            } @else {
              <div class="chart-placeholder">
                <span class="placeholder-text">No deadline data yet</span>
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
                <span class="section-title">Active Chains</span>
                <button class="icon-btn" (click)="navigateToSetup(0)" title="Configure Chains">
                  <mat-icon>link</mat-icon>
                </button>
              </div>
              <div class="section-content">
                <table class="chains-table">
                  <thead>
                    <tr>
                      <th>Chain</th>
                      <th>Height</th>
                      <th>Difficulty</th>
                      <th>PoW Scale</th>
                      <th>Status</th>
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
                        <td colspan="5" class="empty-row">No chains configured</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Best Deadline History -->
            <div class="section deadline-history-section">
              <div class="section-header">
                <span class="section-title">Best Deadline History</span>
                <div class="header-actions">
                  <div class="chain-filter">
                    <select [(ngModel)]="chainFilter" (change)="filterDeadlines()">
                      <option value="all">All Chains</option>
                      @for (chain of enabledChains(); track chain.name) {
                        <option [value]="chain.name">{{ chain.name }}</option>
                      }
                    </select>
                  </div>
                  <button class="export-btn" (click)="exportCSV()" title="Export to CSV">
                    Export CSV
                  </button>
                </div>
              </div>
              <div class="section-content">
                <table class="deadline-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Block</th>
                      <th>Chain</th>
                      <th>Account</th>
                      <th>Best Deadline</th>
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
                        <td colspan="5" class="empty-row">No deadlines found yet</td>
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
                <span class="section-title">Drives</span>
                <div class="header-buttons">
                  @if (hasActivePlan()) {
                    <button class="icon-btn" (click)="openPlanViewer()" title="Plot Plan">
                      <mat-icon>assignment</mat-icon>
                    </button>
                  }
                  <button
                    class="icon-btn"
                    (click)="refreshDriveStats()"
                    title="Refresh Drive Stats"
                  >
                    <mat-icon>refresh</mat-icon>
                  </button>
                  <button class="icon-btn" (click)="navigateToSetup(1)" title="Plotter Settings">
                    <mat-icon>memory</mat-icon>
                  </button>
                  <button class="icon-btn" (click)="navigateToSetup(2)" title="Drive Settings">
                    <mat-icon>storage</mat-icon>
                  </button>
                </div>
              </div>
              <div class="section-content">
                <table>
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Status</th>
                      <th>Plotted</th>
                      <th>Allocated</th>
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
                        <td colspan="4" class="empty-row">No drives configured</td>
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
            <span class="section-title">Recent Activity</span>
            <div class="log-filters">
              <button
                class="log-filter"
                [class.active]="logFilters().all"
                (click)="toggleLogFilter('all')"
              >
                All
              </button>
              <button
                class="log-filter"
                [class.active]="logFilters().info"
                data-filter="info"
                (click)="toggleLogFilter('info')"
              >
                Info
              </button>
              <button
                class="log-filter"
                [class.active]="logFilters().warn"
                data-filter="warn"
                (click)="toggleLogFilter('warn')"
              >
                Warn
              </button>
              <button
                class="log-filter"
                [class.active]="logFilters().error"
                data-filter="error"
                (click)="toggleLogFilter('error')"
              >
                Error
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
                  <span class="log-message">No activity yet</span>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- First-run overlay -->
        @if (showFirstRun()) {
          <div class="overlay show" (click)="hideFirstRun($event)">
            <div class="first-run-card">
              <h2>Welcome to Mining</h2>
              <p>Before you can start mining, configure your mining target and storage drives.</p>
              <button class="btn btn-primary" routerLink="/mining/setup">Get Started</button>
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
        overflow: hidden; /* Don't scroll main content - sections scroll internally */
        display: flex;
        flex-direction: column;
        gap: 12px;
        position: relative;
        min-height: 0; /* Allow flex children to shrink */
      }

      /* Summary Cards Grid */
      .summary-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        flex-shrink: 0;
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

      .summary-card .card-value {
        font-size: 26px;
        font-weight: 600;
        color: #ffffff;
        line-height: 1;
      }

      .summary-card .card-sub {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        margin-top: 4px;
      }

      .gear-link {
        color: rgba(255, 255, 255, 0.6);
        background: transparent;
        border: none;
        font-size: 14px;
        padding: 2px 4px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .gear-link:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
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
      .status-indicator.idle {
        background: #9e9e9e;
      }
      .status-indicator.scanning {
        background: #42a5f5;
        box-shadow: 0 0 8px #42a5f5;
      }
      .status-indicator.plotting {
        background: #ff9800;
        box-shadow: 0 0 8px #ff9800;
        animation: pulse 2s infinite;
      }
      .status-indicator.stopped {
        background: #9e9e9e;
      }
      .status-indicator.error {
        background: #f44336;
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
      .progress-fill.mining {
        background: linear-gradient(90deg, #4caf50, #2e7d32);
      }
      .progress-fill.plotting {
        background: linear-gradient(90deg, #ff9800, #e65100);
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
      .status-item.plotting {
        color: #ffb74d;
      }
      .status-item.queued {
        color: rgba(255, 255, 255, 0.5);
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

      /* Gear link in lower section */
      .capacity-lower .gear-link {
        color: rgba(255, 255, 255, 0.5);
        text-decoration: none;
        font-size: 14px;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .capacity-lower .gear-link:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
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

      .info-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        font-size: 14px;
        padding: 3px 8px;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .info-btn:hover {
        background: rgba(255, 255, 255, 0.2);
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
        min-height: 0;
      }

      .left-stack {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }

      .left-stack .section:first-child {
        flex: 2; /* Active Chains: 40% */
        min-height: 0;
      }

      .left-stack .deadline-history-section {
        flex: 3; /* Best Deadline: 60% */
        min-height: 0;
      }

      .right-column {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .right-column .drives-section {
        flex: 1;
        min-height: 0;
      }

      @media (max-width: 900px) {
        .detail-row {
          grid-template-columns: 1fr;
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

      .section-header .gear-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        font-size: 14px;
        padding: 3px 6px;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .section-header .gear-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .section-content {
        padding: 10px 14px;
        flex: 1;
        overflow-y: auto;
      }

      table {
        width: 100%;
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

      .mini-progress .fill.mining {
        background: #4caf50;
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
        min-height: 100px;
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

  readonly miningStatus = signal<MiningStatus | null>(null);
  readonly plottingStatus = signal<PlottingStatus | null>(null);
  // Use service signals directly for real-time miner event updates
  readonly recentDeadlines = this.miningService.minerDeadlines;
  readonly currentBlock = this.miningService.minerCurrentBlock;
  readonly configured = signal(false);
  readonly stateLoaded = signal(false);
  readonly enabledChains = signal<ChainConfig[]>([]);
  readonly drives = signal<DriveConfig[]>([]);
  // Activity logs from service (survives navigation, auto-cleanup > 1 day)
  private readonly _allActivityLogs = this.miningService.activityLogs;

  // Log filter state (reactive)
  readonly logFilters = signal({ all: true, info: true, warn: true, error: true });

  // Map log types to filter categories
  private readonly LOG_TYPE_TO_CATEGORY: Record<string, string> = {
    info: 'info',
    warn: 'warn',
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
  readonly readyFiles = signal(0);
  readonly pendingFiles = signal(0);
  // Use service's cache directly so updates propagate automatically
  readonly driveInfos = this.miningService.driveInfoCache;

  // Plot plan computed values from service
  readonly plotPlan = this.miningService.plotPlan;
  readonly planStats = this.miningService.planStats;
  readonly planEta = this.miningService.planEta;

  // Effective capacity computed from deadline snapshot
  // Only recalculates on scan round finish (not every deadline update)
  readonly sparklineData = computed(() => {
    const deadlines = this.miningService.capacityDeadlines(); // Snapshot, updates on scan finish
    const chainCount = Math.max(1, this.enabledChains().length);
    const maxDataPoints = chainCount * 120;
    return generateEffectiveCapacityHistory(deadlines, maxDataPoints, 50);
  });

  readonly calculatedEffectiveCapacity = computed(() => {
    const deadlines = this.miningService.capacityDeadlines(); // Snapshot, updates on scan finish
    const capacityTib = calculateEffectiveCapacity(deadlines);
    if (capacityTib === 0) return '--';
    return formatCapacity(capacityTib);
  });

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
    if (!best) return 'No deadlines this round';
    return `${best.chainName} • Block ${best.height.toLocaleString()}`;
  });

  chainFilter = 'all';

  async ngOnInit(): Promise<void> {
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

  hideFirstRun(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      // Don't hide on background click, only on button
    }
  }

  isRunning(): boolean {
    // Use event-driven state for instant UI updates (no polling needed)
    return this.miningService.minerRunning();
  }

  getStatusIndicatorClass(): string {
    const status = this.miningStatus();
    if (!status) return 'idle';
    switch (status.type) {
      case 'scanning':
        return 'scanning';
      case 'idle':
        return 'active';
      case 'starting':
        return 'scanning';
      case 'stopped':
        return 'stopped';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  }

  getStatusText(): string {
    const status = this.miningStatus();
    if (!status) return 'Idle';
    switch (status.type) {
      case 'scanning':
        return 'Scanning Plots';
      case 'idle':
        return 'Mining Active';
      case 'starting':
        return 'Starting...';
      case 'stopped':
        return 'Stopped';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  }

  getCurrentChainInfo(): string {
    const status = this.miningStatus();
    if (status?.type === 'scanning') {
      return `${status.chainName} • Block ${status.height?.toLocaleString()}`;
    }
    const chains = this.enabledChains();
    if (chains.length > 0) {
      return `${chains.length} chain${chains.length > 1 ? 's' : ''} configured`;
    }
    return 'No chains configured';
  }

  getScanProgress(): number {
    const status = this.miningStatus();
    if (status?.type === 'scanning') {
      return Math.round(status.progress);
    }
    return 0;
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

  truncateAccount(account: string): string {
    if (!account) return '';
    if (account.length <= 16) return account;
    return `${account.slice(0, 8)}...${account.slice(-6)}`;
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
      return 'Stopped';
    }

    const scanProgress = this.miningService.minerScanProgress();
    if (
      scanProgress.chain === chainName &&
      scanProgress.progress < 100 &&
      scanProgress.totalWarps > 0
    ) {
      return `Scanning ${scanProgress.progress.toFixed(0)}%`;
    }

    // Check if chain is in queue
    const queue = this.miningService.minerQueue();
    if (queue.some(q => q.chain === chainName)) {
      return 'Queued';
    }

    return 'Ready';
  }

  getChainCompression(chainName: string): string {
    const block = this.currentBlock()[chainName];
    return block?.compressionRange || '--';
  }

  getChainTooltip(chainName: string): string {
    const block = this.currentBlock()[chainName];
    if (!block) return '';

    return `GenSig: ${block.genSig}\nBase Target: ${block.baseTarget}\nScoop: ${block.scoop}`;
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
      if (this.miningService.plotterUIState() === 'stopping') return 'Stopping';
      return 'Plotting';
    }
    if (this.isDriveReady(drive)) return 'Ready';
    return 'Queued';
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

  filteredDeadlines(): DeadlineEntry[] {
    const all = this.recentDeadlines();
    if (this.chainFilter === 'all') return all;
    return all.filter(d => d.chainName === this.chainFilter);
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

  filterDeadlines(): void {
    // Already handled reactively via filteredDeadlines()
  }

  exportCSV(): void {
    const deadlines = this.filteredDeadlines();
    const headers = ['Time', 'Block', 'Chain', 'Account', 'Deadline'];
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
    this.router.navigate(['/mining/setup'], { queryParams: { step } });
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
      this.miningService.addActivityLog(
        'info',
        'Simulation mode enabled - plotter will not write to disk'
      );
    } else {
      this.miningService.addActivityLog('info', 'Simulation mode disabled');
    }
  }

  async togglePlotting(): Promise<void> {
    const uiState = this.miningService.plotterUIState();

    if (uiState === 'plotting' || uiState === 'stopping') {
      // Show confirmation dialog before stopping
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '420px',
        data: {
          title: 'Stop Plotting?',
          message:
            'Soft Stop: Finish current batch, then pause (efficient resume)\n\nHard Stop: Stop immediately (file-by-file resume, less efficient for batches)',
          confirmText: 'Soft Stop',
          secondaryText: 'Hard Stop',
          cancelText: 'Cancel',
          type: 'warning',
        },
      });

      dialogRef.afterClosed().subscribe(async (result: boolean | string) => {
        if (result === true) {
          // Soft stop - finish current batch, keep plan
          await this.miningService.softStopPlotPlan();
          this.miningService.addActivityLog(
            'info',
            'Soft stop requested - will pause after current batch completes'
          );
          await this.miningService.refreshPlotterState();
        } else if (result === 'secondary') {
          // Hard stop - finish current item, clear plan, regenerate
          await this.miningService.hardStopPlotPlan();
          this.miningService.addActivityLog('warning', 'Hard stop - plotting aborted');
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
            title: 'Plotting Address Required',
            message:
              'Please configure a plotting address before starting.\n\nGo to the setup wizard to select a wallet address for your plot files.',
            confirmText: 'Go to Setup',
            cancelText: 'Cancel',
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
            title: 'Invalid Plotting Address',
            message: `The configured plotting address is not valid:\n\n${plottingAddress}\n\nPlease select a valid bech32 address in the setup wizard.`,
            confirmText: 'Go to Setup',
            cancelText: 'Cancel',
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
            title: 'Administrator Recommended',
            message:
              'Without admin rights, file pre-allocation can block for hours with no progress shown.\n\nRestart as admin?',
            confirmText: 'Restart as Admin',
            secondaryText: 'Continue Anyway',
            cancelText: 'Cancel',
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
          this.miningService.addActivityLog(
            'warning',
            'Elevation cancelled - continuing without admin privileges'
          );
        } else if (result === 'secondary') {
          this.miningService.addActivityLog('info', 'Continuing without admin privileges');
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

  // Plot plan methods
  hasPendingTasks(): boolean {
    // Use new simplified state
    return this.miningService.plotterUIState() === 'ready';
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
}
