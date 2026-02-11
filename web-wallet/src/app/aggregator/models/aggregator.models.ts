/**
 * Aggregator configuration (mirrors Rust AggregatorConfig)
 */
export interface AggregatorConfig {
  enabled: boolean;
  listenAddress: string;
  upstreamName: string;
  upstreamRpcHost: string;
  upstreamRpcPort: number;
  submissionMode: 'wallet' | 'pool';
  blockTimeSecs: number;
}

/**
 * Aggregator status (tagged union mirroring Rust AggregatorStatus)
 */
export type AggregatorStatus =
  | { type: 'stopped' }
  | { type: 'starting' }
  | { type: 'running'; listenAddress: string }
  | { type: 'error'; message: string };

/**
 * Aggregator status response from get_aggregator_status command
 */
export interface AggregatorStatusResponse {
  status: AggregatorStatus;
  config: AggregatorConfig;
}

/**
 * Command result wrapper (matches Rust CommandResult<T>)
 */
export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Stats snapshot from pocx_aggregator
 */
export interface StatsSnapshot {
  uniqueMiners: number;
  uniqueMachines: number;
  activeMachines: number;
  currentHeight: number;
  uptimeSecs: number;
  totalCapacity: string;
  networkCapacity: string;
  currentBlockBest: CurrentBlockBest;
  machines: MachineSummary[];
  accounts: AccountSummary[];
}

export interface CurrentBlockBest {
  height: number;
  bestPocTime: number | null;
  bestRawQuality: number | null;
  bestAccountId: string | null;
  bestMachineId: string | null;
}

export interface MachineSummary {
  machineId: string;
  accountCount: number;
  totalCapacityTib: number;
  submissions24h: number;
  submissionPercentage: number;
  lastSeenSecsAgo: number;
  isActive: boolean;
  accounts: AccountInMachine[];
}

export interface AccountInMachine {
  accountId: string;
  capacityTib: number;
  submissions24h: number;
  submissionPercentage: number;
  lastSeenSecsAgo: number;
  isActive: boolean;
}

export interface AccountSummary {
  accountId: string;
  machineCount: number;
  totalCapacityTib: number;
  submissions24h: number;
  submissionPercentage: number;
  lastSeenSecsAgo: number;
  isActive: boolean;
  machines: MachineInAccount[];
}

export interface MachineInAccount {
  machineId: string;
  capacityTib: number;
  submissions24h: number;
  submissionPercentage: number;
  lastSeenSecsAgo: number;
  isActive: boolean;
}

/**
 * Aggregator started event payload
 */
export interface AggregatorStartedInfo {
  listenAddress: string;
  upstreamName: string;
}

/**
 * Block update event payload
 */
export interface BlockUpdate {
  height: number;
  baseTarget: number;
}

/**
 * Default aggregator config
 */
export const defaultAggregatorConfig: AggregatorConfig = {
  enabled: false,
  listenAddress: '0.0.0.0:8080',
  upstreamName: 'local',
  upstreamRpcHost: '127.0.0.1',
  upstreamRpcPort: 18332,
  submissionMode: 'wallet',
  blockTimeSecs: 120,
};

/**
 * Activity log entry for aggregator events
 */
export interface ActivityLogEntry {
  id: number;
  timestamp: number;
  type: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

/**
 * Submission received event payload (matches pocx_aggregator::SubmissionInfo)
 * Full solution details from miner
 */
export interface SubmissionInfo {
  height: number;
  accountId: string;
  machineId: string | null;
  generationSignature: string;
  seed: string;
  nonce: number;
  compression: number; // X value (compression level)
  rawQuality: number;
}

/**
 * Submission accepted event payload (matches pocx_aggregator::AcceptedInfo)
 * Includes calculated poc_time
 */
export interface AcceptedInfo {
  height: number;
  accountId: string;
  machineId: string | null;
  generationSignature: string;
  seed: string;
  nonce: number;
  compression: number;
  rawQuality: number;
  pocTime: number;
}

/**
 * Submission rejected event payload (matches pocx_aggregator::RejectedInfo)
 */
export interface RejectedInfo {
  height: number;
  accountId: string;
  machineId: string | null;
  reason: string;
}

/**
 * Submission forwarded event payload (matches pocx_aggregator::ForwardedInfo)
 */
export interface ForwardedInfo {
  accountId: string;
  rawQuality: number;
  poolName: string;
}

/**
 * Miner connected event payload
 */
export interface MinerConnectedPayload {
  accountId: string;
  machineId: string;
}
