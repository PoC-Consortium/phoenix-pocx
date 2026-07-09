import { Injectable, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

/**
 * BTCX Wallet Service
 *
 * Signal-based wrapper around the nodeless BTCX wallet Tauri backend
 * (`btcx_wallet_*` commands + the `btcx-wallet:sync` event), mirroring how
 * NodeService wraps the node commands. Used by the mobile wallet UI; the
 * desktop wallet keeps using the Core-RPC services.
 *
 * All backend DTOs are camelCase EXCEPT `btcx_wallet_transactions`, whose
 * items come snake_case straight from the wallet-btcx crate — they are
 * mapped to camelCase here (see mapWalletTx).
 */

// ============================================================================
// Types (wire shapes of the btcx_wallet_* commands)
// ============================================================================

/** Seed lifecycle as reported by `btcx_wallet_status`. */
export type BtcxSeedState = 'none' | 'locked' | 'unlocked';

/** Network the nodeless wallet runs on. */
export type BtcxNetwork = 'mainnet' | 'testnet' | 'regtest';

/** Snapshot returned by `btcx_wallet_status`. */
export interface BtcxWalletStatus {
  /** Seed lifecycle: none | locked | unlocked. */
  seed: BtcxSeedState;
  /** Whether the on-disk seed is passphrase-encrypted. */
  seedEncrypted: boolean;
  /** Whether the wallet runtime is open (bdk wallet + sync worker). */
  walletActive: boolean;
  /** Whether the nodeless wallet feature is configured active. */
  active: boolean;
  /** Active network name. */
  network: BtcxNetwork;
  /** Wallet-cache chain height, once open. */
  syncedHeight?: number;
  /** Seconds since the last completed sync pass. */
  syncAgeSecs?: number;
}

/** Balance breakdown in sats (bdk balance categories). */
export interface BtcxBalance {
  confirmedSat: number;
  trustedPendingSat: number;
  untrustedPendingSat: number;
  immatureSat: number;
  /** confirmed + trusted pending — what a send can use. */
  spendableSat: number;
  totalSat: number;
}

/** Wire shape of one `btcx_wallet_transactions` item (snake_case DTO). */
export interface BtcxWalletTxDto {
  txid: string;
  direction: string;
  amount_sat: number;
  fee_sat: number | null;
  vsize: number;
  confirmations: number;
  timestamp: number | null;
}

/** A wallet transaction, mapped to camelCase for the UI. */
export interface BtcxWalletTx {
  txid: string;
  /** Net direction: 'sent' or 'received'. */
  direction: 'sent' | 'received';
  /** Net value moved in sats, excluding the fee on sends. */
  amountSat: number;
  /** Fee in sats; null on receives (paid by the sender). */
  feeSat: number | null;
  /** Virtual size in vB. */
  vsize: number;
  confirmations: number;
  /** Block time (confirmed) or first-seen time (mempool), unix seconds. */
  timestamp: number | null;
}

/** Fee estimates in decimal sat/vB (`btcx_wallet_fee_estimates`). */
export interface BtcxFeeEstimates {
  /** Coin feerate floor (the custom field's minimum/default). */
  minSatPerVb: number;
  /** 1-block target; null when the estimator has no data. */
  fast: number | null;
  /** 6-block target. */
  normal: number | null;
  /** 144-block target. */
  slow: number | null;
}

/** Descriptor branch recorded at create/restore time. */
export interface BtcxDescriptorPolicy {
  kind: 'bip84' | 'bip86';
  coinType: number;
}

/** One probed derivation branch with history (`btcx_wallet_restore`). */
export interface BtcxBranchHit {
  policy: BtcxDescriptorPolicy;
  /** Deepest external (receive) index with history, if any. */
  deepestExternal: number | null;
  /** Deepest internal (change) index with history, if any. */
  deepestInternal: number | null;
}

/** What a restore (or re-probe) found and did. */
export interface BtcxRestoreResult {
  status: BtcxWalletStatus;
  /** The branch the wallet opened with. */
  selected: BtcxDescriptorPolicy;
  /**
   * Every probed branch with history, priority order. More than one entry
   * means history also exists on branches this wallet does not open.
   */
  hits: BtcxBranchHit[];
  /** True when NO branch had history — the wallet starts fresh. */
  fresh: boolean;
}

/** Persisted wallet configuration (`btcx_wallet_get_config`). */
export interface BtcxWalletConfig {
  network: BtcxNetwork;
  /** Electrum server URLs keyed by network name. */
  electrumServers: Record<string, string[]>;
  active: boolean;
  /** Descriptor policy per network name (missing = fresh default). */
  descriptors: Record<string, BtcxDescriptorPolicy>;
}

/** A send request (`btcx_wallet_send`). Give amountSat XOR sendAll. */
export interface BtcxSendRequest {
  address: string;
  amountSat?: number;
  /** Sweep the whole wallet (fee taken out of the swept amount). */
  sendAll?: boolean;
  /** Confirmation target in blocks (market fee estimate). */
  feeTarget?: number;
  /** Explicit feerate in sat/vB; wins over feeTarget. */
  feeRateSatVb?: number;
}

/** Payload of the `btcx-wallet:sync` event. */
export interface BtcxSyncEvent {
  network: string;
  height: number;
  syncAgeSecs: number | null;
}

/** The BIP32 coin type new BTCX wallets derive at (0x504F4358, "POCX"). */
export const BTCX_COIN_TYPE = 0x504f4358;

/**
 * Map one snake_case transaction DTO from `btcx_wallet_transactions` to the
 * camelCase shape the UI uses. Exported for unit testing.
 */
export function mapWalletTx(dto: BtcxWalletTxDto): BtcxWalletTx {
  return {
    txid: dto.txid,
    direction: dto.direction === 'sent' ? 'sent' : 'received',
    amountSat: dto.amount_sat,
    feeSat: dto.fee_sat ?? null,
    vsize: dto.vsize,
    confirmations: dto.confirmations,
    timestamp: dto.timestamp ?? null,
  };
}

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class BtcxWalletService {
  // Signals for reactive state
  private readonly _status = signal<BtcxWalletStatus | null>(null);
  private readonly _balance = signal<BtcxBalance | null>(null);
  private readonly _transactions = signal<BtcxWalletTx[]>([]);
  private readonly _config = signal<BtcxWalletConfig | null>(null);
  private readonly _lastSync = signal<BtcxSyncEvent | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _initialized = signal(false);

  // Initialization lock to prevent concurrent initialization
  private _initializationPromise: Promise<void> | null = null;

  // Event listeners
  private _eventUnlisteners: UnlistenFn[] = [];
  private _isListening = false;

  // Public readonly signals
  readonly status = this._status.asReadonly();
  readonly balance = this._balance.asReadonly();
  readonly transactions = this._transactions.asReadonly();
  readonly config = this._config.asReadonly();
  readonly lastSync = this._lastSync.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly initialized = this._initialized.asReadonly();

  // Computed values
  readonly seedState = computed<BtcxSeedState>(() => this._status()?.seed ?? 'none');
  readonly hasSeed = computed(() => this.seedState() !== 'none');
  readonly isLocked = computed(() => this.seedState() === 'locked');
  readonly seedEncrypted = computed(() => this._status()?.seedEncrypted ?? false);
  readonly walletActive = computed(() => this._status()?.walletActive ?? false);
  readonly network = computed<BtcxNetwork>(() => this._status()?.network ?? 'mainnet');
  readonly syncedHeight = computed(() => this._status()?.syncedHeight ?? null);
  readonly syncAgeSecs = computed(() => this._status()?.syncAgeSecs ?? null);
  readonly hasSynced = computed(() => this._status()?.syncAgeSecs !== undefined);

  /** Electrum servers configured for the ACTIVE network. */
  readonly electrumServers = computed<string[]>(() => {
    const config = this._config();
    if (!config) return [];
    return config.electrumServers[config.network] ?? [];
  });
  readonly hasElectrumServer = computed(() => this.electrumServers().length > 0);

  /** Descriptor policy of the ACTIVE network (null = fresh default). */
  readonly descriptorPolicy = computed<BtcxDescriptorPolicy | null>(() => {
    const config = this._config();
    if (!config) return null;
    return config.descriptors[config.network] ?? null;
  });

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the service: set up the sync event listener and load status
   * and config. Called lazily from the mobile wallet UI (NOT from a
   * constructor) so desktop launches never touch the btcx wallet backend.
   * Safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this._initialized()) {
      return;
    }
    if (this._initializationPromise) {
      return this._initializationPromise;
    }
    this._initializationPromise = this._doInitialize();
    return this._initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    this._isLoading.set(true);
    try {
      await this.setupEventListeners();
      await Promise.all([this.refreshStatus(), this.refreshConfig()]);
      if (this.walletActive()) {
        await Promise.all([this.refreshBalance(), this.refreshTransactions()]);
      }
      this._initialized.set(true);
    } catch (err) {
      console.error('BtcxWalletService: Failed to initialize:', err);
      this._error.set(`${err}`);
      // Clear the promise so retry is possible
      this._initializationPromise = null;
    } finally {
      this._isLoading.set(false);
    }
  }

  private async setupEventListeners(): Promise<void> {
    if (this._isListening) {
      return;
    }
    this._isListening = true;

    const syncUnlisten = await listen<BtcxSyncEvent>('btcx-wallet:sync', event => {
      this._lastSync.set(event.payload);
      // Keep the cheap cached views fresh on every sync/height change
      void this.refreshStatus();
      void this.refreshBalance();
      void this.refreshTransactions();
    });
    this._eventUnlisteners.push(syncUnlisten);
  }

  /** Clean up event listeners. */
  cleanupEventListeners(): void {
    for (const unlisten of this._eventUnlisteners) {
      unlisten();
    }
    this._eventUnlisteners = [];
    this._isListening = false;
  }

  // ============================================================================
  // Status & Seed Lifecycle
  // ============================================================================

  /** Refresh the wallet status snapshot. */
  async refreshStatus(): Promise<BtcxWalletStatus | null> {
    try {
      const status = await invoke<BtcxWalletStatus>('btcx_wallet_status');
      this._status.set(status);
      return status;
    } catch (err) {
      console.error('Failed to get btcx wallet status:', err);
      this._error.set(`${err}`);
      return null;
    }
  }

  /**
   * Generate a fresh 12-word BIP39 mnemonic WITHOUT persisting it — for the
   * show-and-confirm onboarding flow. Commit it with create().
   */
  async generateMnemonic(): Promise<string> {
    return invoke<string>('btcx_wallet_generate_mnemonic');
  }

  /**
   * Create the wallet from a (freshly generated, user-confirmed) mnemonic.
   * The optional passphrase encrypts the seed at rest only — the mnemonic
   * alone always recovers the funds. Throws on failure.
   */
  async create(mnemonic: string, passphrase?: string): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_create', {
      mnemonic,
      passphrase: passphrase || null,
    });
    this._status.set(status);
    await this.refreshConfig();
    await this.refreshAll();
    return status;
  }

  /**
   * Restore the wallet from an existing mnemonic. The backend probes EVERY
   * descriptor branch the seed's history could live on (needs a reachable
   * Electrum server) and opens the best hit; the result carries the full
   * hit list and an honest fresh verdict. Throws on failure.
   */
  async restore(mnemonic: string, passphrase?: string): Promise<BtcxRestoreResult> {
    const result = await invoke<BtcxRestoreResult>('btcx_wallet_restore', {
      mnemonic,
      passphrase: passphrase || null,
    });
    this._status.set(result.status);
    await this.refreshConfig();
    await this.refreshAll();
    return result;
  }

  /**
   * Re-run the restore probe over the already-imported seed — the "scan
   * again" affordance behind a fresh-restore verdict (the server could
   * have been lagging). Switches to a found branch only when the current
   * branch has no history of its own. Throws on failure.
   */
  async reprobe(): Promise<BtcxRestoreResult> {
    const result = await invoke<BtcxRestoreResult>('btcx_wallet_reprobe');
    this._status.set(result.status);
    await this.refreshConfig();
    await this.refreshAll();
    return result;
  }

  /** Unlock a passphrase-encrypted seed and open the wallet. Throws on failure. */
  async unlock(passphrase: string): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_unlock', { passphrase });
    this._status.set(status);
    await this.refreshAll();
    return status;
  }

  /** Lock the wallet (close the runtime, forget the held passphrase). */
  async lock(): Promise<BtcxWalletStatus | null> {
    try {
      const status = await invoke<BtcxWalletStatus>('btcx_wallet_lock');
      this._status.set(status);
      this._balance.set(null);
      this._transactions.set([]);
      return status;
    } catch (err) {
      console.error('Failed to lock btcx wallet:', err);
      this._error.set(`${err}`);
      return null;
    }
  }

  // ============================================================================
  // Wallet Operations
  // ============================================================================

  /** Fresh receive address. Throws when the wallet is not open. */
  async newAddress(): Promise<string> {
    return invoke<string>('btcx_wallet_new_address');
  }

  /** Refresh the balance breakdown from the background-synced cache. */
  async refreshBalance(): Promise<BtcxBalance | null> {
    try {
      const balance = await invoke<BtcxBalance>('btcx_wallet_balance');
      this._balance.set(balance);
      return balance;
    } catch (err) {
      console.error('Failed to get btcx wallet balance:', err);
      return null;
    }
  }

  /** Refresh the transaction history (newest first), mapping the snake_case DTO. */
  async refreshTransactions(): Promise<BtcxWalletTx[]> {
    try {
      const txs = await invoke<BtcxWalletTxDto[]>('btcx_wallet_transactions');
      const mapped = txs.map(mapWalletTx);
      this._transactions.set(mapped);
      return mapped;
    } catch (err) {
      console.error('Failed to get btcx wallet transactions:', err);
      return [];
    }
  }

  /**
   * Send sats to an address (or sweep everything with sendAll). Returns the
   * txid. Throws on failure — callers surface the message.
   */
  async send(request: BtcxSendRequest): Promise<string> {
    const txid = await invoke<string>('btcx_wallet_send', { request });
    await this.refreshAll();
    return txid;
  }

  /** RBF-bump a wallet-owned transaction; returns the replacement txid. Throws on failure. */
  async bumpFee(txid: string, feeRateSatVb: number): Promise<string> {
    const newTxid = await invoke<string>('btcx_wallet_bumpfee', { txid, feeRateSatVb });
    await this.refreshAll();
    return newTxid;
  }

  /** Market fee estimates from the wallet's home Electrum server. Throws on failure. */
  async fetchFeeEstimates(): Promise<BtcxFeeEstimates> {
    return invoke<BtcxFeeEstimates>('btcx_wallet_fee_estimates');
  }

  /**
   * Broadcast a raw transaction (hex) over the configured Electrum servers
   * and return the txid. Chain-only: needs NO seed and NO open wallet —
   * used by the desktop Transaction Builder's Electrum broadcast target.
   * `network` picks which network's server list to use (default: the wallet
   * config's active network). Throws on failure — callers surface the message.
   */
  async broadcastTx(txHex: string, network?: BtcxNetwork): Promise<string> {
    return invoke<string>('btcx_broadcast_tx', { txHex, network: network ?? null });
  }

  /**
   * Electrum servers configured for `network` per the last refreshed config
   * (empty until refreshConfig()/initialize() has run).
   */
  serversFor(network: BtcxNetwork): string[] {
    return this._config()?.electrumServers[network] ?? [];
  }

  // ============================================================================
  // Configuration & Sync
  // ============================================================================

  /** Refresh the persisted wallet configuration. */
  async refreshConfig(): Promise<BtcxWalletConfig | null> {
    try {
      const config = await invoke<BtcxWalletConfig>('btcx_wallet_get_config');
      this._config.set(config);
      return config;
    } catch (err) {
      console.error('Failed to get btcx wallet config:', err);
      this._error.set(`${err}`);
      return null;
    }
  }

  /**
   * Update network and/or the active network's Electrum servers. A change
   * that affects the open runtime closes and reopens it. Throws on failure.
   */
  async setConfig(update: {
    network?: BtcxNetwork;
    electrumServers?: string[];
    active?: boolean;
  }): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_set_config', {
      network: update.network ?? null,
      electrumServers: update.electrumServers ?? null,
      active: update.active ?? null,
    });
    this._status.set(status);
    await this.refreshConfig();
    await this.refreshAll();
    return status;
  }

  /**
   * Poke the background sync worker for an immediate pass. Completion
   * surfaces through the `btcx-wallet:sync` event / status refreshes.
   */
  async syncNow(): Promise<boolean> {
    try {
      await invoke('btcx_wallet_sync_now');
      return true;
    } catch (err) {
      console.error('Failed to poke btcx wallet sync:', err);
      return false;
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /** Refresh balance + transactions when the wallet is open (no-ops otherwise). */
  private async refreshAll(): Promise<void> {
    await this.refreshStatus();
    if (this.walletActive()) {
      await Promise.all([this.refreshBalance(), this.refreshTransactions()]);
    }
  }

  /** Clear current error. */
  clearError(): void {
    this._error.set(null);
  }
}
