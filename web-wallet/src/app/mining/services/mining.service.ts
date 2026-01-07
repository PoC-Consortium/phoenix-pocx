import { Injectable, signal, computed, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  MiningState,
  MiningConfig,
  ChainConfig,
  DriveConfig,
  CpuConfig,
  PlotterDeviceConfig,
  DeviceInfo,
  DriveInfo,
  DeadlineEntry,
  CommandResult,
  AddressInfo,
  MiningStatus,
  PlottingStatus,
  BenchmarkResult,
  PlotPlan,
  PlotPlanItem,
  PlotPlanStatus,
  PlotPlanStats,
  PlotExecutionResult,
  PlottingProgress,
  PlotterStartedEvent,
  PlotterHashingProgressEvent,
  PlotterWritingProgressEvent,
  PlotterCompleteEvent,
  PlotterErrorEvent,
  PlotterItemCompleteEvent,
} from '../models/mining.models';
import { PlotPlanService } from './plot-plan.service';

/**
 * Mining Service
 *
 * Provides access to all mining-related Tauri commands and manages mining state.
 */
@Injectable({
  providedIn: 'root',
})
export class MiningService {
  private readonly plotPlanService = inject(PlotPlanService);

  // Signals for reactive state
  private readonly _state = signal<MiningState | null>(null);
  private readonly _devices = signal<DeviceInfo | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _currentPlottingSpeed = signal<number>(0); // MiB/s for ETA calculation

  // Global plotting progress state (persists across navigation)
  private readonly _plottingProgress = signal<PlottingProgress>({
    hashingWarps: 0,
    writingWarps: 0,
    totalWarps: 0,
    plotStartTime: 0,
    currentBatchSize: 1,
    completedInBatch: 0,
    progress: 0,
    speedMibS: 0,
  });
  private _isPlotterListening = false;
  private _plotterUnlisteners: UnlistenFn[] = [];
  private _lastSpeedUpdateTime = 0;

  // Callback for activity logging (set by dashboard)
  private _onActivityLog: ((type: string, message: string) => void) | null = null;

  // Cached drive info (scanned once, refreshed on config change or job complete)
  private readonly _driveInfoCache = signal<Map<string, DriveInfo>>(new Map());
  private _driveInfoLoaded = false;
  readonly driveInfoCache = this._driveInfoCache.asReadonly();

  // Dev mode detection (cached on init)
  private readonly _isDevMode = signal<boolean>(false);

  // Public computed values
  readonly state = this._state.asReadonly();
  readonly devices = this._devices.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly currentPlottingSpeed = this._currentPlottingSpeed.asReadonly();
  readonly plottingProgress = this._plottingProgress.asReadonly();

  readonly isConfigured = computed(() => this._state()?.isConfigured ?? false);
  readonly miningStatus = computed(() => this._state()?.miningStatus ?? { type: 'stopped' as const });
  readonly plottingStatus = computed(() => this._state()?.plottingStatus ?? { type: 'idle' as const });
  readonly config = computed(() => this._state()?.config ?? null);
  readonly recentDeadlines = computed(() => this._state()?.recentDeadlines ?? []);
  readonly isDevMode = this._isDevMode.asReadonly();
  readonly simulationMode = computed(() => this._state()?.config.simulationMode ?? false);

  // Plot plan computed values
  readonly plotPlan = computed(() => this._state()?.config.plotPlan ?? null);
  readonly planStats = computed(() => {
    const plan = this.plotPlan();
    if (!plan) return null;
    return this.plotPlanService.getPlanStats(plan);
  });
  readonly planEta = computed(() => {
    const stats = this.planStats();
    const speed = this._currentPlottingSpeed();
    if (!stats) return '--';
    return this.plotPlanService.formatEta(stats.remainingGib, speed);
  });

  constructor() {
    // Initialize state on construction
    this.refreshState();
    this.refreshDevices();
    this.checkDevMode();
  }

  /**
   * Check if running in dev mode (Tauri debug build)
   */
  private async checkDevMode(): Promise<void> {
    try {
      const result = await invoke<boolean>('is_dev');
      this._isDevMode.set(result);
      if (result) {
        console.log('MiningService: Running in dev mode');
      }
    } catch (err) {
      // Default to false if check fails
      this._isDevMode.set(false);
    }
  }

  // ============================================================================
  // State Management
  // ============================================================================

  async refreshState(): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const result = await invoke<CommandResult<MiningState>>('get_mining_state');
      if (result.success && result.data) {
        this._state.set(result.data);
      } else if (result.error) {
        this._error.set(result.error);
      }
    } catch (err) {
      this._error.set(`Failed to get mining state: ${err}`);
    } finally {
      this._isLoading.set(false);
    }
  }

  async saveConfig(config: MiningConfig): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('save_mining_config', { config });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to save config');
      return false;
    } catch (err) {
      this._error.set(`Failed to save config: ${err}`);
      return false;
    }
  }

  /**
   * Toggle simulation mode (dev only)
   * When enabled, plotter runs in benchmark mode (no actual disk writes)
   */
  async toggleSimulationMode(enabled: boolean): Promise<boolean> {
    const config = this.config();
    if (!config) {
      this._error.set('No config loaded');
      return false;
    }

    const updatedConfig: MiningConfig = {
      ...config,
      simulationMode: enabled,
    };

    const success = await this.saveConfig(updatedConfig);
    if (success) {
      console.log(`MiningService: Simulation mode ${enabled ? 'enabled' : 'disabled'}`);
    }
    return success;
  }

  // ============================================================================
  // Device Detection
  // ============================================================================

  async refreshDevices(): Promise<void> {
    try {
      const result = await invoke<CommandResult<DeviceInfo>>('detect_mining_devices');
      if (result.success && result.data) {
        this._devices.set(result.data);
      }
    } catch (err) {
      console.error('Failed to detect devices:', err);
    }
  }

  // ============================================================================
  // Drive Info
  // ============================================================================

  async getDriveInfo(path: string): Promise<DriveInfo | null> {
    try {
      const result = await invoke<CommandResult<DriveInfo>>('get_plot_drive_info', { path });
      if (result.success && result.data) {
        // Auto-cache the result
        const cache = new Map(this._driveInfoCache());
        cache.set(path, result.data);
        this._driveInfoCache.set(cache);
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('Failed to get drive info:', err);
      return null;
    }
  }

  /**
   * Fetch drive info for multiple paths in parallel
   */
  async fetchDriveInfoBatch(paths: string[]): Promise<void> {
    const promises = paths.map(path => this.getDriveInfo(path));
    await Promise.all(promises);
  }

  /**
   * Load drive info cache (only if not already loaded)
   */
  async ensureDriveInfoLoaded(): Promise<Map<string, DriveInfo>> {
    if (this._driveInfoLoaded) {
      return this._driveInfoCache();
    }

    const state = this._state();
    const drives = state?.config?.drives || [];
    if (drives.length === 0) {
      this._driveInfoLoaded = true;
      return new Map();
    }

    const cache = new Map<string, DriveInfo>();
    for (const drive of drives) {
      const info = await this.getDriveInfo(drive.path);
      if (info) {
        cache.set(drive.path, info);
      }
    }

    this._driveInfoCache.set(cache);
    this._driveInfoLoaded = true;
    return cache;
  }

  /**
   * Refresh a single drive in cache (after plot job completes)
   */
  async refreshDriveInCache(path: string): Promise<void> {
    const info = await this.getDriveInfo(path);
    if (info) {
      const cache = new Map(this._driveInfoCache());
      cache.set(path, info);
      this._driveInfoCache.set(cache);
    }
  }

  /**
   * Invalidate drive cache (call after drive config changes)
   */
  invalidateDriveCache(): void {
    this._driveInfoLoaded = false;
    this._driveInfoCache.set(new Map());
  }

  /**
   * Refresh drive cache with fresh data for all configured drives
   */
  async refreshDriveCache(): Promise<void> {
    const config = this.config();
    if (!config?.drives?.length) {
      this._driveInfoCache.set(new Map());
      this._driveInfoLoaded = true;
      return;
    }

    const cache = new Map<string, DriveInfo>();
    for (const driveConfig of config.drives) {
      const info = await this.getDriveInfo(driveConfig.path);
      if (info) {
        cache.set(info.path, info);
      }
    }
    this._driveInfoCache.set(cache);
    this._driveInfoLoaded = true;
  }

  // ============================================================================
  // Chain Configuration
  // ============================================================================

  async addChain(chain: ChainConfig): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('add_chain_config', { chain });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to add chain');
      return false;
    } catch (err) {
      this._error.set(`Failed to add chain: ${err}`);
      return false;
    }
  }

  async updateChain(chain: ChainConfig): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('update_chain_config', { chain });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to update chain');
      return false;
    } catch (err) {
      this._error.set(`Failed to update chain: ${err}`);
      return false;
    }
  }

  async removeChain(id: string): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('remove_chain_config', { id });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to remove chain');
      return false;
    } catch (err) {
      this._error.set(`Failed to remove chain: ${err}`);
      return false;
    }
  }

  async reorderChains(chainIds: string[]): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('reorder_chain_priorities', { chainIds });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to reorder chains');
      return false;
    } catch (err) {
      this._error.set(`Failed to reorder chains: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // Drive Configuration
  // ============================================================================

  async addDrive(drive: DriveConfig): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('add_drive_config', { drive });
      if (result.success) {
        await this.refreshState();
        this.invalidateDriveCache();
        return true;
      }
      this._error.set(result.error ?? 'Failed to add drive');
      return false;
    } catch (err) {
      this._error.set(`Failed to add drive: ${err}`);
      return false;
    }
  }

  async updateDrive(drive: DriveConfig): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('update_drive_config', { drive });
      if (result.success) {
        await this.refreshState();
        this.invalidateDriveCache();
        return true;
      }
      this._error.set(result.error ?? 'Failed to update drive');
      return false;
    } catch (err) {
      this._error.set(`Failed to update drive: ${err}`);
      return false;
    }
  }

  async removeDrive(path: string): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('remove_drive_config', { path });
      if (result.success) {
        await this.refreshState();
        this.invalidateDriveCache();
        return true;
      }
      this._error.set(result.error ?? 'Failed to remove drive');
      return false;
    } catch (err) {
      this._error.set(`Failed to remove drive: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // CPU Configuration
  // ============================================================================

  async updateCpuConfig(config: CpuConfig): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('update_cpu_config', { config });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to update CPU config');
      return false;
    } catch (err) {
      this._error.set(`Failed to update CPU config: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // Plotter Device Configuration
  // ============================================================================

  async updatePlotterDevice(device: PlotterDeviceConfig): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('update_plotter_device', { device });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to update plotter device');
      return false;
    } catch (err) {
      this._error.set(`Failed to update plotter device: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // Mining Control
  // ============================================================================

  async startMining(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('start_mining');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to start mining');
      return false;
    } catch (err) {
      this._error.set(`Failed to start mining: ${err}`);
      return false;
    }
  }

  async stopMining(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('stop_mining');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to stop mining');
      return false;
    } catch (err) {
      this._error.set(`Failed to stop mining: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // Deadline Queries
  // ============================================================================

  async getRecentDeadlines(limit?: number): Promise<DeadlineEntry[]> {
    try {
      const result = await invoke<CommandResult<DeadlineEntry[]>>('get_recent_deadlines', {
        limit,
      });
      if (result.success && result.data) {
        return result.data;
      }
      return [];
    } catch (err) {
      console.error('Failed to get recent deadlines:', err);
      return [];
    }
  }

  // ============================================================================
  // Address Validation
  // ============================================================================

  async validateAddress(address: string): Promise<AddressInfo> {
    try {
      const result = await invoke<CommandResult<AddressInfo>>('get_address_info', { address });
      if (result.success && result.data) {
        return result.data;
      }
      return { valid: false, address, payloadHex: '', network: 'unknown' };
    } catch (err) {
      console.error('Failed to validate address:', err);
      return { valid: false, address, payloadHex: '', network: 'unknown' };
    }
  }

  async getAddressInfo(address: string): Promise<AddressInfo | null> {
    try {
      const result = await invoke<CommandResult<AddressInfo>>('get_address_info', { address });
      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('Failed to get address info:', err);
      return null;
    }
  }

  // ============================================================================
  // Direct Access Methods (for components)
  // ============================================================================

  async getState(): Promise<MiningState> {
    // Use cached data if available, otherwise fetch
    if (!this._state()) {
      await this.refreshState();
    }
    return this._state() ?? {
      miningStatus: { type: 'stopped' },
      plottingStatus: { type: 'idle' },
      currentBlock: {},
      recentDeadlines: [],
      config: {
        chains: [],
        drives: [],
        cpuConfig: { miningThreads: 8, plottingThreads: 16, maxThreads: 16 },
        plotterDevices: [],
        plottingAddress: '',
        compressionLevel: 0,
        directIo: true,
        hddWakeupSeconds: 60,
      },
      isConfigured: false,
    };
  }

  async getConfig(): Promise<MiningConfig | null> {
    // Use cached data if available, otherwise fetch
    if (!this._state()) {
      await this.refreshState();
    }
    return this._state()?.config ?? null;
  }

  async detectDevices(): Promise<DeviceInfo> {
    // Use cached data if available, otherwise fetch
    if (!this._devices()) {
      await this.refreshDevices();
    }
    return this._devices() ?? {
      cpu: { name: 'Unknown CPU', cores: 1, threads: 1, features: [] },
      gpus: [],
      totalMemoryMb: 0,
      availableMemoryMb: 0,
    };
  }

  // ============================================================================
  // Reset and Delete Operations
  // ============================================================================

  async resetConfig(): Promise<boolean> {
    // Block reset while plotting is active
    if (this.isPlottingActive()) {
      this._error.set('Cannot reset while plotting is active. Please stop plotting first.');
      return false;
    }

    try {
      const result = await invoke<CommandResult<void>>('reset_mining_config');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to reset config');
      return false;
    } catch (err) {
      this._error.set(`Failed to reset config: ${err}`);
      return false;
    }
  }

  async deleteAllPlots(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('delete_all_plots');
      if (result.success) {
        await this.refreshState();
        await this.refreshDriveCache();
        return true;
      }
      this._error.set(result.error ?? 'Failed to delete plots');
      return false;
    } catch (err) {
      this._error.set(`Failed to delete plots: ${err}`);
      return false;
    }
  }

  async deleteDrivePlots(path: string): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('delete_drive_plots', { path });
      if (result.success) {
        await this.refreshState();
        await this.refreshDriveInCache(path);
        return true;
      }
      this._error.set(result.error ?? 'Failed to delete drive plots');
      return false;
    } catch (err) {
      this._error.set(`Failed to delete drive plots: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // Plotter Event Management (Global - persists across navigation)
  // ============================================================================

  /**
   * Set up plotter event listeners. This should be called when plotting starts.
   * The listeners persist across navigation, maintaining progress state.
   * Idempotent - safe to call multiple times.
   */
  async setupPlotterEventListeners(): Promise<void> {
    if (this._isPlotterListening) {
      return; // Already listening
    }

    this._isPlotterListening = true;
    console.log('MiningService: Setting up global plotter event listeners');

    // Listen for plotter started
    const startedUnlisten = await listen<PlotterStartedEvent>('plotter:started', (event) => {
      console.log('MiningService: Plotter started:', event.payload);
      const { totalWarps, resumeOffset } = event.payload;

      this._plottingProgress.update(p => ({
        ...p,
        totalWarps,
        hashingWarps: resumeOffset, // Resume from offset if resuming
        writingWarps: 0,
        plotStartTime: Date.now(),
        progress: 0,
      }));
      this._lastSpeedUpdateTime = 0;

      // Update plottingStatus with current item path
      this.syncPlottingStatus();
    });
    this._plotterUnlisteners.push(startedUnlisten);

    // Listen for hashing progress (0-50% of total)
    const hashingUnlisten = await listen<PlotterHashingProgressEvent>('plotter:hashing-progress', (event) => {
      this._plottingProgress.update(p => ({
        ...p,
        hashingWarps: p.hashingWarps + event.payload.warpsDelta,
      }));
      this.updatePlottingProgress();
      this.calculateCombinedSpeed();
    });
    this._plotterUnlisteners.push(hashingUnlisten);

    // Listen for writing progress (50-100% of total)
    const writingUnlisten = await listen<PlotterWritingProgressEvent>('plotter:writing-progress', (event) => {
      this._plottingProgress.update(p => ({
        ...p,
        writingWarps: p.writingWarps + event.payload.warpsDelta,
      }));
      this.updatePlottingProgress();
      this.calculateCombinedSpeed();
    });
    this._plotterUnlisteners.push(writingUnlisten);

    // Listen for plotter complete (from pocx_plotter callback)
    const completeUnlisten = await listen<PlotterCompleteEvent>('plotter:complete', (event) => {
      console.log('MiningService: Plotter complete:', event.payload);
      this._plottingProgress.update(p => ({ ...p, progress: 100 }));
    });
    this._plotterUnlisteners.push(completeUnlisten);

    // Listen for plotter error
    const errorUnlisten = await listen<PlotterErrorEvent>('plotter:error', (event) => {
      console.error('MiningService: Plotter error:', event.payload.error);
      this._error.set(event.payload.error);
    });
    this._plotterUnlisteners.push(errorUnlisten);

    // Listen for item complete (our wrapper event for plan advancement)
    const itemCompleteUnlisten = await listen<PlotterItemCompleteEvent>('plotter:item-complete', async (event) => {
      console.log('MiningService: Item complete:', event.payload);
      await this.handleItemComplete(event.payload);
    });
    this._plotterUnlisteners.push(itemCompleteUnlisten);
  }

  /**
   * Clean up plotter event listeners. Called when plotting is fully stopped.
   */
  cleanupPlotterEventListeners(): void {
    console.log('MiningService: Cleaning up plotter event listeners');
    for (const unlisten of this._plotterUnlisteners) {
      unlisten();
    }
    this._plotterUnlisteners = [];
    this._isPlotterListening = false;
  }

  /**
   * Update combined plotting progress from hashing and writing phases.
   * Hashing = 0-50%, Writing = 50-100%
   */
  private updatePlottingProgress(): void {
    const p = this._plottingProgress();
    if (p.totalWarps === 0) {
      this._plottingProgress.update(prev => ({ ...prev, progress: 0 }));
      return;
    }

    // Hashing progress: 0-50%
    const hashingPercent = (p.hashingWarps / p.totalWarps) * 50;
    // Writing progress: 50-100%
    const writingPercent = (p.writingWarps / p.totalWarps) * 50;

    const total = Math.min(100, hashingPercent + writingPercent);
    this._plottingProgress.update(prev => ({ ...prev, progress: Math.round(total) }));
  }

  /**
   * Calculate effective plotting speed since start.
   * Formula: speedMibS = (effectiveWarps × 1024) / elapsedSinceStart
   */
  private calculateCombinedSpeed(): void {
    const now = Date.now();

    // Throttle UI updates to every 0.5 seconds
    if (now - this._lastSpeedUpdateTime < 500) {
      return;
    }
    this._lastSpeedUpdateTime = now;

    const p = this._plottingProgress();
    const elapsedSinceStart = (now - p.plotStartTime) / 1000; // seconds
    if (elapsedSinceStart <= 0) {
      return;
    }

    // combinedWarps goes 0 → 2×totalWarps, effectiveWarps goes 0 → totalWarps
    const combinedWarps = p.hashingWarps + p.writingWarps;
    const effectiveWarps = combinedWarps / 2;

    // Speed = effective GiB processed / time, converted to MiB/s
    const speedMibS = (effectiveWarps * 1024) / elapsedSinceStart;

    this._currentPlottingSpeed.set(speedMibS);
    this._plottingProgress.update(prev => ({ ...prev, speedMibS }));

    // Update plottingStatus with current progress and speed
    this.syncPlottingStatus();
  }

  /**
   * Sync the internal plottingStatus with current progress.
   */
  private syncPlottingStatus(): void {
    const plan = this.plotPlan();
    const currentItem = plan?.items[plan.currentIndex];
    const filePath = currentItem?.path || '';
    const p = this._plottingProgress();

    // Update backend plotting status
    // Note: Backend status is refreshed separately, this is for local UI
  }

  /**
   * Handle item complete event - advance plan index, batch tracking, and trigger next batch
   */
  private async handleItemComplete(event: PlotterItemCompleteEvent): Promise<void> {
    // Log activity
    if (this._onActivityLog) {
      if (event.success) {
        const duration = event.durationMs ? ` in ${(event.durationMs / 1000 / 60).toFixed(1)} min` : '';
        this._onActivityLog('complete', `${event.type} completed: ${this.formatPath(event.path)}${duration}`);
      } else {
        this._onActivityLog('error', `${event.type} failed: ${event.path} - ${event.error}`);
      }
    }

    // Refresh drive stats for the completed item's path
    if (event.success) {
      await this.refreshDriveInCache(event.path);
    }

    // CRITICAL: Advance the plan index for this completed item
    // This increments currentIndex in the backend so the next execution picks up the next item
    console.log('MiningService: Advancing plan index for completed item:', event.path);
    await this.completePlotPlanItem();

    // Update batch tracking
    this._plottingProgress.update(p => ({
      ...p,
      completedInBatch: p.completedInBatch + 1,
    }));

    const progress = this._plottingProgress();

    // Check if batch is complete
    if (progress.completedInBatch >= progress.currentBatchSize) {
      console.log('MiningService: Batch complete, advancing to next batch');

      // Reset warps for next batch
      this._plottingProgress.update(p => ({
        ...p,
        hashingWarps: 0,
        writingWarps: 0,
        progress: 0,
        completedInBatch: 0,
      }));

      // Refresh state and execute next batch
      await this.refreshState();
      await this.executeNextBatch();
    }
  }

  /**
   * Execute the next batch in the plot plan.
   * Groups items with same batchId together for parallel execution.
   */
  async executeNextBatch(): Promise<void> {
    // Ensure event listeners are set up before executing (idempotent)
    await this.setupPlotterEventListeners();

    await this.refreshState();
    const plan = this.plotPlan();

    if (!plan || plan.currentIndex >= plan.items.length) {
      console.log('MiningService: Plan complete or no plan');
      this.cleanupPlotterEventListeners();
      this.resetPlottingProgress();
      return;
    }

    const currentItem = plan.items[plan.currentIndex];
    console.log('MiningService: Executing item:', currentItem);

    // For non-plot items, execute one at a time
    if (currentItem.type !== 'plot') {
      this._plottingProgress.update(p => ({
        ...p,
        currentBatchSize: 1,
        completedInBatch: 0,
      }));

      if (currentItem.type === 'resume') {
        // Execute resume item
        await this.executePlotItem(currentItem);
      } else if (currentItem.type === 'add_to_miner') {
        // Add to miner is a no-op for now, just advance
        await this.completePlotPlanItem();
        await this.executeNextBatch();
      }
      return;
    }

    // For plot items, check stop request before starting new batch
    const stopRequested = await this.isStopRequested();
    if (stopRequested) {
      console.log('MiningService: Stop requested, not starting new plot batch');
      this.cleanupPlotterEventListeners();
      this.resetPlottingProgress();
      return;
    }

    // Group by batchId
    const batchId = currentItem.batchId;
    const batchItems: PlotPlanItem[] = [];
    let totalBatchWarps = 0;

    for (let i = plan.currentIndex; i < plan.items.length; i++) {
      const item = plan.items[i];
      if (item.type !== 'plot' || item.batchId !== batchId) {
        break; // Different batch or non-plot item
      }
      batchItems.push(item);
      totalBatchWarps += item.warps;
    }

    console.log(`MiningService: Executing batch ${batchId} with ${batchItems.length} items, ${totalBatchWarps} total warps`);

    // Update batch tracking
    this._plottingProgress.update(p => ({
      ...p,
      totalWarps: totalBatchWarps,
      currentBatchSize: batchItems.length,
      completedInBatch: 0,
      hashingWarps: 0,
      writingWarps: 0,
      progress: 0,
      plotStartTime: Date.now(),
    }));

    // Execute the batch
    if (batchItems.length === 1) {
      await this.executePlotItem(batchItems[0]);
    } else {
      await this.executePlotBatch(batchItems);
    }
  }

  /**
   * Reset plotting progress to initial state
   */
  resetPlottingProgress(): void {
    this._plottingProgress.set({
      hashingWarps: 0,
      writingWarps: 0,
      totalWarps: 0,
      plotStartTime: 0,
      currentBatchSize: 1,
      completedInBatch: 0,
      progress: 0,
      speedMibS: 0,
    });
    this._currentPlottingSpeed.set(0);
  }

  /**
   * Set activity log callback (called by dashboard to receive activity updates)
   */
  setActivityLogCallback(callback: ((type: string, message: string) => void) | null): void {
    this._onActivityLog = callback;
  }

  /**
   * Format path for display (truncate long paths)
   */
  private formatPath(path: string): string {
    if (path.length <= 30) return path;
    const parts = path.split(/[/\\]/);
    if (parts.length >= 2) {
      return `${parts[0]}\\...\\${parts[parts.length - 1]}`;
    }
    return path;
  }

  /**
   * Check if plotter listeners are currently active
   */
  isListeningToPlotter(): boolean {
    return this._isPlotterListening;
  }

  // ============================================================================
  // Benchmark Operations
  // ============================================================================

  async runBenchmark(
    deviceId: string,
    threads: number,
    address: string,
    escalation?: number,
    zeroCopyBuffers?: boolean
  ): Promise<BenchmarkResult> {
    try {
      const result = await invoke<CommandResult<BenchmarkResult>>('run_device_benchmark', {
        deviceId,
        threads,
        address,
        escalation: escalation ?? 1,
        zeroCopyBuffers: zeroCopyBuffers ?? false,
      });
      if (result.success && result.data) {
        return result.data;
      }
      throw new Error(result.error || 'Benchmark failed');
    } catch (err) {
      throw new Error(`Benchmark failed: ${err}`);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  clearError(): void {
    this._error.set(null);
  }

  isMiningActive(): boolean {
    const status = this.miningStatus();
    return status.type === 'scanning' || status.type === 'idle' || status.type === 'starting';
  }

  isPlottingActive(): boolean {
    const status = this.plottingStatus();
    return status.type === 'plotting' || status.type === 'paused';
  }

  // ============================================================================
  // Plot Plan Management
  // ============================================================================

  /**
   * Generate a new plot plan based on current drive configurations
   */
  async generatePlotPlan(): Promise<PlotPlan | null> {
    const config = this.config();

    if (!config || !config.drives?.length) {
      this._error.set('Cannot generate plan: no drives configured');
      return null;
    }

    // Get DriveInfo ONLY for configured drives (not all system drives)
    const configuredPaths = new Set(config.drives.map(d => d.path));
    const driveInfos: DriveInfo[] = [];

    for (const driveConfig of config.drives) {
      const info = await this.getDriveInfo(driveConfig.path);
      if (info) {
        driveInfos.push(info);
      }
    }

    if (driveInfos.length === 0) {
      this._error.set('Cannot generate plan: no valid drive info');
      return null;
    }

    // Generate plan using the service
    const plan = this.plotPlanService.generatePlan(
      driveInfos,
      config.drives,
      { parallelDrives: config.parallelDrives ?? 1 }
    );

    // Save to backend
    const saved = await this.savePlotPlan(plan);
    if (!saved) {
      return null;
    }

    await this.refreshState();
    return plan;
  }

  /**
   * Save a plot plan to the backend
   */
  async savePlotPlan(plan: PlotPlan): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('save_plot_plan', { plan });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to save plot plan');
      return false;
    } catch (err) {
      this._error.set(`Failed to save plot plan: ${err}`);
      return false;
    }
  }

  /**
   * Get the current plot plan from backend
   */
  async getPlotPlan(): Promise<PlotPlan | null> {
    try {
      const result = await invoke<CommandResult<PlotPlan | null>>('get_plot_plan');
      if (result.success) {
        return result.data ?? null;
      }
      return null;
    } catch (err) {
      console.error('Failed to get plot plan:', err);
      return null;
    }
  }

  /**
   * Start executing the plot plan
   * Returns the first item to execute
   */
  async startPlotPlan(): Promise<PlotPlanItem | null> {
    try {
      const result = await invoke<CommandResult<PlotPlanItem>>('start_plot_plan');
      if (result.success && result.data) {
        await this.refreshState();
        return result.data;
      }
      this._error.set(result.error ?? 'Failed to start plot plan');
      return null;
    } catch (err) {
      this._error.set(`Failed to start plot plan: ${err}`);
      return null;
    }
  }

  /**
   * Soft stop - finish current task, then pause
   */
  async softStopPlotPlan(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('soft_stop_plot_plan');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to soft stop');
      return false;
    } catch (err) {
      this._error.set(`Failed to soft stop: ${err}`);
      return false;
    }
  }

  /**
   * Hard stop - abort immediately, mark plan invalid
   * The .tmp file is kept on disk for later resume
   */
  async hardStopPlotPlan(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('hard_stop_plot_plan');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to hard stop');
      return false;
    } catch (err) {
      this._error.set(`Failed to hard stop: ${err}`);
      return false;
    }
  }

  /**
   * Mark current item as complete and get next item
   */
  async completePlotPlanItem(): Promise<PlotPlanItem | null> {
    try {
      const result = await invoke<CommandResult<PlotPlanItem | null>>('complete_plot_plan_item');
      if (result.success) {
        await this.refreshState();
        return result.data ?? null;
      }
      this._error.set(result.error ?? 'Failed to advance plan');
      return null;
    } catch (err) {
      this._error.set(`Failed to advance plan: ${err}`);
      return null;
    }
  }

  /**
   * Clear the current plan (used before regenerating)
   */
  async clearPlotPlan(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('clear_plot_plan');
      if (result.success) {
        await this.refreshState();
        // Refresh cache with fresh data
        await this.refreshDriveCache();
        return true;
      }
      this._error.set(result.error ?? 'Failed to clear plan');
      return false;
    } catch (err) {
      this._error.set(`Failed to clear plan: ${err}`);
      return false;
    }
  }

  /**
   * Regenerate the plot plan (used after hard stop or config changes)
   * This clears the old plan and generates a new one
   */
  async regeneratePlotPlan(): Promise<PlotPlan | null> {
    // Clear old plan (also refreshes drive cache)
    await this.clearPlotPlan();

    // Generate new plan
    return this.generatePlotPlan();
  }

  /**
   * Check if the current plan is still valid
   * Returns false if config has changed since plan was generated
   */
  isPlanValid(): boolean {
    const plan = this.plotPlan();
    const config = this.config();
    const cache = this._driveInfoCache();

    if (!plan || !config) return false;

    // Convert cache Map to array (only configured drives)
    const drives = Array.from(cache.values());

    const currentHash = this.plotPlanService.computeConfigHash(
      drives,
      config.drives,
      { parallelDrives: config.parallelDrives ?? 1 }
    );

    return this.plotPlanService.validatePlan(plan, currentHash);
  }

  /**
   * Update the current plotting speed (called from progress events)
   */
  updatePlottingSpeed(speedMibS: number): void {
    this._currentPlottingSpeed.set(speedMibS);
  }

  /**
   * Check if plan execution is active
   */
  isPlanRunning(): boolean {
    const plan = this.plotPlan();
    return plan?.status === 'running' || plan?.status === 'stopping';
  }

  /**
   * Check if plan is paused
   */
  isPlanPaused(): boolean {
    const plan = this.plotPlan();
    return plan?.status === 'paused';
  }

  /**
   * Check if plan needs regeneration (invalid or missing)
   */
  needsPlanRegeneration(): boolean {
    const plan = this.plotPlan();
    return !plan || plan.status === 'invalid' || !this.isPlanValid();
  }

  /**
   * Get current plan item being executed
   */
  getCurrentPlanItem(): PlotPlanItem | null {
    const plan = this.plotPlan();
    if (!plan || plan.currentIndex >= plan.items.length) return null;
    return plan.items[plan.currentIndex];
  }

  // ============================================================================
  // Plotter Execution
  // ============================================================================

  /**
   * Execute a single plot plan item.
   * This is the main entry point for actual plotting.
   * The command will block until the item is complete.
   */
  async executePlotItem(item: PlotPlanItem): Promise<PlotExecutionResult | null> {
    try {
      const result = await invoke<CommandResult<PlotExecutionResult>>('execute_plot_item', { item });
      if (result.success && result.data) {
        await this.refreshState();
        return result.data;
      }
      this._error.set(result.error ?? 'Failed to execute plot item');
      return null;
    } catch (err) {
      this._error.set(`Failed to execute plot item: ${err}`);
      return null;
    }
  }

  /**
   * Execute a batch of plot plan items (parallel disk writes).
   * Items with the same batchId are executed together in a single plotter run.
   * The plotter handles multiple outputs internally for efficient parallel I/O.
   */
  async executePlotBatch(items: PlotPlanItem[]): Promise<PlotExecutionResult | null> {
    try {
      const result = await invoke<CommandResult<PlotExecutionResult>>('execute_plot_batch', { items });
      if (result.success && result.data) {
        await this.refreshState();
        return result.data;
      }
      this._error.set(result.error ?? 'Failed to execute plot batch');
      return null;
    } catch (err) {
      this._error.set(`Failed to execute plot batch: ${err}`);
      return null;
    }
  }

  /**
   * Check if plotter is currently running
   */
  async isPlotterRunning(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<boolean>>('is_plotter_running');
      return result.success && result.data === true;
    } catch {
      return false;
    }
  }

  /**
   * Check if stop has been requested
   */
  async isStopRequested(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<boolean>>('is_stop_requested');
      return result.success && result.data === true;
    } catch {
      return false;
    }
  }

  /**
   * Request soft stop - finish current item, then pause
   */
  async requestSoftStop(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('request_soft_stop');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to request soft stop');
      return false;
    } catch (err) {
      this._error.set(`Failed to request soft stop: ${err}`);
      return false;
    }
  }


  // ============================================================================
  // Platform Methods
  // ============================================================================

  /**
   * Get the current platform (win32, darwin, linux)
   */
  async getPlatform(): Promise<string> {
    try {
      return await invoke<string>('get_platform');
    } catch (err) {
      console.error('Failed to get platform:', err);
      return 'unknown';
    }
  }

  // ============================================================================
  // Elevation Methods
  // ============================================================================

  /**
   * Check if the application is running with elevated (admin) privileges.
   * On Windows, this checks if running as Administrator.
   * On Unix, this checks if running as root.
   */
  async isElevated(): Promise<boolean> {
    try {
      return await invoke<boolean>('is_elevated');
    } catch (err) {
      console.error('Failed to check elevation:', err);
      return false;
    }
  }

  /**
   * Restart the application with elevated (admin) privileges.
   * On Windows, this will trigger a UAC prompt.
   * Returns true if restart was initiated, false if cancelled or failed.
   */
  async restartElevated(): Promise<boolean> {
    try {
      return await invoke<boolean>('restart_elevated');
    } catch (err) {
      console.error('Failed to restart elevated:', err);
      return false;
    }
  }
}
