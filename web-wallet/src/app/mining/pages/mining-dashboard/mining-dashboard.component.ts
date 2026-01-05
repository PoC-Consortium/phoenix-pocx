import { Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { MiningService } from '../../services';
import {
  MiningStatus,
  PlottingStatus,
  DeadlineEntry,
  BlockInfo,
  ChainConfig,
  DriveConfig,
  DriveInfo,
  PlotPlan,
  PlotPlanStats,
  PlotPlanItem,
  PlotterStartedEvent,
  PlotterHashingProgressEvent,
  PlotterWritingProgressEvent,
  PlotterCompleteEvent,
  PlotterErrorEvent,
  PlotterItemCompleteEvent,
} from '../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { PlanViewerDialogComponent } from '../../components/plan-viewer-dialog/plan-viewer-dialog.component';

@Component({
  selector: 'app-mining-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatDialogModule, MatTooltipModule, MatIconModule],
  template: `
    <div class="dashboard">
      <div class="main-content">
        <!-- Summary Cards Row -->
        <div class="summary-cards">
          <!-- Mining Status Card -->
          <div class="summary-card mining-status-card">
            <div class="card-header">
              <span class="card-title">Mining Status</span>
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
              <span class="card-title">Best Deadline</span>
            </div>
            <div class="deadline-value">{{ getBestDeadline() }}</div>
            <div class="card-sub">{{ getBestDeadlineInfo() }}</div>
            @if (recentDeadlines().length > 0) {
              <div class="account-list">
                @for (deadline of recentDeadlines().slice(0, 2); track deadline.id) {
                  <div class="account-item">
                    <span class="account-id">{{ truncateAccount(deadline.account) }}</span>
                    <span class="account-deadline">{{ formatDeadline(deadline.deadline) }}</span>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Capacity Card -->
          <div class="summary-card capacity-card">
            <div class="card-header">
              <span class="card-title">Capacity</span>
            </div>

            <!-- Upper Section: Total capacity and status -->
            <div class="capacity-upper">
              <div class="capacity-value">{{ totalPlotSize() }}</div>
              <div class="capacity-status">
                @if (isAllComplete()) {
                  <span class="status-legend">ready for mining</span>
                } @else {
                  <span class="status-item ready"><span class="dot">●</span> {{ formatTib(getReadyTib()) }} ready</span>
                  <span class="status-item plotted"><span class="dot">●</span> {{ formatTib(getPlottedTib()) }} plotted</span>
                  <span class="status-item to-plot"><span class="dot">○</span> {{ formatTib(getToPlotTib()) }} to plot</span>
                }
              </div>
            </div>

            <div class="capacity-divider"></div>

            <!-- Lower Section: Plotter controls -->
            <div class="capacity-lower">
              @if (isPlotting()) {
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
                      <span class="task-info">Task {{ getCurrentTask() }}/{{ getTotalTasks() }}</span>
                      <span class="speed-info">{{ getPlottingSpeed() }}</span>
                    </div>
                    <div class="progress-bar-sm">
                      <div class="progress-fill plotting" [style.width.%]="getPlottingProgress()"></div>
                    </div>
                    <div class="eta-info">ETA: {{ planEta() }}</div>
                  </div>
                </div>

              } @else if (hasQueuedDrives()) {
                <!-- Queued State: Button | Info -->
                <div class="plotter-idle">
                  <button
                    class="btn btn-icon btn-start"
                    (click)="togglePlotting()"
                    title="Start Plotting"
                  >
                    <span class="btn-label">Start</span>
                    <span class="btn-icon-glyph">▶</span>
                  </button>
                  <span class="queue-info">Ready to plot {{ getQueuedSize() }}</span>
                </div>

              } @else {
                <!-- Complete State: Info -->
                <div class="plotter-complete">
                  <span class="complete-info">{{ drives().length }} drive{{ drives().length !== 1 ? 's' : '' }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Effective Capacity Card -->
          <div class="summary-card effective-capacity-card">
            <div class="card-header">
              <span class="card-title">Effective Capacity</span>
            </div>
            <div class="chart-container">
              <svg viewBox="0 0 120 60" preserveAspectRatio="none" class="sparkline-chart">
                <line x1="0" y1="10" x2="120" y2="10" stroke="rgba(255,255,255,0.3)" stroke-width="1" stroke-dasharray="3,3"/>
                <path d="M0,42 L15,38 L30,45 L45,40 L60,48 L75,42 L90,34 L105,26 L120,18 L120,60 L0,60 Z"
                      fill="rgba(129, 199, 132, 0.3)" stroke="none"/>
                <path d="M0,42 L15,38 L30,45 L45,40 L60,48 L75,42 L90,34 L105,26 L120,18"
                      fill="none" stroke="#81c784" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <div class="chart-overlay">
                <div class="overlay-value">{{ effectiveCapacity() }}</div>
                <div class="overlay-sub">of {{ totalPlotSize() }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Detail Sections Row -->
        <div class="detail-row">
          <!-- Chain Details -->
          <div class="section">
            <div class="section-header">
              <span class="section-title">Active Chains</span>
              <button class="icon-btn" (click)="navigateToSetup(0)" title="Configure Chains">
                <mat-icon>link</mat-icon>
              </button>
            </div>
            <div class="section-content">
              <table>
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th>Height</th>
                    <th>Difficulty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (chain of enabledChains(); track chain.name) {
                    <tr>
                      <td>{{ chain.name }}</td>
                      <td>{{ getChainHeight(chain.name) }}</td>
                      <td>{{ getChainDifficulty(chain.name) }}</td>
                      <td><span class="status-dot" [class]="getChainStatusClass(chain.name)"></span>{{ getChainStatus(chain.name) }}</td>
                    </tr>
                  }
                  @if (enabledChains().length === 0) {
                    <tr>
                      <td colspan="4" class="empty-row">No chains configured</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <!-- Drive Details -->
          <div class="section">
            <div class="section-header">
              <span class="section-title">Drives</span>
              <div class="header-buttons">
                @if (hasPendingTasks()) {
                  <button class="icon-btn" (click)="openPlanViewer()" title="Plot Plan">
                    <mat-icon>assignment</mat-icon>
                  </button>
                }
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
                      <td><span class="status-dot" [class]="getDriveStatusClass(drive)"></span>{{ getDriveStatus(drive) }}</td>
                      <td>
                        @if (isDrivePlotting(drive)) {
                          <div class="mini-progress-wrapper">
                            <div class="mini-progress">
                              <div class="fill plotting" [style.width.%]="getDrivePlottingProgress(drive)"></div>
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
              <button class="export-btn" (click)="exportCSV()" title="Export to CSV">Export CSV</button>
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
                    <td class="account-col">{{ truncateAccount(deadline.account) }}</td>
                    <td class="deadline-col" [class.best]="isBestDeadline(deadline)">{{ formatDeadline(deadline.deadline) }}</td>
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

        <!-- Recent Activity -->
        <div class="section activity-section">
          <div class="section-header">
            <span class="section-title">Recent Activity</span>
            <div class="log-filters">
              <button class="log-filter" [class.active]="logFilters.all" (click)="toggleLogFilter('all')">All</button>
              <button class="log-filter" [class.active]="logFilters.info" data-filter="info" (click)="toggleLogFilter('info')">Info</button>
              <button class="log-filter" [class.active]="logFilters.warn" data-filter="warn" (click)="toggleLogFilter('warn')">Warn</button>
              <button class="log-filter" [class.active]="logFilters.error" data-filter="error" (click)="toggleLogFilter('error')">Error</button>
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
  styles: [`
    .dashboard {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }

    .main-content {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
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
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.7);
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
    .status-indicator.idle { background: #9e9e9e; }
    .status-indicator.scanning {
      background: #42a5f5;
      box-shadow: 0 0 8px #42a5f5;
    }
    .status-indicator.plotting {
      background: #ff9800;
      box-shadow: 0 0 8px #ff9800;
      animation: pulse 2s infinite;
    }
    .status-indicator.stopped { background: #9e9e9e; }
    .status-indicator.error { background: #f44336; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
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

    .progress-fill.scanning { background: linear-gradient(90deg, #42a5f5, #1976d2); }
    .progress-fill.mining { background: linear-gradient(90deg, #4caf50, #2e7d32); }
    .progress-fill.plotting { background: linear-gradient(90deg, #ff9800, #e65100); }

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
    }

    .account-deadline {
      font-weight: 500;
      color: #81c784;
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

    .status-item.ready { color: #81c784; }
    .status-item.plotted { color: #4fc3f7; }
    .status-item.plotting { color: #ffb74d; }
    .status-item.queued { color: rgba(255, 255, 255, 0.5); }
    .status-item.to-plot { color: rgba(255, 255, 255, 0.5); }

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
      align-items: flex-start;
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
      padding-bottom: 0;
    }

    .chart-container {
      position: relative;
      margin: -8px -16px -16px -16px;
      height: 80px;
    }

    .sparkline-chart {
      width: 100%;
      height: 100%;
    }

    .chart-overlay {
      position: absolute;
      top: 4px;
      left: 8px;
      text-align: left;
    }

    .overlay-value {
      font-size: 18px;
      font-weight: 600;
      color: #81c784;
      line-height: 1;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }

    .overlay-sub {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.7);
      margin-top: 2px;
    }

    /* Detail Sections Row */
    .detail-row {
      display: flex;
      gap: 12px;
      flex-shrink: 0;
    }

    .detail-row .section {
      flex: 1;
    }

    @media (max-width: 800px) {
      .detail-row {
        flex-direction: column;
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

    .status-dot.active { background: #4caf50; box-shadow: 0 0 4px #4caf50; }
    .status-dot.plotting { background: #ff9800; box-shadow: 0 0 4px #ff9800; }
    .status-dot.queued { background: #9e9e9e; }
    .status-dot.scanning { background: #42a5f5; box-shadow: 0 0 4px #42a5f5; }
    .status-dot.ready { background: #4caf50; }

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

    .mini-progress .fill.mining { background: #4caf50; }
    .mini-progress .fill.plotting { background: #ff9800; }

    /* Deadline History */
    .deadline-history-section {
      flex-shrink: 0;
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
    }

    .deadline-table .deadline-col {
      font-weight: 500;
    }

    .deadline-table .deadline-col.best {
      color: #2e7d32;
    }

    /* Activity Section */
    .activity-section {
      flex: 1;
      min-height: 100px;
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

    .log-filter[data-filter="info"].active {
      background: rgba(100, 181, 246, 0.3);
      color: #64b5f6;
    }

    .log-filter[data-filter="warn"].active {
      background: rgba(255, 183, 77, 0.3);
      color: #ffb74d;
    }

    .log-filter[data-filter="error"].active {
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
      padding: 3px 0;
      font-size: 10px;
      border-bottom: 1px solid #f0f0f0;
    }

    .log-entry:last-child {
      border-bottom: none;
    }

    .log-time {
      color: #888888;
      font-family: 'Consolas', monospace;
      min-width: 50px;
      font-size: 9px;
    }

    .log-message {
      color: #555555;
    }

    .log-message.deadline { color: #2e7d32; }
    .log-message.block { color: #1565c0; }
    .log-message.plot { color: #e65100; }

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
  `],
})
export class MiningDashboardComponent implements OnInit, OnDestroy {
  private readonly miningService = inject(MiningService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private plotterEventUnlisteners: UnlistenFn[] = [];

  // Progress tracking for speed calculation
  private plotStartTime = 0;           // When plotting started (ms since epoch)
  private lastSpeedUpdateTime = 0;     // For throttling UI updates
  private totalWarpsForCurrentItem = 0; // Target warps to plot
  private hashingWarps = 0;            // Warps hashed so far (0 → totalWarps)
  private writingWarps = 0;            // Warps written so far (0 → totalWarps)
  private currentPlottingProgress = signal(0); // Combined progress 0-100

  readonly miningStatus = signal<MiningStatus | null>(null);
  readonly plottingStatus = signal<PlottingStatus | null>(null);
  readonly recentDeadlines = signal<DeadlineEntry[]>([]);
  readonly currentBlock = signal<Record<string, BlockInfo>>({});
  readonly configured = signal(false);
  readonly stateLoaded = signal(false);
  readonly enabledChains = signal<ChainConfig[]>([]);
  readonly drives = signal<DriveConfig[]>([]);
  readonly activityLogs = signal<{ id: number; timestamp: number; type: string; message: string }[]>([]);

  readonly totalPlotSize = signal('0 GiB');
  readonly readySize = signal('0 GiB');
  readonly effectiveCapacity = signal('0 GiB');
  readonly readyFiles = signal(0);
  readonly pendingFiles = signal(0);
  readonly driveInfos = signal<Map<string, DriveInfo>>(new Map());

  // Plot plan computed values from service
  readonly plotPlan = this.miningService.plotPlan;
  readonly planStats = this.miningService.planStats;
  readonly planEta = this.miningService.planEta;

  chainFilter = 'all';
  logFilters = { all: true, info: true, warn: true, error: true };

  async ngOnInit(): Promise<void> {
    await this.loadState();
    await this.setupPlotterEventListeners();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.cleanupPlotterEventListeners();
  }

  private async setupPlotterEventListeners(): Promise<void> {
    // Clean up any existing listeners
    this.cleanupPlotterEventListeners();

    // Listen for plotter started
    const startedUnlisten = await listen<PlotterStartedEvent>('plotter:started', (event) => {
      console.log('Plotter started:', event.payload);
      this.totalWarpsForCurrentItem = event.payload.totalWarps;
      this.hashingWarps = event.payload.resumeOffset;
      this.writingWarps = 0;
      this.plotStartTime = Date.now();
      this.lastSpeedUpdateTime = 0;
      this.currentPlottingProgress.set(0);

      // Get current item path from plan and set plotting status
      const plan = this.plotPlan();
      const currentItem = plan?.items[plan.currentIndex];
      const filePath = currentItem?.path || '';
      this.plottingStatus.set({ type: 'plotting', filePath, progress: 0, speedMibS: 0 });
    });
    this.plotterEventUnlisteners.push(startedUnlisten);

    // Listen for hashing progress (0-50% of total)
    const hashingUnlisten = await listen<PlotterHashingProgressEvent>('plotter:hashing-progress', (event) => {
      this.hashingWarps += event.payload.warpsDelta;
      this.updatePlottingProgress();
      this.calculateCombinedSpeed();
    });
    this.plotterEventUnlisteners.push(hashingUnlisten);

    // Listen for writing progress (50-100% of total)
    const writingUnlisten = await listen<PlotterWritingProgressEvent>('plotter:writing-progress', (event) => {
      this.writingWarps += event.payload.warpsDelta;
      this.updatePlottingProgress();
      this.calculateCombinedSpeed();
    });
    this.plotterEventUnlisteners.push(writingUnlisten);

    // Listen for plotter completion (from pocx_plotter callback) - for UI updates
    const completeUnlisten = await listen<PlotterCompleteEvent>('plotter:complete', (event) => {
      console.log('Plotter complete (callback):', event.payload);
      // Set progress to 100% when complete
      this.currentPlottingProgress.set(100);
    });
    this.plotterEventUnlisteners.push(completeUnlisten);

    // Listen for errors from plotter callback
    const errorUnlisten = await listen<PlotterErrorEvent>('plotter:error', (event) => {
      console.error('Plotter error (callback):', event.payload.error);
    });
    this.plotterEventUnlisteners.push(errorUnlisten);

    // Listen for item completion (from our wrapper) - for plan advancement
    const itemCompleteUnlisten = await listen<PlotterItemCompleteEvent>('plotter:item-complete', async (event) => {
      console.log('Plot item complete:', event.payload);

      if (event.payload.success) {
        // Add success to activity log
        const durationMs = event.payload.durationMs || 1;
        const warps = event.payload.warpsPlotted || 0;
        const speedMibS = (warps * 1024 * 1000) / durationMs;
        this.addActivityLog('plot', `Plotted ${warps} GiB at ${speedMibS.toFixed(0)} MiB/s`);
      } else {
        // Add error to activity log
        this.addActivityLog('error', `Plotting failed: ${event.payload.error || 'Unknown error'}`);
      }

      // Refresh state to update UI (now with fresh drive info)
      await this.loadState();

      // Advance to next item (whether success or failure)
      await this.executeNextPlanItem();
    });
    this.plotterEventUnlisteners.push(itemCompleteUnlisten);
  }

  private cleanupPlotterEventListeners(): void {
    for (const unlisten of this.plotterEventUnlisteners) {
      unlisten();
    }
    this.plotterEventUnlisteners = [];
  }

  private addActivityLog(type: string, message: string): void {
    const logs = this.activityLogs();
    const newLog = {
      id: Date.now(),
      timestamp: Date.now(),
      type,
      message,
    };
    this.activityLogs.set([newLog, ...logs].slice(0, 100));
  }

  /**
   * Update combined plotting progress from hashing and writing phases.
   * Hashing = 0-50%, Writing = 50-100%
   */
  private updatePlottingProgress(): void {
    if (this.totalWarpsForCurrentItem === 0) {
      this.currentPlottingProgress.set(0);
      return;
    }

    // Hashing progress: 0-50%
    const hashingPercent = (this.hashingWarps / this.totalWarpsForCurrentItem) * 50;
    // Writing progress: 50-100%
    const writingPercent = (this.writingWarps / this.totalWarpsForCurrentItem) * 50;

    const total = Math.min(100, hashingPercent + writingPercent);
    this.currentPlottingProgress.set(Math.round(total));
  }

  /**
   * Calculate effective plotting speed since start.
   * Formula: speedMibS = (effectiveWarps × 1024) / elapsedSinceStart
   * Where: effectiveWarps = (hashingWarps + writingWarps) / 2
   */
  private calculateCombinedSpeed(): void {
    const now = Date.now();

    // Throttle UI updates to every 0.5 seconds
    if (now - this.lastSpeedUpdateTime < 500) {
      return;
    }
    this.lastSpeedUpdateTime = now;

    const elapsedSinceStart = (now - this.plotStartTime) / 1000; // seconds
    if (elapsedSinceStart <= 0) {
      return;
    }

    // combinedWarps goes 0 → 2×totalWarps, effectiveWarps goes 0 → totalWarps
    const combinedWarps = this.hashingWarps + this.writingWarps;
    const effectiveWarps = combinedWarps / 2;

    // Speed = effective GiB processed / time, converted to MiB/s
    const speedMibS = (effectiveWarps * 1024) / elapsedSinceStart;

    this.miningService.updatePlottingSpeed(speedMibS);

    // Update plottingStatus with current progress and speed
    this.syncPlottingStatus(speedMibS);
  }

  /**
   * Sync the plottingStatus signal with current progress and speed.
   * Called during progress events to keep UI in sync.
   */
  private syncPlottingStatus(speedMibS: number): void {
    const plan = this.plotPlan();
    const currentItem = plan?.items[plan.currentIndex];
    const filePath = currentItem?.path || '';
    const progress = this.currentPlottingProgress();

    this.plottingStatus.set({ type: 'plotting', filePath, progress, speedMibS });
  }

  private async executeNextPlanItem(): Promise<void> {
    // Get next item from plan
    const nextItem = await this.miningService.completePlotPlanItem();

    if (nextItem) {
      // Check if stop was requested
      const stopRequested = await this.miningService.isStopRequested();
      if (stopRequested) {
        console.log('Stop requested, pausing execution');
        this.plottingStatus.set({ type: 'paused' });
        await this.loadState();
        return;
      }

      // Execute the next item
      console.log('Executing next plan item:', nextItem);
      this.addActivityLog('info', `Starting ${nextItem.type} task`);
      await this.miningService.executePlotItem(nextItem);
    } else {
      // Plan is complete
      console.log('Plan execution finished');
      this.plottingStatus.set({ type: 'idle' });

      // Add completion log
      this.addActivityLog('info', 'Plot plan completed');

      await this.loadState();
    }
  }

  private startPolling(): void {
    this.refreshInterval = setInterval(() => this.loadState(), 2000);
  }

  private stopPolling(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async loadState(): Promise<void> {
    try {
      const state = await this.miningService.getState();
      this.miningStatus.set(state.miningStatus);

      // For plottingStatus: backend provides type (plotting/idle/paused),
      // but progress/speed come from frontend events during active plotting.
      // Preserve frontend progress/speed when both agree we're plotting.
      const currentStatus = this.plottingStatus();
      const backendStatus = state.plottingStatus;
      if (currentStatus?.type === 'plotting' && backendStatus?.type === 'plotting') {
        // Keep frontend's progress/speed (updated by events), use backend's filePath
        this.plottingStatus.set({
          type: 'plotting',
          filePath: backendStatus.filePath || currentStatus.filePath,
          progress: currentStatus.progress,
          speedMibS: currentStatus.speedMibS,
        });
      } else {
        // Not actively plotting or status changed - use backend state
        this.plottingStatus.set(backendStatus);
      }

      this.recentDeadlines.set(state.recentDeadlines || []);
      this.currentBlock.set(state.currentBlock || {});
      this.configured.set(state.isConfigured);

      if (state.config) {
        this.enabledChains.set((state.config.chains || []).filter(c => c.enabled));
        this.drives.set(state.config.drives || []);

        // Fetch DriveInfo for each configured drive
        const driveInfoMap = new Map<string, DriveInfo>();
        let totalAllocated = 0;
        let totalPlotted = 0;
        let totalIncomplete = 0;
        let pendingCount = 0;

        for (const drive of state.config.drives || []) {
          totalAllocated += drive.allocatedGib;
          const info = await this.miningService.getDriveInfo(drive.path);
          if (info) {
            driveInfoMap.set(drive.path, info);
            totalPlotted += info.completeSizeGib;
            totalIncomplete += info.incompleteSizeGib;
            // Pending = allocated - already plotted
            const remaining = drive.allocatedGib - info.completeSizeGib - info.incompleteSizeGib;
            if (remaining > 0) pendingCount++;
          }
        }

        this.driveInfos.set(driveInfoMap);
        this.totalPlotSize.set(this.formatSize(totalAllocated));
        this.readySize.set(this.formatSize(totalPlotted));
        this.effectiveCapacity.set(this.formatSize(totalPlotted));
        this.pendingFiles.set(pendingCount);
      }

      this.stateLoaded.set(true);
    } catch (error) {
      console.error('Failed to load mining state:', error);
      this.stateLoaded.set(true); // Still mark as loaded even on error
    }
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
    const status = this.miningStatus();
    return status?.type === 'scanning' || status?.type === 'idle' || status?.type === 'starting';
  }

  getStatusIndicatorClass(): string {
    const status = this.miningStatus();
    if (!status) return 'idle';
    switch (status.type) {
      case 'scanning': return 'scanning';
      case 'idle': return 'active';
      case 'starting': return 'scanning';
      case 'stopped': return 'stopped';
      case 'error': return 'error';
      default: return 'idle';
    }
  }

  getStatusText(): string {
    const status = this.miningStatus();
    if (!status) return 'Idle';
    switch (status.type) {
      case 'scanning': return 'Scanning Plots';
      case 'idle': return 'Mining Active';
      case 'starting': return 'Starting...';
      case 'stopped': return 'Stopped';
      case 'error': return 'Error';
      default: return 'Idle';
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

  getBestDeadline(): string {
    const deadlines = this.recentDeadlines();
    if (deadlines.length === 0) return '--';
    const best = deadlines.reduce((a, b) => a.deadline < b.deadline ? a : b);
    return this.formatDeadline(best.deadline);
  }

  getBestDeadlineInfo(): string {
    const deadlines = this.recentDeadlines();
    if (deadlines.length === 0) return 'No deadlines found';
    const best = deadlines.reduce((a, b) => a.deadline < b.deadline ? a : b);
    return `${best.chainName} • Quality ${best.nonce.toLocaleString()}`;
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

  getPlottingDrive(): string {
    const status = this.plottingStatus();
    if (status?.type === 'plotting') {
      return status.filePath.split(/[/\\]/).slice(0, -1).join('/') || status.filePath;
    }
    return '';
  }

  getPlottingSpeed(): string {
    const status = this.plottingStatus();
    if (status?.type === 'plotting') {
      return `${status.speedMibS.toFixed(0)} MiB/s`;
    }
    return '';
  }

  getPlottingProgress(): number {
    const status = this.plottingStatus();
    if (status?.type === 'plotting') {
      // Use our locally tracked progress (combined hashing + writing)
      return this.currentPlottingProgress();
    }
    return 0;
  }

  getChainHeight(chainName: string): string {
    const block = this.currentBlock()[chainName];
    return block ? block.height.toLocaleString() : '--';
  }

  getChainDifficulty(chainName: string): string {
    const block = this.currentBlock()[chainName];
    if (!block) return '--';
    const tib = block.baseTarget / (1024 * 1024 * 1024 * 1024);
    if (tib >= 1) return `${tib.toFixed(1)} TiB`;
    return `${(tib * 1024).toFixed(0)} GiB`;
  }

  getChainStatusClass(chainName: string): string {
    const status = this.miningStatus();
    if (status?.type === 'scanning' && status.chainName === chainName) {
      return 'scanning';
    }
    if (status?.type === 'idle') return 'active';
    return 'queued';
  }

  getChainStatus(chainName: string): string {
    const status = this.miningStatus();
    if (status?.type === 'scanning' && status.chainName === chainName) {
      return 'Scanning';
    }
    if (status?.type === 'idle') return 'Ready';
    return 'Queued';
  }

  /**
   * Get drive status class for styling.
   * Simplified 3-status model:
   * - ready: Drive is fully plotted, ready for mining
   * - plotting: Drive is currently being plotted
   * - queued: Drive needs more plotting before mining
   */
  getDriveStatusClass(drive: DriveConfig): string {
    if (this.isDrivePlotting(drive)) return 'plotting';
    if (this.isDriveReady(drive)) return 'ready';
    return 'queued';
  }

  /**
   * Get human-readable drive status.
   * Ready = will be in mining
   * Plotting = currently being plotted
   * Queued = not yet mining, needs more plotting
   */
  getDriveStatus(drive: DriveConfig): string {
    if (this.isDrivePlotting(drive)) return 'Plotting';
    if (this.isDriveReady(drive)) return 'Ready';
    return 'Queued';
  }

  /**
   * Check if a drive is fully plotted and ready for mining.
   * A drive is ready when plotted size >= allocated size.
   */
  private isDriveReady(drive: DriveConfig): boolean {
    const info = this.driveInfos().get(drive.path);
    if (!info) return false;
    const plotted = info.completeSizeGib + info.incompleteSizeGib;
    return plotted >= drive.allocatedGib;
  }

  isDrivePlotting(drive: DriveConfig): boolean {
    const status = this.plottingStatus();
    if (status?.type !== 'plotting') return false;
    return status.filePath.startsWith(drive.path);
  }

  getDrivePlottingProgress(drive: DriveConfig): number {
    if (!this.isDrivePlotting(drive)) return 0;
    const status = this.plottingStatus();
    if (status?.type === 'plotting') {
      return status.progress;
    }
    return 0;
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
    const plotted = info.completeSizeGib + info.incompleteSizeGib;
    if (plotted === 0) return '0 GiB';
    return this.formatDriveSize(plotted);
  }

  filteredDeadlines(): DeadlineEntry[] {
    const all = this.recentDeadlines();
    if (this.chainFilter === 'all') return all;
    return all.filter(d => d.chainName === this.chainFilter);
  }

  isBestDeadline(deadline: DeadlineEntry): boolean {
    const chainDeadlines = this.recentDeadlines().filter(d => d.chainName === deadline.chainName && d.height === deadline.height);
    if (chainDeadlines.length === 0) return false;
    const best = chainDeadlines.reduce((a, b) => a.deadline < b.deadline ? a : b);
    return best.id === deadline.id;
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
      this.formatDeadline(d.deadline)
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'deadline_history.csv';
    link.click();
  }

  toggleLogFilter(filter: string): void {
    if (filter === 'all') {
      const newState = !this.logFilters.all;
      this.logFilters = { all: newState, info: newState, warn: newState, error: newState };
    } else {
      (this.logFilters as Record<string, boolean>)[filter] = !(this.logFilters as Record<string, boolean>)[filter];
    }
  }

  async toggleMining(): Promise<void> {
    if (this.isRunning()) {
      await this.miningService.stopMining();
    } else {
      await this.miningService.startMining();
    }
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
      // Drives step needs drive info
      loadPromises.push(this.miningService.refreshDrives());
    }

    // Wait for all data to load
    await Promise.all(loadPromises);

    // For drives step, also fetch drive info for configured drives
    if (step === 2) {
      const drivePaths = this.drives().map(d => d.path);
      if (drivePaths.length > 0) {
        await this.miningService.fetchDriveInfoBatch(drivePaths);
      }
    }

    // Navigate to setup with step parameter
    this.router.navigate(['/mining/setup'], { queryParams: { step } });
  }

  // Plotter methods
  isPlotting(): boolean {
    const status = this.plottingStatus();
    return status?.type === 'plotting';
  }

  getPlotterStatusIndicatorClass(): string {
    const status = this.plottingStatus();
    if (status?.type === 'plotting') return 'plotting';
    if (this.pendingFiles() > 0) return 'queued';
    return 'idle';
  }

  getPlotterStatusText(): string {
    const status = this.plottingStatus();
    if (status?.type === 'plotting') return 'Plotting';
    if (status?.type === 'paused') return 'Paused';
    if (this.pendingFiles() > 0) return 'Ready';
    return 'Idle';
  }

  /**
   * Check if there are any drives that need plotting.
   */
  hasQueuedDrives(): boolean {
    return this.drives().some(drive => !this.isDriveReady(drive));
  }

  /**
   * Get queue items for mini-queue display in Plotter card.
   * Returns drives with their status (ready/plotting/queued).
   */
  getDriveQueueItems(): { path: string; status: 'ready' | 'plotting' | 'queued' }[] {
    return this.drives().map(drive => ({
      path: drive.path,
      status: this.isDrivePlotting(drive) ? 'plotting' :
              this.isDriveReady(drive) ? 'ready' : 'queued',
    }));
  }

  /**
   * Format drive path for display (show drive letter or last segment).
   */
  formatDrivePath(path: string): string {
    // Windows: "D:\PoCX_Plots" -> "D:"
    // Unix: "/mnt/plots" -> "plots"
    const parts = path.split(/[/\\]/);
    if (parts[0].includes(':')) {
      return parts[0]; // Windows drive letter
    }
    return parts[parts.length - 1] || path;
  }

  /**
   * Get count of drives that need plotting.
   */
  getQueuedDriveCount(): number {
    return this.drives().filter(drive => !this.isDriveReady(drive) && !this.isDrivePlotting(drive)).length;
  }

  /**
   * Get total size of queued drives that need plotting.
   */
  getQueuedSize(): string {
    let totalGib = 0;
    for (const drive of this.drives()) {
      if (!this.isDriveReady(drive) && !this.isDrivePlotting(drive)) {
        const info = this.driveInfos().get(drive.path);
        const plotted = info ? info.completeSizeGib + info.incompleteSizeGib : 0;
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
        const plotted = info ? info.completeSizeGib + info.incompleteSizeGib : 0;
        const remaining = drive.allocatedGib - plotted;
        totalGib += Math.max(0, remaining);
      }
    }
    return totalGib / 1024;
  }

  /**
   * Get TiB currently being actively plotted (in-progress file).
   */
  getPlottingTib(): number {
    const status = this.plottingStatus();
    if (status?.type === 'plotting') {
      // Return the size of the current file being plotted
      // Estimate based on progress if available
      const stats = this.planStats();
      if (stats && stats.totalTasks > 0) {
        const currentItem = this.plotPlan()?.items[stats.completedTasks];
        if (currentItem?.type === 'plot') {
          return currentItem.warps / 1024; // warps = GiB
        } else if (currentItem?.type === 'resume') {
          return currentItem.sizeGib / 1024;
        }
      }
    }
    return 0;
  }

  /**
   * Get TiB queued for plotting (not yet started).
   */
  getQueuedTib(): number {
    let totalGib = 0;
    for (const drive of this.drives()) {
      if (!this.isDriveReady(drive)) {
        const info = this.driveInfos().get(drive.path);
        const plotted = info ? info.completeSizeGib : 0;
        const remaining = drive.allocatedGib - plotted;
        totalGib += remaining;
      }
    }
    // Subtract what's currently being plotted
    const plottingGib = this.getPlottingTib() * 1024;
    return Math.max(0, totalGib - plottingGib) / 1024;
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

  async togglePlotting(): Promise<void> {
    if (this.isPlotting() || this.miningService.isPlanRunning()) {
      // Show confirmation dialog before stopping
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '420px',
        data: {
          title: 'Stop Plotting?',
          message: 'Soft Stop: Finish current file, then pause (can resume later)\n\nHard Stop: Stop immediately (progress saved as .tmp)',
          confirmText: 'Soft Stop',
          secondaryText: 'Hard Stop',
          cancelText: 'Cancel',
          type: 'warning',
        },
      });

      dialogRef.afterClosed().subscribe(async (result: boolean | string) => {
        if (result === true) {
          // Soft stop - finish current task, will pause after completion
          await this.miningService.softStopPlotPlan();
          this.addActivityLog('info', 'Soft stop requested - will pause after current file completes');
          await this.loadState();
        } else if (result === 'secondary') {
          // Hard stop - abort immediately
          await this.miningService.hardStopPlotPlan();
          this.addActivityLog('warning', 'Hard stop - plotting aborted');
          this.plottingStatus.set({ type: 'idle' });
          await this.loadState();
        }
      });
    } else {
      // Start plotting with plan
      await this.startPlottingWithPlan();
    }
  }

  private async startPlottingWithPlan(): Promise<void> {
    // On Windows, check if running elevated (required for optimal disk I/O)
    const platform = await this.miningService.getPlatform();
    if (platform === 'win32') {
      const isElevated = await this.miningService.isElevated();
      if (!isElevated) {
        // Ask user if they want to restart with elevation
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Administrator Required',
            message: 'For optimal plotting performance (especially direct I/O), the app needs to run as Administrator.\n\nWould you like to restart with elevated privileges?',
            confirmText: 'Restart as Admin',
            cancelText: 'Continue Anyway',
          },
        });

        const result = await dialogRef.afterClosed().toPromise();
        if (result) {
          // User wants to restart elevated
          const restarted = await this.miningService.restartElevated();
          if (restarted) {
            // App is restarting, this instance will close
            return;
          }
          // Restart failed or was cancelled by UAC
          this.addActivityLog('warning', 'Elevation cancelled - continuing without admin privileges');
        } else {
          this.addActivityLog('info', 'Continuing without admin privileges');
        }
      }
    }

    // Refresh drives to get latest state
    await this.miningService.refreshDrives();

    // Check if we need to generate/regenerate plan
    if (this.miningService.needsPlanRegeneration()) {
      const plan = await this.miningService.regeneratePlotPlan();
      if (!plan) {
        // No work to do or error
        console.log('No plot plan generated - nothing to plot');
        return;
      }
    }

    // Check if plan is paused (can resume) or pending (start fresh)
    const plan = this.plotPlan();
    if (!plan || plan.items.length === 0) {
      console.log('No items in plot plan');
      return;
    }

    // Start the plan execution
    const firstItem = await this.miningService.startPlotPlan();
    if (firstItem) {
      console.log('Starting plot plan, first item:', firstItem);
      this.addActivityLog('info', `Starting ${firstItem.type} task`);

      // Execute the first item - this will trigger events that drive the rest
      // The plotter:complete event handler will call executeNextPlanItem()
      await this.miningService.executePlotItem(firstItem);
    }

    await this.loadState();
  }

  // Plot plan methods
  hasPlan(): boolean {
    return this.plotPlan() !== null;
  }

  hasPendingTasks(): boolean {
    const plan = this.plotPlan();
    if (!plan) return false;
    // Check if there are any incomplete tasks
    return plan.items.length > 0 && plan.currentIndex < plan.items.length;
  }

  openPlanViewer(): void {
    this.dialog.open(PlanViewerDialogComponent, {
      width: '600px',
      maxHeight: '80vh',
    });
  }

  formatPlanRemaining(tib: number): string {
    if (tib >= 1) {
      return `${tib.toFixed(1)} TiB`;
    }
    const gib = tib * 1024;
    return `${gib.toFixed(0)} GiB`;
  }
}
