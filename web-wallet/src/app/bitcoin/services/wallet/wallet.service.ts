import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, interval, takeUntil } from 'rxjs';
import { WalletRpcService, WalletTransaction, UTXO, AddressInfo } from '../rpc/wallet-rpc.service';
import { WalletManagerService } from './wallet-manager.service';
import { CookieAuthService } from '../../../core/auth/cookie-auth.service';
import { TransactionStateService } from '../transaction-state.service';

/**
 * Wallet state for the active wallet
 */
export interface WalletState {
  isLoaded: boolean;
  balance: number;
  unconfirmedBalance: number;
  immatureBalance: number;
  totalBalance: number;
  txCount: number;
  lastUpdated: Date | null;
}

/**
 * Send transaction options
 */
export interface SendOptions {
  subtractFeeFromAmount?: boolean;
  replaceable?: boolean;
  confTarget?: number;
  feeRate?: number;
  comment?: string;
}

/**
 * WalletService provides high-level wallet operations for the active wallet.
 *
 * This is the main service for UI components to interact with.
 * Uses Angular signals for reactive state management.
 *
 * Responsibilities:
 * - Track active wallet balance and state
 * - Send/receive transactions
 * - Generate addresses
 * - List transactions and UTXOs
 * - Auto-refresh on interval
 */
@Injectable({ providedIn: 'root' })
export class WalletService implements OnDestroy {
  private readonly walletRpc = inject(WalletRpcService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly cookieAuth = inject(CookieAuthService);
  private readonly transactionState = inject(TransactionStateService);
  private readonly destroy$ = new Subject<void>();

  // State using Angular signals
  private readonly _balance = signal<number>(0);
  private readonly _unconfirmedBalance = signal<number>(0);
  private readonly _immatureBalance = signal<number>(0);
  private readonly _txCount = signal<number>(0);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _lastError = signal<string | null>(null);
  private readonly _lastUpdated = signal<Date | null>(null);
  private readonly _recentTransactions = signal<WalletTransaction[]>([]);

  // Public readonly signals
  readonly balance = this._balance.asReadonly();
  readonly unconfirmedBalance = this._unconfirmedBalance.asReadonly();
  readonly immatureBalance = this._immatureBalance.asReadonly();
  readonly txCount = this._txCount.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly lastUpdated = this._lastUpdated.asReadonly();
  readonly recentTransactions = this._recentTransactions.asReadonly();

  // Computed signals
  readonly totalBalance = computed(
    () => this._balance() + this._unconfirmedBalance() + this._immatureBalance()
  );

  readonly confirmedBalance = computed(() => this._balance());

  readonly hasUnconfirmed = computed(() => this._unconfirmedBalance() > 0);

  // Recent transactions cache (observable for backwards compatibility)
  private readonly recentTransactionsSubject = new BehaviorSubject<WalletTransaction[]>([]);
  readonly recentTransactions$: Observable<WalletTransaction[]> =
    this.recentTransactionsSubject.asObservable();

  // Auto-refresh configuration
  private refreshInterval = 30000; // 30 seconds
  private refreshSubscription: Subscription | null = null;
  private isAutoRefreshing = false;

  constructor() {
    // Subscribe to active wallet changes
    this.walletManager.activeWallet$.subscribe(wallet => {
      if (wallet) {
        this.refresh();
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
        this.resetState();
      }
    });
  }

  // ============================================================
  // State Management
  // ============================================================

  /**
   * Refresh wallet state from Bitcoin Core.
   * Silently skips if RPC credentials are not yet available.
   */
  async refresh(): Promise<void> {
    // Skip if not authenticated (credentials not loaded yet)
    if (!this.cookieAuth.isAuthenticated) return;

    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    this._isLoading.set(true);
    this._lastError.set(null);

    try {
      // Fetch balance
      const balances = await this.walletRpc.getBalances(walletName);

      this._balance.set(balances.mine.trusted);
      this._unconfirmedBalance.set(balances.mine.untrusted_pending);
      this._immatureBalance.set(balances.mine.immature);

      // Fetch wallet info for tx count
      const info = await this.walletRpc.getWalletInfo(walletName);
      this._txCount.set(info.txcount);

      // Fetch recent transactions (100 for chart history, sorted newest first)
      const transactions = await this.walletRpc.listTransactions(walletName, '*', 100);
      const recentTxs = transactions.sort((a, b) => b.time - a.time);
      this._recentTransactions.set(recentTxs);
      this.recentTransactionsSubject.next(recentTxs); // Keep observable in sync

      // Update transaction state tracking for notifications
      this.transactionState.updateTransactions(recentTxs);

      this._lastUpdated.set(new Date());
    } catch (error) {
      this._lastError.set(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Reset state when no wallet is active
   */
  private resetState(): void {
    this._balance.set(0);
    this._unconfirmedBalance.set(0);
    this._immatureBalance.set(0);
    this._txCount.set(0);
    this._lastError.set(null);
    this._lastUpdated.set(null);
    this._recentTransactions.set([]);
    this.recentTransactionsSubject.next([]);
    this.transactionState.reset();
  }

  /**
   * Start auto-refresh polling.
   * Called when a wallet becomes active.
   */
  startAutoRefresh(intervalMs = 30000): void {
    // Stop any existing subscription first
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
      this.refreshSubscription = null;
    }

    if (this.isAutoRefreshing && this.refreshInterval === intervalMs) return;

    this.refreshInterval = intervalMs;
    this.isAutoRefreshing = true;

    // Start new polling interval
    this.refreshSubscription = interval(this.refreshInterval)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refresh());
  }

  /**
   * Stop auto-refresh polling.
   * Called when wallet is deactivated or service is destroyed.
   */
  stopAutoRefresh(): void {
    this.isAutoRefreshing = false;
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
      this.refreshSubscription = null;
    }
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ============================================================
  // Address Management
  // ============================================================

  /**
   * Get a new receiving address
   */
  async getNewAddress(
    label = '',
    type?: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m'
  ): Promise<string> {
    const walletName = this.requireActiveWallet();
    return this.walletRpc.getNewAddress(walletName, label, type);
  }

  /**
   * Get address information
   */
  async getAddressInfo(address: string): Promise<AddressInfo> {
    const walletName = this.requireActiveWallet();
    return this.walletRpc.getAddressInfo(walletName, address);
  }

  /**
   * Check if an address belongs to this wallet
   */
  async isMyAddress(address: string): Promise<boolean> {
    const info = await this.getAddressInfo(address);
    return info.ismine;
  }

  // ============================================================
  // Transactions
  // ============================================================

  /**
   * Send bitcoin to an address
   */
  async sendToAddress(address: string, amount: number, options: SendOptions = {}): Promise<string> {
    const walletName = this.requireActiveWallet();

    const txid = await this.walletRpc.sendToAddress(walletName, address, amount, {
      comment: options.comment,
      subtractFeeFromAmount: options.subtractFeeFromAmount,
      replaceable: options.replaceable ?? true,
      confTarget: options.confTarget ?? 6,
      feeRate: options.feeRate,
    });

    // Refresh state after sending
    await this.refresh();

    return txid;
  }

  /**
   * Send to multiple addresses
   */
  async sendMany(amounts: Record<string, number>, options: SendOptions = {}): Promise<string> {
    const walletName = this.requireActiveWallet();

    const txid = await this.walletRpc.sendMany(walletName, amounts, {
      comment: options.comment,
      replaceable: options.replaceable ?? true,
      confTarget: options.confTarget ?? 6,
      feeRate: options.feeRate,
    });

    await this.refresh();

    return txid;
  }

  /**
   * Get transaction history
   */
  async getTransactions(count = 100, skip = 0, label = '*'): Promise<WalletTransaction[]> {
    const walletName = this.requireActiveWallet();
    return this.walletRpc.listTransactions(walletName, label, count, skip);
  }

  /**
   * Get transaction details
   */
  async getTransaction(
    txid: string
  ): Promise<WalletTransaction & { hex: string; details: unknown[] }> {
    const walletName = this.requireActiveWallet();
    return this.walletRpc.getTransaction(walletName, txid);
  }

  // ============================================================
  // UTXOs
  // ============================================================

  /**
   * List unspent transaction outputs
   */
  async listUnspent(minconf = 1, maxconf = 9999999): Promise<UTXO[]> {
    const walletName = this.requireActiveWallet();
    return this.walletRpc.listUnspent(walletName, minconf, maxconf);
  }

  /**
   * Get total UTXO count
   */
  async getUtxoCount(): Promise<number> {
    const utxos = await this.listUnspent(0);
    return utxos.length;
  }

  /**
   * Get UTXOs for coin selection
   */
  async getSpendableUtxos(minAmount?: number): Promise<UTXO[]> {
    const utxos = await this.listUnspent(1);
    if (minAmount !== undefined) {
      return utxos.filter(u => u.amount >= minAmount);
    }
    return utxos;
  }

  // ============================================================
  // Balance Utilities
  // ============================================================

  /**
   * Format balance for display (8 decimal places)
   */
  formatBalance(satoshis: number): string {
    return satoshis.toFixed(8);
  }

  /**
   * Convert BTC to satoshis
   */
  btcToSatoshis(btc: number): number {
    return Math.round(btc * 100000000);
  }

  /**
   * Convert satoshis to BTC
   */
  satoshisToBtc(satoshis: number): number {
    return satoshis / 100000000;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private requireActiveWallet(): string {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) {
      throw new Error('No active wallet');
    }
    return walletName;
  }
}
