import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CdkDragDrop, CdkDrag, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { I18nPipe, I18nService } from '../../../core/i18n';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MiningService } from '../../services';
import { WalletManagerService } from '../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletRpcService } from '../../../bitcoin/services/rpc/wallet-rpc.service';
import { MiningRpcService } from '../../../bitcoin/services/rpc/mining-rpc.service';
import {
  selectRpcHost,
  selectRpcPort,
  selectDataDirectory,
  selectNetwork,
} from '../../../store/settings/settings.selectors';
import {
  DriveInfo,
  DriveConfig,
  ChainConfig,
  CpuConfig,
  CpuInfo,
  GpuInfo,
  PlotterDeviceConfig,
  AddressInfo,
  PlotterStartedEvent,
  PlotterHashingProgressEvent,
  PlotterCompleteEvent,
  PlotterErrorEvent,
} from '../../models';

type ChainMode = 'solo' | 'pool' | 'custom';

interface ChainModalData {
  mode: ChainMode;
  chainName: string;
  poolUrl: string;
  poolToken: string;
  customUrl: string;
  customApiPath: string;
  customMode: 'solo' | 'pool';
  customBlockTime: number;
  customToken: string;
}

@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    CdkDropList,
    CdkDrag,
    I18nPipe,
  ],
  template: `
    <div class="header">
      <div class="header-left">
        <button mat-icon-button class="back-button" (click)="cancel()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h1>{{ 'setup_mining_setup' | i18n }}</h1>
      </div>
    </div>

    <div class="wizard-container">
      <!-- Step Indicator -->
      <div class="step-indicator">
        <div class="step">
          <div
            class="step-circle"
            [class.active]="currentStep() === 0"
            [class.complete]="currentStep() > 0"
          >
            @if (currentStep() > 0) {
              &#10003;
            } @else {
              1
            }
          </div>
          <span class="step-label" [class.active]="currentStep() === 0">{{
            'setup_step_miner' | i18n
          }}</span>
        </div>
        <div class="step-line" [class.complete]="currentStep() > 0"></div>
        <div class="step">
          <div
            class="step-circle"
            [class.active]="currentStep() === 1"
            [class.complete]="currentStep() > 1"
            [class.inactive]="currentStep() < 1"
          >
            @if (currentStep() > 1) {
              &#10003;
            } @else {
              2
            }
          </div>
          <span class="step-label" [class.active]="currentStep() === 1">{{
            'setup_step_plotter' | i18n
          }}</span>
        </div>
        <div class="step-line" [class.complete]="currentStep() > 1"></div>
        <div class="step">
          <div
            class="step-circle"
            [class.active]="currentStep() === 2"
            [class.complete]="currentStep() > 2"
            [class.inactive]="currentStep() < 2"
          >
            @if (currentStep() > 2) {
              &#10003;
            } @else {
              3
            }
          </div>
          <span class="step-label" [class.active]="currentStep() === 2">{{
            'setup_step_drives' | i18n
          }}</span>
        </div>
      </div>

      <!-- Step 1: Miner + CPU/Performance -->
      @if (currentStep() === 0) {
        <!-- Chain Configuration Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_chain_configuration' | i18n }}</span>
          </div>
          <div class="section-content">
            <div class="chain-list-header">
              <span class="chain-list-label">{{ 'setup_priority' | i18n }}</span>
              <span class="chain-list-hint">{{ 'setup_drag_to_reorder' | i18n }}</span>
            </div>
            <div class="chain-list" cdkDropList (cdkDropListDropped)="onChainDropped($event)">
              @for (chain of chainConfigs(); track chain.id; let i = $index) {
                <div class="chain-item" cdkDrag>
                  <div class="drag-handle" cdkDragHandle title="Drag to reorder">&#9776;</div>
                  <div class="priority-slot" [title]="'Priority ' + (i + 1)">{{ i + 1 }}</div>
                  <div class="chain-info">
                    <div class="chain-name">{{ chain.name }}</div>
                    <div class="chain-url">
                      {{
                        chain.mode === 'solo'
                          ? ('setup_solo_mining_via_node' | i18n)
                          : chain.rpcTransport + '://' + chain.rpcHost + ':' + chain.rpcPort
                      }}
                    </div>
                  </div>
                  <span class="chain-mode" [class]="chain.mode">
                    {{ chain.mode === 'solo' ? ('setup_solo' | i18n) : ('setup_pool' | i18n) }}
                  </span>
                  <div class="chain-actions">
                    <button
                      class="edit-btn"
                      (click)="editChain(chain)"
                      [title]="'setup_edit' | i18n"
                    >
                      &#9998;
                    </button>
                    <button class="remove-btn" (click)="removeChain(chain)">
                      {{ 'setup_remove' | i18n }}
                    </button>
                  </div>
                </div>
              }
              @if (chainConfigs().length === 0) {
                <div class="chain-empty">
                  <span>{{ 'setup_no_chains_configured' | i18n }}</span>
                </div>
              }
            </div>
            <div class="btn-row">
              <button class="btn btn-secondary" (click)="showChainModal()">
                {{ 'setup_add_chain' | i18n }}
              </button>
            </div>
          </div>
        </div>

        <!-- CPU / Performance Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_cpu_performance' | i18n }}</span>
          </div>
          <div class="section-content">
            <div class="device-item">
              <div class="device-icon cpu"><span class="icon-glyph">⚙</span>CPU</div>
              <div class="device-info">
                <div class="device-name">{{ cpuInfo()?.name || ('setup_unknown_cpu' | i18n) }}</div>
                <div class="device-specs">
                  {{ 'setup_threads_available' | i18n: { count: cpuInfo()?.threads || 0 } }} &bull;
                  {{ cpuInfo()?.features?.join(', ') || 'AVX2' }}
                </div>
              </div>
            </div>
            <div class="thread-slider-container">
              <div class="slider-label">
                <span>{{ 'setup_mining_threads' | i18n }}</span>
                <span>{{ 'setup_max' | i18n }} {{ cpuInfo()?.threads || 0 }}</span>
              </div>
              <div class="slider-wrapper">
                <input
                  type="range"
                  class="slider"
                  min="1"
                  [max]="cpuInfo()?.threads || 16"
                  [ngModel]="cpuConfig().miningThreads"
                  (ngModelChange)="onMiningThreadsChange($event)"
                />
                <span class="slider-value"
                  >{{ cpuConfig().miningThreads }} {{ 'setup_threads' | i18n }}</span
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Advanced Options Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_advanced_options' | i18n }}</span>
            <button class="collapse-toggle" (click)="toggleAdvanced('step1')">
              <span>{{ advancedStep1Open() ? ('setup_hide' | i18n) : ('setup_show' | i18n) }}</span>
              <span>{{ advancedStep1Open() ? '&#9660;' : '&#9654;' }}</span>
            </button>
          </div>
          @if (advancedStep1Open()) {
            <div class="section-content">
              <div class="form-row">
                <div class="form-group">
                  <label>{{ 'setup_poll_interval' | i18n }}</label>
                  <input
                    type="number"
                    [ngModel]="pollInterval()"
                    (ngModelChange)="pollInterval.set($event)"
                  />
                </div>
                <div class="form-group">
                  <label>{{ 'setup_timeout' | i18n }}</label>
                  <input
                    type="number"
                    [ngModel]="timeout()"
                    (ngModelChange)="timeout.set($event)"
                  />
                </div>
              </div>
              <div class="form-row checkbox-row">
                <label class="checkbox-option">
                  <input
                    type="checkbox"
                    [ngModel]="compressionEnabled()"
                    (ngModelChange)="compressionEnabled.set($event)"
                  />
                  {{ 'setup_enable_compression' | i18n }}
                </label>
                <label class="checkbox-option">
                  <input
                    type="checkbox"
                    [ngModel]="threadPinning()"
                    (ngModelChange)="threadPinning.set($event)"
                  />
                  {{ 'setup_thread_pinning' | i18n }}
                </label>
              </div>
            </div>
          }
        </div>
      }

      <!-- Step 2: Plotter -->
      @if (currentStep() === 1) {
        <!-- Plotting Devices Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_plotting_device' | i18n }}</span>
          </div>
          <div class="section-content">
            @for (gpu of gpus(); track gpu.id) {
              <div class="device-item">
                <input
                  type="radio"
                  name="plotter-device"
                  class="device-radio"
                  [checked]="isDeviceEnabled(gpu.id)"
                  (change)="selectDevice(gpu.id)"
                />
                <div class="device-icon gpu" [class.apu]="gpu.isApu">
                  <span class="icon-glyph">🖥️</span>{{ gpu.isApu ? 'APU' : 'GPU' }}
                </div>
                <div class="device-info">
                  <div class="device-name">
                    {{ gpu.name }}
                    @if (gpu.isApu) {
                      <span class="apu-badge">APU</span>
                    }
                  </div>
                  <div class="device-specs">
                    {{ gpu.memoryMb }} MB VRAM &bull; {{ gpu.openclVersion }}
                  </div>
                </div>
                <div class="benchmark-display">
                  @if (benchmarkingDevice() === gpu.id) {
                    <div class="benchmark-progress">
                      <div class="progress-bar" [style.width.%]="benchmarkProgress() * 100"></div>
                    </div>
                  } @else if (getBenchmarkError(gpu.id)) {
                    <span class="benchmark-error" [title]="getBenchmarkError(gpu.id)">{{
                      'setup_error' | i18n
                    }}</span>
                    <button
                      class="redo-btn"
                      (click)="runSingleDeviceBenchmark(gpu.id)"
                      [disabled]="benchmarkRunning()"
                      [title]="'setup_retry_benchmark' | i18n"
                    >
                      ↻
                    </button>
                  } @else if (getBenchmarkResult(gpu.id)) {
                    <span class="benchmark-result"
                      >{{ getBenchmarkResult(gpu.id) | number: '1.0-0' }} MiB/s</span
                    >
                    <button
                      class="redo-btn"
                      (click)="runSingleDeviceBenchmark(gpu.id)"
                      [disabled]="benchmarkRunning()"
                      [title]="'setup_redo_benchmark' | i18n"
                    >
                      ↻
                    </button>
                  } @else {
                    <button
                      class="benchmark-btn"
                      (click)="runSingleDeviceBenchmark(gpu.id)"
                      [disabled]="benchmarkRunning()"
                    >
                      {{ 'setup_benchmark' | i18n }}
                    </button>
                  }
                </div>
                <div class="device-config">
                  <div class="thread-input">
                    <input
                      type="number"
                      [value]="getDeviceThreads(gpu.id)"
                      (change)="setDeviceThreads(gpu.id, $event)"
                      min="1"
                      [max]="getGpuComputeUnits(gpu)"
                    />
                    <span class="thread-max">{{
                      'setup_of_cus' | i18n: { count: getGpuComputeUnits(gpu) }
                    }}</span>
                  </div>
                </div>
              </div>
            }

            <!-- CPU as plotting device -->
            <div class="device-item">
              <input
                type="radio"
                name="plotter-device"
                class="device-radio"
                [checked]="isDeviceEnabled('cpu')"
                (change)="selectDevice('cpu')"
              />
              <div class="device-icon cpu"><span class="icon-glyph">⚙</span>CPU</div>
              <div class="device-info">
                <div class="device-name">{{ cpuInfo()?.name || ('setup_unknown_cpu' | i18n) }}</div>
                <div class="device-specs">
                  {{ 'setup_threads_available' | i18n: { count: cpuInfo()?.threads || 0 } }} &bull;
                  {{ cpuInfo()?.features?.join(', ') || 'AVX2' }} &bull; CPU
                </div>
              </div>
              <div class="benchmark-display">
                @if (benchmarkingDevice() === 'cpu') {
                  <div class="benchmark-progress">
                    <div class="progress-bar" [style.width.%]="benchmarkProgress() * 100"></div>
                  </div>
                } @else if (getBenchmarkError('cpu')) {
                  <span class="benchmark-error" [title]="getBenchmarkError('cpu')">{{
                    'setup_error' | i18n
                  }}</span>
                  <button
                    class="redo-btn"
                    (click)="runSingleDeviceBenchmark('cpu')"
                    [disabled]="benchmarkRunning()"
                    [title]="'setup_retry_benchmark' | i18n"
                  >
                    ↻
                  </button>
                } @else if (getBenchmarkResult('cpu')) {
                  <span class="benchmark-result"
                    >{{ getBenchmarkResult('cpu') | number: '1.0-0' }} MiB/s</span
                  >
                  <button
                    class="redo-btn"
                    (click)="runSingleDeviceBenchmark('cpu')"
                    [disabled]="benchmarkRunning()"
                    [title]="'setup_redo_benchmark' | i18n"
                  >
                    ↻
                  </button>
                } @else {
                  <button
                    class="benchmark-btn"
                    (click)="runSingleDeviceBenchmark('cpu')"
                    [disabled]="benchmarkRunning()"
                  >
                    {{ 'setup_benchmark' | i18n }}
                  </button>
                }
              </div>
              <div class="device-config">
                <div class="thread-input">
                  <input
                    type="number"
                    [value]="getDeviceThreads('cpu')"
                    (change)="setDeviceThreads('cpu', $event)"
                    min="1"
                    [max]="cpuInfo()?.threads || 16"
                  />
                  <span class="thread-max">{{
                    'setup_of_threads' | i18n: { count: cpuInfo()?.threads || 16 }
                  }}</span>
                </div>
              </div>
            </div>

            @if (gpus().length === 0) {
              <div class="info-box">
                {{ 'setup_no_gpus_detected' | i18n }}
              </div>
            }
          </div>
        </div>

        <!-- Plot Address Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_plot_address' | i18n }}</span>
          </div>
          <div class="section-content">
            <div class="radio-group">
              <label class="radio-option">
                <input
                  type="radio"
                  name="addressMode"
                  [checked]="!useCustomAddress()"
                  (change)="useCustomAddress.set(false)"
                />
                <div class="radio-label">
                  <div class="radio-label-main">{{ 'setup_use_wallet_address' | i18n }}</div>
                  <div class="radio-label-sub address-full">
                    {{ walletAddress() || ('setup_no_wallet_connected' | i18n) }}
                  </div>
                </div>
              </label>
              <label class="radio-option">
                <input
                  type="radio"
                  name="addressMode"
                  [checked]="useCustomAddress()"
                  (change)="useCustomAddress.set(true)"
                />
                <div class="radio-label">
                  <div class="radio-label-main">{{ 'setup_custom_address' | i18n }}</div>
                  <div class="address-input-row">
                    <input
                      type="text"
                      class="input-field address-input"
                      [ngModel]="customPlottingAddress()"
                      (ngModelChange)="onCustomAddressChange($event)"
                      [placeholder]="'setup_enter_plotting_address' | i18n"
                      [disabled]="!useCustomAddress()"
                    />
                    @if (addressValidation() && useCustomAddress()) {
                      @if (!addressValidation()!.valid) {
                        <span
                          class="address-badge error"
                          [title]="'setup_address_invalid_tooltip' | i18n"
                        >
                          ❌ {{ 'setup_invalid' | i18n }}
                        </span>
                      } @else if (addressValidation()!.isMine === true) {
                        <span
                          class="address-badge success"
                          [title]="'setup_address_mine_tooltip' | i18n"
                        >
                          🔑
                        </span>
                      } @else if (addressValidation()!.assignedToUs === true) {
                        <span
                          class="address-badge success"
                          [title]="'setup_address_assigned_tooltip' | i18n"
                        >
                          🔑
                        </span>
                      } @else {
                        <span
                          class="address-badge warning"
                          [title]="'setup_address_no_keys_tooltip' | i18n"
                        >
                          🔑
                        </span>
                      }
                    }
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>

        <!-- Advanced Options Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_advanced_options' | i18n }}</span>
            <button class="collapse-toggle" (click)="toggleAdvanced('step2')">
              <span>{{ advancedStep2Open() ? ('setup_hide' | i18n) : ('setup_show' | i18n) }}</span>
              <span>{{ advancedStep2Open() ? '&#9660;' : '&#9654;' }}</span>
            </button>
          </div>
          @if (advancedStep2Open()) {
            <div class="section-content advanced-content">
              <!-- Memory Estimation Box -->
              <div class="memory-estimation">
                <div class="memory-estimation-header">{{ 'setup_estimated_memory' | i18n }}</div>
                <div class="memory-breakdown">
                  <div class="memory-row">
                    <span class="memory-label">{{ 'setup_plotter_cache' | i18n }}</span>
                    <span class="memory-value">{{ plotterCacheGib() | number: '1.1-1' }} GiB</span>
                  </div>
                  <div class="memory-row">
                    <span class="memory-label"
                      >{{ 'setup_hdd_cache' | i18n }} ({{ parallelDrives() }}
                      {{
                        parallelDrives() > 1 ? ('mining_drives' | i18n) : ('mining_drive' | i18n)
                      }})</span
                    >
                    <span class="memory-value">{{ hddCacheGib() | number: '1.1-1' }} GiB</span>
                  </div>
                  @if (gpuMemoryGib() > 0) {
                    <div class="memory-row">
                      <span class="memory-label">{{ 'setup_gpu_cache' | i18n }}</span>
                      <span class="memory-value">{{ gpuMemoryGib() | number: '1.1-1' }} GiB</span>
                    </div>
                  }
                  <div class="memory-row memory-total">
                    <span class="memory-label">{{ 'setup_total' | i18n }}</span>
                    <span class="memory-value"
                      >~{{ totalEstimatedMemoryGib() | number: '1.0-0' }} GiB</span
                    >
                  </div>
                  <div class="memory-row memory-available">
                    <span class="memory-label">{{ 'setup_available_ram' | i18n }}</span>
                    <span
                      class="memory-value"
                      [class.warning]="totalEstimatedMemoryGib() > systemMemoryGib()"
                      >{{ systemMemoryGib() }} GiB</span
                    >
                  </div>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group escalation-group">
                  <label>{{ 'setup_drives_in_parallel' | i18n }}</label>
                  <input
                    type="number"
                    [ngModel]="parallelDrives()"
                    (ngModelChange)="parallelDrives.set($event)"
                    min="1"
                    max="10"
                    class="escalation-input"
                  />
                </div>
                <div class="form-group escalation-group">
                  <label>{{ 'setup_memory_escalation' | i18n }}</label>
                  <input
                    type="number"
                    [ngModel]="escalation()"
                    (ngModelChange)="onEscalationChange($event)"
                    min="1"
                    class="escalation-input"
                  />
                </div>
                <div class="form-group">
                  <label>{{ 'setup_pow_scaling' | i18n }}</label>
                  <select
                    [ngModel]="compressionLevel()"
                    (ngModelChange)="compressionLevel.set($event)"
                  >
                    <option value="1">{{ 'setup_pow_x1' | i18n }}</option>
                    <option value="2">{{ 'setup_pow_x2' | i18n }}</option>
                    <option value="3">{{ 'setup_pow_x3' | i18n }}</option>
                    <option value="4">{{ 'setup_pow_x4' | i18n }}</option>
                    <option value="5">{{ 'setup_pow_x5' | i18n }}</option>
                    <option value="6">{{ 'setup_pow_x6' | i18n }}</option>
                  </select>
                </div>
              </div>
              <div class="checkbox-row standalone">
                <label class="checkbox-option">
                  <input
                    type="checkbox"
                    [ngModel]="directIo()"
                    (ngModelChange)="directIo.set($event)"
                  />
                  {{ 'setup_direct_io' | i18n }}
                </label>
                <label class="checkbox-option">
                  <input
                    type="checkbox"
                    [ngModel]="lowPriority()"
                    (ngModelChange)="lowPriority.set($event)"
                  />
                  {{ 'setup_low_priority' | i18n }}
                </label>
              </div>

              <!-- Performance Hint Table (GPU only) -->
              @if (selectedGpuInfo() && performanceHintEntries().length > 0) {
                <div class="performance-hint">
                  <div class="performance-hint-header">{{ 'setup_performance_hint' | i18n }}</div>
                  <div class="performance-hint-desc">
                    {{ 'setup_optimal_combinations' | i18n: { device: selectedGpuInfo()!.name } }}
                  </div>
                  <table class="performance-table">
                    <thead>
                      <tr>
                        <th>{{ 'setup_cus' | i18n }}</th>
                        <th>{{ 'setup_memory_escalation' | i18n }}</th>
                        <th>{{ 'setup_occupancy' | i18n }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (entry of performanceHintEntries(); track entry.cus) {
                        <tr
                          [class.current]="
                            entry.cus === getDeviceThreads(selectedGpuInfo()!.id) &&
                            entry.escalation === escalation()
                          "
                        >
                          <td>{{ entry.cus }}</td>
                          <td>{{ entry.escalation }}</td>
                          <td>{{ entry.usagePercent | number: '1.0-0' }}%</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Step 3: Drives -->
      @if (currentStep() === 2) {
        <!-- Plot Directories Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_plot_directories' | i18n }}</span>
            <button class="btn btn-secondary btn-sm" (click)="addDrive()">
              {{ 'setup_add_folders' | i18n }}
            </button>
          </div>
          <div class="section-content drives-section">
            <!-- Summary Totals (centered, with color legend) -->
            <div class="drives-summary">
              <div class="summary-item">
                <span class="summary-value plotted">{{ formatSize(plottedGib()) }}</span>
                <span class="summary-label">{{ 'setup_plotted' | i18n }}</span>
              </div>
              <div class="summary-item">
                <span class="summary-value unfinished">{{ formatSize(unfinishedGib()) }}</span>
                <span class="summary-label">{{ 'setup_unfinished' | i18n }}</span>
              </div>
              <div class="summary-item">
                <span class="summary-value to-plot">{{ formatSize(toPlotGib()) }}</span>
                <span class="summary-label">{{ 'setup_to_plot' | i18n }}</span>
              </div>
              <div class="summary-item">
                <span class="summary-value total">{{ formatSize(totalPlotGib()) }}</span>
                <span class="summary-label">{{ 'setup_total' | i18n }}</span>
              </div>
            </div>

            @for (drive of availableDrives(); track drive.path) {
              <div class="drive-card" [class.system-drive]="drive.isSystemDrive">
                <!-- Line 1: Path + Capacity + Actions -->
                <div class="drive-header">
                  <span class="drive-path">{{ drive.path }}</span>
                  <span class="capacity-badge"
                    >{{ 'setup_total_capacity' | i18n }} {{ formatSize(drive.totalGib) }}</span
                  >
                  @if (drive.isSystemDrive) {
                    <span class="system-badge" [title]="'setup_system_drive_warning' | i18n"
                      >&#9888;</span
                    >
                  }
                  <div class="drive-actions">
                    <button
                      class="drive-refresh"
                      (click)="refreshDrive(drive)"
                      [title]="'setup_refresh' | i18n"
                    >
                      &#8635;
                    </button>
                    <button class="drive-remove" (click)="removeDrive(drive)">&#10005;</button>
                  </div>
                </div>

                <!-- Line 2: Segmented Bar -->
                <div class="segment-bar-container">
                  <div class="segment-bar">
                    @if (getOtherDataGib(drive) > 0) {
                      <div
                        class="segment other"
                        [style.flex]="getOtherDataGib(drive)"
                        [title]="'setup_other_data_tooltip' | i18n"
                      >
                        <span class="segment-label">{{ formatSize(getOtherDataGib(drive)) }}</span>
                      </div>
                    }
                    @if (drive.completeSizeGib > 0) {
                      <div
                        class="segment existing"
                        [style.flex]="drive.completeSizeGib"
                        [title]="'setup_plotted_tooltip' | i18n"
                      >
                        <span class="segment-label">{{ formatSize(drive.completeSizeGib) }}</span>
                      </div>
                    }
                    @if (drive.incompleteSizeGib > 0) {
                      <div
                        class="segment unfinished"
                        [style.flex]="drive.incompleteSizeGib"
                        [title]="'setup_unfinished_tooltip' | i18n"
                      >
                        <span class="segment-label">{{ formatSize(drive.incompleteSizeGib) }}</span>
                      </div>
                    }
                    @if (getToPlotGib(drive) > 0) {
                      <div
                        class="segment allocated"
                        [style.flex]="getToPlotGib(drive)"
                        [title]="'setup_to_plot_tooltip' | i18n"
                      >
                        <span class="segment-label">+{{ formatSize(getToPlotGib(drive)) }}</span>
                      </div>
                    }
                    @if (getRemainingFree(drive) > 0) {
                      <div
                        class="segment free"
                        [style.flex]="getRemainingFree(drive)"
                        [title]="'setup_free_tooltip' | i18n"
                      >
                        <span class="segment-label"
                          >{{ formatSize(getRemainingFree(drive)) }} {{ 'setup_free' | i18n }}</span
                        >
                      </div>
                    }
                  </div>
                </div>

                <!-- Line 3: Slider (0 to free space = new space to plot) -->
                <div class="drive-controls">
                  <input
                    type="range"
                    class="slider"
                    min="0"
                    [max]="getNewPlotMax(drive)"
                    [ngModel]="getNewPlotValue(drive)"
                    (ngModelChange)="onNewPlotChange(drive, $event)"
                    step="1"
                  />
                  <div class="gib-input">
                    <input
                      type="number"
                      min="0"
                      [max]="getNewPlotMax(drive)"
                      [ngModel]="getNewPlotValue(drive)"
                      (ngModelChange)="onNewPlotChange(drive, $event)"
                    />
                    <span class="unit">GiB</span>
                  </div>
                </div>
              </div>
            }

            @if (availableDrives().length === 0) {
              <div class="empty-state">
                <span class="empty-icon">&#128193;</span>
                <p>{{ 'setup_no_drives_configured' | i18n }}</p>
                <p class="hint">{{ 'setup_add_folder_hint' | i18n }}</p>
              </div>
            }
          </div>
        </div>

        <!-- Advanced Options Section -->
        <div class="section">
          <div class="section-header">
            <span class="section-title">{{ 'setup_advanced_options' | i18n }}</span>
            <button class="collapse-toggle" (click)="toggleAdvanced('step3')">
              <span>{{ advancedStep3Open() ? ('setup_hide' | i18n) : ('setup_show' | i18n) }}</span>
              <span>{{ advancedStep3Open() ? '&#9660;' : '&#9654;' }}</span>
            </button>
          </div>
          @if (advancedStep3Open()) {
            <div class="section-content">
              <div class="form-row">
                <div class="form-group">
                  <label>{{ 'setup_hdd_wakeup' | i18n }}</label>
                  <input
                    type="number"
                    [ngModel]="hddWakeup()"
                    (ngModelChange)="hddWakeup.set($event)"
                    min="0"
                  />
                </div>
              </div>
              <div class="form-row">
                <label class="checkbox-option">
                  <input
                    type="checkbox"
                    [ngModel]="miningDirectIo()"
                    (ngModelChange)="miningDirectIo.set($event)"
                  />
                  {{ 'setup_mining_direct_io' | i18n }}
                </label>
              </div>
            </div>
          }
        </div>
      }

      <!-- Navigation Footer -->
      <div class="wizard-footer">
        @if (currentStep() > 0) {
          <button class="btn btn-ghost" (click)="previousStep()">
            &larr; {{ 'setup_back' | i18n }}
          </button>
        } @else {
          <button class="btn btn-ghost" (click)="cancel()">{{ 'setup_cancel' | i18n }}</button>
        }
        <div class="footer-right">
          @if (currentStep() === 2 || !isFirstRun()) {
            <button class="btn btn-success" (click)="saveAndStart()" [disabled]="saving()">
              {{ saving() ? ('setup_saving' | i18n) : ('setup_save_close' | i18n) }}
            </button>
          }
          @if (currentStep() < 2) {
            <button class="btn btn-primary" (click)="nextStep()">
              {{ 'setup_next' | i18n }} &rarr;
            </button>
          }
        </div>
      </div>
    </div>

    <!-- Chain Add/Edit Modal -->
    @if (chainModalOpen()) {
      <div class="modal-overlay" (click)="closeChainModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>
              {{ editingChain() ? ('setup_edit_chain' | i18n) : ('setup_add_chain_title' | i18n) }}
            </h3>
          </div>
          <div class="modal-content">
            <div class="form-group" style="margin-bottom: 16px;">
              <label>{{ 'setup_type' | i18n }}</label>
              <div class="mode-tabs">
                <button
                  class="mode-tab"
                  [class.active]="chainModalData().mode === 'solo'"
                  (click)="setChainMode('solo')"
                >
                  {{ 'setup_solo_local' | i18n }}
                </button>
                <button
                  class="mode-tab"
                  [class.active]="chainModalData().mode === 'pool'"
                  (click)="setChainMode('pool')"
                >
                  {{ 'setup_pool' | i18n }}
                </button>
                <button
                  class="mode-tab"
                  [class.active]="chainModalData().mode === 'custom'"
                  (click)="setChainMode('custom')"
                >
                  {{ 'setup_custom' | i18n }}
                </button>
              </div>
            </div>

            <!-- Solo Mode -->
            @if (chainModalData().mode === 'solo') {
              <div class="info-box solo">
                <strong>{{ 'setup_solo_mining_info' | i18n }}</strong
                ><br />
                {{ 'setup_solo_mining_desc' | i18n }}
              </div>
            }

            <!-- Pool Mode -->
            @if (chainModalData().mode === 'pool') {
              <div class="form-group" style="margin-bottom: 16px;">
                <label>{{ 'setup_select_pool' | i18n }}</label>
                <select
                  [ngModel]="chainModalData().poolUrl"
                  (ngModelChange)="updateChainModal('poolUrl', $event)"
                >
                  <option value="">{{ 'setup_select_pool_placeholder' | i18n }}</option>
                  <option value="https://pool.pocx.io:8080/api">
                    PoCX Pool Alpha (pool.pocx.io)
                  </option>
                  <option value="https://pool2.pocx.io:8080/api">
                    PoCX Pool Beta (pool2.pocx.io)
                  </option>
                  <option value="https://community.pocx.io:8080/api">
                    Community Pool (community.pocx.io)
                  </option>
                </select>
              </div>
              <div class="form-group">
                <label>{{ 'setup_bearer_token' | i18n }}</label>
                <input
                  type="text"
                  [ngModel]="chainModalData().poolToken"
                  (ngModelChange)="updateChainModal('poolToken', $event)"
                  [placeholder]="'setup_pool_token_placeholder' | i18n"
                />
              </div>
            }

            <!-- Custom Mode -->
            @if (chainModalData().mode === 'custom') {
              <div class="form-group" style="margin-bottom: 16px;">
                <label>{{ 'setup_chain_name' | i18n }}</label>
                <input
                  type="text"
                  [ngModel]="chainModalData().chainName"
                  (ngModelChange)="updateChainModal('chainName', $event)"
                  [placeholder]="'setup_chain_name_placeholder' | i18n"
                />
              </div>
              <div class="form-group" style="margin-bottom: 16px;">
                <label>{{ 'setup_endpoint_url' | i18n }}</label>
                <input
                  type="text"
                  [ngModel]="chainModalData().customUrl"
                  (ngModelChange)="updateChainModal('customUrl', $event)"
                  placeholder="https://example.com:8332"
                />
              </div>
              <div class="form-group" style="margin-bottom: 16px;">
                <label>{{ 'setup_api_path' | i18n }}</label>
                <input
                  type="text"
                  [ngModel]="chainModalData().customApiPath"
                  (ngModelChange)="updateChainModal('customApiPath', $event)"
                  placeholder="/api"
                />
              </div>
              <div class="form-row" style="margin-bottom: 16px;">
                <div class="form-group">
                  <label>{{ 'setup_mode' | i18n }}</label>
                  <select
                    [ngModel]="chainModalData().customMode"
                    (ngModelChange)="updateChainModal('customMode', $event)"
                  >
                    <option value="solo">{{ 'setup_wallet_solo' | i18n }}</option>
                    <option value="pool">{{ 'setup_pool' | i18n }}</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>{{ 'setup_block_time' | i18n }}</label>
                  <input
                    type="number"
                    [ngModel]="chainModalData().customBlockTime"
                    (ngModelChange)="updateChainModal('customBlockTime', $event)"
                  />
                </div>
              </div>
              <div class="form-group">
                <label>{{ 'setup_auth_token' | i18n }}</label>
                <input
                  type="text"
                  [ngModel]="chainModalData().customToken"
                  (ngModelChange)="updateChainModal('customToken', $event)"
                  [placeholder]="'setup_auth_token_placeholder' | i18n"
                />
              </div>
            }
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" (click)="closeChainModal()">{{ 'cancel' | i18n }}</button>
            <button class="btn btn-primary" (click)="saveChain()">
              {{ editingChain() ? ('setup_save' | i18n) : ('setup_add' | i18n) }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      * {
        box-sizing: border-box;
      }

      :host {
        display: block;
        font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: #eaf0f6;
        color: rgb(0, 35, 65);
      }

      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .header-left h1 {
        margin: 0;
        font-weight: 300;
        font-size: 24px;
      }

      .back-button {
        color: rgba(255, 255, 255, 0.9);
      }

      .back-button:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      .wizard-container {
        max-width: 700px;
        margin: 0 auto;
        padding: 16px 16px 0 16px;
      }

      .step-indicator {
        display: flex;
        align-items: center;
        margin-bottom: 16px;
        padding: 12px 16px;
        background: #ffffff;
        border-radius: 6px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
      }

      .step {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .step-circle {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        background: #e0e0e0;
        color: #9e9e9e;
      }

      .step-circle.active {
        background: #1976d2;
        color: white;
      }

      .step-circle.complete {
        background: #4caf50;
        color: white;
      }

      .step-circle.inactive {
        background: #e0e0e0;
        color: #9e9e9e;
      }

      .step-label {
        font-size: 12px;
        color: #666666;
      }

      .step-label.active {
        color: rgb(0, 35, 65);
        font-weight: 500;
      }

      .step-line {
        flex: 1;
        height: 2px;
        background: #e0e0e0;
        margin: 0 10px;
      }

      .step-line.complete {
        background: #4caf50;
      }

      .section {
        background: #ffffff;
        border-radius: 6px;
        margin-bottom: 12px;
        overflow: hidden;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
      }

      .section:last-of-type {
        margin-bottom: 0;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      }

      .section-title {
        font-size: 12px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #ffffff;
      }

      .section-header .btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: #ffffff;
        padding: 3px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
      }

      .section-header .btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .section-content {
        padding: 12px 16px;
      }

      .collapse-toggle {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: #ffffff;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
        display: flex;
        gap: 4px;
        align-items: center;
      }

      .collapse-toggle:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      /* Chain Configuration */
      .chain-list-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        padding: 0 4px;
      }

      .chain-list-label {
        font-size: 11px;
        font-weight: 600;
        color: #1976d2;
        text-transform: uppercase;
      }

      .chain-list-hint {
        flex: 1;
        font-size: 11px;
        color: #666;
      }

      .chain-list {
        background: #f8f9fa;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
        overflow: hidden;
      }

      .chain-item {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid #e0e0e0;
        gap: 12px;
        background: #ffffff;
      }

      .chain-item:last-child {
        border-bottom: none;
      }

      /* CDK Drag and Drop styles */
      .cdk-drag-preview {
        box-sizing: border-box;
        border-radius: 4px;
        box-shadow:
          0 5px 5px -3px rgba(0, 0, 0, 0.2),
          0 8px 10px 1px rgba(0, 0, 0, 0.14),
          0 3px 14px 2px rgba(0, 0, 0, 0.12);
        background: white;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 8px;
      }

      .cdk-drag-placeholder {
        opacity: 0.3;
        background: #e3f2fd;
      }

      .cdk-drag-animating {
        transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
      }

      .chain-list.cdk-drop-list-dragging .chain-item:not(.cdk-drag-placeholder) {
        transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
      }

      .drag-handle {
        cursor: grab;
        color: #9e9e9e;
        font-size: 14px;
        padding: 4px;
        user-select: none;
      }

      .drag-handle:hover {
        color: #616161;
      }

      .cdk-drag-preview .drag-handle {
        cursor: grabbing;
      }

      .chain-empty {
        padding: 24px;
        text-align: center;
        color: #666666;
        font-size: 13px;
      }

      .priority-slot {
        width: 28px;
        height: 28px;
        background: #1976d2;
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        cursor: grab;
      }

      .chain-info {
        flex: 1;
      }

      .chain-name {
        font-size: 14px;
        font-weight: 500;
        color: rgb(0, 35, 65);
      }

      .chain-url {
        font-size: 12px;
        color: #666666;
        margin-top: 2px;
      }

      .chain-mode {
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
      }

      .chain-mode.solo {
        background: rgba(76, 175, 80, 0.15);
        color: #2e7d32;
      }

      .chain-mode.pool {
        background: rgba(25, 118, 210, 0.15);
        color: #1565c0;
      }

      .chain-actions {
        display: flex;
        gap: 8px;
      }

      .edit-btn {
        background: none;
        border: none;
        color: #9e9e9e;
        cursor: pointer;
        padding: 4px;
        font-size: 14px;
      }

      .edit-btn:hover {
        color: #1976d2;
      }

      .remove-btn {
        background: none;
        border: 1px solid #e0e0e0;
        color: #666666;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
      }

      .remove-btn:hover {
        border-color: #d32f2f;
        color: #d32f2f;
        background: rgba(211, 47, 47, 0.05);
      }

      .btn-row {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }

      /* Device Items */
      .device-item {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        gap: 10px;
        background: #f8f9fa;
        border-radius: 6px;
        border: 1px solid #e0e0e0;
        margin-bottom: 6px;
      }

      .device-item:last-child {
        margin-bottom: 0;
      }

      .device-radio {
        width: 18px;
        height: 18px;
        accent-color: #1976d2;
        cursor: pointer;
        flex-shrink: 0;
      }

      .device-icon {
        width: 36px;
        height: 36px;
        background: #e0e0e0;
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.3px;
        gap: 1px;
        flex-shrink: 0;
      }

      .device-icon .icon-glyph {
        font-size: 13px;
        line-height: 1;
      }

      .device-icon.cpu {
        background: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
        color: #2e7d32;
      }

      .device-icon.gpu {
        background: rgba(25, 118, 210, 0.1);
        border: 1px solid rgba(25, 118, 210, 0.3);
        color: #1976d2;
      }

      .device-icon.apu {
        background: rgba(255, 152, 0, 0.1);
        border: 1px solid rgba(255, 152, 0, 0.3);
      }

      .apu-badge {
        background: rgba(255, 152, 0, 0.2);
        color: #ff9800;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 9px;
        font-weight: 600;
        margin-left: 6px;
      }

      .device-info {
        flex: 1;
        min-width: 0;
      }

      .device-name {
        font-size: 13px;
        font-weight: 500;
        color: rgb(0, 35, 65);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .device-specs {
        font-size: 11px;
        color: #666666;
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .device-config {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .thread-input {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .thread-input input {
        width: 50px;
        padding: 4px 6px;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        color: rgb(0, 35, 65);
        font-size: 12px;
        text-align: center;
      }

      .thread-input input:focus {
        outline: none;
        border-color: #1976d2;
      }

      .thread-input input:disabled {
        opacity: 0.5;
      }

      .thread-max {
        font-size: 11px;
        color: #888888;
        min-width: 70px;
      }

      .benchmark-display {
        min-width: 95px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .benchmark-btn {
        height: 24px;
        padding: 0 8px;
        background: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        color: #424242;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .benchmark-btn:hover:not(:disabled) {
        background: #e3f2fd;
        border-color: #1976d2;
      }

      .benchmark-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .redo-btn {
        width: 20px;
        height: 20px;
        padding: 0;
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 12px;
        color: #757575;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        border-radius: 50%;
      }

      .redo-btn:hover:not(:disabled) {
        background: #e0e0e0;
        color: #424242;
      }

      .redo-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .benchmark-progress {
        width: 70px;
        height: 5px;
        background: #e0e0e0;
        border-radius: 3px;
        overflow: hidden;
      }

      .benchmark-progress .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #1976d2, #42a5f5);
        border-radius: 3px;
        transition: width 0.1s ease-out;
      }

      .benchmark-result {
        font-size: 11px;
        font-weight: 600;
        color: #2e7d32;
        background: #e8f5e9;
        padding: 3px 6px;
        border-radius: 4px;
      }

      .benchmark-error {
        font-size: 11px;
        font-weight: 600;
        color: #c62828;
        background: #ffebee;
        padding: 3px 6px;
        border-radius: 4px;
        cursor: help;
      }

      .thread-slider-container {
        margin-top: 12px;
        padding: 12px;
        background: #f8f9fa;
        border-radius: 6px;
        border: 1px solid #e0e0e0;
      }

      .slider-label {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 12px;
        color: #666666;
      }

      .slider-wrapper {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .gib-input {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .gib-input input {
        width: 70px;
        padding: 4px 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 12px;
        text-align: right;
      }

      .gib-input input:focus {
        outline: none;
        border-color: #1976d2;
      }

      .gib-input .unit {
        font-size: 11px;
        color: #666;
      }

      .slider {
        flex: 1;
        -webkit-appearance: none;
        height: 6px;
        background: #e0e0e0;
        border-radius: 3px;
        outline: none;
      }

      .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        background: #1976d2;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(25, 118, 210, 0.4);
      }

      .slider-value {
        min-width: 100px;
        text-align: right;
        font-weight: 500;
        color: #1976d2;
        font-size: 14px;
      }

      /* Radio Groups */
      .radio-group {
        background: #f8f9fa;
        border-radius: 6px;
        border: 1px solid #e0e0e0;
        padding: 10px 12px;
      }

      .radio-option {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 6px 0;
        cursor: pointer;
      }

      .radio-option:first-child {
        padding-top: 0;
      }

      .radio-option:last-child {
        padding-bottom: 0;
      }

      .radio-option input[type='radio'] {
        width: 16px;
        height: 16px;
        accent-color: #1976d2;
        margin-top: 2px;
        flex-shrink: 0;
      }

      .radio-label {
        flex: 1;
        min-width: 0;
      }

      .radio-label-main {
        font-size: 13px;
        color: rgb(0, 35, 65);
      }

      .radio-label-sub {
        font-size: 11px;
        color: #666666;
        margin-top: 1px;
        font-family: 'Consolas', monospace;
      }

      .radio-label-sub.address-full {
        font-size: 12px;
        word-break: break-all;
        white-space: normal;
        max-width: 100%;
        color: #444444;
        margin-top: 4px;
      }

      .input-field {
        width: 100%;
        padding: 8px 10px;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        color: rgb(0, 35, 65);
        font-size: 13px;
        margin-top: 6px;
      }

      .input-field:focus {
        outline: none;
        border-color: #1976d2;
      }

      .input-field:disabled {
        opacity: 0.5;
        background: #f5f5f5;
      }

      .address-input-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
      }

      .address-input {
        flex: 1;
        margin-top: 0 !important;
      }

      .address-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        padding: 4px 6px;
        border-radius: 4px;
        cursor: help;
        flex-shrink: 0;
      }

      .address-badge.error {
        font-size: 10px;
        font-weight: 600;
        color: #c62828;
        background: rgba(211, 47, 47, 0.15);
      }

      .address-badge.success {
        background: rgba(76, 175, 80, 0.2);
        border: 1px solid rgba(76, 175, 80, 0.4);
      }

      .address-badge.warning {
        background: rgba(255, 152, 0, 0.2);
        border: 1px solid rgba(255, 152, 0, 0.4);
      }

      /* Memory Estimation Box */
      .memory-estimation {
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 16px;
      }

      .memory-estimation-header {
        font-size: 12px;
        font-weight: 600;
        color: #666666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
      }

      .memory-breakdown {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .memory-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        padding: 2px 0;
      }

      .memory-label {
        color: #666666;
      }

      .memory-value {
        font-weight: 500;
        font-family: 'Consolas', monospace;
        color: rgb(0, 35, 65);
      }

      .memory-total {
        border-top: 1px solid #d0d0d0;
        margin-top: 6px;
        padding-top: 8px;
        font-weight: 600;
      }

      .memory-total .memory-label,
      .memory-total .memory-value {
        font-weight: 600;
        color: rgb(0, 35, 65);
      }

      .memory-available {
        color: #666666;
        font-size: 12px;
      }

      .memory-available .memory-value {
        font-weight: 500;
      }

      .memory-available .memory-value.warning {
        color: #d32f2f;
      }

      .checkbox-row.standalone {
        margin-top: 8px;
      }

      /* Performance Hint Table */
      .performance-hint {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
      }

      .performance-hint-header {
        font-size: 12px;
        font-weight: 600;
        color: #666666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }

      .performance-hint-desc {
        font-size: 12px;
        color: #888888;
        margin-bottom: 10px;
      }

      .performance-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        font-family: 'Consolas', monospace;
      }

      .performance-table th,
      .performance-table td {
        padding: 6px 12px;
        text-align: right;
        border-bottom: 1px solid #e8e8e8;
      }

      .performance-table th {
        font-weight: 600;
        color: #666666;
        background: #f0f0f0;
        text-align: right;
      }

      .performance-table th:first-child,
      .performance-table td:first-child {
        text-align: left;
      }

      .performance-table tbody tr:hover {
        background: #f5f5f5;
      }

      .performance-table tbody tr.current {
        background: rgba(25, 118, 210, 0.1);
        font-weight: 600;
      }

      .performance-table tbody tr.current td {
        color: #1976d2;
      }

      /* Form Elements */
      .form-row {
        display: flex;
        gap: 16px;
        margin-bottom: 12px;
      }

      .form-row:last-child {
        margin-bottom: 0;
      }

      .form-group {
        flex: 1;
      }

      .form-group label {
        display: block;
        font-size: 12px;
        color: #666666;
        margin-bottom: 6px;
        font-weight: 500;
      }

      .form-group input,
      .form-group select {
        width: 100%;
        padding: 8px 12px;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        color: rgb(0, 35, 65);
        font-size: 13px;
      }

      .form-group input:focus,
      .form-group select:focus {
        outline: none;
        border-color: #1976d2;
      }

      .checkbox-row {
        display: flex;
        gap: 24px;
      }

      .checkbox-option {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: rgb(0, 35, 65);
        cursor: pointer;
      }

      .checkbox-option input[type='checkbox'] {
        width: 16px;
        height: 16px;
        accent-color: #1976d2;
      }

      /* Drives Section */
      .drives-section {
        display: flex;
        flex-direction: column;
        max-height: 500px;
        overflow-y: auto;
      }

      /* Summary Totals - Centered with Color Legend */
      .drives-summary {
        display: flex;
        justify-content: center;
        gap: 40px;
        padding: 10px 16px;
        margin-bottom: 12px;
        background: #ffffff;
        border-radius: 6px;
        border: 1px solid #e8e8e8;
      }

      .drives-summary .summary-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .drives-summary .summary-value {
        font-size: 20px;
        font-weight: 600;
        font-family: 'Consolas', monospace;
      }

      .drives-summary .summary-value.plotted {
        color: #4caf50;
      }

      .drives-summary .summary-value.unfinished {
        color: #9c27b0;
      }

      .drives-summary .summary-value.to-plot {
        color: #1976d2;
      }

      .drives-summary .summary-value.total {
        color: #616161;
      }

      .drives-summary .summary-label {
        font-size: 12px;
        color: #666666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      /* Drive Cards - Compact 3-line Layout with Segmented Bar */
      .drive-card {
        background: #f8f9fa;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
        padding: 12px 16px;
        margin-bottom: 10px;
      }

      .drive-card:last-of-type {
        margin-bottom: 0;
      }

      .drive-card.system-drive {
        border-color: #ffb74d;
        background: #fff8e1;
      }

      /* Line 1: Path + Actions */
      .drive-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }

      .drive-path {
        flex: 1;
        font-size: 13px;
        font-weight: 500;
        font-family: 'Consolas', monospace;
        color: rgb(0, 35, 65);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .capacity-badge {
        padding: 2px 8px;
        background: #e0e0e0;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        color: #616161;
        font-family: 'Consolas', monospace;
      }

      .system-badge {
        color: #e65100;
        font-size: 14px;
        cursor: help;
      }

      .drive-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .drive-refresh,
      .drive-remove {
        background: none;
        border: 1px solid #d0d0d0;
        color: #888888;
        cursor: pointer;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 3px;
        line-height: 1;
      }

      .drive-refresh:hover {
        color: #1976d2;
        border-color: #1976d2;
      }

      .drive-remove:hover {
        color: #d32f2f;
        border-color: #d32f2f;
      }

      /* Line 2: Segmented Bar */
      .segment-bar-container {
        margin-bottom: 8px;
      }

      .segment-bar {
        display: flex;
        height: 24px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid #d0d0d0;
        background: #e8e8e8;
      }

      .segment {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        overflow: hidden;
        transition: flex 0.15s ease-out;
      }

      .segment-label {
        font-size: 10px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 6px;
      }

      .segment.existing {
        background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);
        color: white;
      }

      .segment.unfinished {
        background: linear-gradient(135deg, #9c27b0 0%, #ba68c8 100%);
        color: white;
      }

      .segment.other {
        background: linear-gradient(135deg, #757575 0%, #9e9e9e 100%);
        color: white;
      }

      .segment.allocated {
        background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%);
        color: white;
      }

      .segment.free {
        background: #f5f5f5;
        color: #888888;
      }

      /* Line 3: Slider + Controls */
      .drive-controls {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .drive-controls .slider {
        flex: 1;
        min-width: 80px;
      }

      .drive-controls .gib-input {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .drive-controls .gib-input input {
        width: 60px;
        padding: 4px 6px;
        border: 1px solid #e0e0e0;
        border-radius: 3px;
        font-size: 12px;
        text-align: right;
      }

      .drive-controls .gib-input .unit {
        font-size: 11px;
        color: #888888;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 48px 32px;
        color: #666666;
        flex: 1;
      }

      .empty-icon {
        font-size: 48px;
        display: block;
        margin-bottom: 8px;
      }

      .hint {
        font-size: 12px;
        margin-top: 4px;
      }

      /* Info Box */
      .info-box {
        background: rgba(25, 118, 210, 0.08);
        border: 1px solid rgba(25, 118, 210, 0.2);
        border-radius: 6px;
        padding: 10px 12px;
        margin-top: 10px;
        font-size: 12px;
        color: #555555;
      }

      .info-box strong {
        color: #1976d2;
      }

      .info-box.solo {
        background: rgba(76, 175, 80, 0.1);
        border-color: rgba(76, 175, 80, 0.3);
      }

      .info-box.solo strong {
        color: #2e7d32;
      }

      /* Buttons */
      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-secondary {
        background: #ffffff;
        color: rgb(0, 35, 65);
        border: 1px solid #d0d0d0;
      }

      .btn-secondary:hover {
        background: #f8f9fa;
        border-color: #1976d2;
      }

      .btn-sm {
        padding: 6px 12px;
        font-size: 11px;
      }

      .btn-primary {
        background: #1976d2;
        color: white;
      }

      .btn-primary:hover {
        background: #1565c0;
        box-shadow: 0 2px 8px rgba(25, 118, 210, 0.4);
      }

      .btn-ghost {
        background: #ffffff;
        color: #666666;
        border: 1px solid #d0d0d0;
      }

      .btn-ghost:hover {
        background: #f8f9fa;
        border-color: #1976d2;
        color: #1976d2;
      }

      .btn-success {
        background: #4caf50;
        color: white;
      }

      .btn-success:hover {
        background: #43a047;
        box-shadow: 0 2px 8px rgba(76, 175, 80, 0.4);
      }

      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      /* Footer */
      .wizard-footer {
        display: flex;
        justify-content: space-between;
        margin-top: 20px;
        padding-bottom: 20px;
      }

      .footer-right {
        display: flex;
        gap: 12px;
      }

      /* Modal */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 100;
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .modal {
        background: #ffffff;
        border-radius: 8px;
        width: 500px;
        max-width: 90%;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        overflow: hidden;
      }

      .modal-header {
        padding: 16px 20px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      }

      .modal-header h3 {
        font-size: 16px;
        font-weight: 500;
        color: #ffffff;
        margin: 0;
      }

      .modal-content {
        padding: 20px;
      }

      .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        padding: 16px 20px;
        background: #f8f9fa;
        border-top: 1px solid #e0e0e0;
      }

      .mode-tabs {
        display: flex;
        gap: 0;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        overflow: hidden;
      }

      .mode-tab {
        flex: 1;
        padding: 10px 16px;
        background: #f5f5f5;
        border: none;
        border-right: 1px solid #e0e0e0;
        cursor: pointer;
        font-size: 13px;
        color: #666666;
        transition: all 0.2s;
      }

      .mode-tab:last-child {
        border-right: none;
      }

      .mode-tab:hover {
        background: #eeeeee;
      }

      .mode-tab.active {
        background: #1976d2;
        color: white;
      }

      .advanced-content {
        padding: 16px;
        background: #f8f9fa;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
      }

      .escalation-group {
        flex: 0 0 auto;
        width: auto;
      }

      .escalation-input {
        width: 56px;
        text-align: right;
        padding-right: 8px;
      }
    `,
  ],
})
export class SetupWizardComponent implements OnInit, OnDestroy {
  private readonly miningService = inject(MiningService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly miningRpc = inject(MiningRpcService);
  private readonly store = inject(Store);
  private readonly i18n = inject(I18nService);

  // Wallet settings for solo mining (synced to mining config)
  private readonly walletRpcHost = toSignal(this.store.select(selectRpcHost), {
    initialValue: '127.0.0.1',
  });
  private readonly walletRpcPort = toSignal(this.store.select(selectRpcPort), {
    initialValue: 18332,
  });
  private readonly walletDataDirectory = toSignal(this.store.select(selectDataDirectory), {
    initialValue: '',
  });
  private readonly walletNetwork = toSignal(this.store.select(selectNetwork), {
    initialValue: 'testnet',
  });

  // Event listener cleanup
  private plotterEventUnlisteners: UnlistenFn[] = [];

  // Step management
  readonly currentStep = signal(0);
  readonly saving = signal(false);
  readonly isFirstRun = signal(true);

  // Benchmark state
  readonly benchmarkRunning = signal(false);
  readonly benchmarkingDevice = signal<string | null>(null); // null, 'cpu', or gpu.id
  readonly benchmarkProgress = signal(0);
  readonly benchmarkResults = signal<Map<string, number>>(new Map()); // deviceId -> MiB/s
  readonly benchmarkErrors = signal<Map<string, string>>(new Map()); // deviceId -> error message
  private benchmarkTotalWarps = 0;
  private benchmarkHashedWarps = 0;

  // Advanced sections
  readonly advancedStep1Open = signal(false);
  readonly advancedStep2Open = signal(false);
  readonly advancedStep3Open = signal(false);

  // Device info
  readonly cpuInfo = signal<CpuInfo | null>(null);
  readonly gpus = signal<GpuInfo[]>([]);
  readonly systemMemoryGib = signal(0); // Available system RAM

  // Derive available drives from service cache based on driveConfigs
  readonly availableDrives = computed(() => {
    const configs = this.driveConfigs();
    const cache = this.miningService.driveInfoCache();
    return configs
      .map(config => cache.get(config.path))
      .filter((info): info is DriveInfo => info !== undefined);
  });

  // Step 1: Chain + CPU Config
  readonly chainConfigs = signal<ChainConfig[]>([]);
  readonly cpuConfig = signal<CpuConfig>({
    miningThreads: 8,
    plottingThreads: 16,
    maxThreads: 16,
  });
  readonly pollInterval = signal(1000);
  readonly timeout = signal(5000);
  readonly compressionEnabled = signal(true);
  readonly threadPinning = signal(true);

  // Step 2: Plotter config
  readonly plotterDevices = signal<PlotterDeviceConfig[]>([]);
  readonly zeroCopyBuffers = signal(false); // auto-set when APU selected
  readonly useCustomAddress = signal(false);
  readonly walletAddress = signal('');
  readonly customPlottingAddress = signal('');
  readonly addressValidation = signal<AddressInfo | null>(null);
  readonly compressionLevel = signal('1');
  readonly escalation = signal(1); // default 1, min 1
  readonly directIo = signal(true);
  readonly lowPriority = signal(false);

  // Step 3: Drives config
  readonly driveConfigs = signal<DriveConfig[]>([]);
  readonly parallelDrives = signal(1); // Number of drives to plot simultaneously
  readonly hddWakeup = signal(30);
  readonly miningDirectIo = signal(true);

  // Chain modal
  readonly chainModalOpen = signal(false);
  readonly editingChain = signal<ChainConfig | null>(null);
  readonly chainModalData = signal<ChainModalData>({
    mode: 'solo',
    chainName: '',
    poolUrl: '',
    poolToken: '',
    customUrl: '',
    customApiPath: '',
    customMode: 'solo',
    customBlockTime: 120,
    customToken: '',
  });

  // Computed values - GiB based
  readonly totalAllocatedGib = computed(() => {
    return this.driveConfigs().reduce((sum, d) => sum + d.allocatedGib, 0);
  });

  readonly plottedGib = computed(() => {
    // Only complete .pocx files count as "plotted"
    return this.availableDrives().reduce((sum, d) => sum + d.completeSizeGib, 0);
  });

  readonly unfinishedGib = computed(() => {
    // Incomplete .tmp files that need to be finished
    return this.availableDrives().reduce((sum, d) => sum + d.incompleteSizeGib, 0);
  });

  readonly toPlotGib = computed(() => {
    // To plot = total allocated - plotted (unfinished files are included since they need work)
    return Math.max(0, this.totalAllocatedGib() - this.plottedGib());
  });

  readonly totalPlotGib = computed(() => {
    // Total = plotted + unfinished + to plot
    return this.plottedGib() + this.unfinishedGib() + this.toPlotGib();
  });

  // Memory estimation computed signals
  readonly plotterCacheGib = computed(() => {
    const powScaling = parseInt(this.compressionLevel(), 10);
    const escalation = this.escalation();
    return Math.pow(2, powScaling) * escalation;
  });

  readonly hddCacheGib = computed(() => {
    return this.escalation() * this.parallelDrives();
  });

  readonly gpuMemoryGib = computed(() => {
    // Find the enabled device
    const enabledDevice = this.plotterDevices().find(d => d.enabled);
    if (!enabledDevice || enabledDevice.deviceId === 'cpu') return 0;

    // Find the GPU info
    const gpu = this.gpus().find(g => g.id === enabledDevice.deviceId);
    if (!gpu) return 0;

    // Use user-selected CU count (threads) not max
    const computeUnits = enabledDevice.threads;
    const kws = gpu.kernelWorkgroupSize;

    // Formula: 2 * compute_units * kernel_workgroup_size * 256 * 1024 bytes
    const memBytes = 2 * computeUnits * kws * 256 * 1024;
    let memGib = memBytes / (1024 * 1024 * 1024);

    // APU uses zero-copy buffers, halves GPU memory
    if (gpu.isApu) {
      memGib = memGib / 2;
    }

    return memGib;
  });

  readonly totalEstimatedMemoryGib = computed(() => {
    return this.plotterCacheGib() + this.hddCacheGib() + this.gpuMemoryGib();
  });

  // Performance hint: optimal CU/escalation combinations for selected GPU
  readonly selectedGpuInfo = computed(() => {
    const enabledDevice = this.plotterDevices().find(d => d.enabled);
    if (!enabledDevice || enabledDevice.deviceId === 'cpu') return null;
    return this.gpus().find(g => g.id === enabledDevice.deviceId) || null;
  });

  readonly performanceHintEntries = computed(() => {
    const gpu = this.selectedGpuInfo();
    if (!gpu) return [];

    const wgs = gpu.kernelWorkgroupSize;
    const maxCUs = this.getGpuComputeUnits(gpu);
    const WORK_PACKAGE = 8192;

    const gcd = (a: number, b: number): number => {
      while (b !== 0) {
        [a, b] = [b, a % b];
      }
      return a;
    };

    // Calculate entries for CU counts from 16 to max
    const entries: Array<{ cus: number; escalation: number; usagePercent: number }> = [];
    const startCUs = Math.min(16, maxCUs);

    for (let cus = startCUs; cus <= maxCUs; cus++) {
      const totalBlock = cus * wgs;
      const escalation = Math.floor(
        (WORK_PACKAGE * totalBlock) / gcd(WORK_PACKAGE, totalBlock) / WORK_PACKAGE
      );
      const usagePercent = (cus / maxCUs) * 100;
      entries.push({ cus, escalation, usagePercent });
    }

    // Reverse Pareto filter: keep only entries with minimal escalation for given usage
    entries.sort((a, b) => b.usagePercent - a.usagePercent);
    const filtered: typeof entries = [];
    let minEscalationSeen = Infinity;

    for (const e of entries) {
      if (e.escalation < minEscalationSeen) {
        filtered.push(e);
        minEscalationSeen = e.escalation;
      }
    }

    // Sort by CUs for display
    filtered.sort((a, b) => a.cus - b.cus);
    return filtered;
  });

  async ngOnInit(): Promise<void> {
    // Check for step query parameter FIRST to avoid visual jump
    const stepParam = this.route.snapshot.queryParamMap.get('step');
    if (stepParam) {
      const step = parseInt(stepParam, 10);
      if (!isNaN(step) && step >= 0 && step <= 2) {
        this.currentStep.set(step);
        // If navigating to specific step, this is not first run
        this.isFirstRun.set(false);
      }
    }

    await this.loadDeviceInfo();
    await this.loadWalletAddress();
    await this.loadExistingConfig();
    await this.setupBenchmarkListener();
  }

  ngOnDestroy(): void {
    // Cleanup plotter event listeners
    for (const unlisten of this.plotterEventUnlisteners) {
      unlisten();
    }
    this.plotterEventUnlisteners = [];
  }

  private async setupBenchmarkListener(): Promise<void> {
    // Clean up any existing listeners
    for (const unlisten of this.plotterEventUnlisteners) {
      unlisten();
    }
    this.plotterEventUnlisteners = [];

    // Listen for plotter started - get total warps
    const startedUnlisten = await listen<PlotterStartedEvent>('plotter:started', event => {
      this.benchmarkTotalWarps = event.payload.totalWarps;
      this.benchmarkHashedWarps = 0;
      this.benchmarkProgress.set(0);
    });
    this.plotterEventUnlisteners.push(startedUnlisten);

    // Listen for hashing progress - accumulate warps
    const hashingUnlisten = await listen<PlotterHashingProgressEvent>(
      'plotter:hashing-progress',
      event => {
        this.benchmarkHashedWarps += event.payload.warpsDelta;
        if (this.benchmarkTotalWarps > 0) {
          const progress = this.benchmarkHashedWarps / this.benchmarkTotalWarps;
          this.benchmarkProgress.set(Math.min(progress, 1));
        }
      }
    );
    this.plotterEventUnlisteners.push(hashingUnlisten);

    // Listen for completion
    const completeUnlisten = await listen<PlotterCompleteEvent>('plotter:complete', () => {
      this.benchmarkProgress.set(1);
    });
    this.plotterEventUnlisteners.push(completeUnlisten);

    // Listen for errors
    const errorUnlisten = await listen<PlotterErrorEvent>('plotter:error', event => {
      const deviceId = this.benchmarkingDevice();
      if (deviceId) {
        this.benchmarkErrors.update(m => {
          const newMap = new Map(m);
          newMap.set(deviceId, event.payload.error);
          return newMap;
        });
        // Clear benchmarking device so the error badge shows instead of progress bar
        this.benchmarkingDevice.set(null);
      }
      this.benchmarkProgress.set(0);
      this.benchmarkRunning.set(false);
    });
    this.plotterEventUnlisteners.push(errorUnlisten);
  }

  /** Run benchmark for a single device (per-device button) */
  async runSingleDeviceBenchmark(deviceId: string): Promise<void> {
    const address = this.useCustomAddress() ? this.customPlottingAddress() : this.walletAddress();
    if (!address) {
      console.error('[Benchmark] No address available');
      return;
    }

    const device = this.plotterDevices().find(d => d.deviceId === deviceId);
    if (!device) {
      console.error('[Benchmark] Device not found:', deviceId);
      return;
    }

    this.benchmarkRunning.set(true);
    this.benchmarkingDevice.set(deviceId);
    this.benchmarkProgress.set(0);
    this.benchmarkTotalWarps = 0;
    this.benchmarkHashedWarps = 0;

    // Clear any previous error/result for this device
    this.benchmarkErrors.update(m => {
      const newMap = new Map(m);
      newMap.delete(deviceId);
      return newMap;
    });
    this.benchmarkResults.update(m => {
      const newMap = new Map(m);
      newMap.delete(deviceId);
      return newMap;
    });

    console.log(
      `[Benchmark] Starting ${deviceId} with ${device.threads} threads, escalation=${this.escalation()}, zcb=${this.zeroCopyBuffers()}, address: ${address.substring(0, 20)}...`
    );
    const startTime = performance.now();

    try {
      const result = await this.miningService.runBenchmark(
        deviceId,
        device.threads,
        address,
        this.escalation(),
        this.zeroCopyBuffers()
      );
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

      this.benchmarkResults.update(m => {
        const newMap = new Map(m);
        newMap.set(deviceId, result.mibPerSecond);
        return newMap;
      });
      console.log(
        `[Benchmark] ${deviceId}: ${result.mibPerSecond.toFixed(1)} MiB/s (plotter: ${result.durationMs}ms, total: ${elapsed}s)`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Benchmark] ${deviceId} failed:`, errorMsg);
      this.benchmarkErrors.update(m => {
        const newMap = new Map(m);
        newMap.set(deviceId, errorMsg);
        return newMap;
      });
    }

    this.benchmarkingDevice.set(null);
    this.benchmarkProgress.set(0);
    this.benchmarkRunning.set(false);
  }

  getBenchmarkResult(deviceId: string): number | null {
    return this.benchmarkResults().get(deviceId) ?? null;
  }

  getBenchmarkError(deviceId: string): string | null {
    return this.benchmarkErrors().get(deviceId) ?? null;
  }

  private async loadWalletAddress(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    try {
      // Get wallet descriptors (includes full xpub key material)
      const result = await this.walletRpc.listDescriptors(walletName);

      // Find the BIP84 (wpkh) external receive descriptor
      // Look for: active, not internal, starts with "wpkh("
      const bip84Descriptor = result.descriptors.find(
        d => d.active && !d.internal && d.desc.startsWith('wpkh(')
      );

      if (bip84Descriptor) {
        // Derive address at index 0 (first receive address)
        const addresses = await this.walletRpc.deriveAddresses(bip84Descriptor.desc, [0, 0]);
        if (addresses.length > 0) {
          this.walletAddress.set(addresses[0]);
          return;
        }
      }

      // Fallback: generate new address if descriptor approach fails
      const newAddress = await this.walletRpc.getNewAddress(walletName, '', 'bech32');
      this.walletAddress.set(newAddress);
    } catch (error) {
      console.error('Failed to load wallet address:', error);
    }
  }

  private async loadDeviceInfo(): Promise<void> {
    try {
      const deviceInfo = await this.miningService.detectDevices();

      this.cpuInfo.set(deviceInfo.cpu);
      this.gpus.set(deviceInfo.gpus);
      this.systemMemoryGib.set(Math.floor(deviceInfo.availableMemoryMb / 1024));
      // Don't pre-populate availableDrives - user must add folders manually

      if (deviceInfo.cpu) {
        this.cpuConfig.set({
          miningThreads: deviceInfo.cpu.threads,
          plottingThreads: deviceInfo.cpu.threads,
          maxThreads: deviceInfo.cpu.threads,
        });

        // Default CPU as plotting device
        this.plotterDevices.set([
          {
            deviceId: 'cpu',
            enabled: true,
            threads: deviceInfo.cpu.threads,
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to load device info:', error);
    }
  }

  private async loadExistingConfig(): Promise<void> {
    try {
      const config = await this.miningService.getConfig();
      if (config && (config.chains?.length || config.drives?.length)) {
        // Not first run if we have chains or drives configured
        this.isFirstRun.set(false);
        this.chainConfigs.set(config.chains || []);
        this.driveConfigs.set(config.drives || []);

        // Load drive info for existing configured drives (auto-caches in service)
        if (config.drives?.length) {
          await Promise.all(config.drives.map(d => this.miningService.getDriveInfo(d.path)));
          // availableDrives computed signal auto-updates from cache
        }

        if (config.cpuConfig) {
          this.cpuConfig.set(config.cpuConfig);
        }
        if (config.plotterDevices?.length) {
          // Filter out invalid device IDs (old format was "0-0", new format is "0:0:60")
          const validDevices = config.plotterDevices.filter(d => {
            if (d.deviceId === 'cpu') return true;
            // GPU IDs must be "platform:device:cores" format (3 colon-separated integers)
            const parts = d.deviceId.split(':');
            if (parts.length !== 3) return false;
            return parts.every(p => /^\d+$/.test(p));
          });
          this.plotterDevices.set(validDevices);
        }
        if (config.plottingAddress) {
          this.customPlottingAddress.set(config.plottingAddress);
          this.useCustomAddress.set(true);
        }
        // Load other settings
        if (config.escalation) {
          this.escalation.set(config.escalation);
        }
        if (config.lowPriority !== undefined) {
          this.lowPriority.set(config.lowPriority);
        }
        if (config.parallelDrives) {
          this.parallelDrives.set(config.parallelDrives);
        }
        if (config.hddWakeupSeconds) {
          this.hddWakeup.set(config.hddWakeupSeconds);
        }
      }
    } catch (error) {
      console.error('Failed to load existing config:', error);
    }
  }

  // Navigation
  nextStep(): void {
    if (this.currentStep() < 2) {
      this.currentStep.update(s => s + 1);
    }
  }

  previousStep(): void {
    if (this.currentStep() > 0) {
      this.currentStep.update(s => s - 1);
    }
  }

  cancel(): void {
    this.router.navigate(['/mining']);
  }

  toggleAdvanced(step: string): void {
    if (step === 'step1') this.advancedStep1Open.update(v => !v);
    if (step === 'step2') this.advancedStep2Open.update(v => !v);
    if (step === 'step3') this.advancedStep3Open.update(v => !v);
  }

  // Step 1: Chain management
  showChainModal(): void {
    this.editingChain.set(null);
    this.chainModalData.set({
      mode: 'solo',
      chainName: '',
      poolUrl: '',
      poolToken: '',
      customUrl: '',
      customApiPath: '',
      customMode: 'solo',
      customBlockTime: 120,
      customToken: '',
    });
    this.chainModalOpen.set(true);
  }

  editChain(chain: ChainConfig): void {
    this.editingChain.set(chain);
    // Build URL from chain config for display
    const chainUrl = `${chain.rpcTransport}://${chain.rpcHost}:${chain.rpcPort}`;
    // Determine if this is a "custom" chain (user-defined pool endpoint)
    const isCustomPool =
      chain.mode === 'pool' && chain.rpcHost && !chain.rpcHost.includes('pocx.io');
    // Extract token from auth
    const authToken = chain.rpcAuth.type === 'user_pass' ? chain.rpcAuth.password : '';
    this.chainModalData.set({
      mode: isCustomPool ? 'custom' : chain.mode,
      chainName: chain.name,
      poolUrl: chain.mode === 'pool' && !isCustomPool ? chainUrl : '',
      poolToken: authToken,
      customUrl: isCustomPool ? chainUrl : '',
      customApiPath: '', // API path no longer used
      customMode: chain.mode,
      customBlockTime: chain.blockTimeSeconds || 120,
      customToken: authToken,
    });
    this.chainModalOpen.set(true);
  }

  closeChainModal(): void {
    this.chainModalOpen.set(false);
    this.editingChain.set(null);
  }

  setChainMode(mode: ChainMode): void {
    this.chainModalData.update(d => ({ ...d, mode }));
  }

  updateChainModal(field: string, value: unknown): void {
    this.chainModalData.update(d => ({ ...d, [field]: value }));
  }

  saveChain(): void {
    const data = this.chainModalData();
    const editing = this.editingChain();

    let chain: ChainConfig;
    const id = editing?.id || crypto.randomUUID();

    if (data.mode === 'solo') {
      // Solo mode uses wallet RPC settings (host/port read from wallet config)
      // rpcAuth is cookie with no path - backend reads cookie from wallet settings
      chain = {
        id,
        name: 'PoCX Testnet (Local)',
        rpcTransport: 'http',
        rpcHost: '127.0.0.1', // Will be overridden from wallet settings
        rpcPort: 18332, // Will be overridden from wallet settings
        rpcAuth: { type: 'cookie' }, // Backend reads cookie from wallet settings
        blockTimeSeconds: 120,
        mode: 'solo',
        enabled: true,
        priority: editing?.priority ?? this.chainConfigs().length + 1,
      };
    } else if (data.mode === 'pool') {
      const poolName = data.poolUrl.includes('pool.pocx.io')
        ? 'PoCX Pool Alpha'
        : data.poolUrl.includes('pool2.pocx.io')
          ? 'PoCX Pool Beta'
          : 'Community Pool';

      // Parse pool URL to extract host and port
      const { transport, host, port } = this.parseUrl(data.poolUrl);

      chain = {
        id,
        name: poolName,
        rpcTransport: transport,
        rpcHost: host,
        rpcPort: port,
        rpcAuth: data.poolToken
          ? { type: 'user_pass', username: 'pool', password: data.poolToken }
          : { type: 'none' },
        blockTimeSeconds: 120,
        mode: 'pool',
        enabled: true,
        priority: editing?.priority ?? this.chainConfigs().length + 1,
      };
    } else {
      // Custom mode - parse URL and set auth
      const { transport, host, port } = this.parseUrl(data.customUrl);

      chain = {
        id,
        name: data.chainName || 'Custom Chain',
        rpcTransport: transport,
        rpcHost: host,
        rpcPort: port,
        rpcAuth: data.customToken
          ? { type: 'user_pass', username: 'user', password: data.customToken }
          : { type: 'none' },
        blockTimeSeconds: data.customBlockTime,
        mode: data.customMode,
        enabled: true,
        priority: editing?.priority ?? this.chainConfigs().length + 1,
      };
    }

    if (editing) {
      this.chainConfigs.update(chains => chains.map(c => (c.id === editing.id ? chain : c)));
    } else {
      this.chainConfigs.update(chains => [...chains, chain]);
    }

    this.closeChainModal();
  }

  /** Parse URL into transport, host, port */
  private parseUrl(urlStr: string): { transport: 'http' | 'https'; host: string; port: number } {
    try {
      const url = new URL(urlStr);
      const transport = url.protocol === 'https:' ? 'https' : 'http';
      const host = url.hostname;
      const port = url.port ? parseInt(url.port, 10) : transport === 'https' ? 443 : 80;
      return { transport, host, port };
    } catch {
      // Default if URL parsing fails
      return { transport: 'http', host: '127.0.0.1', port: 8080 };
    }
  }

  removeChain(chain: ChainConfig): void {
    this.chainConfigs.update(chains => chains.filter(c => c.id !== chain.id));
  }

  // Chain drag and drop reordering using CDK
  onChainDropped(event: CdkDragDrop<ChainConfig[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.chainConfigs.update(chains => {
        const newChains = [...chains];
        moveItemInArray(newChains, event.previousIndex, event.currentIndex);
        // Update priorities based on new order
        return newChains.map((chain, i) => ({ ...chain, priority: i + 1 }));
      });
    }
  }

  onMiningThreadsChange(value: number): void {
    this.cpuConfig.update(c => ({ ...c, miningThreads: value }));
  }

  // Step 2: Device management
  isDeviceEnabled(deviceId: string): boolean {
    const device = this.plotterDevices().find(d => d.deviceId === deviceId);
    return device?.enabled ?? false;
  }

  getDeviceThreads(deviceId: string): number {
    const device = this.plotterDevices().find(d => d.deviceId === deviceId);
    if (device) return device.threads;
    // Return max threads as default
    return this.getMaxThreadsForDevice(deviceId);
  }

  getMaxThreadsForDevice(deviceId: string): number {
    if (deviceId === 'cpu') {
      return this.cpuInfo()?.threads ?? 16;
    }
    // For GPU, find by gpu.id (format: "platform:device:computeUnits")
    const gpu = this.gpus().find(g => g.id === deviceId);
    if (gpu) {
      return this.getGpuComputeUnits(gpu);
    }
    return 64; // Default fallback
  }

  selectDevice(deviceId: string): void {
    const devices = this.plotterDevices();
    const existing = devices.find(d => d.deviceId === deviceId);

    if (existing) {
      // Disable all devices except the selected one
      this.plotterDevices.set(devices.map(d => ({ ...d, enabled: d.deviceId === deviceId })));
    } else {
      // Add new device as enabled, disable all others
      const maxThreads = this.getMaxThreadsForDevice(deviceId);
      const updatedDevices = devices.map(d => ({ ...d, enabled: false }));
      this.plotterDevices.set([
        ...updatedDevices,
        { deviceId, enabled: true, threads: maxThreads },
      ]);
    }

    // Auto-set zeroCopyBuffers based on whether selected device is an APU
    const gpu = this.gpus().find(g => g.id === deviceId);
    this.zeroCopyBuffers.set(gpu?.isApu ?? false);
  }

  setDeviceThreads(deviceId: string, event: Event): void {
    const threads = parseInt((event.target as HTMLInputElement).value, 10);
    const devices = this.plotterDevices();
    const existing = devices.find(d => d.deviceId === deviceId);

    if (existing) {
      this.plotterDevices.set(devices.map(d => (d.deviceId === deviceId ? { ...d, threads } : d)));
    } else {
      this.plotterDevices.set([...devices, { deviceId, enabled: true, threads }]);
    }
  }

  // Get compute units from GPU id (format: platform:device:computeUnits)
  getGpuComputeUnits(gpu: GpuInfo): number {
    const parts = gpu.id.split(':');
    if (parts.length >= 3) {
      const cu = parseInt(parts[2], 10);
      return isNaN(cu) ? 64 : cu;
    }
    return 64; // Default fallback
  }

  onEscalationChange(value: number): void {
    this.escalation.set(Math.max(1, value));
  }

  async onCustomAddressChange(address: string): Promise<void> {
    this.customPlottingAddress.set(address);
    if (address.length > 10) {
      try {
        // First validate bech32 format
        const result = await this.miningService.validateAddress(address);

        // If valid, check wallet ownership
        if (result.valid) {
          const walletName = this.walletManager.activeWallet;
          if (walletName) {
            try {
              const walletInfo = await this.walletRpc.getAddressInfo(walletName, address);
              result.isMine = walletInfo.ismine;
            } catch {
              // Wallet check failed, but address is still valid
              result.isMine = undefined;
            }

            // If not our address, check if there's a forging assignment to us
            if (!result.isMine) {
              try {
                const assignmentStatus = await this.miningRpc.getAssignmentStatus(address);
                result.hasAssignment =
                  assignmentStatus.has_assignment && assignmentStatus.state === 'ASSIGNED';

                // If assigned, check if the forging_address belongs to our wallet
                if (result.hasAssignment && assignmentStatus.forging_address) {
                  try {
                    const forgingAddrInfo = await this.walletRpc.getAddressInfo(
                      walletName,
                      assignmentStatus.forging_address
                    );
                    result.assignedToUs = forgingAddrInfo.ismine;
                  } catch {
                    result.assignedToUs = false;
                  }
                }
              } catch {
                // Assignment check failed, assume no assignment
                result.hasAssignment = false;
                result.assignedToUs = false;
              }
            }
          }
        }

        this.addressValidation.set(result);
      } catch {
        this.addressValidation.set({ valid: false, address, payloadHex: '', network: 'unknown' });
      }
    } else {
      this.addressValidation.set(null);
    }
  }

  // Step 3: Drive management - GiB based
  getDriveAllocatedGib(path: string): number {
    const config = this.driveConfigs().find(d => d.path === path);
    if (config) return config.allocatedGib;
    // Default to max allocatable (fill the drive)
    const drive = this.availableDrives().find(d => d.path === path);
    return drive ? this.getMaxAllocatable(drive) : 0;
  }

  onDriveAllocatedChange(drive: DriveInfo, value: number): void {
    const config: DriveConfig = {
      path: drive.path,
      enabled: true,
      allocatedGib: value,
    };

    const configs = [...this.driveConfigs()];
    const idx = configs.findIndex(d => d.path === drive.path);
    if (idx >= 0) {
      configs[idx] = config;
    } else {
      configs.push(config);
    }
    this.driveConfigs.set(configs);
  }

  /**
   * Minimum allocatable = what's already plotted (can't go below this).
   */
  getMinAllocatable(drive: DriveInfo): number {
    return Math.floor(drive.completeSizeGib);
  }

  /**
   * Maximum allocatable = plotted + incomplete + free (total possible capacity).
   * System drives must leave 20% free.
   */
  getMaxAllocatable(drive: DriveInfo): number {
    const plotted = drive.completeSizeGib + drive.incompleteSizeGib;
    if (drive.isSystemDrive) {
      const minFreeRequired = drive.totalGib * 0.2;
      const maxFree = Math.max(0, drive.freeGib - minFreeRequired);
      return Math.floor(plotted + maxFree);
    }
    return Math.floor(plotted + drive.freeGib);
  }

  /**
   * Maximum new space that can be plotted (just the available free space).
   * System drives must leave 20% free.
   */
  getNewPlotMax(drive: DriveInfo): number {
    if (drive.isSystemDrive) {
      const minFreeRequired = drive.totalGib * 0.2;
      return Math.floor(Math.max(0, drive.freeGib - minFreeRequired));
    }
    return Math.floor(drive.freeGib);
  }

  /**
   * Current "new to plot" value = allocated - already plotted.
   */
  getNewPlotValue(drive: DriveInfo): number {
    const allocated = this.getDriveAllocatedGib(drive.path);
    const plotted = Math.floor(drive.completeSizeGib + drive.incompleteSizeGib);
    return Math.max(0, allocated - plotted);
  }

  /**
   * Handle slider change for "new to plot" - converts back to total allocation.
   */
  onNewPlotChange(drive: DriveInfo, newToPlot: number): void {
    const plotted = Math.floor(drive.completeSizeGib + drive.incompleteSizeGib);
    const totalAllocated = plotted + newToPlot;
    this.onDriveAllocatedChange(drive, totalAllocated);
  }

  getOtherDataGib(drive: DriveInfo): number {
    // Other data = total capacity - plots - unfinished - free space
    const otherData =
      drive.totalGib - drive.completeSizeGib - drive.incompleteSizeGib - drive.freeGib;
    return Math.max(0, Math.round(otherData));
  }

  /**
   * Get the additional GiB to plot (allocatedGib - already plotted).
   * This is what will actually be plotted when the plan runs.
   */
  getToPlotGib(drive: DriveInfo): number {
    const allocated = this.getDriveAllocatedGib(drive.path);
    const alreadyPlotted = drive.completeSizeGib + drive.incompleteSizeGib;
    return Math.max(0, allocated - alreadyPlotted);
  }

  getRemainingFree(drive: DriveInfo): number {
    // Free space minus what we're going to plot
    const toPlot = this.getToPlotGib(drive);
    return Math.max(0, drive.freeGib - toPlot);
  }

  formatSize(gib: number): string {
    if (gib >= 1024) {
      return `${(gib / 1024).toFixed(1)} TiB`;
    }
    return `${gib.toFixed(0)} GiB`;
  }

  async addDrive(): Promise<void> {
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: 'Select Plot Folder(s)',
      });

      if (!selected) return;

      // Handle both single string and array of strings
      const paths = Array.isArray(selected) ? selected : [selected];

      for (const path of paths) {
        // Skip if already in driveConfigs
        if (this.driveConfigs().some(c => c.path === path)) {
          continue;
        }

        // Get drive info from service (auto-caches) - needed for volumeId check
        let driveInfo: DriveInfo | null = null;
        try {
          driveInfo = await this.miningService.getDriveInfo(path);
        } catch (error) {
          console.error('Failed to get drive info for', path, error);
          continue;
        }

        if (!driveInfo) {
          continue;
        }

        // Check for same-drive conflict using volumeId (handles mount points correctly)
        // Skip this check in dev mode to allow testing with multiple folders
        if (!this.miningService.isDevMode()) {
          const conflictingDrive = this.findConflictingDrive(driveInfo);

          if (conflictingDrive) {
            this.snackBar.open(
              `Cannot add folder: This drive already has a plot folder configured (${conflictingDrive.path}). Multiple folders on the same physical drive would severely impact performance.`,
              'Dismiss',
              { duration: 6000 }
            );
            continue;
          }
        }

        // Create DriveConfig with default allocation (max allocatable)
        const defaultAllocation = this.getMaxAllocatable(driveInfo);
        if (defaultAllocation > 0) {
          const config: DriveConfig = {
            path: driveInfo.path,
            enabled: true,
            allocatedGib: defaultAllocation,
          };
          this.driveConfigs.update(configs => [...configs, config]);
          // availableDrives computed signal auto-updates from cache
        }
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  }

  /**
   * Find an existing drive config that conflicts with the new drive (same physical volume).
   * Uses volumeId for accurate detection (handles Windows mount points correctly).
   * Falls back to drive letter comparison if volumeId not available.
   */
  private findConflictingDrive(newDrive: DriveInfo): DriveInfo | null {
    const driveInfoCache = this.miningService.driveInfoCache();

    for (const config of this.driveConfigs()) {
      const existingDrive = driveInfoCache.get(config.path);
      if (!existingDrive) continue;

      // Compare volumeIds if both available (most accurate, handles mount points)
      if (newDrive.volumeId && existingDrive.volumeId) {
        if (newDrive.volumeId === existingDrive.volumeId) {
          return existingDrive;
        }
      } else {
        // Fallback: compare drive letters (Windows) or root (Unix)
        if (this.getDriveLetter(newDrive.path) === this.getDriveLetter(existingDrive.path)) {
          return existingDrive;
        }
      }
    }

    return null;
  }

  private getDriveLetter(path: string): string {
    // Windows: extract drive letter (e.g., "C:" from "C:\Plots")
    // Unix: use root or first path segment
    const match = path.match(/^([A-Za-z]:)/);
    if (match) {
      return match[1].toUpperCase();
    }
    // For Unix-like paths, use root
    return path.startsWith('/') ? '/' : path.split(/[/\\]/)[0];
  }

  async refreshDrive(drive: DriveInfo): Promise<void> {
    try {
      // getDriveInfo auto-caches, computed signal auto-updates
      await this.miningService.getDriveInfo(drive.path);
    } catch (error) {
      console.error('Failed to refresh drive info:', error);
    }
  }

  removeDrive(drive: DriveInfo): void {
    // Only update driveConfigs - cache keeps entry (harmless orphan)
    // availableDrives computed signal auto-updates when driveConfigs changes
    this.driveConfigs.update(configs => configs.filter(c => c.path !== drive.path));
  }

  // Save and start
  async saveAndStart(): Promise<void> {
    this.saving.set(true);

    try {
      const plottingAddress = this.useCustomAddress()
        ? this.customPlottingAddress()
        : this.walletAddress();

      console.log('Saving config with drives:', this.driveConfigs());

      const success = await this.miningService.saveConfig({
        chains: this.chainConfigs(),
        drives: this.driveConfigs(),
        cpuConfig: this.cpuConfig(),
        plotterDevices: this.plotterDevices(),
        plottingAddress,
        compressionLevel: parseInt(this.compressionLevel(), 10),
        memoryLimitGib: undefined, // No limit - plotter manages memory based on settings
        escalation: this.escalation(),
        zeroCopyBuffers: this.zeroCopyBuffers(),
        directIo: this.directIo(),
        lowPriority: this.lowPriority(),
        parallelDrives: this.parallelDrives(),
        hddWakeupSeconds: this.hddWakeup(),
        // Wallet RPC settings for solo mining
        walletRpcHost: this.walletRpcHost(),
        walletRpcPort: this.walletRpcPort(),
        walletDataDirectory: this.walletDataDirectory(),
        walletNetwork: this.walletNetwork(),
      });

      if (!success) {
        console.error('Failed to save configuration - service returned false');
        // TODO: Show error to user
        return;
      }

      console.log('Configuration saved successfully');

      // Auto-generate plot plan if there are drives with allocations
      if (this.driveConfigs().length > 0) {
        console.log('Generating plot plan...');
        const plan = await this.miningService.generatePlotPlan();
        if (plan) {
          console.log('Plot plan generated:', plan.items.length, 'tasks');
        }
      }

      // Navigate to dashboard - user can start mining/plotting from there
      // Mining requires plot files to exist first
      await this.router.navigate(['/mining']);
    } catch (error) {
      console.error('Failed to save configuration:', error);
    } finally {
      this.saving.set(false);
    }
  }
}
