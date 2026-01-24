import { Injectable, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  NodeConfig,
  NodeStatus,
  NodeMode,
  NodePaths,
  DownloadProgress,
  DownloadStage,
  ReleaseInfo,
  UpdateInfo,
  NodeDownloadProgressEvent,
  NodeStatusChangedEvent,
  NodeStartedEvent,
  NodeInstalledEvent,
  NodeErrorEvent,
  createDefaultNodeConfig,
  createDefaultNodeStatus,
} from '../models/node.models';

/**
 * Node Service
 *
 * Provides access to all node management Tauri commands and manages node state.
 * Handles both managed (download/run bitcoind) and external node connections.
 */
@Injectable({
  providedIn: 'root',
})
export class NodeService {
  // Signals for reactive state
  private readonly _config = signal<NodeConfig>(createDefaultNodeConfig());
  private readonly _status = signal<NodeStatus>(createDefaultNodeStatus());
  private readonly _paths = signal<NodePaths | null>(null);
  private readonly _downloadProgress = signal<DownloadProgress | null>(null);
  private readonly _releases = signal<ReleaseInfo[]>([]);
  private readonly _updateInfo = signal<UpdateInfo | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _initialized = signal(false);

  // Initialization lock to prevent concurrent initialization
  private _initializationPromise: Promise<void> | null = null;

  // Event listeners
  private _eventUnlisteners: UnlistenFn[] = [];
  private _isListening = false;

  // Public readonly signals
  readonly config = this._config.asReadonly();
  readonly status = this._status.asReadonly();
  readonly paths = this._paths.asReadonly();
  readonly downloadProgress = this._downloadProgress.asReadonly();
  readonly releases = this._releases.asReadonly();
  readonly updateInfo = this._updateInfo.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly initialized = this._initialized.asReadonly();

  // Computed values (mode values are lowercase to match Rust serde serialization)
  readonly isManaged = computed(() => this._config().mode === 'managed');
  readonly isExternal = computed(() => this._config().mode === 'external');
  readonly isRunning = computed(() => this._status().running);
  readonly isInstalled = computed(() => this._status().installed);
  readonly isSynced = computed(() => this._status().synced);
  readonly hasUpdate = computed(() => this._updateInfo()?.available ?? false);
  readonly currentVersion = computed(() => this._config().installedVersion);
  readonly network = computed(() => this._config().network);
  readonly mode = computed(() => this._config().mode);

  // Download progress computed values
  readonly isDownloading = computed(() => {
    const progress = this._downloadProgress();
    return progress !== null && progress.stage === 'downloading';
  });
  readonly downloadPercent = computed(() => {
    const progress = this._downloadProgress();
    if (!progress || progress.totalBytes === 0) return 0;
    return Math.round((progress.downloadedBytes / progress.totalBytes) * 100);
  });

  constructor() {
    // Initialize on first use
    this.initialize();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the service - load config, status, and set up event listeners.
   * Safe to call multiple times (idempotent). Uses a lock to prevent concurrent initialization.
   */
  async initialize(): Promise<void> {
    // Already initialized
    if (this._initialized()) {
      return;
    }

    // If initialization is already in progress, wait for it
    if (this._initializationPromise) {
      return this._initializationPromise;
    }

    // Start initialization with a lock
    this._initializationPromise = this._doInitialize();
    return this._initializationPromise;
  }

  /**
   * Internal initialization logic.
   */
  private async _doInitialize(): Promise<void> {
    this._isLoading.set(true);

    try {
      // Set up event listeners first
      await this.setupEventListeners();

      // Load initial state in parallel
      await Promise.all([this.refreshConfig(), this.refreshStatus(), this.refreshPaths()]);

      this._initialized.set(true);
      console.log('NodeService: Initialized successfully');
    } catch (err) {
      console.error('NodeService: Failed to initialize:', err);
      this._error.set(`Failed to initialize node service: ${err}`);
      // Clear the promise so retry is possible
      this._initializationPromise = null;
    } finally {
      this._isLoading.set(false);
    }
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  /**
   * Set up event listeners for node events from the Tauri backend.
   */
  private async setupEventListeners(): Promise<void> {
    if (this._isListening) {
      return;
    }

    this._isListening = true;
    console.log('NodeService: Setting up event listeners');

    // Download progress events
    const downloadProgressUnlisten = await listen<NodeDownloadProgressEvent>(
      'node:download-progress',
      event => {
        this._downloadProgress.set({
          stage: event.payload.stage as DownloadStage,
          downloadedBytes: event.payload.downloaded,
          totalBytes: event.payload.total,
          speedBytesPerSec: event.payload.speed,
        });
      }
    );
    this._eventUnlisteners.push(downloadProgressUnlisten);

    // Status changed events
    const statusChangedUnlisten = await listen<NodeStatusChangedEvent>(
      'node:status-changed',
      event => {
        this._status.set(event.payload);
      }
    );
    this._eventUnlisteners.push(statusChangedUnlisten);

    // Node started event
    const startedUnlisten = await listen<NodeStartedEvent>('node:started', event => {
      console.log('NodeService: Node started with PID:', event.payload.pid);
      this._status.update(s => ({
        ...s,
        running: true,
        pid: event.payload.pid,
        error: null,
      }));
    });
    this._eventUnlisteners.push(startedUnlisten);

    // Node stopped event
    const stoppedUnlisten = await listen('node:stopped', () => {
      console.log('NodeService: Node stopped');
      this._status.update(s => ({
        ...s,
        running: false,
        pid: null,
      }));
    });
    this._eventUnlisteners.push(stoppedUnlisten);

    // Node installed event
    const installedUnlisten = await listen<NodeInstalledEvent>('node:installed', event => {
      console.log('NodeService: Node installed:', event.payload.version);
      this._config.update(c => ({
        ...c,
        installedVersion: event.payload.version,
      }));
      this._status.update(s => ({
        ...s,
        installed: true,
        version: event.payload.version,
      }));
      this._downloadProgress.set(null);
    });
    this._eventUnlisteners.push(installedUnlisten);

    // Node error event
    const errorUnlisten = await listen<NodeErrorEvent>('node:error', event => {
      console.error('NodeService: Node error:', event.payload.message);
      this._error.set(event.payload.message);
      this._status.update(s => ({
        ...s,
        error: event.payload.message,
      }));
    });
    this._eventUnlisteners.push(errorUnlisten);

    // Starting event
    const startingUnlisten = await listen('node:starting', () => {
      console.log('NodeService: Node starting...');
    });
    this._eventUnlisteners.push(startingUnlisten);

    // Stopping event
    const stoppingUnlisten = await listen('node:stopping', () => {
      console.log('NodeService: Node stopping...');
    });
    this._eventUnlisteners.push(stoppingUnlisten);
  }

  /**
   * Clean up event listeners.
   */
  cleanupEventListeners(): void {
    console.log('NodeService: Cleaning up event listeners');
    for (const unlisten of this._eventUnlisteners) {
      unlisten();
    }
    this._eventUnlisteners = [];
    this._isListening = false;
  }

  // ============================================================================
  // Configuration Commands
  // ============================================================================

  /**
   * Refresh configuration from backend.
   */
  async refreshConfig(): Promise<void> {
    try {
      const config = await invoke<NodeConfig>('get_node_config');
      this._config.set(config);
    } catch (err) {
      console.error('Failed to get node config:', err);
      this._error.set(`Failed to get config: ${err}`);
    }
  }

  /**
   * Save configuration to backend.
   */
  async saveConfig(config: NodeConfig): Promise<boolean> {
    try {
      await invoke('set_node_config', { config });
      this._config.set(config);
      return true;
    } catch (err) {
      console.error('Failed to save node config:', err);
      this._error.set(`Failed to save config: ${err}`);
      return false;
    }
  }

  /**
   * Get current node mode.
   */
  async getMode(): Promise<NodeMode> {
    try {
      return await invoke<NodeMode>('get_node_mode');
    } catch (err) {
      console.error('Failed to get node mode:', err);
      return 'managed';
    }
  }

  /**
   * Set node mode.
   */
  async setMode(mode: NodeMode): Promise<boolean> {
    try {
      await invoke('set_node_mode', { mode });
      this._config.update(c => ({ ...c, mode }));
      return true;
    } catch (err) {
      console.error('Failed to set node mode:', err);
      this._error.set(`Failed to set mode: ${err}`);
      return false;
    }
  }

  /**
   * Set network.
   */
  async setNetwork(network: string): Promise<boolean> {
    try {
      await invoke('set_node_network', { network: network.toLowerCase() });
      await this.refreshConfig();
      return true;
    } catch (err) {
      console.error('Failed to set network:', err);
      this._error.set(`Failed to set network: ${err}`);
      return false;
    }
  }

  /**
   * Get network.
   */
  async getNetwork(): Promise<string> {
    try {
      return await invoke<string>('get_node_network');
    } catch (err) {
      console.error('Failed to get network:', err);
      return 'testnet';
    }
  }

  // ============================================================================
  // Status Commands
  // ============================================================================

  /**
   * Refresh status from backend.
   */
  async refreshStatus(): Promise<void> {
    try {
      const status = await invoke<NodeStatus>('get_node_status');
      this._status.set(status);
    } catch (err) {
      console.error('Failed to get node status:', err);
      this._error.set(`Failed to get status: ${err}`);
    }
  }

  /**
   * Refresh all node-related paths.
   */
  async refreshPaths(): Promise<void> {
    try {
      const paths = await invoke<NodePaths>('get_node_paths');
      this._paths.set(paths);
    } catch (err) {
      console.error('Failed to get node paths:', err);
    }
  }

  /**
   * Check if node is running.
   */
  async isNodeRunning(): Promise<boolean> {
    try {
      return await invoke<boolean>('is_node_running');
    } catch (err) {
      console.error('Failed to check if node running:', err);
      return false;
    }
  }

  /**
   * Check if node is installed.
   */
  async isNodeInstalled(): Promise<boolean> {
    try {
      return await invoke<boolean>('is_node_installed');
    } catch (err) {
      console.error('Failed to check if node installed:', err);
      return false;
    }
  }

  /**
   * Get installed node version.
   */
  async getInstalledVersion(): Promise<string | null> {
    try {
      return await invoke<string | null>('get_installed_node_version');
    } catch (err) {
      console.error('Failed to get installed version:', err);
      return null;
    }
  }

  /**
   * Get current download progress.
   */
  async getDownloadProgress(): Promise<DownloadProgress | null> {
    try {
      return await invoke<DownloadProgress | null>('get_download_progress');
    } catch (err) {
      console.error('Failed to get download progress:', err);
      return null;
    }
  }

  /**
   * Preview bitcoin.conf content without saving.
   */
  async previewBitcoinConf(): Promise<string> {
    try {
      return await invoke<string>('preview_bitcoin_conf');
    } catch (err) {
      console.error('Failed to preview bitcoin.conf:', err);
      return '';
    }
  }

  // ============================================================================
  // Process Management Commands
  // ============================================================================

  /**
   * Start the managed node.
   */
  async startNode(): Promise<number | null> {
    try {
      this._error.set(null);
      const pid = await invoke<number>('start_managed_node');
      console.log('NodeService: Started node with PID:', pid);
      await this.refreshStatus();
      return pid;
    } catch (err) {
      console.error('Failed to start node:', err);
      this._error.set(`Failed to start node: ${err}`);
      return null;
    }
  }

  /**
   * Stop the managed node.
   */
  async stopNode(): Promise<boolean> {
    try {
      this._error.set(null);
      await invoke('stop_managed_node');
      console.log('NodeService: Stopped node');
      await this.refreshStatus();
      return true;
    } catch (err) {
      console.error('Failed to stop node:', err);
      this._error.set(`Failed to stop node: ${err}`);
      return false;
    }
  }

  /**
   * Restart the managed node.
   */
  async restartNode(): Promise<number | null> {
    try {
      this._error.set(null);
      const pid = await invoke<number>('restart_managed_node');
      console.log('NodeService: Restarted node with PID:', pid);
      await this.refreshStatus();
      return pid;
    } catch (err) {
      console.error('Failed to restart node:', err);
      this._error.set(`Failed to restart node: ${err}`);
      return null;
    }
  }

  /**
   * Detect existing node (crash recovery).
   */
  async detectExistingNode(): Promise<number | null> {
    try {
      const pid = await invoke<number | null>('detect_existing_node');
      if (pid !== null) {
        console.log('NodeService: Detected existing node with PID:', pid);
        await this.refreshStatus();
      }
      return pid;
    } catch (err) {
      console.error('Failed to detect existing node:', err);
      return null;
    }
  }

  /**
   * Refresh node status (checks process and updates state).
   */
  async refreshNodeStatus(): Promise<NodeStatus> {
    try {
      const status = await invoke<NodeStatus>('refresh_node_status');
      this._status.set(status);
      return status;
    } catch (err) {
      console.error('Failed to refresh node status:', err);
      throw err;
    }
  }

  // ============================================================================
  // Download & Update Commands
  // ============================================================================

  /**
   * Fetch the latest release from GitHub.
   */
  async fetchLatestRelease(): Promise<ReleaseInfo | null> {
    try {
      this._isLoading.set(true);
      const release = await invoke<ReleaseInfo>('fetch_latest_node_release');
      return release;
    } catch (err) {
      console.error('Failed to fetch latest release:', err);
      this._error.set(`Failed to fetch latest release: ${err}`);
      return null;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Fetch SHA256 hash for a specific release asset.
   */
  async fetchAssetSha256(tag: string, assetName: string): Promise<string | null> {
    try {
      return await invoke<string>('fetch_asset_sha256', { tag, assetName });
    } catch (err) {
      console.error('Failed to fetch asset SHA256:', err);
      return null;
    }
  }

  /**
   * Get the platform architecture.
   */
  async getPlatformArch(): Promise<string> {
    try {
      return await invoke<string>('get_platform_arch');
    } catch (err) {
      console.error('Failed to get platform arch:', err);
      return 'unknown';
    }
  }

  /**
   * Fetch all releases from GitHub.
   */
  async fetchAllReleases(): Promise<ReleaseInfo[]> {
    try {
      this._isLoading.set(true);
      const releases = await invoke<ReleaseInfo[]>('fetch_all_node_releases');
      this._releases.set(releases);
      return releases;
    } catch (err) {
      console.error('Failed to fetch all releases:', err);
      this._error.set(`Failed to fetch releases: ${err}`);
      return [];
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Check for node updates.
   */
  async checkForUpdate(): Promise<UpdateInfo | null> {
    try {
      this._isLoading.set(true);
      const updateInfo = await invoke<UpdateInfo>('check_node_update');
      this._updateInfo.set(updateInfo);
      return updateInfo;
    } catch (err) {
      console.error('Failed to check for update:', err);
      this._error.set(`Failed to check for update: ${err}`);
      return null;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Download and install the node from a specific asset.
   * @param version Version string (e.g., "v30.0-RC3")
   * @param downloadUrl Direct download URL for the asset
   * @param fileName Name of the file being downloaded
   * @param sha256 Optional SHA256 hash for verification
   */
  async downloadAndInstallFromAsset(
    version: string,
    downloadUrl: string,
    fileName: string,
    sha256?: string
  ): Promise<string | null> {
    try {
      this._error.set(null);
      this._downloadProgress.set({
        stage: 'downloading',
        downloadedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
      });

      const installedVersion = await invoke<string>('download_and_install_from_asset', {
        version,
        downloadUrl,
        fileName,
        expectedHash: sha256 || null,
      });

      console.log('NodeService: Installed version:', installedVersion);

      // Refresh state
      await Promise.all([this.refreshConfig(), this.refreshStatus()]);

      return installedVersion;
    } catch (err) {
      console.error('Failed to download and install:', err);
      this._error.set(`Failed to download: ${err}`);
      this._downloadProgress.set({
        stage: 'failed',
        downloadedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
      });
      return null;
    }
  }

  /**
   * Cancel ongoing download.
   */
  cancelDownload(): void {
    try {
      invoke('cancel_node_download');
      this._downloadProgress.set(null);
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
  }

  /**
   * Reset node configuration to defaults.
   */
  async resetConfig(): Promise<boolean> {
    try {
      await invoke('reset_node_config');

      // Refresh local state
      await this.refreshConfig();
      await this.refreshStatus();

      console.log('NodeService: Config reset to defaults');
      return true;
    } catch (err) {
      console.error('Failed to reset node config:', err);
      this._error.set(`Failed to reset config: ${err}`);
      return false;
    }
  }

  /**
   * Uninstall the managed node (delete binary and reset config).
   * Use this when doing a full wallet reset.
   */
  async uninstallNode(): Promise<boolean> {
    try {
      await invoke('uninstall_node');

      // Refresh local state
      await this.refreshConfig();
      await this.refreshStatus();

      console.log('NodeService: Node uninstalled');
      return true;
    } catch (err) {
      console.error('Failed to uninstall node:', err);
      this._error.set(`Failed to uninstall node: ${err}`);
      return false;
    }
  }

  /**
   * Wait for the node to be ready (RPC responding).
   * @param timeoutSecs Timeout in seconds (default: 60)
   */
  async waitForNodeReady(timeoutSecs?: number): Promise<boolean> {
    try {
      await invoke('wait_for_node_ready', { timeoutSecs });
      console.log('NodeService: Node is ready');
      return true;
    } catch (err) {
      console.error('Node failed to become ready:', err);
      this._error.set(`Node startup timeout: ${err}`);
      return false;
    }
  }

  /**
   * Check if the node RPC is responding.
   */
  async isNodeReady(): Promise<boolean> {
    try {
      return await invoke<boolean>('is_node_ready');
    } catch {
      return false;
    }
  }

  /**
   * Stop the node gracefully via RPC stop command.
   * This is the preferred way to stop the node.
   */
  async stopNodeGracefully(): Promise<boolean> {
    try {
      this._error.set(null);
      await invoke('stop_node_gracefully');
      console.log('NodeService: Node stopped gracefully');
      await this.refreshStatus();
      return true;
    } catch (err) {
      console.error('Failed to stop node gracefully:', err);
      // Fall back to process kill
      return this.stopNode();
    }
  }

  /**
   * Start the node and wait for it to be ready.
   * This is the preferred way to start the node.
   * @param timeoutSecs Timeout in seconds to wait for RPC (default: 60)
   */
  async startNodeAndWait(timeoutSecs?: number): Promise<boolean> {
    const pid = await this.startNode();
    if (pid === null) {
      return false;
    }

    // Wait for RPC to be ready
    return this.waitForNodeReady(timeoutSecs);
  }

  /**
   * Unified node startup flow: detect, start if needed, wait for RPC, refresh credentials.
   * This is the single entry point for ensuring the node is ready and authenticated.
   *
   * @param refreshCredentials Callback to refresh cookie credentials (avoids circular dependency)
   * @param timeoutSecs Timeout in seconds to wait for RPC (default: 60)
   * @returns true if node is ready and credentials refreshed, false otherwise
   */
  async ensureNodeReadyAndAuthenticated(
    refreshCredentials: () => Promise<boolean>,
    timeoutSecs = 60
  ): Promise<boolean> {
    try {
      // 1. Check if node is already running
      const existingPid = await this.detectExistingNode();

      // 2. Start if needed, wait for RPC
      let ready: boolean;
      if (existingPid) {
        console.log('NodeService: Node already running (PID:', existingPid, '), waiting for RPC...');
        ready = await this.waitForNodeReady(timeoutSecs);
      } else {
        console.log('NodeService: Starting node and waiting for RPC...');
        ready = await this.startNodeAndWait(timeoutSecs);
      }

      if (!ready) {
        console.error('NodeService: Node failed to become ready');
        return false;
      }

      // 3. Refresh credentials (re-read cookie file)
      console.log('NodeService: Refreshing credentials...');
      const authSuccess = await refreshCredentials();
      if (!authSuccess) {
        console.error('NodeService: Failed to refresh credentials');
        return false;
      }

      console.log('NodeService: Node ready and authenticated');
      return true;
    } catch (err) {
      console.error('NodeService: ensureNodeReadyAndAuthenticated failed:', err);
      this._error.set(`Node startup failed: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Clear current error.
   */
  clearError(): void {
    this._error.set(null);
  }

  /**
   * Clear download progress (used to dismiss error state and return to file view).
   */
  clearDownloadProgress(): void {
    this._downloadProgress.set(null);
  }

  /**
   * Check if the service is properly initialized and ready for use.
   */
  isReady(): boolean {
    return this._initialized();
  }

  /**
   * Get full state snapshot for debugging.
   */
  getStateSnapshot(): {
    config: NodeConfig;
    status: NodeStatus;
    paths: NodePaths | null;
    downloadProgress: DownloadProgress | null;
    error: string | null;
  } {
    return {
      config: this._config(),
      status: this._status(),
      paths: this._paths(),
      downloadProgress: this._downloadProgress(),
      error: this._error(),
    };
  }
}
