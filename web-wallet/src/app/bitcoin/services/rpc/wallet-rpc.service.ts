import { Injectable, inject } from '@angular/core';
import { RpcClientService } from './rpc-client.service';

/**
 * Wallet information from getwalletinfo
 */
export interface WalletInfo {
  walletname: string;
  walletversion: number;
  format: string;
  balance: number;
  unconfirmed_balance: number;
  immature_balance: number;
  txcount: number;
  keypoolsize: number;
  keypoolsize_hd_internal?: number;
  unlocked_until?: number;
  paytxfee: number;
  private_keys_enabled: boolean;
  avoid_reuse: boolean;
  scanning: boolean | { duration: number; progress: number };
  descriptors: boolean;
  external_signer: boolean;
  hdmasterfingerprint?: string;
}

/**
 * Balance information
 */
export interface WalletBalance {
  mine: {
    trusted: number;
    untrusted_pending: number;
    immature: number;
    used?: number;
  };
  watchonly?: {
    trusted: number;
    untrusted_pending: number;
    immature: number;
  };
  lastprocessedblock: {
    hash: string;
    height: number;
  };
}

/**
 * Address information
 */
export interface AddressInfo {
  address: string;
  scriptPubKey: string;
  ismine: boolean;
  solvable: boolean;
  desc?: string;
  parent_desc?: string;
  isscript: boolean;
  ischange: boolean;
  iswitness: boolean;
  witness_version?: number;
  witness_program?: string;
  pubkey?: string;
  iscompressed?: boolean;
  hdkeypath?: string;
  hdseedid?: string;
  hdmasterfingerprint?: string;
  labels: string[];
}

/**
 * Transaction list entry
 */
export interface WalletTransaction {
  address?: string;
  category: 'send' | 'receive' | 'generate' | 'immature' | 'orphan';
  amount: number;
  label?: string;
  vout?: number;
  fee?: number;
  confirmations: number;
  blockhash?: string;
  blockheight?: number;
  blockindex?: number;
  blocktime?: number;
  txid: string;
  wtxid?: string;
  time: number;
  timereceived: number;
  bip125_replaceable?: 'yes' | 'no' | 'unknown';
  abandoned?: boolean;
  comment?: string;
  to?: string;
}

/**
 * UTXO (Unspent Transaction Output)
 */
export interface UTXO {
  txid: string;
  vout: number;
  address: string;
  label?: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
  solvable: boolean;
  desc?: string;
  parent_descs?: string[];
  safe: boolean;
}

/**
 * Descriptor for wallet import
 */
export interface ImportDescriptor {
  desc: string;
  active?: boolean;
  range?: number | [number, number];
  next_index?: number;
  timestamp: number | 'now';
  internal?: boolean;
  label?: string;
}

/**
 * Import result
 */
export interface ImportResult {
  success: boolean;
  warnings?: string[];
  error?: {
    code: number;
    message: string;
  };
}

/**
 * WalletRpcService handles all wallet-related RPC calls.
 *
 * This service provides typed methods for:
 * - Wallet management (create, load, list)
 * - Address generation and management
 * - Transaction listing and sending
 * - UTXO queries
 * - Descriptor imports
 */
@Injectable({ providedIn: 'root' })
export class WalletRpcService {
  private readonly rpc = inject(RpcClientService);

  // ============================================================
  // Wallet Management
  // ============================================================

  /**
   * List available wallets
   */
  async listWallets(): Promise<string[]> {
    return this.rpc.call<string[]>('listwallets');
  }

  /**
   * List wallet directories
   */
  async listWalletDir(): Promise<{ wallets: Array<{ name: string }> }> {
    return this.rpc.call('listwalletdir');
  }

  /**
   * Create a new wallet
   */
  async createWallet(
    walletName: string,
    options: {
      disablePrivateKeys?: boolean;
      blank?: boolean;
      passphrase?: string;
      avoidReuse?: boolean;
      descriptors?: boolean;
      loadOnStartup?: boolean;
      externalSigner?: boolean;
    } = {}
  ): Promise<{ name: string; warnings?: string[] }> {
    return this.rpc.call('createwallet', [
      walletName,
      options.disablePrivateKeys ?? false,
      options.blank ?? false,
      options.passphrase ?? '',
      options.avoidReuse ?? false,
      options.descriptors ?? true, // Default to descriptor wallets
      options.loadOnStartup ?? null,
      options.externalSigner ?? false,
    ]);
  }

  /**
   * Load an existing wallet
   */
  async loadWallet(
    walletName: string,
    loadOnStartup?: boolean
  ): Promise<{ name: string; warnings?: string[] }> {
    const params: unknown[] = [walletName];
    if (loadOnStartup !== undefined) params.push(loadOnStartup);
    return this.rpc.call('loadwallet', params);
  }

  /**
   * Unload a wallet
   */
  async unloadWallet(walletName?: string): Promise<{ warning?: string }> {
    const params: unknown[] = walletName ? [walletName] : [];
    return this.rpc.call('unloadwallet', params);
  }

  /**
   * Get wallet information
   */
  async getWalletInfo(walletName: string): Promise<WalletInfo> {
    return this.rpc.call<WalletInfo>('getwalletinfo', [], walletName);
  }

  /**
   * Get detailed wallet balances
   */
  async getBalances(walletName: string): Promise<WalletBalance> {
    return this.rpc.call<WalletBalance>('getbalances', [], walletName);
  }

  /**
   * Get total balance
   */
  async getBalance(walletName: string, minconf = 1, includeWatchonly = false): Promise<number> {
    return this.rpc.call<number>('getbalance', ['*', minconf, includeWatchonly], walletName);
  }

  // ============================================================
  // Address Management
  // ============================================================

  /**
   * Get a new receiving address
   */
  async getNewAddress(
    walletName: string,
    label = '',
    addressType?: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m'
  ): Promise<string> {
    const params: unknown[] = [label];
    if (addressType) params.push(addressType);
    return this.rpc.call<string>('getnewaddress', params, walletName);
  }

  /**
   * Get a new change address
   */
  async getRawChangeAddress(
    walletName: string,
    addressType?: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m'
  ): Promise<string> {
    const params: unknown[] = addressType ? [addressType] : [];
    return this.rpc.call<string>('getrawchangeaddress', params, walletName);
  }

  /**
   * Get address information
   */
  async getAddressInfo(walletName: string, address: string): Promise<AddressInfo> {
    return this.rpc.call<AddressInfo>('getaddressinfo', [address], walletName);
  }

  /**
   * List addresses by label
   */
  async getAddressesByLabel(
    walletName: string,
    label: string
  ): Promise<Record<string, { purpose: string }>> {
    return this.rpc.call('getaddressesbylabel', [label], walletName);
  }

  /**
   * Set label for an address
   */
  async setLabel(walletName: string, address: string, label: string): Promise<void> {
    return this.rpc.call('setlabel', [address, label], walletName);
  }

  /**
   * List all labels
   */
  async listLabels(walletName: string): Promise<string[]> {
    return this.rpc.call<string[]>('listlabels', [], walletName);
  }

  // ============================================================
  // Transactions
  // ============================================================

  /**
   * List transactions
   */
  async listTransactions(
    walletName: string,
    label = '*',
    count = 10,
    skip = 0,
    includeWatchonly = false
  ): Promise<WalletTransaction[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactions = await this.rpc.call<any[]>(
      'listtransactions',
      [label, count, skip, includeWatchonly],
      walletName
    );
    // Map hyphenated field from Bitcoin Core to underscore version
    return transactions.map(tx => this.mapTransactionFields(tx)) as WalletTransaction[];
  }

  /**
   * Get transaction details
   */
  async getTransaction(
    walletName: string,
    txid: string,
    includeWatchonly = false,
    verbose = false
  ): Promise<WalletTransaction & { hex: string; details: unknown[] }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await this.rpc.call<any>(
      'gettransaction',
      [txid, includeWatchonly, verbose],
      walletName
    );
    // Map hyphenated field from Bitcoin Core to underscore version
    return this.mapTransactionFields(tx) as WalletTransaction & { hex: string; details: unknown[] };
  }

  /**
   * Map Bitcoin Core hyphenated fields to underscore versions
   * Bitcoin Core returns 'bip125-replaceable' but TypeScript prefers underscores
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapTransactionFields(tx: any): any {
    if (tx && typeof tx === 'object' && 'bip125-replaceable' in tx) {
      tx.bip125_replaceable = tx['bip125-replaceable'];
      delete tx['bip125-replaceable'];
    }
    return tx;
  }

  /**
   * Send to a single address
   */
  async sendToAddress(
    walletName: string,
    address: string,
    amount: number,
    options: {
      comment?: string;
      commentTo?: string;
      subtractFeeFromAmount?: boolean;
      replaceable?: boolean;
      confTarget?: number;
      feeRate?: number;
    } = {}
  ): Promise<string> {
    // Bitcoin Core sendtoaddress positional params:
    // 0:address, 1:amount, 2:comment, 3:comment_to, 4:subtractfeefromamount,
    // 5:replaceable, 6:conf_target, 7:estimate_mode, 8:avoid_reuse, 9:fee_rate
    const params: unknown[] = [
      address,
      amount,
      options.comment ?? '',
      options.commentTo ?? '',
      options.subtractFeeFromAmount ?? false,
      options.replaceable ?? true,
      options.feeRate ? null : (options.confTarget ?? 6), // skip conf_target when fee_rate is set
      options.feeRate ? null : 'unset',                   // skip estimate_mode when fee_rate is set
      false,                                              // avoid_reuse
      options.feeRate ?? null,
    ];
    return this.rpc.call<string>('sendtoaddress', params, walletName);
  }

  /**
   * Send to multiple addresses
   */
  async sendMany(
    walletName: string,
    amounts: Record<string, number>,
    options: {
      minconf?: number;
      comment?: string;
      subtractFeeFrom?: string[];
      replaceable?: boolean;
      confTarget?: number;
      feeRate?: number;
    } = {}
  ): Promise<string> {
    return this.rpc.call<string>(
      'sendmany',
      [
        '', // dummy (deprecated fromaccount)
        amounts,
        options.minconf ?? 1,
        options.comment ?? '',
        options.subtractFeeFrom ?? [],
        options.replaceable ?? true,
        options.confTarget ?? 6,
        'unset',
        options.feeRate ?? null,
      ],
      walletName
    );
  }

  /**
   * Bump the fee of a pending RBF-enabled transaction
   * Creates a replacement transaction with a higher fee
   */
  async bumpFee(
    walletName: string,
    txid: string,
    options?: {
      confTarget?: number;
      feeRate?: number;
      replaceable?: boolean;
    }
  ): Promise<{ txid: string; origfee: number; fee: number; errors?: string[] }> {
    const optionsObj: Record<string, unknown> = {};
    if (options?.confTarget !== undefined) optionsObj['conf_target'] = options.confTarget;
    if (options?.feeRate !== undefined) optionsObj['fee_rate'] = options.feeRate;
    if (options?.replaceable !== undefined) optionsObj['replaceable'] = options.replaceable;

    return this.rpc.call('bumpfee', [txid, optionsObj], walletName);
  }

  /**
   * Bump the fee of a pending RBF-enabled transaction using PSBT
   * Use this for encrypted wallets that require signing
   */
  async psbtBumpFee(
    walletName: string,
    txid: string,
    options?: {
      confTarget?: number;
      feeRate?: number;
      replaceable?: boolean;
    }
  ): Promise<{ psbt: string; origfee: number; fee: number; errors?: string[] }> {
    const optionsObj: Record<string, unknown> = {};
    if (options?.confTarget !== undefined) optionsObj['conf_target'] = options.confTarget;
    if (options?.feeRate !== undefined) optionsObj['fee_rate'] = options.feeRate;
    if (options?.replaceable !== undefined) optionsObj['replaceable'] = options.replaceable;

    return this.rpc.call('psbtbumpfee', [txid, optionsObj], walletName);
  }

  // ============================================================
  // UTXOs
  // ============================================================

  /**
   * List unspent transaction outputs
   */
  async listUnspent(
    walletName: string,
    minconf = 1,
    maxconf = 9999999,
    addresses?: string[],
    includeUnsafe = false
  ): Promise<UTXO[]> {
    return this.rpc.call<UTXO[]>(
      'listunspent',
      [minconf, maxconf, addresses ?? [], includeUnsafe],
      walletName
    );
  }

  /**
   * Lock an unspent output
   */
  async lockUnspent(
    walletName: string,
    unlock: boolean,
    transactions?: Array<{ txid: string; vout: number }>
  ): Promise<boolean> {
    const params: unknown[] = [unlock];
    if (transactions) params.push(transactions);
    return this.rpc.call<boolean>('lockunspent', params, walletName);
  }

  /**
   * List locked unspent outputs
   */
  async listLockUnspent(walletName: string): Promise<Array<{ txid: string; vout: number }>> {
    return this.rpc.call('listlockunspent', [], walletName);
  }

  // ============================================================
  // Descriptors & Import
  // ============================================================

  /**
   * List descriptors in wallet
   */
  async listDescriptors(
    walletName: string,
    showPrivate = false
  ): Promise<{
    wallet_name: string;
    descriptors: Array<{
      desc: string;
      timestamp: number;
      active: boolean;
      internal?: boolean;
      range?: [number, number];
      next?: number;
    }>;
  }> {
    return this.rpc.call('listdescriptors', [showPrivate], walletName);
  }

  /**
   * Import descriptors into wallet
   * @param timeoutMs - Optional timeout (default 30s). Use shorter timeout for fire-and-forget style.
   */
  async importDescriptors(
    walletName: string,
    descriptors: ImportDescriptor[],
    timeoutMs?: number
  ): Promise<ImportResult[]> {
    return this.rpc.call<ImportResult[]>('importdescriptors', [descriptors], walletName, timeoutMs);
  }

  /**
   * Get descriptor info (checksum, etc)
   */
  async getDescriptorInfo(descriptor: string): Promise<{
    descriptor: string;
    checksum: string;
    isrange: boolean;
    issolvable: boolean;
    hasprivatekeys: boolean;
  }> {
    return this.rpc.call('getdescriptorinfo', [descriptor]);
  }

  /**
   * Derive addresses from a descriptor
   */
  async deriveAddresses(descriptor: string, range?: number | [number, number]): Promise<string[]> {
    const params: unknown[] = [descriptor];
    if (range !== undefined) params.push(range);
    return this.rpc.call<string[]>('deriveaddresses', params);
  }

  // ============================================================
  // Wallet Encryption
  // ============================================================

  /**
   * Encrypt the wallet
   */
  async encryptWallet(walletName: string, passphrase: string): Promise<string> {
    return this.rpc.call<string>('encryptwallet', [passphrase], walletName);
  }

  /**
   * Unlock the wallet for a specified time
   */
  async walletPassphrase(walletName: string, passphrase: string, timeout: number): Promise<void> {
    return this.rpc.call('walletpassphrase', [passphrase, timeout], walletName);
  }

  /**
   * Lock the wallet
   */
  async walletLock(walletName: string): Promise<void> {
    return this.rpc.call('walletlock', [], walletName);
  }

  /**
   * Change wallet passphrase
   */
  async walletPassphraseChange(
    walletName: string,
    oldPassphrase: string,
    newPassphrase: string
  ): Promise<void> {
    return this.rpc.call('walletpassphrasechange', [oldPassphrase, newPassphrase], walletName);
  }

  // ============================================================
  // PSBT (Partially Signed Bitcoin Transactions)
  // ============================================================

  /**
   * Create a PSBT
   */
  async createPsbt(
    inputs: Array<{ txid: string; vout: number; sequence?: number }>,
    outputs: Array<Record<string, number> | { data: string }>,
    locktime = 0,
    replaceable = true
  ): Promise<string> {
    return this.rpc.call<string>('createpsbt', [inputs, outputs, locktime, replaceable]);
  }

  /**
   * Process a PSBT with wallet
   */
  async walletProcessPsbt(
    walletName: string,
    psbt: string,
    sign = true,
    sighashType: string = 'ALL',
    bip32derivs = true,
    finalize = true
  ): Promise<{ psbt: string; complete: boolean }> {
    return this.rpc.call(
      'walletprocesspsbt',
      [psbt, sign, sighashType, bip32derivs, finalize],
      walletName
    );
  }

  /**
   * Finalize a PSBT
   */
  async finalizePsbt(
    psbt: string,
    extract = true
  ): Promise<{ psbt?: string; hex?: string; complete: boolean }> {
    return this.rpc.call('finalizepsbt', [psbt, extract]);
  }

  /**
   * Decode a PSBT
   */
  async decodePsbt(psbt: string): Promise<unknown> {
    return this.rpc.call('decodepsbt', [psbt]);
  }

  // ============================================================
  // Rescan & Backup
  // ============================================================

  /**
   * Rescan blockchain for wallet transactions
   */
  async rescanBlockchain(
    walletName: string,
    startHeight?: number,
    stopHeight?: number
  ): Promise<{ start_height: number; stop_height: number }> {
    const params: unknown[] = [];
    if (startHeight !== undefined) params.push(startHeight);
    if (stopHeight !== undefined) params.push(stopHeight);
    return this.rpc.call('rescanblockchain', params, walletName);
  }

  /**
   * Abort a wallet rescan
   */
  async abortRescan(walletName: string): Promise<boolean> {
    return this.rpc.call<boolean>('abortrescan', [], walletName);
  }

  /**
   * Backup the wallet
   */
  async backupWallet(walletName: string, destination: string): Promise<void> {
    return this.rpc.call('backupwallet', [destination], walletName);
  }
}
