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
  /**
   * Whether the seed is PASSPHRASE-encrypted (lockable). False for the
   * transparent at-rest wraps (OS keystore / obfuscation) — those present
   * like unencrypted Core wallets (no padlock).
   */
  seedEncrypted: boolean;
  /** Whether the wallet runtime is open (bdk wallet + sync worker). */
  walletActive: boolean;
  /** Whether the nodeless wallet feature is configured active. */
  active: boolean;
  /** Active network name. */
  network: BtcxNetwork;
  /** Name of the selected wallet on the active network. */
  walletName: string;
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
  /** Display address derived from the outputs; absent when underivable. */
  address?: string;
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
  /**
   * Display address: the counterparty output on sends, our receiving
   * address on receives; null when underivable (e.g. OP_RETURN-only).
   */
  address: string | null;
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

/** Per-wallet metadata in the named-wallet registry. */
export interface BtcxWalletMeta {
  policy: BtcxDescriptorPolicy;
  /** Unix seconds at create/restore/migration time (display only). */
  createdAt?: number | null;
}

/** One registered wallet as listed by `btcx_wallet_list`. */
export interface BtcxWalletSummary {
  name: string;
  network: BtcxNetwork;
  policy: BtcxDescriptorPolicy;
  /** The selected wallet of the network. */
  isActive: boolean;
  /** Runtime open (only ever true for the active wallet). */
  isOpen: boolean;
  /** Whether the seed is PASSPHRASE-encrypted (lockable, shows a padlock). */
  seedEncrypted: boolean;
  /** Whether the seed currently needs a passphrase unlock. */
  seedLocked: boolean;
  /** Total balance in sats — only present for the open wallet. */
  balanceSat?: number;
}

/** Persisted wallet configuration (`btcx_wallet_get_config`). */
export interface BtcxWalletConfig {
  network: BtcxNetwork;
  /** Electrum server URLs keyed by network name (first = primary). */
  electrumServers: Record<string, string[]>;
  active: boolean;
  /**
   * LEGACY (pre-multi-wallet) descriptor policy per network name — only
   * present until the startup migration has run; absent afterwards.
   */
  descriptors?: Record<string, BtcxDescriptorPolicy>;
  /** Named-wallet registry: network name → wallet name → metadata. */
  wallets: Record<string, Record<string, BtcxWalletMeta>>;
  /** The selected wallet per network name (missing = 'default'). */
  activeWallet: Record<string, string>;
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

/** Aggregate Electrum connectivity as the toolbar indicator shows it. */
export type BtcxOverallHealth = 'connecting' | 'healthy' | 'degraded' | 'down';

/** Payload of the `btcx-wallet:sync` event. */
export interface BtcxSyncEvent {
  network: string;
  height: number;
  syncAgeSecs: number | null;
  /** Aggregate Electrum connectivity (home server + failover views). */
  overall: BtcxOverallHealth;
}

/** One server's health snapshot (`btcx_electrum_health`, snake_case DTO). */
export interface BtcxServerHealth {
  coin_id: string;
  url: string;
  /** 'untested' | 'healthy' | 'down'. */
  state: 'untested' | 'healthy' | 'down';
  /** 'wallet' (the home server), 'view', or 'standby'. */
  role?: 'wallet' | 'view' | 'standby';
  /** When down: seconds until the backoff window expires. */
  retry_in_secs?: number;
  /** Smoothed request latency, milliseconds. */
  latency_ms?: number;
  last_ok_secs_ago?: number;
  last_error?: string;
  last_error_secs_ago?: number;
  requests: number;
  failures: number;
}

/** Result of a live server probe (`btcx_electrum_probe`). */
export interface BtcxElectrumProbeResult {
  /** The server's chain tip height. */
  height: number;
  /** Round-trip time of the tip fetch, milliseconds. */
  latencyMs: number;
}

/** Chain tip snapshot from Electrum (`btcx_chain_info`). */
export interface BtcxChainInfo {
  network: BtcxNetwork;
  height: number;
  tipHash: string;
  /** nTime of the tip header, unix seconds. */
  headerTime: number;
  /** PoCX consensus base target of the tip (0 when unavailable). */
  baseTarget: number;
}

/** Client-side PSBT decode result (`btcx_psbt_decode`). */
export interface BtcxPsbtDecode {
  txid: string;
  version: number;
  locktime: number;
  vin: { txid: string; vout: number; sequence: number }[];
  vout: {
    n: number;
    valueSat: number;
    address?: string;
    scriptHex: string;
    opReturn: boolean;
  }[];
  inputs: {
    index: number;
    hasWitnessUtxo: boolean;
    hasNonWitnessUtxo: boolean;
    utxoValueSat?: number;
    utxoAddress?: string;
    partialSigs: number;
    isFinal: boolean;
  }[];
  feeSat?: number;
  complete: boolean;
}

/** Client-side PSBT analysis result (`btcx_psbt_analyze`). */
export interface BtcxPsbtAnalyze {
  inputs: { index: number; hasUtxo: boolean; isFinal: boolean; next: string }[];
  next: 'updater' | 'signer' | 'finalizer' | 'extractor';
  feeSat?: number;
  estimatedVsize?: number;
  estimatedFeeRateSatVb?: number;
}

/** Sign/finalize result (`btcx_psbt_wallet_process` / `btcx_psbt_finalize`). */
export interface BtcxPsbtProcessResult {
  psbt: string;
  hex?: string;
  complete: boolean;
}

/** One spendable wallet UTXO (`btcx_wallet_utxos`). */
export interface BtcxUtxo {
  txid: string;
  vout: number;
  amountSat: number;
  address?: string;
  confirmations: number;
  isChange: boolean;
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
    address: dto.address ?? null,
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

  /** Name of the selected wallet on the active network. */
  readonly walletName = computed(() => this._status()?.walletName ?? 'default');

  /**
   * Descriptor policy of the active network's selected wallet (null =
   * fresh default). Falls back to the legacy per-network map while the
   * startup migration has not run yet.
   */
  readonly descriptorPolicy = computed<BtcxDescriptorPolicy | null>(() => {
    const config = this._config();
    if (!config) return null;
    const name = config.activeWallet?.[config.network] ?? 'default';
    return (
      config.wallets?.[config.network]?.[name]?.policy ??
      config.descriptors?.[config.network] ??
      null
    );
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
   * Generate a fresh 24-word BIP39 mnemonic WITHOUT persisting it — for the
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
  async create(mnemonic: string, passphrase?: string, name?: string): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_create', {
      mnemonic,
      passphrase: passphrase || null,
      name: name ?? null,
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
  async restore(mnemonic: string, passphrase?: string, name?: string): Promise<BtcxRestoreResult> {
    const result = await invoke<BtcxRestoreResult>('btcx_wallet_restore', {
      mnemonic,
      passphrase: passphrase || null,
      name: name ?? null,
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
      this._lastSync.set(null);
      return status;
    } catch (err) {
      console.error('Failed to lock btcx wallet:', err);
      this._error.set(`${err}`);
      return null;
    }
  }

  // ============================================================================
  // Named-Wallet Registry
  // ============================================================================

  /** List the registered wallets of the active network. Throws on failure. */
  async list(): Promise<BtcxWalletSummary[]> {
    return invoke<BtcxWalletSummary[]>('btcx_wallet_list');
  }

  /**
   * Select (and open, when possible) another registered wallet of the
   * active network. Closes the previous wallet's runtime. Throws on failure.
   */
  async select(name: string): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_select', { name });
    this._status.set(status);
    this._balance.set(null);
    this._transactions.set([]);
    // The previous runtime's sync events no longer describe this wallet.
    this._lastSync.set(null);
    await this.refreshConfig();
    await this.refreshAll();
    return status;
  }

  /**
   * Close the active wallet's runtime WITHOUT switching the selection (the
   * wallet selector's "unload"). The held passphrase survives.
   */
  async close(): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_close');
    this._status.set(status);
    this._balance.set(null);
    this._transactions.set([]);
    // The closed runtime's sync events are stale — the toolbar falls back
    // to the passive per-server health snapshots.
    this._lastSync.set(null);
    return status;
  }

  /**
   * Delete a registered wallet — moved to the network's trash directory,
   * never removed from disk. Refuses the open wallet; `confirmName` must
   * repeat the name exactly. Throws on failure.
   */
  async delete(name: string, confirmName: string): Promise<void> {
    await invoke('btcx_wallet_delete', { name, confirmName });
    await this.refreshConfig();
    await this.refreshStatus();
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

  // ============================================================================
  // PSBT Operations (remote node mode)
  // ============================================================================

  /** Decode a PSBT for display — client-side `decodepsbt`. Throws on failure. */
  async psbtDecode(psbtBase64: string): Promise<BtcxPsbtDecode> {
    return invoke<BtcxPsbtDecode>('btcx_psbt_decode', { psbtBase64 });
  }

  /** Analyze a PSBT's signing progress — client-side `analyzepsbt`. */
  async psbtAnalyze(psbtBase64: string): Promise<BtcxPsbtAnalyze> {
    return invoke<BtcxPsbtAnalyze>('btcx_psbt_analyze', { psbtBase64 });
  }

  /** Sign a PSBT with the open wallet — client-side `walletprocesspsbt`. */
  async psbtProcess(psbtBase64: string): Promise<BtcxPsbtProcessResult> {
    return invoke<BtcxPsbtProcessResult>('btcx_psbt_wallet_process', { psbtBase64 });
  }

  /** Finalize a PSBT — client-side `finalizepsbt` (hex when complete). */
  async psbtFinalize(psbtBase64: string): Promise<BtcxPsbtProcessResult> {
    return invoke<BtcxPsbtProcessResult>('btcx_psbt_finalize', { psbtBase64 });
  }

  /** Merge signatures from several copies — client-side `combinepsbt`. */
  async psbtCombine(psbts: string[]): Promise<string> {
    return invoke<string>('btcx_psbt_combine', { psbts });
  }

  /** Compose a funded UNSIGNED PSBT — client-side `walletcreatefundedpsbt`. */
  async createFundedPsbt(
    outputs: { address: string; amountSat: number }[],
    feeRateSatVb?: number
  ): Promise<string> {
    return invoke<string>('btcx_wallet_create_funded_psbt', {
      outputs,
      feeRateSatVb: feeRateSatVb ?? null,
    });
  }

  /** The open wallet's unspent outputs (cache read). Throws on failure. */
  async utxos(): Promise<BtcxUtxo[]> {
    return invoke<BtcxUtxo[]>('btcx_wallet_utxos');
  }

  // ============================================================================
  // Forging Assignments (remote node mode)
  // ============================================================================

  /**
   * Create a forging assignment client-side (BDK build + sign, Electrum
   * broadcast). The plot address must hold a spendable coin in the open
   * wallet. Result mirrors the node's `create_assignment` (snake_case).
   * Throws on failure.
   */
  async createAssignment(
    plotAddress: string,
    forgingAddress: string,
    feeRateSatVb?: number
  ): Promise<{ txid: string; hex: string; plot_address: string; forging_address: string }> {
    const result = await invoke<{
      txid: string;
      hex: string;
      plot_address: string;
      forging_address: string;
    }>('btcx_wallet_create_assignment', {
      plotAddress,
      forgingAddress,
      feeRateSatVb: feeRateSatVb ?? null,
    });
    await this.refreshAll();
    return result;
  }

  /** Revoke a forging assignment client-side. Throws on failure. */
  async revokeAssignment(
    plotAddress: string,
    feeRateSatVb?: number
  ): Promise<{ txid: string; hex: string; plot_address: string }> {
    const result = await invoke<{ txid: string; hex: string; plot_address: string }>(
      'btcx_wallet_revoke_assignment',
      { plotAddress, feeRateSatVb: feeRateSatVb ?? null }
    );
    await this.refreshAll();
    return result;
  }

  /**
   * Assignment status derived from the plot address's Electrum script
   * history — mirrors the node's `get_assignment` (snake_case DTO).
   * Chain-only: works without an open wallet. Throws on failure.
   */
  async getAssignment(plotAddress: string): Promise<unknown> {
    return invoke('btcx_wallet_get_assignment', { plotAddress });
  }

  // ============================================================================
  // Electrum Health & Chain Info (remote node mode)
  // ============================================================================

  /**
   * Per-server health snapshots of the active network's configured servers
   * (passive cells — no network I/O). Throws on failure.
   */
  async electrumHealth(): Promise<BtcxServerHealth[]> {
    return invoke<BtcxServerHealth[]>('btcx_electrum_health');
  }

  /**
   * Probe one Electrum server with a fresh connection: dial, genesis-check
   * the chain, time a tip fetch. Throws with a reason on failure — the
   * settings "Test connection" button surfaces it.
   */
  async electrumProbe(url: string, network?: BtcxNetwork): Promise<BtcxElectrumProbeResult> {
    return invoke<BtcxElectrumProbeResult>('btcx_electrum_probe', {
      url,
      network: network ?? null,
    });
  }

  /**
   * Chain tip snapshot from the active network's first configured server —
   * the remote-mode replacement for getblockchaininfo. Chain-only: needs no
   * seed and no open wallet. Throws on failure.
   */
  async chainInfo(): Promise<BtcxChainInfo> {
    return invoke<BtcxChainInfo>('btcx_chain_info');
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
