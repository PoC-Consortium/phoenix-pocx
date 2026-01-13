import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { WalletRpcService, WalletInfo, ImportResult } from '../rpc/wallet-rpc.service';
import { DescriptorService, DescriptorOptions } from './descriptor.service';

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
}

/**
 * Watch-only wallet creation options
 */
export interface WatchOnlyWalletOptions {
  walletName: string;
  address: string;
  rescan?: boolean;
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
  isEncrypted?: boolean;
}

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
  private readonly descriptorService = inject(DescriptorService);

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
   * Refresh the list of loaded wallets from Bitcoin Core
   */
  async refreshLoadedWallets(): Promise<string[]> {
    const wallets = await this.walletRpc.listWallets();
    this.loadedWalletsSubject.next(wallets);
    return wallets;
  }

  /**
   * List all wallets in the wallet directory (loaded and unloaded)
   */
  async listAllWallets(): Promise<string[]> {
    const result = await this.walletRpc.listWalletDir();
    return result.wallets.map(w => w.name);
  }

  /**
   * Get wallet summaries for UI display
   */
  async getWalletSummaries(): Promise<WalletSummary[]> {
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
        } catch {
          // Wallet info failed, just mark as loaded
        }
      }

      summaries.push(summary);
    }

    return summaries;
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
   * Create a new wallet and import mnemonic-based descriptors
   *
   * This is the primary method for creating a wallet from a seed phrase.
   * It creates a blank descriptor wallet and imports all standard descriptors.
   */
  async createWalletFromMnemonic(options: ImportWalletOptions): Promise<{
    success: boolean;
    walletName: string;
    fingerprint: string;
    importResults: ImportResult[];
    errors?: string[];
  }> {
    this.isLoadingSubject.next(true);

    try {
      // Validate mnemonic first
      if (!this.descriptorService.validateMnemonic(options.mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
      }

      // Create blank descriptor wallet
      await this.walletRpc.createWallet(options.walletName, {
        blank: true,
        descriptors: true,
        disablePrivateKeys: false,
      });

      // Generate descriptors from mnemonic
      const descriptorOptions: DescriptorOptions = {
        passphrase: options.mnemonicPassphrase,
        isTestnet: options.isTestnet ?? true,
        account: options.account ?? 0,
        addressRange: options.addressRange ?? [0, 999],
      };

      const walletDescriptors = this.descriptorService.generateDescriptors(
        options.mnemonic,
        descriptorOptions
      );

      // Format for import
      const importData = this.descriptorService.formatForImport(walletDescriptors);

      // Import descriptors
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
        fingerprint: walletDescriptors.fingerprint,
        importResults,
        errors: errors.length > 0 ? errors : undefined,
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
   * Create a watch-only wallet from a single Bitcoin address
   *
   * This creates a descriptor wallet with private keys disabled
   * and imports the address as an addr() descriptor.
   */
  async createWatchOnlyWallet(options: WatchOnlyWalletOptions): Promise<void> {
    this.isLoadingSubject.next(true);

    try {
      // Create a blank descriptor wallet with private keys disabled
      await this.walletRpc.createWallet(options.walletName, {
        blank: true,
        descriptors: true,
        disablePrivateKeys: true,
      });

      // Create an addr() descriptor for the address
      // Get descriptor info to compute checksum
      const descriptorInfo = await this.walletRpc.getDescriptorInfo(`addr(${options.address})`);

      // Import the descriptor
      const importResults = await this.walletRpc.importDescriptors(options.walletName, [
        {
          desc: descriptorInfo.descriptor, // includes checksum
          timestamp: options.rescan ? 0 : 'now',
          label: 'watched-address',
        },
      ]);

      // Check for import errors
      const errors = importResults
        .filter(r => !r.success)
        .map(r => r.error?.message || 'Unknown import error');

      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      await this.refreshLoadedWallets();
      this.setActiveWallet(options.walletName);

      // Notify subscribers
      this.walletsChangedSubject.next();
    } catch (error) {
      // If wallet was created but something failed, try to unload it
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
  // Wallet Loading/Unloading
  // ============================================================

  /**
   * Load a wallet
   */
  async loadWallet(walletName: string, loadOnStartup?: boolean): Promise<void> {
    this.isLoadingSubject.next(true);

    try {
      await this.walletRpc.loadWallet(walletName, loadOnStartup);
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
   * Unload a wallet
   */
  async unloadWallet(walletName: string): Promise<void> {
    this.isLoadingSubject.next(true);

    try {
      await this.walletRpc.unloadWallet(walletName);
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
   * Check if a wallet name is available
   */
  async isWalletNameAvailable(walletName: string): Promise<boolean> {
    const allWallets = await this.listAllWallets();
    return !allWallets.includes(walletName);
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
    await this.walletRpc.walletPassphrase(walletName, passphrase, timeoutSeconds);
  }

  /**
   * Lock an encrypted wallet
   */
  async lockWallet(walletName: string): Promise<void> {
    await this.walletRpc.walletLock(walletName);
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
