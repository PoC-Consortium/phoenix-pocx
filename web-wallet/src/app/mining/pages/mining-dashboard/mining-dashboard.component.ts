import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MiningService } from '../../services';
import { MiningStatus, PlottingStatus, DeadlineEntry, BlockInfo, ChainConfig, DriveConfig } from '../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-mining-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatDialogModule],
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

          <!-- Plots Card -->
          <div class="summary-card storage-card">
            <div class="card-header">
              <span class="card-title">Plotter</span>
              <a routerLink="/mining/setup" [queryParams]="{step: 1}" class="gear-link" title="Plotter Settings">⚙</a>
            </div>
            <div class="status-row">
              <span class="status-indicator" [class]="getPlotterStatusIndicatorClass()"></span>
              <span class="status-text">{{ getPlotterStatusText() }}</span>
              @if (pendingFiles() > 0 || isPlotting()) {
                <button
                  class="btn btn-icon"
                  [class.btn-stop]="isPlotting()"
                  [class.btn-start]="!isPlotting()"
                  (click)="togglePlotting()"
                  [title]="isPlotting() ? 'Stop Plotting' : 'Start Plotting'"
                >
                  <span class="btn-label">{{ isPlotting() ? 'Stop' : 'Start' }}</span>
                  <span class="btn-icon-glyph">{{ isPlotting() ? '■' : '▶' }}</span>
                </button>
              }
            </div>
            <div class="card-sub">
              <span class="ready-dot">●</span> {{ readySize() }} ready
              @if (pendingFiles() > 0) {
                <span class="queued-dot">●</span> {{ pendingFiles() }} to plot
              }
            </div>
            @if (plottingStatus()?.type === 'plotting') {
              <div class="plotter-progress">
                <div class="progress-label">
                  <span><span class="status-indicator plotting"></span>{{ getPlottingDrive() }}</span>
                  <span>{{ getPlottingSpeed() }}</span>
                </div>
                <div class="progress-bar-sm">
                  <div class="progress-fill plotting" [style.width.%]="getPlottingProgress()"></div>
                </div>
              </div>
            }
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
              <button class="gear-btn" routerLink="/mining/setup" [queryParams]="{step: 0}" title="Configure Chains">⚙</button>
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
              <button class="gear-btn" routerLink="/mining/setup" [queryParams]="{step: 2}" title="Configure Drives">⚙</button>
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
                            <span>{{ formatDriveSize(drive.allocatedGib) }}</span>
                          </div>
                        } @else {
                          -
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
      text-decoration: none;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 4px;
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

    /* Plots Card */
    .ready-dot { color: #2e7d32; }
    .plotting-dot { color: #ff9800; }
    .queued-dot { color: #9e9e9e; }

    .plotter-progress {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
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
      position: fixed;
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

  chainFilter = 'all';
  logFilters = { all: true, info: true, warn: true, error: true };

  async ngOnInit(): Promise<void> {
    await this.loadState();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
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
      this.plottingStatus.set(state.plottingStatus);
      this.recentDeadlines.set(state.recentDeadlines || []);
      this.currentBlock.set(state.currentBlock || {});
      this.configured.set(state.isConfigured);

      if (state.config) {
        this.enabledChains.set((state.config.chains || []).filter(c => c.enabled));
        this.drives.set(state.config.drives || []);

        let totalGib = 0;

        for (const drive of state.config.drives || []) {
          totalGib += drive.allocatedGib;
        }

        // Note: Ready/pending files require real-time drive scanning via DriveInfo
        // For now, show total allocated and set ready/pending to 0
        // TODO: Load DriveInfo for each drive to get complete/incomplete file counts
        this.totalPlotSize.set(this.formatSize(totalGib));
        this.readySize.set(this.formatSize(0));
        this.effectiveCapacity.set(this.formatSize(0));
        this.readyFiles.set(0);
        this.pendingFiles.set(0);
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
      return status.progress;
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

  getDriveStatusClass(drive: DriveConfig): string {
    if (this.isDrivePlotting(drive)) return 'plotting';
    if (drive.allocatedGib > 0) return 'active';
    return 'queued';
  }

  getDriveStatus(drive: DriveConfig): string {
    if (this.isDrivePlotting(drive)) return 'Plotting';
    if (drive.allocatedGib > 0) return 'Configured';
    return 'Empty';
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

  async togglePlotting(): Promise<void> {
    if (this.isPlotting()) {
      // Show confirmation dialog before stopping
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: {
          title: 'Stop Plotting?',
          message: 'Stopping will leave incomplete plot files on disk. These files will need to be deleted manually or replotted later. Are you sure you want to stop?',
          confirmText: 'Stop Plotting',
          cancelText: 'Continue',
          type: 'danger',
        },
      });

      dialogRef.afterClosed().subscribe(async (confirmed: boolean) => {
        if (confirmed) {
          await this.miningService.stopPlotting();
          await this.loadState();
        }
      });
    } else {
      await this.miningService.startAllPlotting();
      await this.loadState();
    }
  }
}
