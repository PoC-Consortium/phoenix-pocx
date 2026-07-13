import { Injectable, signal, computed, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { NotificationService } from '../../shared/services/notification.service';
import { I18nService } from '../i18n';

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
  /**
   * The selected wallet is a single-address (wpkh(WIF)) wallet — one
   * address, change returns to it; the receive page hides "new address".
   */
  singleAddress: boolean;
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

/** Wire shape of one `btcx_wallet_transactions` page (items + total). */
export interface BtcxWalletTxPageDto {
  items: BtcxWalletTxDto[];
  /** History size BEFORE the limit/offset slice (the paginator length). */
  total: number;
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

/**
 * Descriptor branch recorded at create/restore/import time. 'legacy' only
 * ever occurs on descriptor-IMPORTED wallets (pkh / sh(wpkh) scripts) —
 * accepted for fund visibility and spending, gated from mining/assignments
 * like taproot.
 */
export interface BtcxDescriptorPolicy {
  kind: 'bip84' | 'bip86' | 'legacy';
  coinType: number;
}

/** Key-material source of a registered wallet. */
export type BtcxWalletSource = 'seed' | 'descriptor';

/** Structured error codes of the descriptor-import validation. */
export type BtcxImportErrorCode =
  | 'empty'
  | 'watch_only'
  | 'bare_key'
  | 'bare_wif'
  | 'wif_not_segwit'
  | 'wrong_network'
  | 'needs_internal'
  | 'unsupported_type'
  | 'not_ranged'
  | 'pair_mismatch'
  | 'multipath_nonstandard'
  | 'too_many'
  | 'parse';

/** Pre-submit feedback of `btcx_wallet_validate_import`. */
export interface BtcxImportValidation {
  valid: boolean;
  /** Error code keying the translated message (invalid input only). */
  code?: BtcxImportErrorCode;
  /** English error detail (secondary line under the translated message). */
  message?: string;
  /** Script-type classification of a VALID paste. */
  kind?: BtcxDescriptorPolicy['kind'];
  /** BIP32 coin type parsed from the derivation path (informational). */
  coinType?: number;
  /** The internal (change) descriptor was inferred automatically. */
  inferredInternal: boolean;
  /** Both branches came from one multipath `<0;1>` descriptor. */
  fromMultipath: boolean;
  /**
   * Single-address wpkh(WIF) wallet — one keychain, change returns to the
   * same address (the verdict line notes it).
   */
  singleAddress: boolean;
}

/** What `btcx_wallet_import_descriptor` did. */
export interface BtcxImportResult {
  status: BtcxWalletStatus;
  /** Script class + informational coin type the wallet registered with. */
  policy: BtcxDescriptorPolicy;
  inferredInternal: boolean;
  fromMultipath: boolean;
  /** Single-address wpkh(WIF) wallet — the success screen notes it. */
  singleAddress: boolean;
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
  /** Key-material source: seed (create/restore) or imported descriptors. */
  source: BtcxWalletSource;
  /** Single-address wpkh(WIF) wallet — the switcher/settings badge. */
  singleAddress: boolean;
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

/**
 * What one v30→v31 migration pass did (`btcx_wallet_migrate_v30` /
 * `btcx_wallet_rescan_legacy`):
 * - `noop` — nothing to create; the seed has no counterpart to build.
 * - `created-v31` — a v31 (BTCX coin type) counterpart was created + activated.
 * - `created-v30` — a legacy v30 (coin type 0') counterpart was restored.
 * - `already` — the migrate flag was already set (migrate pass only).
 * - `deferred` — skipped without weakening the seed at rest (locked/encrypted).
 */
export type BtcxV30MigrationOutcome =
  | 'noop'
  | 'created-v31'
  | 'created-v30'
  | 'already'
  | 'deferred';

/** Result of a v30→v31 migration pass (`btcx_wallet_migrate_v30` / rescan). */
export interface BtcxV30MigrationResult {
  outcome: BtcxV30MigrationOutcome;
  /** The wallet selected after the pass. */
  activeWallet: string;
  /** The counterpart wallet created (v31 or v30), if any. */
  createdWallet?: string;
  /** Human-readable note — e.g. why the pass deferred. */
  detail?: string;
  status: BtcxWalletStatus;
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
 * Default transaction window: the home page's recent-list maximum (its
 * FitRowsDirective caps at 10 rows). The service never fetches more than
 * the last consumer asked for, so a fat wallet's history stays on the Rust
 * side until the transactions page pages through it.
 */
export const RECENT_TX_LIMIT = 10;

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
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  // Signals for reactive state
  private readonly _status = signal<BtcxWalletStatus | null>(null);
  private readonly _balance = signal<BtcxBalance | null>(null);
  private readonly _transactions = signal<BtcxWalletTx[]>([]);
  private readonly _transactionsTotal = signal(0);
  /**
   * The window the `transactions` signal currently holds — re-requested
   * verbatim on every sync tick / refreshAll, so background refreshes stay
   * as small as whatever the visible page last asked for.
   */
  private _txWindow: { limit?: number; offset?: number } = { limit: RECENT_TX_LIMIT };
  private readonly _config = signal<BtcxWalletConfig | null>(null);
  private readonly _wallets = signal<BtcxWalletSummary[]>([]);
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
  /** The last requested transaction WINDOW (see refreshTransactions). */
  readonly transactions = this._transactions.asReadonly();
  /** Full history size behind the window (the paginator's length). */
  readonly transactionsTotal = this._transactionsTotal.asReadonly();
  readonly config = this._config.asReadonly();
  /** Registered wallets of the active network (refreshWallets snapshot). */
  readonly wallets = this._wallets.asReadonly();
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
   * The selected wallet is a single-address (wpkh(WIF)) wallet — one
   * address, change to self; the receive page hides "new address".
   */
  readonly singleAddress = computed(() => this._status()?.singleAddress ?? false);

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
        await Promise.all([this.refreshBalance(), this.refreshTransactions(RECENT_TX_LIMIT)]);
        // An already-open wallet on launch may still be a pre-v31 seed.
        void this.autoMigrateV30();
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
      // Keep the cheap cached views fresh on every sync/height change —
      // re-requesting only the WINDOW the UI currently shows.
      void this.refreshStatus();
      void this.refreshBalance();
      void this.refreshTransactions(this._txWindow.limit, this._txWindow.offset);
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
   * alone always recovers the funds. `kind` picks the descriptor family
   * (default BIP-84; 'bip86' = taproot, the create flow's advanced
   * address-type choice). Throws on failure.
   */
  async create(
    mnemonic: string,
    passphrase?: string,
    name?: string,
    kind?: BtcxDescriptorPolicy['kind']
  ): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_create', {
      mnemonic,
      passphrase: passphrase || null,
      name: name ?? null,
      kind: kind ?? null,
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
   * hit list and an honest fresh verdict. `kind` FORCES the descriptor
   * family instead: the best hit of that family (or its fresh BTCX-coin-
   * type default) — the second call of the "create both wallets" flow.
   * Throws on failure.
   */
  async restore(
    mnemonic: string,
    passphrase?: string,
    name?: string,
    kind?: BtcxDescriptorPolicy['kind']
  ): Promise<BtcxRestoreResult> {
    const result = await invoke<BtcxRestoreResult>('btcx_wallet_restore', {
      mnemonic,
      passphrase: passphrase || null,
      name: name ?? null,
      kind: kind ?? null,
    });
    this._status.set(result.status);
    await this.refreshConfig();
    await this.refreshAll();
    return result;
  }

  /**
   * Import a wallet from one or two PRIVATE descriptors (single input,
   * whitespace/newline separated). A single standard descriptor infers its
   * /0/* ↔ /1/* sibling; a multipath <0;1> descriptor carries both
   * branches; a wpkh(WIF) descriptor imports as a SINGLE-ADDRESS wallet
   * (change returns to the same address — vanity/plot identities).
   * Public-only (xpub) material is rejected — watch-only is not supported
   * yet. The optional passphrase encrypts the stored descriptors at rest.
   * Throws on failure.
   */
  async importDescriptor(
    input: string,
    passphrase?: string,
    name?: string
  ): Promise<BtcxImportResult> {
    const result = await invoke<BtcxImportResult>('btcx_wallet_import_descriptor', {
      input,
      passphrase: passphrase || null,
      name: name ?? null,
    });
    this._status.set(result.status);
    await this.refreshConfig();
    await this.refreshAll();
    return result;
  }

  /**
   * Pre-submit validation of the import paste box: parses/classifies the
   * input WITHOUT writing anything. Offline and cheap — call it on every
   * debounced input change.
   */
  async validateImport(input: string): Promise<BtcxImportValidation> {
    return invoke<BtcxImportValidation>('btcx_wallet_validate_import', { input });
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
    // Unlocking is the deferred-migration retry: a seed that could not be
    // migrated while locked can be now that it is open.
    void this.autoMigrateV30();
    return status;
  }

  /** Lock the wallet (close the runtime, forget the held passphrase). */
  async lock(): Promise<BtcxWalletStatus | null> {
    try {
      const status = await invoke<BtcxWalletStatus>('btcx_wallet_lock');
      this._status.set(status);
      this._balance.set(null);
      this.resetTransactionWindow();
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
   * Refresh the `wallets` signal from the registry — the mobile wallet
   * switcher's and settings page's shared list. Errors resolve to an empty
   * list (e.g. desktop-managed mode where the backend is untouched).
   */
  async refreshWallets(): Promise<BtcxWalletSummary[]> {
    try {
      const list = await this.list();
      this._wallets.set(list);
      return list;
    } catch (err) {
      console.error('Failed to list btcx wallets:', err);
      return this._wallets();
    }
  }

  /**
   * Select (and open, when possible) another registered wallet of the
   * active network. Closes the previous wallet's runtime. Throws on failure.
   */
  async select(name: string): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_select', { name });
    this._status.set(status);
    this._balance.set(null);
    this.resetTransactionWindow();
    // The previous runtime's sync events no longer describe this wallet.
    this._lastSync.set(null);
    await this.refreshConfig();
    await this.refreshAll();
    // A newly-opened wallet may still be a pre-v31 (coin-0') seed — migrate
    // it (and surface the one-time notice) once it is open.
    void this.autoMigrateV30();
    return status;
  }

  // ============================================================================
  // v30 → v31 Migration
  // ============================================================================

  /**
   * Silently upgrade a pre-v31 (legacy coin-0') seed to the new BTCX coin
   * type: when the open wallet's seed has an unregistered counterpart, the
   * backend creates it (`created-v31` for the v31 branch, `created-v30` for a
   * legacy branch with history) and records the pass; a locked/encrypted seed
   * `deferred`s so a later open retries. Refreshes config/status on success.
   * Throws on failure — callers decide whether to surface it.
   */
  async migrateV30(): Promise<BtcxV30MigrationResult> {
    const result = await invoke<BtcxV30MigrationResult>('btcx_wallet_migrate_v30');
    this._status.set(result.status);
    await this.refreshConfig();
    return result;
  }

  /**
   * Re-run the legacy (v30) probe for the open wallet, ignoring the migrate
   * flag — the "check for older funds" affordance. Restores a legacy
   * counterpart when history turns up (`created-v30`), otherwise `noop`.
   * Refreshes config/status. Throws on failure.
   */
  async rescanLegacy(): Promise<BtcxV30MigrationResult> {
    const result = await invoke<BtcxV30MigrationResult>('btcx_wallet_rescan_legacy');
    this._status.set(result.status);
    await this.refreshConfig();
    return result;
  }

  /**
   * Fire-and-forget v30 migration run for the open wallet, showing the calm
   * one-time notice only when a counterpart was actually created. Naturally
   * idempotent: once migrated the backend returns `already`/`noop`, and a
   * locked seed `deferred`s silently — so this is safe to call on every open.
   */
  private async autoMigrateV30(): Promise<void> {
    if (!this.walletActive()) return;
    try {
      const result = await this.migrateV30();
      if (result.outcome === 'created-v31' || result.outcome === 'created-v30') {
        this.notification.info(this.i18n.get('wallet_v30_migrated_notice'), undefined, 8000);
      }
    } catch (err) {
      // A migration hiccup must never block using the wallet — log and move on.
      console.warn('v30 auto-migration failed:', err);
    }
  }

  /**
   * Close the active wallet's runtime WITHOUT switching the selection (the
   * wallet selector's "unload"). The held passphrase survives.
   */
  async close(): Promise<BtcxWalletStatus> {
    const status = await invoke<BtcxWalletStatus>('btcx_wallet_close');
    this._status.set(status);
    this._balance.set(null);
    this.resetTransactionWindow();
    // The closed runtime's sync events are stale — the toolbar falls back
    // to the passive per-server health snapshots.
    this._lastSync.set(null);
    return status;
  }

  /** Empty the transaction signals and fall back to the default window. */
  private resetTransactionWindow(): void {
    this._transactions.set([]);
    this._transactionsTotal.set(0);
    this._txWindow = { limit: RECENT_TX_LIMIT };
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

  /**
   * Rename a registered wallet: registry entry + data dir move together
   * (active-wallet pointer follows if it referenced the old name). Refuses
   * the open wallet — switch first, like delete. Throws on failure.
   */
  async rename(name: string, newName: string): Promise<void> {
    await invoke('btcx_wallet_rename', { name, newName });
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

  /**
   * CURRENT receive address — the lowest-index revealed-but-unused
   * external address, revealing a fresh one only when none is outstanding
   * (BDK next-unused semantics, the desktop receive page's behavior).
   * Entering the receive page uses this so repeated visits never burn
   * addresses; only the explicit button calls `newAddress()`.
   */
  async currentAddress(): Promise<string> {
    return invoke<string>('btcx_wallet_current_address');
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

  /**
   * Fetch one WINDOW of the transaction history (newest first) WITHOUT
   * touching the signals — the backend-router seam (desktop remote mode)
   * pages through here so it never clobbers the mobile UI's window.
   * `limit: 0` is a cheap count-only query (no items, no per-item work).
   * Both absent = the full history. Throws on failure.
   */
  async fetchTransactionsPage(
    limit?: number,
    offset?: number
  ): Promise<{ items: BtcxWalletTx[]; total: number }> {
    const page = await invoke<BtcxWalletTxPageDto>('btcx_wallet_transactions', {
      limit: limit ?? null,
      offset: offset ?? null,
    });
    return { items: page.items.map(mapWalletTx), total: page.total };
  }

  /**
   * Refresh the `transactions` signal with one WINDOW of the history
   * (newest first) and remember the window: every background refresh
   * (sync tick, refreshAll after a send) re-requests the same small slice,
   * so nothing ever pulls a fat wallet's full history over IPC. The home
   * page asks for its recent-list maximum, the transactions page for its
   * fit-sized paginator page; `transactionsTotal` carries the full size.
   */
  async refreshTransactions(limit?: number, offset?: number): Promise<BtcxWalletTx[]> {
    this._txWindow = { limit, offset };
    try {
      const { items, total } = await this.fetchTransactionsPage(limit, offset);
      this._transactions.set(items);
      this._transactionsTotal.set(total);
      return items;
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

  /** Refresh the persisted wallet configuration (and the registry view). */
  async refreshConfig(): Promise<BtcxWalletConfig | null> {
    try {
      const config = await invoke<BtcxWalletConfig>('btcx_wallet_get_config');
      this._config.set(config);
      // The wallets signal is the registry's per-network view — every
      // path that can change it (create/restore/select/delete/network
      // switch) already refreshes the config, so ride the same seam.
      await this.refreshWallets();
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

  /**
   * Refresh balance + the current transaction window when the wallet is
   * open (no-ops otherwise) — never more than the UI's visible slice.
   */
  private async refreshAll(): Promise<void> {
    await this.refreshStatus();
    if (this.walletActive()) {
      await Promise.all([
        this.refreshBalance(),
        this.refreshTransactions(this._txWindow.limit, this._txWindow.offset),
      ]);
    }
  }

  /** Clear current error. */
  clearError(): void {
    this._error.set(null);
  }
}
