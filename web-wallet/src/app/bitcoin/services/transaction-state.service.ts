import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { WalletTransaction } from './rpc/wallet-rpc.service';
import { PocxNotificationService } from './pocx-notification.service';
import { selectConfirmationsRequired } from '../../store/settings/settings.selectors';

/**
 * Tracked state for a single transaction
 */
interface TrackedTransaction {
  txid: string;
  category: string;
  confirmations: number;
  amount: number;
  wasConfirmed: boolean; // Has reached required confirmations
  wasMatured: boolean; // Has reached 100 confirmations (for immature)
}

/**
 * TransactionStateService tracks transaction state changes and triggers
 * notifications when significant state transitions occur.
 *
 * Detects:
 * - New incoming payments (receive transactions appearing)
 * - Payment confirmations (reaching required confirmations threshold)
 * - New mined blocks (generate transactions appearing)
 * - Block reward maturation (immature → generate with 100+ confirmations)
 */
@Injectable({ providedIn: 'root' })
export class TransactionStateService {
  private readonly store = inject(Store);
  private readonly notificationService = inject(PocxNotificationService);

  // Settings
  private readonly confirmationsRequired = toSignal(
    this.store.select(selectConfirmationsRequired),
    { initialValue: 6 }
  );

  // Maturation threshold for coinbase transactions
  private readonly COINBASE_MATURITY = 100;

  // Tracked transaction states by txid
  private trackedTransactions: Map<string, TrackedTransaction> = new Map();

  // Flag to skip notifications on first load
  private isInitialized = false;

  /**
   * Update tracked transactions with new transaction list.
   * Detects state changes and triggers appropriate notifications.
   */
  updateTransactions(transactions: WalletTransaction[]): void {
    const currentTxids = new Set<string>();

    for (const tx of transactions) {
      currentTxids.add(tx.txid);
      this.processTransaction(tx);
    }

    // We don't remove old transactions from tracking to maintain history
    // This prevents re-notification if transactions temporarily disappear

    // Mark as initialized after first update
    if (!this.isInitialized) {
      this.isInitialized = true;
    }
  }

  /**
   * Process a single transaction and detect state changes
   */
  private processTransaction(tx: WalletTransaction): void {
    const existing = this.trackedTransactions.get(tx.txid);
    const requiredConfs = this.confirmationsRequired();

    if (!existing) {
      // New transaction - track it
      const tracked: TrackedTransaction = {
        txid: tx.txid,
        category: tx.category,
        confirmations: tx.confirmations,
        amount: Math.abs(tx.amount),
        wasConfirmed: tx.confirmations >= requiredConfs,
        wasMatured: tx.category === 'generate' && tx.confirmations >= this.COINBASE_MATURITY,
      };
      this.trackedTransactions.set(tx.txid, tracked);

      // Only notify for new transactions after initialization
      if (this.isInitialized) {
        this.handleNewTransaction(tx);
      }
      return;
    }

    // Existing transaction - check for state changes
    this.handleStateChange(existing, tx);

    // Update tracked state
    existing.category = tx.category;
    existing.confirmations = tx.confirmations;
    existing.amount = Math.abs(tx.amount);
  }

  /**
   * Handle a newly appearing transaction
   */
  private handleNewTransaction(tx: WalletTransaction): void {
    const amount = Math.abs(tx.amount);

    switch (tx.category) {
      case 'receive':
        // New incoming payment
        this.notificationService.notifyIncomingPayment(amount);
        break;

      case 'generate':
      case 'immature':
        // New mined block
        this.notificationService.notifyBlockMined(amount);
        break;

      // We don't notify for 'send' or 'orphan' categories
    }
  }

  /**
   * Handle state changes on an existing transaction
   */
  private handleStateChange(existing: TrackedTransaction, current: WalletTransaction): void {
    const amount = Math.abs(current.amount);
    const requiredConfs = this.confirmationsRequired();

    // Check for confirmation threshold crossing
    if (!existing.wasConfirmed && current.confirmations >= requiredConfs) {
      existing.wasConfirmed = true;

      if (current.category === 'receive') {
        this.notificationService.notifyPaymentConfirmed(amount);
      }
    }

    // Check for coinbase maturation
    // immature → generate with 100+ confirmations
    if (!existing.wasMatured) {
      const isNowMature =
        current.category === 'generate' && current.confirmations >= this.COINBASE_MATURITY;

      if (isNowMature) {
        existing.wasMatured = true;

        // Only notify if it was previously immature
        if (existing.category === 'immature') {
          this.notificationService.notifyBlockRewardMatured(amount);
        }
      }
    }
  }

  /**
   * Clear all tracked state (useful when switching wallets)
   */
  reset(): void {
    this.trackedTransactions.clear();
    this.isInitialized = false;
  }

  /**
   * Get the number of tracked transactions (for debugging)
   */
  get trackedCount(): number {
    return this.trackedTransactions.size;
  }
}
