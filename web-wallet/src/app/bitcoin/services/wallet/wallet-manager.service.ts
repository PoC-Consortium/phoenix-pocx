import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { WalletRpcService, WalletInfo, ImportResult } from '../rpc/wallet-rpc.service';
import { BlockchainRpcService, ScanTxOutSetObject } from '../rpc/blockchain-rpc.service';
import { DescriptorService, WalletDescriptors } from './descriptor.service';
import { BTCX_COIN_TYPE, BtcxWalletService } from '../../../core/services/btcx-wallet.service';
import { NodeService } from '../../../node/services/node.service';

/**
 * Wallet creation options
 */
export interface CreateWalletOptions {
  walletName: string;
  passphrase?: string;
  descriptors?: boolean;
  blank?: boolean;
  disablePrivateKeys?: boolean;
}

/**
 * Import wallet from mnemonic options
 */
export interface ImportWalletOptions {
  walletName: string;
  mnemonic: string;
  mnemonicPassphrase?: string;
  isTestnet?: boolean;
  account?: number;
  addressRange?: [number, number];
  rescan?: boolean;
  /**
   * true = the seed may have prior history: the active BTCX-coin-type
   * branches are imported as always, and the legacy branches (44'/49'/
   * 84'/86' at 0', plus 1' on testnet) are UTXO-scanned first and only
   * imported — inactive, never address-generating — when coins actually
   * live there. false/absent = brand-new seed: 84'+86' at the BTCX coin
   * type only.
   */
  restore?: boolean;
}

/**
 * Which derivation branches the restore-time UTXO scan found coins on.
 *
 * Deliberate trade-off (UTXO presence is the criterion): a legacy branch
 * that was fully DRAINED before the restore is not imported, so its old
 * transactions will not show in the history — but no funds can be
 * stranded, and the wallet stays free of dead legacy keyspace.
 */
export interface RestoreBranchReport {
  /** Legacy-era branches holding coins, e.g. ["84'/0'"]. */
  legacy: string[];
  /** BTCX-era branches holding coins, e.g. ["84'/BTCX"]. */
  pocx: string[];
  /** True when the UTXO scan found nothing on any branch. */
  fresh: boolean;
}

/**
 * How far back to rescan when importing watch-only descriptors. Maps to the
 * `timestamp` field of `importdescriptors`: 'now' = no rescan, 0 = genesis,
 * a unix-seconds integer = from that date.
 */
export type WatchOnlyRescan =
  | { kind: 'now' }
  | { kind: 'genesis' }
  | { kind: 'date'; timestamp: number };

/**
 * Watch-only wallet creation options. `descriptors` are canonical
 * `<body>#<checksum>` strings — raw addresses should be wrapped as
 * `addr(<addr>)` with a checksum by the caller before landing here.
 */
export interface WatchOnlyWalletOptions {
  walletName: string;
  descriptors: string[];
  rescan: WatchOnlyRescan;
}

export function rescanToTimestamp(rescan: WatchOnlyRescan): number | 'now' {
  switch (rescan.kind) {
    case 'now':
      return 'now';
    case 'genesis':
      return 0;
    case 'date':
      return rescan.timestamp;
  }
}

/**
 * N-of-M shape of a multisig wallet, parsed from its active
 * wsh(sortedmulti(...)) / wsh(multi(...)) descriptor.
 */
export interface MultisigInfo {
  requiredSigs: number;
  totalKeys: number;
}

/**
 * Parse a descriptor like "wsh(sortedmulti(2,keyA,keyB,...))" into its
 * N-of-M shape. Returns null for non-multisig descriptors.
 */
export function parseMultisigDescriptor(desc: string): MultisigInfo | null {
  const match = desc.match(/^wsh\((?:sorted)?multi\((\d+),([^)]+)\)/);
  if (!match) return null;
  return { requiredSigs: parseInt(match[1], 10), totalKeys: match[2].split(',').length };
}

/**
 * Wallet summary for UI display
 */
export interface WalletSummary {
  name: string;
  isLoaded: boolean;
  balance?: number;
  unconfirmedBalance?: number;
  txCount?: number;
  isDescriptor?: boolean;
  isWatchOnly?: boolean;
  /** Set when the wallet's active descriptors are N-of-M multisig (loaded wallets only) */
  multisig?: MultisigInfo;
  isEncrypted?: boolean;
  /**
   * Mirrors `getwalletinfo.unlocked_until`. `undefined` if the wallet is not
   * encrypted, `0` if encrypted and locked, `>0` (unix timestamp) if unlocked.
   */
  unlockedUntil?: number;
}

/**
 * Timeout passed to `walletpassphrase` when the user opts into a session-long
 * unlock. Bitcoin Core requires a positive integer; `0` is treated as "unlock
 * for 0 seconds". `i32::MAX` (~68 years) is the conventional "until restart"
 * value — the wallet will re-lock when the node process exits.
 */
export const SESSION_UNLOCK_SECONDS = 2_147_483_647;

/**
 * Earliest moment a v31 (BTCX coin type) address could hold funds: the
 * `importdescriptors` rescan floor for the v30→v31 upgrade. The v31 coin type
 * shipped 2026-07-09, so nothing can exist on a v31 branch before this — a
 * rescan from here (2026-07-01 UTC, a safe margin) catches any v31 funds
 * received on the same seed via another install without a full genesis rescan.
 */
export const V31_BIRTHDAY_TIMESTAMP = 1782864000;

/**
 * WalletManagerService handles wallet lifecycle operations.
 *
 * Responsibilities:
 * - Create new wallets (blank or from mnemonic)
 * - Load/unload wallets
 * - Import wallets from mnemonic (via descriptors)
 * - List and query wallet status
 * - Track currently active wallet
 */
@Injectable({ providedIn: 'root' })
export class WalletManagerService {
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly descriptorService = inject(DescriptorService);
  private readonly btcxWallet = inject(BtcxWalletService);
  private readonly nodeService = inject(NodeService);

  private readonly loadedWalletsSubject = new BehaviorSubject<string[]>([]);
  private readonly activeWalletSubject = new BehaviorSubject<string | null>(null);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);
  private readonly walletsChangedSubject = new Subject<void>();

  /** Observable of currently loaded wallet names */
  readonly loadedWallets$: Observable<string[]> = this.loadedWalletsSubject.asObservable();

  /** Observable of the active wallet name */
  readonly activeWallet$: Observable<string | null> = this.activeWalletSubject.asObservable();

  /** Observable of loading state */
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  /** Emits when wallets are loaded/unloaded - subscribe to refresh wallet lists */
  readonly walletsChanged$: Observable<void> = this.walletsChangedSubject.asObservable();

  /** Get current active wallet */
  get activeWallet(): string | null {
    return this.activeWalletSubject.value;
  }

  /** Get loaded wallets */
  get loadedWallets(): string[] {
    return this.loadedWalletsSubject.value;
  }

  // ============================================================
  // Wallet Discovery
  // ============================================================

  /**
   * Refresh the list of loaded wallets — from Bitcoin Core, or (remote
   * mode) the GROUP of the local store's open pocket (at most one; remote
   * wallet names surfaced by this service are always group ids).
   */
  async refreshLoadedWallets(): Promise<string[]> {
    if (this.nodeService.isRemote()) {
      const status = await this.btcxWallet.refreshStatus();
      let wallets: string[] = [];
      if (status?.walletActive) {
        const groups = await this.btcxWallet.refreshGroups();
        const group = groups.find(g => g.compartments.some(c => c.name === status.walletName));
        wallets = [group?.group ?? status.walletName];
      }
      this.loadedWalletsSubject.next(wallets);
      return wallets;
    }
    const wallets = await this.walletRpc.listWallets();
    this.loadedWalletsSubject.next(wallets);
    return wallets;
  }

  /**
   * List all wallets in the wallet directory (loaded and unloaded) —
   * remote mode lists the local named-wallet registry.
   */
  async listAllWallets(): Promise<string[]> {
    if (this.nodeService.isRemote()) {
      const list = await this.btcxWallet.list();
      return list.map(w => w.name);
    }
    const result = await this.walletRpc.listWalletDir();
    return result.wallets.map(w => w.name);
  }

  /**
   * Get wallet summaries for UI display. Remote mode maps the local
   * registry (`btcx_wallet_list`) onto the same summary shape the wallet
   * selector renders for Core wallets.
   */
  async getWalletSummaries(): Promise<WalletSummary[]> {
    if (this.nodeService.isRemote()) {
      // ONE row per GROUP (one seed): summed balance, loaded when any
      // pocket is open. Loading picks a pocket (see loadWallet /
      // loadRemotePocket) — fewer rows, one wallet per seed.
      const groups = await this.btcxWallet.refreshGroups();
      this.loadedWalletsSubject.next(
        groups.filter(g => g.compartments.some(c => c.isOpen)).map(g => g.group)
      );
      return groups.map(g => {
        const open = g.compartments.find(c => c.isOpen);
        const anyEncrypted = g.compartments.some(c => c.seedEncrypted);
        const anyLocked = g.compartments.some(c => c.seedLocked);
        return {
          name: g.group,
          isLoaded: !!open,
          // The OPEN pocket's balance — never a sum across pockets. Closed
          // groups fill the column from the chosen pocket's snapshot
          // (wallet-select's remoteBalance).
          balance: open?.balanceSat !== undefined ? open.balanceSat / 100_000_000 : undefined,
          isDescriptor: true,
          isWatchOnly: false,
          isEncrypted: anyEncrypted,
          // Selector semantics: undefined = no unlock needed, 0 = locked,
          // >0 = unlocked. Keyring-encrypted seeds auto-unlock → undefined.
          unlockedUntil: anyLocked ? 0 : anyEncrypted && !!open ? SESSION_UNLOCK_SECONDS : undefined,
        };
      });
    }

    const allWallets = await this.listAllWallets();
    const loadedWallets = await this.refreshLoadedWallets();

    const summaries: WalletSummary[] = [];

    for (const name of allWallets) {
      const isLoaded = loadedWallets.includes(name);
      const summary: WalletSummary = { name, isLoaded };

      if (isLoaded) {
        try {
          const info = await this.walletRpc.getWalletInfo(name);
          const balances = await this.walletRpc.getBalances(name);

          summary.balance = balances.mine.trusted;
          summary.unconfirmedBalance = balances.mine.untrusted_pending;
          summary.txCount = info.txcount;
          summary.isDescriptor = info.descriptors;
          summary.isWatchOnly = !info.private_keys_enabled;
          // Wallet is encrypted if unlocked_until field exists (0 means locked, >0 means unlocked until timestamp)
          summary.isEncrypted = info.unlocked_until !== undefined;
          summary.unlockedUntil = info.unlocked_until;
          if (info.descriptors) {
            summary.multisig = (await this.getMultisigInfo(name)) ?? undefined;
          }
        } catch {
          // Wallet info failed, just mark as loaded
        }
      }

      summaries.push(summary);
    }

    return summaries;
  }

  /**
   * N-of-M shape of a loaded wallet's multisig descriptors, or null when the
   * wallet is not multisig (or descriptors cannot be listed).
   */
  async getMultisigInfo(walletName: string): Promise<MultisigInfo | null> {
    try {
      const result = await this.walletRpc.listDescriptors(walletName);
      for (const d of result.descriptors) {
        const info = parseMultisigDescriptor(d.desc);
        if (info) return info;
      }
    } catch {
      // Legacy wallet or listing failed — treat as non-multisig
    }
    return null;
  }

  // ============================================================
  // Wallet Creation
  // ============================================================

  /**
   * Create a new empty descriptor wallet
   */
  async createWallet(options: CreateWalletOptions): Promise<{ name: string; warnings?: string[] }> {
    this.isLoadingSubject.next(true);

    try {
      const result = await this.walletRpc.createWallet(options.walletName, {
        blank: options.blank ?? true,
        passphrase: options.passphrase,
        descriptors: options.descriptors ?? true,
        disablePrivateKeys: options.disablePrivateKeys ?? false,
      });

      await this.refreshLoadedWallets();
      this.setActiveWallet(options.walletName);

      return result;
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  /**
   * Create a new wallet and import mnemonic-based descriptors.
   *
   * This is the primary method for creating a wallet from a seed phrase.
   * New wallets get the ACTIVE BTCX-coin-type branches (84'+86', receive
   * and change) — nothing else. Restores additionally UTXO-scan the legacy
   * branches (`scantxoutset`, no wallet needed) and import them INACTIVE
   * (watched and spendable, never address-generating) only when coins
   * actually live there, so legacy funds drain into the modern branch via
   * change while fresh/mobile/drained seeds get a clean modern-only wallet.
   */
  async createWalletFromMnemonic(options: ImportWalletOptions): Promise<{
    success: boolean;
    walletName: string;
    fingerprint: string;
    importResults: ImportResult[];
    errors?: string[];
    /** Restore only: which branches the UTXO scan found coins on. */
    branchReport?: RestoreBranchReport;
  }> {
    this.isLoadingSubject.next(true);

    try {
      // Validate mnemonic first
      if (!this.descriptorService.validateMnemonic(options.mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
      }

      const descriptorOptions = {
        passphrase: options.mnemonicPassphrase,
        isTestnet: options.isTestnet ?? true,
        account: options.account ?? 0,
        addressRange: options.addressRange ?? ([0, 999] as [number, number]),
      };

      // The BTCX-coin-type branches — always imported, ACTIVE, so every
      // new receive AND change address comes from the modern derivation.
      const pocxSet = this.descriptorService.generateNewWalletDescriptors(
        options.mnemonic,
        descriptorOptions
      );

      // Restore: pre-check the legacy branches against the UTXO set
      // (before touching any wallet) and keep only funded ones.
      let branchReport: RestoreBranchReport | undefined;
      let legacyEntries: Array<{
        desc: string;
        active: boolean;
        internal: boolean;
        range: [number, number];
        timestamp: number | 'now';
      }> = [];
      if (options.restore) {
        const legacySet = this.descriptorService.generateLegacyRestoreDescriptors(
          options.mnemonic,
          descriptorOptions
        );
        const scan = await this.scanBranchesForCoins(
          legacySet,
          pocxSet,
          descriptorOptions.addressRange
        );
        branchReport = scan.report ?? undefined;
        if (scan.importLegacy) {
          // INACTIVE: spendable and watched, but never handing out
          // addresses — legacy coins migrate to the BTCX branch as change.
          legacyEntries = this.descriptorService
            .formatForImport(legacySet)
            .map(entry => ({ ...entry, active: false }));
        }
      }

      // Create blank descriptor wallet
      await this.walletRpc.createWallet(options.walletName, {
        blank: true,
        descriptors: true,
        disablePrivateKeys: false,
      });

      // Import: active BTCX set + (restore only) funded legacy set.
      const importData = [...this.descriptorService.formatForImport(pocxSet), ...legacyEntries];
      const importResults = await this.walletRpc.importDescriptors(options.walletName, importData);

      // Check for errors
      const errors = importResults
        .filter(r => !r.success)
        .map(r => r.error?.message || 'Unknown import error');

      // Trigger rescan if requested (happens automatically with timestamp: 'now')
      if (options.rescan) {
        await this.walletRpc.rescanBlockchain(options.walletName);
      }

      await this.refreshLoadedWallets();
      this.setActiveWallet(options.walletName);

      return {
        success: errors.length === 0,
        walletName: options.walletName,
        fingerprint: pocxSet.fingerprint,
        importResults,
        errors: errors.length > 0 ? errors : undefined,
        branchReport,
      };
    } catch (error) {
      // If wallet was created but import failed, try to unload it
      try {
        await this.walletRpc.unloadWallet(options.walletName);
      } catch {
        // Ignore unload error
      }
      throw error;
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  /**
   * One `scantxoutset` over the legacy AND BTCX branch descriptors:
   * decides whether the legacy set gets imported (any legacy coin found)
   * and doubles as the user-facing branch report.
   *
   * Fails SAFE: when the scan cannot run (RPC hiccup, exotic node), the
   * legacy set is imported anyway — a pointless legacy import costs dead
   * keyspace, skipping a funded one would strand coins. No report then.
   */
  private async scanBranchesForCoins(
    legacySet: WalletDescriptors,
    pocxSet: WalletDescriptors,
    addressRange: [number, number]
  ): Promise<{ importLegacy: boolean; report: RestoreBranchReport | null }> {
    try {
      const scanObjects: ScanTxOutSetObject[] = [
        ...legacySet.descriptors,
        ...pocxSet.descriptors,
      ].map(d => ({ desc: d.descriptor, range: addressRange }));

      const result = await this.blockchainRpc.scanTxOutSet(scanObjects);
      if (!result.success) {
        return { importLegacy: true, report: null };
      }

      // The "current" coin type is per-network (mainnet: BTCX; testnet/
      // regtest: 1'). A UTXO on the current branch is not legacy.
      const currentCoinType = this.nodeService.network() === 'mainnet' ? BTCX_COIN_TYPE : 1;
      const legacy = new Set<string>();
      const pocx = new Set<string>();
      for (const unspent of result.unspents) {
        const branch = parseBranchFromDescriptor(unspent.desc);
        if (!branch) continue;
        (branch.coinType === currentCoinType ? pocx : legacy).add(branch.label);
      }
      return {
        importLegacy: legacy.size > 0,
        report: {
          legacy: [...legacy].sort(),
          pocx: [...pocx].sort(),
          fresh: result.unspents.length === 0,
        },
      };
    } catch {
      return { importLegacy: true, report: null };
    }
  }

  /**
   * Generate a new mnemonic for wallet creation
   */
  generateMnemonic(strength: 128 | 256 = 256): string {
    return this.descriptorService.generateMnemonic(strength);
  }

  /**
   * Validate a mnemonic phrase
   */
  validateMnemonic(mnemonic: string): boolean {
    return this.descriptorService.validateMnemonic(mnemonic);
  }

  /**
   * Create a watch-only wallet and batch-import the supplied descriptors.
   *
   * Creates a blank descriptor wallet with private keys disabled, then
   * imports every descriptor in a single `importdescriptors` RPC call
   * sharing the provided rescan timestamp. Any per-entry failure aborts
   * the batch and unloads the wallet so the caller can retry after
   * correction.
   */
  async createWatchOnlyWallet(options: WatchOnlyWalletOptions): Promise<void> {
    if (options.descriptors.length === 0) {
      throw new Error('At least one descriptor or address is required');
    }
    this.isLoadingSubject.next(true);

    try {
      await this.walletRpc.createWallet(options.walletName, {
        blank: true,
        descriptors: true,
        disablePrivateKeys: true,
      });

      const timestamp = rescanToTimestamp(options.rescan);
      const importSet = options.descriptors.map(desc => ({
        desc,
        timestamp,
        label: 'watch',
      }));

      const importResults = await this.walletRpc.importDescriptors(options.walletName, importSet);

      const errors = importResults
        .filter(r => !r.success)
        .map(r => r.error?.message || 'Unknown import error');

      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      await this.refreshLoadedWallets();
      this.setActiveWallet(options.walletName);

      this.walletsChangedSubject.next();
    } catch (error) {
      try {
        await this.walletRpc.unloadWallet(options.walletName);
      } catch {
        // Ignore unload error
      }
      throw error;
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  /**
   * Create an N-of-M multisig wallet from prepared wsh(sortedmulti(...))
   * import entries (this participant's key as xprv, co-signers as xpubs).
   *
   * Creates a blank descriptor wallet WITH private keys (the wallet must
   * sign its share of PSBTs), then batch-imports the receive/change
   * descriptors as active so the wallet derives addresses itself. Failure
   * unloads the wallet so the wizard can retry after correction.
   */
  async createMultisigWallet(options: {
    walletName: string;
    importEntries: Array<{
      desc: string;
      active: boolean;
      internal: boolean;
      range: [number, number];
      timestamp: number | 'now';
    }>;
  }): Promise<void> {
    if (options.importEntries.length === 0) {
      throw new Error('No descriptors to import');
    }
    this.isLoadingSubject.next(true);

    try {
      await this.walletRpc.createWallet(options.walletName, {
        blank: true,
        descriptors: true,
        disablePrivateKeys: false,
      });

      const importResults = await this.walletRpc.importDescriptors(
        options.walletName,
        options.importEntries
      );

      const errors = importResults
        .filter(r => !r.success)
        .map(r => r.error?.message || 'Unknown import error');
      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      await this.refreshLoadedWallets();
      this.setActiveWallet(options.walletName);
      this.walletsChangedSubject.next();
    } catch (error) {
      try {
        await this.walletRpc.unloadWallet(options.walletName);
      } catch {
        // Ignore unload error
      }
      throw error;
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  // ============================================================
  // v30 → v31 Upgrade (BTCX coin-type migration)
  // ============================================================
  //
  // OLD ("v30") Core wallets imported only the coin-type-0' descriptors.
  // NEW ("v31") wallets import the BTCX coin type (0x504F4358) branch. Since
  // Phoenix never persists a Core wallet's mnemonic, bitcoind cannot derive
  // the BTCX branch on its own — upgrading an old wallet to see (and generate)
  // v31 funds requires the user to RE-ENTER the seed, which is verified
  // against the wallet's existing descriptors before anything is imported.

  /**
   * True only for a Core wallet that is both upgradeable AND not yet upgraded:
   *
   * - has at least one HD descriptor on a legacy (non-BTCX) coin type, AND
   * - has NO active descriptor on the BTCX coin type, AND
   * - has private keys (`getwalletinfo.private_keys_enabled`), AND
   * - is not multisig.
   *
   * The private-keys gate excludes watch-only AND descriptor-imported wallets
   * (Phoenix imports those with private keys disabled), and the "must have a
   * legacy HD origin" gate excludes single-address (wpkh(WIF)) wallets, whose
   * descriptors carry no `[fp/purpose'/coin'/…]` key origin. Together these
   * enforce the product rule that a wallet created WITHOUT a mnemonic has no
   * upgrade path and never shows an upgrade badge.
   *
   * Remote (local BDK) wallets always derive at the BTCX coin type — nothing
   * to upgrade — so this is always false in remote mode.
   */
  async needsV31Upgrade(walletName: string): Promise<boolean> {
    if (this.nodeService.isRemote()) return false;
    // The v30→v31 split only exists on mainnet (coin 0' → BTCX coin type).
    // Testnet/regtest use coin type 1' end to end, so their non-BTCX
    // descriptors are the CURRENT branch, not a legacy one to upgrade.
    if (this.nodeService.network() !== 'mainnet') return false;

    let info: WalletInfo;
    let descriptors: Array<{ desc: string; active: boolean }>;
    try {
      info = await this.walletRpc.getWalletInfo(walletName);
      descriptors = (await this.walletRpc.listDescriptors(walletName)).descriptors;
    } catch {
      // Non-descriptor (legacy) wallet, or listing failed — no upgrade path.
      return false;
    }

    // No keys → watch-only or descriptor-import → not upgradeable.
    if (!info.private_keys_enabled) return false;

    // Multisig descriptors embed their full original paths — excluded.
    if (descriptors.some(d => parseMultisigDescriptor(d.desc) !== null)) return false;

    // New receives only ever come from the address types Phoenix hands out —
    // wpkh (84', bech32) and tr (86', taproot). Needs upgrade iff one of THOSE
    // is still active on a legacy (non-BTCX) coin type; importing the v31
    // branch active auto-deactivates them (one active descriptor per output
    // type). This also catches a PARTIAL upgrade, so the badge stays until the
    // legacy 84'/86' branches are actually inactive.
    //
    // Bitcoin Core's default pkh(44') and sh(wpkh)(49') descriptors are NEVER
    // used by Phoenix and hold no history, so an active one is harmless and
    // must NOT keep the badge lit.
    let hasActiveLegacyReceiveBranch = false;
    for (const d of descriptors) {
      if (!d.active) continue;
      const branch = parseBranchFromDescriptor(d.desc);
      // Skip raw-key / single-address descriptors (no BIP32 key origin).
      if (!branch) continue;
      const isPhoenixAddressType = branch.purpose === 84 || branch.purpose === 86;
      if (isPhoenixAddressType && branch.coinType !== BTCX_COIN_TYPE) {
        hasActiveLegacyReceiveBranch = true;
      }
    }

    return hasActiveLegacyReceiveBranch;
  }

  /**
   * Safety gate for the upgrade: confirm a re-entered mnemonic (+ optional
   * BIP39 passphrase) actually derives the wallet's existing descriptors.
   *
   * Compares the mnemonic's master fingerprint against the master fingerprint
   * carried in the wallet descriptors' key origins (`[fp/…]`), case-insensitive.
   * A wrong seed must be rejected here before any BTCX descriptor is imported.
   */
  async verifyMnemonicMatchesWallet(
    walletName: string,
    mnemonic: string,
    passphrase?: string
  ): Promise<boolean> {
    if (!this.descriptorService.validateMnemonic(mnemonic)) return false;

    const walletFingerprint = await this.getWalletMasterFingerprint(walletName);
    if (!walletFingerprint) return false;

    const mnemonicFingerprint = this.descriptorService.getMasterFingerprint(
      mnemonic,
      passphrase ?? ''
    );
    return walletFingerprint.toLowerCase() === mnemonicFingerprint.toLowerCase();
  }

  /**
   * Upgrade an old (coin-type-0') Core wallet to v31 by importing the BTCX
   * coin-type branch ACTIVE, using a re-entered mnemonic.
   *
   * Importing the v31 84'(wpkh) + 86'(tr) branches active is the ENTIRE job:
   * Bitcoin Core allows one active descriptor per output type, so this
   * automatically deactivates the previously-active legacy wpkh(84'/0') and
   * tr(86'/0') branches. They stay watched/spendable — funds intact, draining
   * into the v31 branch as change — but stop handing out new addresses. No
   * explicit legacy re-import (or range juggling) is needed.
   *
   * Bitcoin Core's default pkh(44') and sh(wpkh)(49') descriptors are a
   * different output type, so they stay active — but Phoenix only ever
   * requests bech32/taproot addresses, so they're never used and hold no
   * history. We deliberately leave them alone (`needsV31Upgrade` ignores
   * them, so the badge still clears).
   *
   * The v31 branch is new to this wallet (it never handed out v31 addresses),
   * so its only possible history is funds received on the SAME seed via
   * another install (mobile/BDK) after the v31 coin type shipped — hence a
   * rescan from the v31 birthday rather than genesis.
   *
   * Rejects a mismatched seed up front (`upgrade_seed_mismatch`). After
   * success the wallet hands out v31 addresses and `needsV31Upgrade` is false.
   */
  async upgradeWalletToV31(
    walletName: string,
    mnemonic: string,
    passphrase?: string
  ): Promise<void> {
    this.isLoadingSubject.next(true);

    try {
      if (!(await this.verifyMnemonicMatchesWallet(walletName, mnemonic, passphrase))) {
        throw new Error('upgrade_seed_mismatch');
      }

      const pocxSet = this.descriptorService.generateNewWalletDescriptors(mnemonic, {
        passphrase,
        isTestnet: this.nodeService.network() !== 'mainnet',
        account: 0,
        addressRange: [0, 999],
      });
      const pocxEntries = this.descriptorService.formatForImport(pocxSet).map(entry => ({
        ...entry,
        active: true,
        timestamp: V31_BIRTHDAY_TIMESTAMP as number | 'now',
      }));

      const importResults = await this.walletRpc.importDescriptors(walletName, pocxEntries);

      const errors = importResults
        .filter(r => !r.success)
        .map(r => r.error?.message || 'Unknown import error');
      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      await this.refreshLoadedWallets();
      this.walletsChangedSubject.next();
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  /**
   * Master-key fingerprint (8 hex) carried in a wallet's descriptor key
   * origins (`[fp/…]`). Returns null for wallets whose descriptors have no
   * origin (e.g. single-address / raw-key imports) or cannot be listed.
   */
  private async getWalletMasterFingerprint(walletName: string): Promise<string | null> {
    try {
      const { descriptors } = await this.walletRpc.listDescriptors(walletName);
      for (const d of descriptors) {
        const match = /\[([0-9a-fA-F]{8})\//.exec(d.desc);
        if (match) return match[1];
      }
    } catch {
      // Legacy wallet or listing failed.
    }
    return null;
  }

  // ============================================================
  // Wallet Loading/Unloading
  // ============================================================

  /**
   * The remote pocket a GROUP id resolves to when loaded without an
   * explicit pocket choice: the registry's last-selected member, else the
   * primary (current SegWit — the backend's role order). An exact pocket
   * name that is not a group id passes through unchanged.
   */
  private async resolveRemotePocket(name: string): Promise<string> {
    let groups = this.btcxWallet.groups();
    if (groups.length === 0) {
      groups = await this.btcxWallet.refreshGroups();
    }
    const group = groups.find(g => g.group === name);
    if (!group || group.compartments.length === 1) {
      return name;
    }
    return (group.compartments.find(c => c.isActive) ?? group.compartments[0]).name;
  }

  /**
   * Load one EXACT remote pocket — the wallet selector's pocket picker
   * (bypasses the group→pocket resolution, which matters when the group id
   * doubles as a member's name).
   */
  async loadRemotePocket(pocketName: string): Promise<void> {
    this.isLoadingSubject.next(true);
    try {
      await this.btcxWallet.select(pocketName);
      const loaded = await this.refreshLoadedWallets();
      if (loaded.length > 0) {
        this.setActiveWallet(loaded[0]);
      }
      this.walletsChangedSubject.next();
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  /**
   * Load a wallet. Remote mode selects (and opens) the named local wallet
   * — the previous one closes, Core-`loadwallet`-style semantics. A GROUP
   * id resolves to its last-selected pocket (see resolveRemotePocket).
   */
  async loadWallet(walletName: string, loadOnStartup?: boolean): Promise<void> {
    this.isLoadingSubject.next(true);

    try {
      if (this.nodeService.isRemote()) {
        await this.btcxWallet.select(await this.resolveRemotePocket(walletName));
      } else {
        await this.walletRpc.loadWallet(walletName, loadOnStartup);
      }
      await this.refreshLoadedWallets();

      // If no active wallet, set this as active
      if (!this.activeWallet) {
        this.setActiveWallet(walletName);
      }

      // Notify subscribers that wallets changed
      this.walletsChangedSubject.next();
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  /**
   * Unload a wallet. Remote mode closes the open local wallet's runtime
   * (selection survives; reopening needs no restore).
   */
  async unloadWallet(walletName: string): Promise<void> {
    this.isLoadingSubject.next(true);

    try {
      if (this.nodeService.isRemote()) {
        await this.btcxWallet.close();
      } else {
        await this.walletRpc.unloadWallet(walletName);
      }
      await this.refreshLoadedWallets();

      // If this was the active wallet, clear it or select another
      if (this.activeWallet === walletName) {
        const remaining = this.loadedWallets;
        this.setActiveWallet(remaining.length > 0 ? remaining[0] : null);
      }

      // Notify subscribers that wallets changed
      this.walletsChangedSubject.next();
    } finally {
      this.isLoadingSubject.next(false);
    }
  }

  /**
   * Set the active wallet
   */
  setActiveWallet(walletName: string | null): void {
    if (walletName && !this.loadedWallets.includes(walletName)) {
      throw new Error(`Wallet '${walletName}' is not loaded`);
    }
    this.activeWalletSubject.next(walletName);
  }

  /**
   * Notify subscribers that wallet list should be refreshed.
   * Call this after operations that affect wallet availability (e.g., node restart).
   */
  notifyWalletsChanged(): void {
    this.walletsChangedSubject.next();
  }

  // ============================================================
  // Wallet Information
  // ============================================================

  /**
   * Get wallet info for the active wallet
   */
  async getActiveWalletInfo(): Promise<WalletInfo | null> {
    if (!this.activeWallet) return null;
    return this.walletRpc.getWalletInfo(this.activeWallet);
  }

  /**
   * Get wallet info for a specific wallet
   */
  async getWalletInfo(walletName: string): Promise<WalletInfo> {
    return this.walletRpc.getWalletInfo(walletName);
  }

  /**
   * Check if a wallet name is available. Comparison is case-insensitive
   * because the underlying storage (Windows/macOS filesystems) treats
   * names that differ only in case as the same file.
   */
  async isWalletNameAvailable(walletName: string): Promise<boolean> {
    const allWallets = await this.listAllWallets();
    const target = walletName.trim().toLowerCase();
    return !allWallets.some(name => name.toLowerCase() === target);
  }

  // ============================================================
  // Wallet Encryption
  // ============================================================

  /**
   * Encrypt a wallet (can only be done once)
   */
  async encryptWallet(walletName: string, passphrase: string): Promise<void> {
    await this.walletRpc.encryptWallet(walletName, passphrase);
    // Wallet will be shut down after encryption, need to reload
    await this.refreshLoadedWallets();
  }

  /**
   * Unlock an encrypted wallet
   */
  async unlockWallet(
    walletName: string,
    passphrase: string,
    timeoutSeconds: number
  ): Promise<void> {
    if (this.nodeService.isRemote()) {
      // Local wallet: the passphrase decrypts the seed; the timeout concept
      // does not apply (held until lock/close).
      await this.btcxWallet.select(walletName);
      await this.btcxWallet.unlock(passphrase);
      this.walletsChangedSubject.next();
      return;
    }
    await this.walletRpc.walletPassphrase(walletName, passphrase, timeoutSeconds);
    this.walletsChangedSubject.next();
  }

  /**
   * Unlock an encrypted wallet for the lifetime of the Phoenix / node session.
   * The passphrase is forwarded to bitcoin-pocx core and not stored anywhere
   * in Phoenix; on a node restart the wallet will be locked again and the user
   * must re-enter it.
   */
  async unlockWalletForSession(walletName: string, passphrase: string): Promise<void> {
    await this.unlockWallet(walletName, passphrase, SESSION_UNLOCK_SECONDS);
  }

  /**
   * Lock an encrypted wallet
   */
  async lockWallet(walletName: string): Promise<void> {
    if (this.nodeService.isRemote()) {
      await this.btcxWallet.lock();
      this.walletsChangedSubject.next();
      return;
    }
    await this.walletRpc.walletLock(walletName);
    this.walletsChangedSubject.next();
  }

  // ============================================================
  // Backup & Recovery
  // ============================================================

  /**
   * Backup wallet to a file
   */
  async backupWallet(walletName: string, destination: string): Promise<void> {
    await this.walletRpc.backupWallet(walletName, destination);
  }

  /**
   * Rescan blockchain for wallet transactions
   */
  async rescanBlockchain(walletName: string, startHeight?: number): Promise<void> {
    await this.walletRpc.rescanBlockchain(walletName, startHeight);
  }

  /**
   * Abort an ongoing rescan
   */
  async abortRescan(walletName: string): Promise<boolean> {
    return this.walletRpc.abortRescan(walletName);
  }
}

/**
 * Fold a descriptor carrying a key-origin like `[fp/84h/0h/0h]` (or the
 * apostrophe-hardened form, as `scantxoutset` echoes it back) into its
 * purpose'/coin' branch. Returns null when there is no such origin.
 */
export function parseBranchFromDescriptor(
  desc: string | undefined
): { purpose: number; coinType: number; label: string } | null {
  if (!desc) return null;
  const match = /\[[0-9a-fA-F]{8}\/(\d+)['hH]\/(\d+)['hH]/.exec(desc);
  if (!match) return null;
  const purpose = parseInt(match[1], 10);
  const coinType = parseInt(match[2], 10);
  const coinLabel = coinType === BTCX_COIN_TYPE ? 'BTCX' : `${coinType}'`;
  return { purpose, coinType, label: `${purpose}'/${coinLabel}` };
}
