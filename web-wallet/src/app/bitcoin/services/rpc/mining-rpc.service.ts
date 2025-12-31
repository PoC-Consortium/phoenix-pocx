import { Injectable, inject } from '@angular/core';
import { RpcClientService } from './rpc-client.service';

/**
 * Mining information from getmininginfo
 */
export interface MiningInfo {
  blocks: number;
  currentblockweight?: number;
  currentblocktx?: number;
  difficulty: number;
  networkhashps: number;
  pooledtx: number;
  chain: string;
  warnings: string;
}

/**
 * Block template for mining
 */
export interface BlockTemplate {
  capabilities: string[];
  version: number;
  rules: string[];
  vbavailable: Record<string, number>;
  vbrequired: number;
  previousblockhash: string;
  transactions: BlockTemplateTransaction[];
  coinbaseaux: Record<string, string>;
  coinbasevalue: number;
  longpollid: string;
  target: string;
  mintime: number;
  mutable: string[];
  noncerange: string;
  sigoplimit: number;
  sizelimit: number;
  weightlimit: number;
  curtime: number;
  bits: string;
  height: number;
  default_witness_commitment?: string;
}

export interface BlockTemplateTransaction {
  data: string;
  txid: string;
  hash: string;
  depends: number[];
  fee: number;
  sigops: number;
  weight: number;
}

/**
 * Forging Assignment State (Bitcoin-PoCX specific)
 */
export type AssignmentState = 'UNASSIGNED' | 'ASSIGNING' | 'ASSIGNED' | 'REVOKING' | 'REVOKED';

/**
 * Forging Assignment Status (Bitcoin-PoCX specific)
 * Returns the current state of a plot address's forging assignment
 */
export interface AssignmentStatus {
  plot_address: string;
  height: number;
  has_assignment: boolean;
  state: AssignmentState;
  forging_address?: string;
  assignment_txid?: string;
  assignment_height?: number;
  activation_height?: number;
  revoked?: boolean;
  revocation_txid?: string;
  revocation_height?: number;
  revocation_effective_height?: number;
}

/**
 * Result of creating a forging assignment
 */
export interface CreateAssignmentResult {
  txid: string;
  hex: string;
  plot_address: string;
  forging_address: string;
}

/**
 * Result of revoking a forging assignment
 */
export interface RevokeAssignmentResult {
  txid: string;
  hex: string;
  plot_address: string;
}

/**
 * PoCX Assignment Info (Bitcoin-PoCX specific)
 * This is specific to the Proof-of-Capacity-X consensus mechanism
 */
export interface PocxAssignment {
  assignment_id: string;
  wallet_address: string;
  plot_id: string;
  nonce_start: number;
  nonce_count: number;
  deadline: number;
  height: number;
  signature: string;
}

/**
 * PoCX Mining Status (Bitcoin-PoCX specific)
 */
export interface PocxMiningStatus {
  is_mining: boolean;
  current_height: number;
  best_deadline: number | null;
  assignments_count: number;
  plots_assigned: string[];
  last_block_mined?: number;
}

/**
 * Plot Information (Bitcoin-PoCX specific)
 */
export interface PlotInfo {
  plot_id: string;
  path: string;
  size_gb: number;
  nonce_count: number;
  status: 'active' | 'inactive' | 'error';
  last_verified?: number;
}

/**
 * MiningRpcService handles all mining-related RPC calls.
 *
 * This service provides methods for:
 * - Standard Bitcoin mining operations (getblocktemplate, submitblock)
 * - Bitcoin-PoCX specific operations (assignments, plots, capacity proofs)
 *
 * Note: Bitcoin-PoCX uses Proof-of-Capacity-X instead of Proof-of-Work,
 * so some standard mining RPCs may behave differently.
 */
@Injectable({ providedIn: 'root' })
export class MiningRpcService {
  private readonly rpc = inject(RpcClientService);

  // ============================================================
  // Standard Mining RPCs
  // ============================================================

  /**
   * Get mining information
   */
  async getMiningInfo(): Promise<MiningInfo> {
    return this.rpc.call<MiningInfo>('getmininginfo');
  }

  /**
   * Get network hash rate
   * @param nblocks - Number of blocks to average (default 120, -1 for since last difficulty change)
   * @param height - Block height to end at (default -1 for current tip)
   */
  async getNetworkHashPs(nblocks = 120, height = -1): Promise<number> {
    return this.rpc.call<number>('getnetworkhashps', [nblocks, height]);
  }

  /**
   * Get block template for mining
   * Note: In Bitcoin-PoCX, this may return PoCX-specific fields
   */
  async getBlockTemplate(
    templateRequest: {
      mode?: 'template' | 'proposal';
      capabilities?: string[];
      rules?: string[];
    } = {}
  ): Promise<BlockTemplate> {
    return this.rpc.call<BlockTemplate>('getblocktemplate', [templateRequest]);
  }

  /**
   * Submit a mined block
   * @param hexdata - Block hex data
   * @param dummy - Optional dummy parameter (ignored)
   */
  async submitBlock(hexdata: string, dummy?: string): Promise<string | null> {
    const params: unknown[] = [hexdata];
    if (dummy) params.push(dummy);
    return this.rpc.call<string | null>('submitblock', params);
  }

  /**
   * Submit block header
   */
  async submitHeader(hexdata: string): Promise<void> {
    return this.rpc.call('submitheader', [hexdata]);
  }

  /**
   * Generate blocks (regtest only)
   * @param nblocks - Number of blocks to generate
   * @param address - Address to send rewards to
   * @param maxtries - Maximum attempts (default 1000000)
   */
  async generateToAddress(nblocks: number, address: string, maxtries = 1000000): Promise<string[]> {
    return this.rpc.call<string[]>('generatetoaddress', [nblocks, address, maxtries]);
  }

  /**
   * Generate blocks to a descriptor (regtest only)
   */
  async generateToDescriptor(
    nblocks: number,
    descriptor: string,
    maxtries = 1000000
  ): Promise<string[]> {
    return this.rpc.call<string[]>('generatetodescriptor', [nblocks, descriptor, maxtries]);
  }

  /**
   * Generate a block with specific transactions (regtest only)
   */
  async generateBlock(address: string, transactions: string[]): Promise<{ hash: string }> {
    return this.rpc.call('generateblock', [address, transactions]);
  }

  // ============================================================
  // Bitcoin-PoCX Specific RPCs
  // These are custom RPCs for Proof-of-Capacity-X consensus
  // ============================================================

  /**
   * Get PoCX mining status
   * Returns current mining state for this node
   */
  async getPocxMiningStatus(): Promise<PocxMiningStatus> {
    return this.rpc.call<PocxMiningStatus>('get_mining_status');
  }

  /**
   * Create a new mining assignment
   * Assigns plot capacity to mine for a specific wallet
   *
   * @param walletAddress - Address to receive mining rewards
   * @param plotIds - Plot IDs to use for mining
   */
  async createAssignment(walletAddress: string, plotIds: string[]): Promise<PocxAssignment> {
    return this.rpc.call<PocxAssignment>('create_assignment', [walletAddress, plotIds]);
  }

  /**
   * Submit a deadline (proof of capacity)
   * Used when a plot finds a valid deadline for the current block
   *
   * @param assignmentId - The assignment this deadline is for
   * @param nonce - The nonce that produced this deadline
   * @param deadline - The calculated deadline value
   * @param signature - Signature proving ownership
   */
  async submitDeadline(
    assignmentId: string,
    nonce: number,
    deadline: number,
    signature: string
  ): Promise<{ accepted: boolean; message?: string }> {
    return this.rpc.call('submit_deadline', [assignmentId, nonce, deadline, signature]);
  }

  /**
   * Get current mining assignments
   */
  async getAssignments(walletAddress?: string): Promise<PocxAssignment[]> {
    const params: unknown[] = walletAddress ? [walletAddress] : [];
    return this.rpc.call<PocxAssignment[]>('get_assignments', params);
  }

  /**
   * Cancel a mining assignment
   */
  async cancelAssignment(assignmentId: string): Promise<boolean> {
    return this.rpc.call<boolean>('cancel_assignment', [assignmentId]);
  }

  /**
   * List registered plots
   */
  async listPlots(): Promise<PlotInfo[]> {
    return this.rpc.call<PlotInfo[]>('list_plots');
  }

  /**
   * Register a new plot
   * @param path - Path to the plot file
   */
  async registerPlot(path: string): Promise<PlotInfo> {
    return this.rpc.call<PlotInfo>('register_plot', [path]);
  }

  /**
   * Unregister a plot
   */
  async unregisterPlot(plotId: string): Promise<boolean> {
    return this.rpc.call<boolean>('unregister_plot', [plotId]);
  }

  /**
   * Verify a plot's integrity
   */
  async verifyPlot(plotId: string): Promise<{
    valid: boolean;
    errors?: string[];
    nonces_checked: number;
  }> {
    return this.rpc.call('verify_plot', [plotId]);
  }

  /**
   * Get the best deadline for current block
   */
  async getBestDeadline(): Promise<{
    height: number;
    deadline: number | null;
    assignment_id?: string;
    nonce?: number;
  }> {
    return this.rpc.call('get_best_deadline');
  }

  /**
   * Get mining statistics
   */
  async getMiningStats(blocks = 100): Promise<{
    blocks_mined: number;
    total_rewards: number;
    average_deadline: number;
    best_deadline: number;
    efficiency: number;
  }> {
    return this.rpc.call('get_mining_stats', [blocks]);
  }

  /**
   * Estimate capacity requirements
   * Returns estimated plot size needed to mine blocks at given rate
   */
  async estimateCapacity(blocksPerDay: number): Promise<{
    estimated_capacity_tb: number;
    current_network_capacity_tb: number;
    current_difficulty: number;
  }> {
    return this.rpc.call('estimate_capacity', [blocksPerDay]);
  }

  // ============================================================
  // Forging Assignment RPCs (Bitcoin-PoCX)
  // Manage delegation of forging rights between addresses
  // ============================================================

  /**
   * Get assignment status for a plot address
   * RPC: get_assignment (node category - no wallet required)
   *
   * @param plotAddress - The plot address to check
   * @param height - Optional block height to check at
   */
  async getAssignmentStatus(plotAddress: string, height?: number): Promise<AssignmentStatus> {
    const params: unknown[] = [plotAddress];
    if (height !== undefined) {
      params.push(height);
    }
    return this.rpc.call<AssignmentStatus>('get_assignment', params);
  }

  /**
   * Create a forging assignment transaction
   * RPC: create_assignment (wallet category)
   * Delegates forging rights from plot address to forging address
   *
   * @param walletName - Wallet containing the plot address
   * @param plotAddress - Address that owns the plot
   * @param forgingAddress - Address to delegate forging to
   * @param feeRate - Optional fee rate in sat/vB
   */
  async createForgingAssignment(
    walletName: string,
    plotAddress: string,
    forgingAddress: string,
    feeRate?: number
  ): Promise<CreateAssignmentResult> {
    const params: unknown[] = [plotAddress, forgingAddress];
    if (feeRate !== undefined) {
      params.push(feeRate);
    }
    return this.rpc.call<CreateAssignmentResult>('create_assignment', params, walletName);
  }

  /**
   * Revoke a forging assignment transaction
   * RPC: revoke_assignment (wallet category)
   * Reclaims forging rights back to plot owner
   *
   * @param walletName - Wallet containing the plot address
   * @param plotAddress - Address to revoke assignment for
   * @param feeRate - Optional fee rate in sat/vB
   */
  async revokeForgingAssignment(
    walletName: string,
    plotAddress: string,
    feeRate?: number
  ): Promise<RevokeAssignmentResult> {
    const params: unknown[] = [plotAddress];
    if (feeRate !== undefined) {
      params.push(feeRate);
    }
    return this.rpc.call<RevokeAssignmentResult>('revoke_assignment', params, walletName);
  }
}
