import { Injectable, inject, signal, computed, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  AggregatorConfig,
  AggregatorStatus,
  AggregatorStatusResponse,
  StatsSnapshot,
  CommandResult,
  AggregatorStartedInfo,
  BlockUpdate,
  ActivityLogEntry,
  SubmissionInfo,
  AcceptedInfo,
  RejectedInfo,
  ForwardedInfo,
  MinerConnectedPayload,
  defaultAggregatorConfig,
} from '../models/aggregator.models';
import { selectNetwork } from '../../store/settings';
import { MiningService } from '../../mining/services/mining.service';

@Injectable({
  providedIn: 'root',
})
export class AggregatorService {
  private readonly store = inject(Store);
  private readonly injector = inject(Injector);

  // Signals
  private readonly _config = signal<AggregatorConfig>(defaultAggregatorConfig);
  private readonly _status = signal<AggregatorStatus>({ type: 'stopped' });
  private readonly _stats = signal<StatsSnapshot | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _bestAccountBech32 = signal<string | null>(null);

  // Activity logs (persisted in service, survives navigation)
  private readonly _activityLogs = signal<ActivityLogEntry[]>([]);
  private static readonly INFO_LOG_AGE_MS = 60 * 60 * 1000; // 1 hour for info
  private static readonly WARN_ERROR_LOG_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours for warn/error

  // Bech32 cache
  private readonly bech32Cache = new Map<string, string>();
  private currentNetwork: string = 'testnet';

  // Public readonly signals
  readonly config = this._config.asReadonly();
  readonly status = this._status.asReadonly();
  readonly stats = this._stats.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly activityLogs = this._activityLogs.asReadonly();
  readonly bestAccountBech32 = this._bestAccountBech32.asReadonly();

  readonly isRunning = computed(() => this._status().type === 'running');
  readonly isStopped = computed(() => this._status().type === 'stopped');

  constructor() {
    // Subscribe to network changes
    this.store.select(selectNetwork).subscribe(network => {
      if (network !== this.currentNetwork) {
        this.currentNetwork = network;
        this.bech32Cache.clear(); // Clear cache on network change
      }
    });
  }

  // Event listeners
  private _unlisteners: UnlistenFn[] = [];
  private _listenersInitialized = false;

  /**
   * Add an activity log entry.
   * Basic 24h cleanup on add; smart tiered cleanup runs on new-block
   */
  addActivityLog(type: ActivityLogEntry['type'], message: string): void {
    const now = Date.now();
    const newEntry: ActivityLogEntry = { id: now, timestamp: now, type, message };

    this._activityLogs.update(logs => {
      // Basic cleanup: remove anything older than 24h (absolute max)
      const cutoff = now - AggregatorService.WARN_ERROR_LOG_AGE_MS;
      return [newEntry, ...logs.filter(log => log.timestamp > cutoff)];
    });
  }

  /**
   * Smart tiered cleanup of activity logs.
   * - info/success logs: keep for 1 hour
   * - warn/error logs: keep for 24 hours
   * Called on new-block events (similar to miner's scan-finished)
   */
  private cleanupActivityLogs(): void {
    const now = Date.now();

    this._activityLogs.update(logs => {
      return logs.filter(log => {
        const age = now - log.timestamp;
        if (log.type === 'info' || log.type === 'success') {
          return age < AggregatorService.INFO_LOG_AGE_MS;
        } else {
          // warn/error - keep for 24 hours
          return age < AggregatorService.WARN_ERROR_LOG_AGE_MS;
        }
      });
    });
  }

  /**
   * Initialize event listeners (call once from app component or dashboard)
   */
  async initListeners(): Promise<void> {
    if (this._listenersInitialized) return;
    this._listenersInitialized = true;

    this._unlisteners.push(
      await listen<AggregatorStartedInfo>('aggregator:started', event => {
        this._status.set({
          type: 'running',
          listenAddress: event.payload.listenAddress,
        });
        this._error.set(null);
        this.addActivityLog('success', `Aggregator started on ${event.payload.listenAddress}`);
      }),

      await listen('aggregator:stopped', () => {
        this._status.set({ type: 'stopped' });
        this.addActivityLog('info', 'Aggregator stopped');
      }),

      await listen<StatsSnapshot>('aggregator:stats-updated', async event => {
        this._stats.set(event.payload);
        // Convert best account to bech32
        const bestAccountHex = event.payload.currentBlockBest?.bestAccountId;
        if (bestAccountHex) {
          const bech32 = await this.hexToBech32(bestAccountHex);
          this._bestAccountBech32.set(bech32);
        } else {
          this._bestAccountBech32.set(null);
        }
      }),

      await listen<{ error: string }>('aggregator:error', event => {
        this._error.set(event.payload.error);
        this._status.set({ type: 'error', message: event.payload.error });
        this.addActivityLog('error', event.payload.error);
      }),

      await listen<BlockUpdate>('aggregator:new-block', event => {
        this.addActivityLog('info', `New block #${event.payload.height}`);
        // Tiered cleanup on each new block (every ~2 min)
        this.cleanupActivityLogs();
      }),

      await listen<SubmissionInfo>('aggregator:submission-received', event => {
        const p = event.payload;
        // Format: received: height=26760, account=...cb71, machine=192.168.1.50, seed=...83ef, nonce=2569540, X=5, quality=807
        const log = `received: height=${p.height}, account=${this.truncateId(p.accountId)}, machine=${p.machineId ?? 'unknown'}, seed=${this.truncateId(p.seed)}, nonce=${p.nonce}, X=${p.compression}, quality=${p.quality}`;
        this.addActivityLog('info', log);
      }),

      await listen<ForwardedInfo>('aggregator:submission-forwarded', event => {
        const p = event.payload;
        const log = `forwarded: account=${this.truncateId(p.accountId)}, quality=${p.quality}, pool=${p.poolName}`;
        this.addActivityLog('info', log);
      }),

      await listen<AcceptedInfo>('aggregator:submission-accepted', event => {
        const p = event.payload;
        // Format: accepted: height=26760, account=...cb71, seed=...83ef, nonce=2569540, X=5, quality=807, time=254s
        const log = `accepted: height=${p.height}, account=${this.truncateId(p.accountId)}, seed=${this.truncateId(p.seed)}, nonce=${p.nonce}, X=${p.compression}, quality=${p.quality}, time=${p.pocTime}s`;
        this.addActivityLog('success', log);
      }),

      await listen<RejectedInfo>('aggregator:submission-rejected', event => {
        const p = event.payload;
        // Format: rejected: height=26760, account=...cb71, reason=...
        const log = `rejected: height=${p.height}, account=${this.truncateId(p.accountId)}, reason=${p.reason}`;
        this.addActivityLog('error', log);
      }),

      await listen<MinerConnectedPayload>('aggregator:miner-connected', event => {
        const acct = this.truncateId(event.payload.accountId);
        const machine = this.truncateId(event.payload.machineId);
        this.addActivityLog('info', `Miner connected: ${acct} (${machine})`);
      }),
    );
  }

  /**
   * Load config from backend
   */
  async loadConfig(): Promise<void> {
    try {
      const result = await invoke<CommandResult<AggregatorConfig>>('get_aggregator_config');
      if (result.success && result.data) {
        this._config.set(result.data);
      }
    } catch (e) {
      console.error('Failed to load aggregator config:', e);
    }
  }

  /**
   * Get MiningService lazily to avoid circular dependency at construction time
   */
  private getMiningService(): MiningService {
    return this.injector.get(MiningService);
  }

  /**
   * Check if a solo chain is configured in mining config
   */
  private hasSoloChain(): boolean {
    const miningService = this.getMiningService();
    const config = miningService.config();
    return config?.chains?.some(c => c.chainType === 'solo') ?? false;
  }

  /**
   * Determine if aggregator should be running based on config and mining setup
   * ON = enabled AND solo chain configured
   * OFF = disabled OR no solo chain
   */
  private shouldAggregatorRun(config: AggregatorConfig): boolean {
    return config.enabled && this.hasSoloChain();
  }

  /**
   * Save config to backend and handle start/stop based on state change
   */
  async saveConfig(config: AggregatorConfig): Promise<boolean> {
    // Determine current state (was running?)
    const wasRunning = this.isRunning();
    const oldShouldRun = this.shouldAggregatorRun(this._config());

    try {
      const result = await invoke<CommandResult<void>>('save_aggregator_config', { config });
      if (!result.success) {
        this._error.set(result.error || 'Failed to save config');
        return false;
      }

      this._config.set(config);

      // Determine new state (should run now?)
      const newShouldRun = this.shouldAggregatorRun(config);

      // Handle state transitions
      if (oldShouldRun && !newShouldRun) {
        // Was ON, now OFF → stop
        console.log('Aggregator: config changed to OFF, stopping...');
        await this.stop();
      } else if (!oldShouldRun && newShouldRun) {
        // Was OFF, now ON → start
        console.log('Aggregator: config changed to ON, starting...');
        await this.initListeners();
        await this.start();
      }
      // If still same state, do nothing

      return true;
    } catch (e) {
      this._error.set(`Failed to save config: ${e}`);
      return false;
    }
  }

  /**
   * Start the aggregator
   */
  async start(): Promise<boolean> {
    this._isLoading.set(true);
    this._error.set(null);
    this._status.set({ type: 'starting' });
    this.addActivityLog('info', 'Starting aggregator...');

    try {
      const result = await invoke<CommandResult<void>>('start_aggregator');
      if (!result.success) {
        const errMsg = result.error || 'Failed to start aggregator';
        // "Already running" is just a warning, not an error
        if (errMsg.toLowerCase().includes('already running')) {
          this.addActivityLog('warn', errMsg);
          // Refresh status to get current state
          await this.refreshStatus();
          return true;
        }
        this._error.set(errMsg);
        this._status.set({ type: 'error', message: errMsg });
        this.addActivityLog('error', errMsg);
        return false;
      }
      return true;
    } catch (e) {
      this._error.set(`Failed to start: ${e}`);
      this._status.set({ type: 'error', message: `${e}` });
      this.addActivityLog('error', `Failed to start: ${e}`);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Stop the aggregator
   */
  async stop(): Promise<boolean> {
    this._isLoading.set(true);
    this.addActivityLog('info', 'Stopping aggregator...');
    try {
      const result = await invoke<CommandResult<void>>('stop_aggregator');
      if (!result.success) {
        this._error.set(result.error || 'Failed to stop');
        this.addActivityLog('error', result.error || 'Failed to stop');
        return false;
      }
      this._status.set({ type: 'stopped' });
      return true;
    } catch (e) {
      this._error.set(`Failed to stop: ${e}`);
      this.addActivityLog('error', `Failed to stop: ${e}`);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Refresh status from backend
   */
  async refreshStatus(): Promise<void> {
    try {
      const result = await invoke<CommandResult<AggregatorStatusResponse>>(
        'get_aggregator_status'
      );
      if (result.success && result.data) {
        this._status.set(result.data.status);
        this._config.set(result.data.config);
      }
    } catch (e) {
      console.error('Failed to refresh aggregator status:', e);
    }
  }

  /**
   * Get cached stats from backend
   */
  async refreshStats(): Promise<void> {
    try {
      const result = await invoke<CommandResult<StatsSnapshot | null>>(
        'get_aggregator_stats'
      );
      if (result.success && result.data != null) {
        this._stats.set(result.data);
      }
    } catch (e) {
      console.error('Failed to get aggregator stats:', e);
    }
  }

  /**
   * Auto-start the aggregator if enabled AND solo chain configured.
   * Call this after node is ready.
   */
  async autoStart(): Promise<void> {
    await this.loadConfig();
    const cfg = this._config();
    if (this.shouldAggregatorRun(cfg)) {
      console.log('Aggregator auto-start: enabled + solo chain configured, starting...');
      await this.initListeners();
      await this.start();
    } else if (cfg.enabled && !this.hasSoloChain()) {
      console.log('Aggregator auto-start skipped: enabled but no solo chain configured');
    }
  }

  /**
   * Cleanup listeners
   */
  destroy(): void {
    for (const unlisten of this._unlisteners) {
      unlisten();
    }
    this._unlisteners = [];
    this._listenersInitialized = false;
  }

  private truncateId(id: string): string {
    if (!id) return '—';
    if (id.length <= 12) return id;
    return id.slice(0, 6) + '…' + id.slice(-6);
  }

  /**
   * Convert hex account ID to bech32 address with caching
   */
  private async hexToBech32(hexAccount: string): Promise<string> {
    // Check cache
    const cached = this.bech32Cache.get(hexAccount);
    if (cached) return cached;

    try {
      const result = await invoke<CommandResult<string>>('hex_to_bech32', {
        payloadHex: hexAccount,
        network: this.currentNetwork,
      });
      if (result.success && result.data) {
        this.bech32Cache.set(hexAccount, result.data);
        return result.data;
      }
    } catch (e) {
      console.error('Failed to convert hex to bech32:', e);
    }

    // Fallback to hex
    return hexAccount;
  }
}
