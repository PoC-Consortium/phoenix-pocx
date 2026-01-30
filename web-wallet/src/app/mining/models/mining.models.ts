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

export interface DriveInfo {
  path: string;
  label: string;
  totalGib: number;
  freeGib: number;
  isSystemDrive: boolean;
  completeFiles: number; // .pocx files (ready for mining)
  completeSizeGib: number; // Size of complete files
  incompleteFiles: number; // .tmp files (can resume)
  incompleteSizeGib: number; // Size of incomplete files
  volumeId?: string; // Volume GUID for same-drive detection (handles mount points)
}

/**
 * Wrapper for drive display that handles unavailable drives.
 * When a configured drive is removed/unavailable, we still show it
 * in the UI so users can remove it from config.
 */
export type DisplayDrive =
  | { available: true; info: DriveInfo; allocatedGib: number }
  | { available: false; path: string; allocatedGib: number };

// ============================================================================
// Configuration Models
// ============================================================================

export type SubmissionMode = 'solo' | 'pool';
export type RpcTransport = 'http' | 'https';

export type RpcAuth =
  | { type: 'none' }
  | { type: 'user_pass'; username: string; password: string }
  | { type: 'cookie'; cookiePath?: string };

/**
 * Chain type for UI purposes:
 * - solo: Built-in solo mining via local managed node
 * - pool: Built-in pool from predefined list
 * - custom: User-defined chain/pool endpoint
 */
export type ChainType = 'solo' | 'pool' | 'custom';

export interface ChainConfig {
  id: string;
  name: string;
  chainType: ChainType;
  rpcTransport: RpcTransport;
  rpcHost: string;
  rpcPort: number;
  rpcAuth: RpcAuth;
  blockTimeSeconds: number;
  mode: SubmissionMode;
  enabled: boolean;
  priority: number;
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
  // Note: plotPlan has been removed - plan is now runtime-only in PlotterState
  simulationMode?: boolean; // Dev only: run plotter in benchmark mode (no disk writes)
  autoStart?: boolean; // Auto-start mining when app launches (after node ready)

  // Miner advanced settings
  pollInterval?: number; // Mining info poll interval in ms (default 1000)
  timeout?: number; // Request timeout in ms (default 5000)
  enableOnTheFlyCompression?: boolean; // On-the-fly decompression for compressed plots
  threadPinning?: boolean; // Pin CPU threads for better performance
  miningDirectIo?: boolean; // Use Direct I/O for mining (separate from plotter directIo)

  // Wallet RPC settings for solo mining
  // These mirror the wallet's connection settings for deadline submission
  walletRpcHost?: string; // Default: 127.0.0.1
  walletRpcPort?: number; // Default: 18332 (Bitcoin testnet RPC)
  walletDataDirectory?: string; // For cookie auth
  walletNetwork?: string; // testnet/mainnet/regtest
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
  | { type: 'error'; message: string };
// Note: 'stopping' state removed - now derived from PlotterState.stopType

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
  qualityRaw: number; // Raw quality for effective capacity calculations
  baseTarget: number; // Block's base target for capacity calculations
  submitted: boolean;
  timestamp: number;
}

export interface ActivityLogEntry {
  id: number;
  timestamp: number;
  type: string;
  message: string;
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
// Plotter Runtime State (new simplified model)
// ============================================================================

/**
 * Stop type for plotter
 * - none: Not stopping, running normally
 * - soft: Finish current batch, keep plan for resume
 * - hard: Finish current item, clear plan
 */
export type StopType = 'none' | 'soft' | 'hard';

/**
 * UI State derived from PlotterState
 * - plotting: Plotter is running, no stop requested
 * - stopping: Plotter is running but stop requested
 * - ready: Plan exists, not running, can start
 * - complete: No plan, all drives plotted
 */
export type PlotterUIState = 'plotting' | 'stopping' | 'ready' | 'complete';

// ============================================================================
// Plot Plan Models (simplified - runtime only, not persisted)
// ============================================================================

export type PlotPlanItem =
  | { type: 'resume'; path: string; fileIndex: number; sizeGib: number }
  | { type: 'plot'; path: string; warps: number; batchId: number }
  | { type: 'add_to_miner' };

/**
 * Plot plan - now runtime-only (not persisted to config)
 *
 * Plan is generated on demand:
 * - First start: When entering mining section after app launch
 * - Config saved: When user saves in setup wizard
 * - Hard stop done: When hard stop completes (to detect .tmp files)
 */
export interface PlotPlan {
  items: PlotPlanItem[]; // Ordered list of tasks to execute
  configHash: string; // Hash of drive configs for change detection
  generatedAt: number; // Timestamp when plan was generated
}

/**
 * Plotter runtime state - the single source of truth
 *
 * This replaces the complex persisted plan with a simple runtime state.
 * All UI state is derived from these values.
 */
export interface PlotterState {
  running: boolean; // Whether plotter is actively running
  stopType: StopType; // Current stop request (none/soft/hard)
  plan: PlotPlan | null; // Current plan (null = no work or complete)
  currentIndex: number; // Current execution position (0-based)
  progress: PlottingProgress; // Current plotting progress
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
  path?: string; // Optional - not present for add_to_miner
  success: boolean;
  warpsPlotted?: number;
  durationMs?: number;
  error?: string;
}

// ============================================================================
// Global Plotting Progress State (for service-level tracking)
// ============================================================================

export interface PlottingProgress {
  hashingWarps: number; // Warps completed in hashing phase (0→totalWarps)
  writingWarps: number; // Warps completed in writing phase (0→totalWarps)
  totalWarps: number; // Target warps for current batch
  resumeOffset: number; // Warps already completed before this session (for resume)
  plotStartTime: number; // Timestamp when current batch started (ms)
  currentBatchSize: number; // Number of items in current batch
  completedInBatch: number; // Items completed in current batch
  progress: number; // Combined progress 0-100%
  speedMibS: number; // Current plotting speed in MiB/s
}

// ============================================================================
// Miner Event Types (from Tauri backend)
// ============================================================================

/** Event: miner:started */
export interface MinerStartedEvent {
  chains: string[];
  version: string;
}

/** Event: miner:capacity-loaded */
export interface MinerCapacityLoadedEvent {
  drives: number;
  totalWarps: number;
  capacityTib: number;
}

/** Event: miner:new-block */
export interface MinerNewBlockEvent {
  chain: string;
  height: number;
  baseTarget: number;
  genSig: string;
  networkCapacity: string;
  compressionRange: string;
  scoop: number;
}

/** Event: miner:queue-updated */
export interface MinerQueueUpdateEvent {
  queue: MinerQueueItem[];
}

export interface MinerQueueItem {
  position: number;
  chain: string;
  height: number;
  progressPercent: number;
}

/** Event: miner:scan-started */
export interface MinerScanStartedEvent {
  chain: string;
  height: number;
  totalWarps: number;
  resuming: boolean;
}

/** Event: miner:scan-progress */
export interface MinerScanProgressEvent {
  warpsDelta: number;
}

/** Event: miner:scan-status */
export interface MinerScanStatusEvent {
  chain: string;
  height: number;
  status: 'finished' | 'paused' | 'interrupted';
  durationSecs?: number; // For 'finished'
  progressPercent?: number; // For 'paused' or 'interrupted'
}

/** Event: miner:deadline-accepted */
export interface MinerDeadlineAcceptedEvent {
  chain: string;
  account: string; // bech32 format (pre-converted by backend)
  height: number;
  nonce: number;
  qualityRaw: number;
  compression: number;
  pocTime: number;
  gensig: string; // Generation signature for fork detection
  isBestForBlock: boolean; // Always true (backend only emits best)
  baseTarget: number; // Block's base target for capacity calculations
}

/** Event: miner:deadline-retry */
export interface MinerDeadlineRetryEvent {
  chain: string;
  account: string;
  height: number;
  nonce: number;
  compression: number;
  reason: string;
}

/** Event: miner:deadline-rejected */
export interface MinerDeadlineRejectedEvent {
  chain: string;
  account: string;
  height: number;
  nonce: number;
  compression: number;
  code: number;
  message: string;
}

/** Event: miner:log - forwarded log messages from miner */
export interface MinerLogEvent {
  level: string; // 'info', 'warn', 'error', 'debug', 'trace'
  message: string;
}

// ============================================================================
// Miner State Models (for tracking in frontend)
// ============================================================================

/** Current miner state */
export interface MinerRuntimeState {
  running: boolean;
  chains: string[];
  totalWarps: number;
  capacityTib: number;
  currentBlock: Record<string, MinerBlockInfo>;
  scanProgress: MinerScanProgress;
  queue: MinerQueueItem[];
  recentDeadlines: DeadlineEntry[];
}

/** Block info for a specific chain */
export interface MinerBlockInfo {
  height: number;
  baseTarget: number;
  genSig: string;
  networkCapacity: string;
  compressionRange: string;
  scoop: number;
  bestDeadline?: number;
}

/** Current scan progress */
export interface MinerScanProgress {
  chain: string;
  height: number;
  totalWarps: number;
  scannedWarps: number;
  progress: number; // 0-100%
  startTime: number; // timestamp
  resuming: boolean;
}

// ============================================================================
// Effective Capacity Calculation
// ============================================================================

/**
 * Genesis base target constant
 *
 * This is the base target at genesis block (difficulty = 1).
 * Used to normalize deadline calculations across different network difficulties.
 */
export const GENESIS_BASE_TARGET = 4398046511104; // 2^42

/**
 * Calculate network capacity from base target and block time
 *
 * This replicates the miner's calculate_network_capacity formula:
 *   genesis_base_target = 2^42 / block_time
 *   capacity_ratio = genesis_base_target / base_target
 *   capacity_bytes = capacity_ratio * 2^40
 *
 * @param baseTarget The base target from the block
 * @param blockTimeSeconds The chain's block time in seconds
 * @returns Network capacity in TiB
 */
export function calculateNetworkCapacityTib(baseTarget: number, blockTimeSeconds: number): number {
  if (baseTarget === 0 || blockTimeSeconds === 0) return 0;

  const genesisBaseTarget = Math.pow(2, 42) / blockTimeSeconds;
  const capacityRatio = genesisBaseTarget / baseTarget;
  const capacityBytes = capacityRatio * Math.pow(2, 40);
  const capacityTib = capacityBytes / Math.pow(1024, 4);

  return capacityTib;
}

/**
 * Format capacity value for display
 *
 * @param capacityTib Capacity in TiB
 * @returns Formatted string (e.g., "1.5 TiB" or "512 GiB")
 */
export function formatCapacity(capacityTib: number): string {
  if (capacityTib >= 1) {
    return `${capacityTib.toFixed(1)} TiB`;
  }
  const capacityGib = capacityTib * 1024;
  if (capacityGib >= 1) {
    return `${capacityGib.toFixed(0)} GiB`;
  }
  const capacityMib = capacityGib * 1024;
  return `${capacityMib.toFixed(0)} MiB`;
}

/**
 * Calculate effective capacity from deadline history
 *
 * Formula: n * GENESIS_BASE_TARGET / sum(qualityRaw)
 *
 * Note: Backend already guarantees one best deadline per chain+height,
 * so no deduplication needed here.
 *
 * Note: qualityRaw = 0 is valid (instant forge / golden deadline).
 *
 * @param deadlines Array of DeadlineEntry with qualityRaw
 * @returns Effective capacity in TiB
 */
export function calculateEffectiveCapacity(deadlines: DeadlineEntry[]): number {
  if (deadlines.length === 0) return 0;

  const qualitySum = deadlines.reduce((acc, d) => acc + d.qualityRaw, 0);
  if (qualitySum === 0) return 0; // All instant forges - capacity is effectively infinite

  // Effective capacity (TiB) = n * GENESIS_BASE_TARGET / sum(qualityRaw)
  return (deadlines.length * GENESIS_BASE_TARGET) / qualitySum;
}

/**
 * Maximum lookback for effective capacity (number of best deadlines to use).
 * 720 data points ≈ 24 hours if one block per 2 minutes per chain.
 */
export const MAX_CAPACITY_DATAPOINTS = 720;

/**
 * Effective capacity data point with timestamp for X-axis
 */
export interface CapacityDataPoint {
  timestamp: number; // From deadline entry
  capacity: number; // TiB
}

/**
 * Cached capacity calculation state
 * Stored in service to survive navigation and enable incremental updates
 */
export interface CapacityCache {
  count: number; // Number of valid deadlines
  qualitySum: number; // Sum of qualityRaw for all valid deadlines
  effectiveCapacity: number; // Calculated TiB (n * GENESIS_BASE_TARGET / qualitySum)
  history: CapacityDataPoint[]; // Sparkline chart data
  lastDeadlineTimestamp: number; // For detecting new data
}

/**
 * Generate effective capacity history for sparkline chart
 *
 * Uses cumulative averaging with a sliding window of the last N deadlines.
 * Each chart point shows effective capacity calculated from all data points
 * up to that moment (capped at maxDataPoints).
 *
 * Optimized with prefix sums for O(n) instead of O(n²) complexity.
 *
 * Note: Backend already guarantees one best deadline per chain+height,
 * so no deduplication needed here.
 *
 * @param deadlines Array of DeadlineEntry
 * @param maxDataPoints Maximum deadlines to include in lookback (default 720)
 * @param maxChartPoints Maximum chart points to return (default 50)
 * @returns Array of CapacityDataPoint for sparkline, oldest to newest
 */
export function generateEffectiveCapacityHistory(
  deadlines: DeadlineEntry[],
  maxDataPoints: number = MAX_CAPACITY_DATAPOINTS,
  maxChartPoints: number = 50
): CapacityDataPoint[] {
  if (deadlines.length === 0) return [];

  // Sort by timestamp ascending (oldest first)
  const sorted = [...deadlines].sort((a, b) => a.timestamp - b.timestamp);

  // Cap at maxDataPoints (take most recent)
  const capped =
    sorted.length > maxDataPoints ? sorted.slice(sorted.length - maxDataPoints) : sorted;

  if (capped.length === 0) return [];

  // Build prefix sums in single pass: O(n)
  const prefixQualitySum = new Array<number>(capped.length);
  let runningSum = 0;
  for (let i = 0; i < capped.length; i++) {
    runningSum += capped[i].qualityRaw;
    prefixQualitySum[i] = runningSum;
  }

  // Determine which indices to sample for chart points
  const step = Math.max(1, Math.floor(capped.length / maxChartPoints));
  const sampledIndices: number[] = [];
  for (let i = 0; i < capped.length; i += step) {
    sampledIndices.push(i);
  }
  // Always include the last point
  if (sampledIndices[sampledIndices.length - 1] !== capped.length - 1) {
    sampledIndices.push(capped.length - 1);
  }

  // Calculate cumulative capacity at each sampled point using prefix sums: O(1) per point
  const result: CapacityDataPoint[] = [];

  for (const idx of sampledIndices) {
    const count = idx + 1;
    const qualitySum = prefixQualitySum[idx];
    if (qualitySum > 0) {
      const capacity = (count * GENESIS_BASE_TARGET) / qualitySum;
      result.push({
        timestamp: capped[idx].timestamp,
        capacity,
      });
    }
  }

  return result;
}
