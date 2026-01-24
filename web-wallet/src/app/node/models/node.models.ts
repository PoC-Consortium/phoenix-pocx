/**
 * Node Management Models
 *
 * TypeScript interfaces matching the Tauri Rust types for node management.
 */

// ============================================================================
// Mode & Network Types
// ============================================================================

// Note: These must be lowercase to match Rust serde(rename_all = "lowercase")
export type NodeMode = 'managed' | 'external';

export type Network = 'mainnet' | 'testnet' | 'regtest';

export type AuthMethod = 'cookie' | 'userpass';

// ============================================================================
// Configuration
// ============================================================================

export interface NodeConfig {
  mode: NodeMode;
  network: Network;

  // Managed mode settings
  txindex: boolean;
  miningServer: boolean;
  customArgs: string;
  installedVersion: string | null;

  // External mode settings
  dataDirectory: string;
  rpcHost: string;
  rpcPort: number;
  authMethod: AuthMethod;
  rpcUser: string;
  rpcPassword: string;
}

// Note: Field names must match Rust NodePaths with #[serde(rename_all = "camelCase")]
export interface NodePaths {
  bitcoind: string;
  dataDir: string;
  config: string;
  bitcoinConf: string;
}

// ============================================================================
// Status & State
// ============================================================================

export interface NodeStatus {
  mode: NodeMode;
  running: boolean;
  installed: boolean;
  version: string | null;
  network: string;
  blocks: number;
  headers: number;
  peers: number;
  synced: boolean;
  syncProgress: number;
  pid: number | null;
  error: string | null;
}

// Note: Must match Rust #[serde(rename_all = "lowercase")]
export type DownloadStage =
  | 'idle'
  | 'fetchingrelease'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'complete'
  | 'failed';

export interface DownloadProgress {
  stage: DownloadStage;
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
}

// ============================================================================
// Release Information
// ============================================================================

export interface ReleaseInfo {
  version: string;
  tag: string;
  date: string;
  releaseNotes: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
  sha256?: string;
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string | null;
  latestVersion: string;
  releaseInfo: ReleaseInfo | null;
}

// ============================================================================
// Event Payloads (from Tauri backend)
// ============================================================================

// Note: Field names match Rust DownloadProgress with #[serde(rename_all = "camelCase")]
export interface NodeDownloadProgressEvent {
  stage: DownloadStage;
  downloaded: number;
  total: number;
  speed: number;
  fileName: string;
}

export interface NodeStatusChangedEvent {
  mode: NodeMode;
  running: boolean;
  installed: boolean;
  version: string | null;
  network: string;
  blocks: number;
  headers: number;
  peers: number;
  synced: boolean;
  syncProgress: number;
  pid: number | null;
  error: string | null;
}

export interface NodeStartedEvent {
  pid: number;
}

export interface NodeInstalledEvent {
  version: string;
}

export interface NodeErrorEvent {
  message: string;
  expected?: string;
  computed?: string;
}

// ============================================================================
// Command Result (generic wrapper)
// ============================================================================

export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get default RPC port for a network
 */
export function getDefaultRpcPort(network: Network): number {
  switch (network) {
    case 'mainnet':
      return 8332;
    case 'testnet':
      return 18332;
    case 'regtest':
      return 18443;
    default:
      return 8332;
  }
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Format download speed for display
 */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * ETA values for translation
 */
export interface EtaValues {
  key: string | null;
  params: Record<string, string | number>;
}

/**
 * Calculate ETA values for download (returns translation key and params)
 */
export function getEtaValues(remainingBytes: number, speedBytesPerSec: number): EtaValues {
  if (speedBytesPerSec <= 0) return { key: null, params: {} };

  const seconds = remainingBytes / speedBytesPerSec;

  if (seconds < 60) {
    return { key: 'node_eta_seconds', params: { seconds: Math.ceil(seconds) } };
  } else if (seconds < 3600) {
    return { key: 'node_eta_minutes', params: { minutes: Math.ceil(seconds / 60) } };
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.ceil((seconds % 3600) / 60);
    return { key: 'node_eta_hours_mins', params: { hours, mins } };
  }
}

/**
 * Get translation key for download stage
 */
export function getStageKey(stage: DownloadStage): string {
  switch (stage) {
    case 'idle':
      return 'node_stage_idle';
    case 'fetchingrelease':
      return 'node_stage_fetchingrelease';
    case 'downloading':
      return 'node_stage_downloading';
    case 'verifying':
      return 'node_stage_verifying';
    case 'extracting':
      return 'node_stage_extracting';
    case 'complete':
      return 'node_stage_complete';
    case 'failed':
      return 'node_stage_failed';
    default:
      return 'unknown';
  }
}

/**
 * Create default node config
 */
export function createDefaultNodeConfig(): NodeConfig {
  return {
    mode: 'managed',
    network: 'testnet',
    txindex: false,
    miningServer: false,
    customArgs: '',
    installedVersion: null,
    dataDirectory: '',
    rpcHost: '127.0.0.1',
    rpcPort: 18332,
    authMethod: 'cookie',
    rpcUser: '',
    rpcPassword: '',
  };
}

/**
 * Create default node status
 */
export function createDefaultNodeStatus(): NodeStatus {
  return {
    mode: 'managed',
    running: false,
    installed: false,
    version: null,
    network: 'testnet',
    blocks: 0,
    headers: 0,
    peers: 0,
    synced: false,
    syncProgress: 0,
    pid: null,
    error: null,
  };
}
