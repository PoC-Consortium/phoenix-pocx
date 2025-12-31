import { Injectable, inject } from '@angular/core';
import { RpcClientService } from './rpc-client.service';

/**
 * Blockchain information from getblockchaininfo
 */
export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  time: number;
  mediantime: number;
  verificationprogress: number;
  initialblockdownload: boolean;
  chainwork: string;
  size_on_disk: number;
  pruned: boolean;
  warnings: string;
}

/**
 * Block header information
 */
export interface BlockHeader {
  hash: string;
  confirmations: number;
  height: number;
  version: number;
  versionHex: string;
  merkleroot: string;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
}

/**
 * Full block data
 */
export interface Block extends BlockHeader {
  strippedsize: number;
  size: number;
  weight: number;
  tx: string[] | Transaction[];
}

/**
 * Transaction structure (simplified)
 */
export interface Transaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: TransactionInput[];
  vout: TransactionOutput[];
  hex?: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export interface TransactionInput {
  txid?: string;
  vout?: number;
  scriptSig?: { asm: string; hex: string };
  txinwitness?: string[];
  sequence: number;
  coinbase?: string;
  /** Available with verbosity 2 in getrawtransaction (Bitcoin Core 24+) */
  prevout?: {
    generated: boolean;
    height: number;
    value: number;
    scriptPubKey: {
      asm: string;
      desc?: string;
      hex: string;
      address?: string;
      type: string;
    };
  };
}

export interface TransactionOutput {
  value: number;
  n: number;
  scriptPubKey: {
    asm: string;
    desc?: string;
    hex: string;
    address?: string;
    type: string;
  };
}

/**
 * Network information
 */
export interface NetworkInfo {
  version: number;
  subversion: string;
  protocolversion: number;
  localservices: string;
  localservicesnames: string[];
  localrelay: boolean;
  timeoffset: number;
  networkactive: boolean;
  connections: number;
  connections_in: number;
  connections_out: number;
  networks: NetworkDetails[];
  relayfee: number;
  incrementalfee: number;
  localaddresses: LocalAddress[];
  warnings: string;
}

export interface NetworkDetails {
  name: string;
  limited: boolean;
  reachable: boolean;
  proxy: string;
  proxy_randomize_credentials: boolean;
}

export interface LocalAddress {
  address: string;
  port: number;
  score: number;
}

/**
 * Peer information from getpeerinfo
 */
export interface PeerInfo {
  id: number;
  addr: string;
  addrbind?: string;
  addrlocal?: string;
  network: 'ipv4' | 'ipv6' | 'onion' | 'i2p' | 'cjdns' | 'not_publicly_routable';
  services: string;
  servicesnames: string[];
  relaytxes: boolean;
  lastsend: number;
  lastrecv: number;
  last_transaction: number;
  last_block: number;
  bytessent: number;
  bytesrecv: number;
  conntime: number;
  timeoffset: number;
  pingtime?: number;
  minping?: number;
  pingwait?: number;
  version: number;
  subver: string;
  inbound: boolean;
  bip152_hb_to: boolean;
  bip152_hb_from: boolean;
  startingheight: number;
  presynced_headers: number;
  synced_headers: number;
  synced_blocks: number;
  inflight: number[];
  addr_relay_enabled: boolean;
  addr_processed: number;
  addr_rate_limited: number;
  permissions: string[];
  minfeefilter: number;
  bytessent_per_msg: Record<string, number>;
  bytesrecv_per_msg: Record<string, number>;
  connection_type: string;
  transport_protocol_type: string;
  session_id: string;
}

/**
 * Mempool information
 */
export interface MempoolInfo {
  loaded: boolean;
  size: number;
  bytes: number;
  usage: number;
  total_fee: number;
  maxmempool: number;
  mempoolminfee: number;
  minrelaytxfee: number;
  incrementalrelayfee: number;
  unbroadcastcount: number;
  fullrbf: boolean;
}

/**
 * BlockchainRpcService handles all blockchain-related RPC calls.
 *
 * This service wraps RpcClientService and provides typed methods for:
 * - Block data retrieval
 * - Chain state queries
 * - Network information
 * - Mempool queries
 */
@Injectable({ providedIn: 'root' })
export class BlockchainRpcService {
  private readonly rpc = inject(RpcClientService);

  /**
   * Get blockchain information
   */
  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return this.rpc.call<BlockchainInfo>('getblockchaininfo');
  }

  /**
   * Get current block count (height)
   */
  async getBlockCount(): Promise<number> {
    return this.rpc.call<number>('getblockcount');
  }

  /**
   * Get best block hash
   */
  async getBestBlockHash(): Promise<string> {
    return this.rpc.call<string>('getbestblockhash');
  }

  /**
   * Get block hash at height
   */
  async getBlockHash(height: number): Promise<string> {
    return this.rpc.call<string>('getblockhash', [height]);
  }

  /**
   * Get block header
   * @param blockhash - Block hash
   * @param verbose - Return JSON object (true) or hex string (false)
   */
  async getBlockHeader(blockhash: string, verbose = true): Promise<BlockHeader | string> {
    return this.rpc.call<BlockHeader | string>('getblockheader', [blockhash, verbose]);
  }

  /**
   * Get block data
   * @param blockhash - Block hash
   * @param verbosity - 0=hex, 1=json, 2=json with tx details
   */
  async getBlock(blockhash: string, verbosity: 0 | 1 | 2 = 1): Promise<Block | string> {
    return this.rpc.call<Block | string>('getblock', [blockhash, verbosity]);
  }

  /**
   * Get raw transaction
   * @param txid - Transaction ID
   * @param verbose - Return JSON object (true) or hex string (false)
   */
  async getRawTransaction(txid: string, verbose = true): Promise<Transaction | string> {
    return this.rpc.call<Transaction | string>('getrawtransaction', [txid, verbose]);
  }

  /**
   * Decode raw transaction hex
   */
  async decodeRawTransaction(hexstring: string): Promise<Transaction> {
    return this.rpc.call<Transaction>('decoderawtransaction', [hexstring]);
  }

  /**
   * Get network information
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    return this.rpc.call<NetworkInfo>('getnetworkinfo');
  }

  /**
   * Get peer information
   */
  async getPeerInfo(): Promise<PeerInfo[]> {
    return this.rpc.call<PeerInfo[]>('getpeerinfo');
  }

  /**
   * Get connection count
   */
  async getConnectionCount(): Promise<number> {
    return this.rpc.call<number>('getconnectioncount');
  }

  /**
   * Get mempool information
   */
  async getMempoolInfo(): Promise<MempoolInfo> {
    return this.rpc.call<MempoolInfo>('getmempoolinfo');
  }

  /**
   * Get raw mempool (list of txids or detailed info)
   */
  async getRawMempool(verbose = false): Promise<string[] | Record<string, unknown>> {
    return this.rpc.call<string[] | Record<string, unknown>>('getrawmempool', [verbose]);
  }

  /**
   * Get mempool entry for a transaction
   */
  async getMempoolEntry(txid: string): Promise<unknown> {
    return this.rpc.call<unknown>('getmempoolentry', [txid]);
  }

  /**
   * Estimate smart fee
   * @param confTarget - Confirmation target in blocks
   * @param estimateMode - ECONOMICAL or CONSERVATIVE
   */
  async estimateSmartFee(
    confTarget: number,
    estimateMode: 'ECONOMICAL' | 'CONSERVATIVE' = 'ECONOMICAL'
  ): Promise<{ feerate?: number; errors?: string[]; blocks: number }> {
    return this.rpc.call('estimatesmartfee', [confTarget, estimateMode]);
  }

  /**
   * Validate an address
   */
  async validateAddress(address: string): Promise<{
    isvalid: boolean;
    address?: string;
    scriptPubKey?: string;
    isscript?: boolean;
    iswitness?: boolean;
    witness_version?: number;
    witness_program?: string;
  }> {
    return this.rpc.call('validateaddress', [address]);
  }

  /**
   * Get chain tips
   */
  async getChainTips(): Promise<
    Array<{
      height: number;
      hash: string;
      branchlen: number;
      status: string;
    }>
  > {
    return this.rpc.call('getchaintips');
  }

  /**
   * Get difficulty
   */
  async getDifficulty(): Promise<number> {
    return this.rpc.call<number>('getdifficulty');
  }

  /**
   * Get chain TX stats
   * @param nblocks - Number of blocks to average over
   * @param blockhash - Optional ending block hash
   */
  async getChainTxStats(
    nblocks?: number,
    blockhash?: string
  ): Promise<{
    time: number;
    txcount: number;
    window_final_block_hash: string;
    window_final_block_height: number;
    window_block_count: number;
    window_tx_count?: number;
    window_interval?: number;
    txrate?: number;
  }> {
    const params: unknown[] = [];
    if (nblocks !== undefined) params.push(nblocks);
    if (blockhash !== undefined) params.push(blockhash);
    return this.rpc.call('getchaintxstats', params);
  }

  /**
   * Get recent blocks (fetches from current height backwards)
   * @param count - Number of blocks to fetch
   * @param verbosity - 0=hex, 1=json, 2=json with tx details
   */
  async getRecentBlocks<T = Block>(count: number, verbosity: 0 | 1 | 2 = 1): Promise<T[]> {
    const currentHeight = await this.getBlockCount();
    const blocks: T[] = [];

    const startHeight = Math.max(0, currentHeight - count + 1);

    for (let height = currentHeight; height >= startHeight; height--) {
      const hash = await this.getBlockHash(height);
      const block = await this.getBlock(hash, verbosity);
      blocks.push(block as T);
    }

    return blocks;
  }

  /**
   * Get block by height
   * @param height - Block height
   * @param verbosity - 0=hex, 1=json, 2=json with tx details
   */
  async getBlockByHeight<T = Block>(height: number, verbosity: 0 | 1 | 2 = 1): Promise<T> {
    const hash = await this.getBlockHash(height);
    return this.getBlock(hash, verbosity) as Promise<T>;
  }
}
