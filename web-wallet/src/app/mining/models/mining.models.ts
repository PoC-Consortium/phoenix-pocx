/**
 * Mining Models
 *
 * TypeScript interfaces matching the Tauri Rust types
 */

// ============================================================================
// Device Models
// ============================================================================

export interface CpuInfo {
  name: string;
  cores: number;
  threads: number;
  features: string[];
}

export interface GpuInfo {
  id: string;
  name: string;
  vendor: string;
  memoryMb: number;
  platformIndex: number;
  deviceIndex: number;
  openclVersion: string;
  isApu: boolean;
  kernelWorkgroupSize: number;
}

export interface DeviceInfo {
  cpu: CpuInfo;
  gpus: GpuInfo[];
  totalMemoryMb: number;
  availableMemoryMb: number;
}

// ============================================================================
// Drive Models
// ============================================================================

export type DriveType = 'ssd' | 'hdd' | 'unknown';

export interface DriveInfo {
  path: string;
  label: string;
  totalGib: number;
  freeGib: number;
  driveType: DriveType;
  isSystemDrive: boolean;
  completeFiles: number;     // .pocx files (ready for mining)
  completeSizeGib: number;   // Size of complete files
  incompleteFiles: number;   // .tmp files (can resume)
  incompleteSizeGib: number; // Size of incomplete files
}

// ============================================================================
// Configuration Models
// ============================================================================

export type SubmissionMode = 'solo' | 'pool';

export interface ChainConfig {
  id: string;
  name: string;
  url: string;
  apiPath: string;
  blockTimeSeconds: number;
  mode: SubmissionMode;
  enabled: boolean;
  priority: number;
  authToken?: string;
}

export interface DriveConfig {
  path: string;
  enabled: boolean;
  allocatedGib: number; // User-selected GiB to allocate for plotting
}

export interface CpuConfig {
  miningThreads: number;
  plottingThreads: number;
  maxThreads: number;
}

export interface PlotterDeviceConfig {
  deviceId: string;
  enabled: boolean;
  threads: number;
}

export interface MiningConfig {
  chains: ChainConfig[];
  drives: DriveConfig[];
  cpuConfig: CpuConfig;
  plotterDevices: PlotterDeviceConfig[];
  plottingAddress: string;
  compressionLevel: number;
  memoryLimitGib?: number; // 0 or undefined = auto
  escalation?: number; // default 1, used for plotting/benchmark
  zeroCopyBuffers?: boolean; // for APU/integrated GPU
  directIo: boolean;
  lowPriority?: boolean;
  parallelDrives?: number; // Number of drives to plot simultaneously (default 1)
  hddWakeupSeconds: number;
}

// ============================================================================
// State Models
// ============================================================================

export type MiningStatus =
  | { type: 'stopped' }
  | { type: 'starting' }
  | { type: 'scanning'; chainName: string; height: number; progress: number }
  | { type: 'idle' }
  | { type: 'error'; message: string };

export type PlottingStatus =
  | { type: 'idle' }
  | { type: 'plotting'; filePath: string; progress: number; speedMibS: number }
  | { type: 'paused' }
  | { type: 'error'; message: string };

export interface BlockInfo {
  height: number;
  baseTarget: number;
  generationSignature: string;
  bestDeadline?: number;
}

export interface DeadlineEntry {
  id: number;
  chainName: string;
  account: string;
  height: number;
  nonce: number;
  deadline: number;
  submitted: boolean;
  timestamp: number;
}

export interface MiningState {
  miningStatus: MiningStatus;
  plottingStatus: PlottingStatus;
  currentBlock: Record<string, BlockInfo>;
  recentDeadlines: DeadlineEntry[];
  config: MiningConfig;
  isConfigured: boolean;
}

// ============================================================================
// Command Models
// ============================================================================

export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StartPlottingParams {
  address: string;
  drivePath: string;
  allocatedGib: number; // Total GiB to allocate for this drive
  compressionLevel: number;
}

export interface AddressInfo {
  valid: boolean;
  address: string;
  payloadHex: string;
  network: string;
  isMine?: boolean; // Whether wallet has keys for this address
  hasAssignment?: boolean; // Whether address has an active forging assignment
  assignedToUs?: boolean; // Whether forging rights are assigned to our wallet
}

// ============================================================================
// Benchmark Models
// ============================================================================

export interface BenchmarkResult {
  deviceId: string;
  threads: number;
  warps: number;
  durationMs: number;
  mibPerSecond: number;
  success: boolean;
  error?: string;
}

export interface BenchmarkProgress {
  deviceId: string;
  progress: number;
}

// Plotter event payloads (from Tauri backend)
export interface PlotterStartedEvent {
  totalWarps: number;
  resumeOffset: number;
}

export interface PlotterHashingProgressEvent {
  warpsDelta: number;
}

export interface PlotterWritingProgressEvent {
  warpsDelta: number;
}

export interface PlotterCompleteEvent {
  totalWarps: number;
  durationMs: number;
}

export interface PlotterErrorEvent {
  error: string;
}

// ============================================================================
// UI State Models
// ============================================================================

export interface WizardStep {
  id: string;
  title: string;
  completed: boolean;
  current: boolean;
}

export interface MiningDashboardStats {
  totalPlotSize: string;
  readyToMine: string;
  toPlot: string;
  activeChains: number;
  bestDeadline?: number;
  lastBlockHeight?: number;
}
