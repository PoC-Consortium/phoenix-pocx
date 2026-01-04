import { Injectable, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
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
  StartPlottingParams,
  AddressInfo,
  MiningStatus,
  PlottingStatus,
  BenchmarkResult,
} from '../models/mining.models';

/**
 * Mining Service
 *
 * Provides access to all mining-related Tauri commands and manages mining state.
 */
@Injectable({
  providedIn: 'root',
})
export class MiningService {
  // Signals for reactive state
  private readonly _state = signal<MiningState | null>(null);
  private readonly _devices = signal<DeviceInfo | null>(null);
  private readonly _drives = signal<DriveInfo[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public computed values
  readonly state = this._state.asReadonly();
  readonly devices = this._devices.asReadonly();
  readonly drives = this._drives.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isConfigured = computed(() => this._state()?.isConfigured ?? false);
  readonly miningStatus = computed(() => this._state()?.miningStatus ?? { type: 'stopped' as const });
  readonly plottingStatus = computed(() => this._state()?.plottingStatus ?? { type: 'idle' as const });
  readonly config = computed(() => this._state()?.config ?? null);
  readonly recentDeadlines = computed(() => this._state()?.recentDeadlines ?? []);

  constructor() {
    // Initialize state on construction
    this.refreshState();
    this.refreshDevices();
    this.refreshDrives();
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
  // Drive Detection
  // ============================================================================

  async refreshDrives(): Promise<void> {
    try {
      const result = await invoke<CommandResult<DriveInfo[]>>('list_plot_drives');
      if (result.success && result.data) {
        this._drives.set(result.data);
      }
    } catch (err) {
      console.error('Failed to list drives:', err);
    }
  }

  async getDriveInfo(path: string): Promise<DriveInfo | null> {
    try {
      const result = await invoke<CommandResult<DriveInfo>>('get_plot_drive_info', { path });
      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('Failed to get drive info:', err);
      return null;
    }
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
  // Plotting Control
  // ============================================================================

  async startPlotting(params: StartPlottingParams): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('start_plotting', { params });
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to start plotting');
      return false;
    } catch (err) {
      this._error.set(`Failed to start plotting: ${err}`);
      return false;
    }
  }

  /**
   * Start plotting all pending drives using saved config
   */
  async startAllPlotting(): Promise<boolean> {
    try {
      const config = await this.getConfig();
      if (!config) {
        this._error.set('No mining configuration found');
        return false;
      }

      // Find first enabled drive with allocated space
      const pendingDrive = config.drives.find(d => d.enabled && d.allocatedGib > 0);

      if (!pendingDrive) {
        this._error.set('No drives configured for plotting');
        return false;
      }

      // Start plotting the first pending drive
      const params: StartPlottingParams = {
        address: config.plottingAddress,
        drivePath: pendingDrive.path,
        allocatedGib: pendingDrive.allocatedGib,
        compressionLevel: config.compressionLevel,
      };

      return this.startPlotting(params);
    } catch (err) {
      this._error.set(`Failed to start plotting: ${err}`);
      return false;
    }
  }

  async stopPlotting(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('stop_plotting');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to stop plotting');
      return false;
    } catch (err) {
      this._error.set(`Failed to stop plotting: ${err}`);
      return false;
    }
  }

  async pausePlotting(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('pause_plotting');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to pause plotting');
      return false;
    } catch (err) {
      this._error.set(`Failed to pause plotting: ${err}`);
      return false;
    }
  }

  async resumePlotting(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('resume_plotting');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to resume plotting');
      return false;
    } catch (err) {
      this._error.set(`Failed to resume plotting: ${err}`);
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
    await this.refreshState();
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
    await this.refreshState();
    return this._state()?.config ?? null;
  }

  async detectDevices(): Promise<DeviceInfo> {
    await this.refreshDevices();
    return this._devices() ?? {
      cpu: { name: 'Unknown CPU', cores: 1, threads: 1, features: [] },
      gpus: [],
      totalMemoryMb: 0,
      availableMemoryMb: 0,
    };
  }

  async detectDrives(): Promise<DriveInfo[]> {
    await this.refreshDrives();
    return this._drives();
  }

  // ============================================================================
  // Reset and Delete Operations
  // ============================================================================

  async resetConfig(): Promise<boolean> {
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
        await this.refreshDrives();
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
        await this.refreshDrives();
        return true;
      }
      this._error.set(result.error ?? 'Failed to delete drive plots');
      return false;
    } catch (err) {
      this._error.set(`Failed to delete drive plots: ${err}`);
      return false;
    }
  }

  async cancelPlotting(): Promise<boolean> {
    try {
      const result = await invoke<CommandResult<void>>('cancel_plotting');
      if (result.success) {
        await this.refreshState();
        return true;
      }
      this._error.set(result.error ?? 'Failed to cancel plotting');
      return false;
    } catch (err) {
      this._error.set(`Failed to cancel plotting: ${err}`);
      return false;
    }
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
}
