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
  plotPlan?: PlotPlan; // Current plot execution plan
  simulationMode?: boolean; // Dev only: run plotter in benchmark mode (no disk writes)
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
// Plot Plan Models
// ============================================================================

export type PlotPlanStatus = 'pending' | 'running' | 'stopping' | 'paused' | 'completed' | 'invalid';

export type PlotPlanItem =
  | { type: 'resume'; path: string; fileIndex: number; sizeGib: number }
  | { type: 'plot'; path: string; warps: number; batchId: number }
  | { type: 'add_to_miner'; path: string };

export interface PlotPlan {
  version: number;           // Schema version
  generatedAt: number;       // Timestamp when plan was generated
  configHash: string;        // Hash of drive configs for change detection
  finishedDrives: string[];  // Drives already complete (no work needed)
  items: PlotPlanItem[];     // Ordered list of tasks to execute
  currentIndex: number;      // Current execution position (0-based)
  status: PlotPlanStatus;    // Execution status
}

export interface PlotPlanStats {
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  totalWarps: number;
  completedWarps: number;
  remainingWarps: number;
  completedGib: number;
  completedTib: number;
  remainingGib: number;
  remainingTib: number;
}

// ============================================================================
// Plotter Execution Models
// ============================================================================

export interface PlotExecutionResult {
  success: boolean;
  warpsPlotted: number;
  durationMs: number;
  error?: string;
}

export interface PlotterItemCompleteEvent {
  type: 'resume' | 'plot' | 'add_to_miner';
  path: string;
  success: boolean;
  warpsPlotted?: number;
  durationMs?: number;
  error?: string;
}

// ============================================================================
// Global Plotting Progress State (for service-level tracking)
// ============================================================================

export interface PlottingProgress {
  hashingWarps: number;      // Warps completed in hashing phase (0→totalWarps)
  writingWarps: number;      // Warps completed in writing phase (0→totalWarps)
  totalWarps: number;        // Target warps for current batch
  plotStartTime: number;     // Timestamp when current batch started (ms)
  currentBatchSize: number;  // Number of items in current batch
  completedInBatch: number;  // Items completed in current batch
  progress: number;          // Combined progress 0-100%
  speedMibS: number;         // Current plotting speed in MiB/s
}
