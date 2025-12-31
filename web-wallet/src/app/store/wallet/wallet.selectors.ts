import { createFeatureSelector, createSelector } from '@ngrx/store';
import { WalletState } from './wallet.state';

/**
 * Feature selector
 */
export const selectWalletState = createFeatureSelector<WalletState>('wallet');

// ============================================================
// Wallet Selection
// ============================================================

export const selectActiveWallet = createSelector(selectWalletState, state => state.activeWallet);

export const selectLoadedWallets = createSelector(selectWalletState, state => state.loadedWallets);

export const selectHasActiveWallet = createSelector(selectActiveWallet, wallet => wallet !== null);

// ============================================================
// Balance
// ============================================================

export const selectBalance = createSelector(selectWalletState, state => state.balance);

export const selectUnconfirmedBalance = createSelector(
  selectWalletState,
  state => state.unconfirmedBalance
);

export const selectImmatureBalance = createSelector(
  selectWalletState,
  state => state.immatureBalance
);

export const selectTotalBalance = createSelector(
  selectWalletState,
  state => state.balance + state.unconfirmedBalance + state.immatureBalance
);

export const selectConfirmedBalance = createSelector(selectBalance, balance => balance);

export const selectHasUnconfirmed = createSelector(
  selectUnconfirmedBalance,
  unconfirmed => unconfirmed > 0
);

export const selectBalanceSummary = createSelector(selectWalletState, state => ({
  confirmed: state.balance,
  unconfirmed: state.unconfirmedBalance,
  immature: state.immatureBalance,
  total: state.balance + state.unconfirmedBalance + state.immatureBalance,
}));

// ============================================================
// Transactions
// ============================================================

export const selectTransactions = createSelector(selectWalletState, state => state.transactions);

export const selectTransactionsLoading = createSelector(
  selectWalletState,
  state => state.transactionsLoading
);

export const selectTransactionsError = createSelector(
  selectWalletState,
  state => state.transactionsError
);

export const selectRecentTransactions = createSelector(selectTransactions, transactions =>
  transactions.slice(0, 10)
);

export const selectPendingTransactions = createSelector(selectTransactions, transactions =>
  transactions.filter(tx => tx.confirmations === 0)
);

export const selectTransactionCount = createSelector(
  selectTransactions,
  transactions => transactions.length
);

// ============================================================
// UTXOs
// ============================================================

export const selectUtxos = createSelector(selectWalletState, state => state.utxos);

export const selectUtxosLoading = createSelector(selectWalletState, state => state.utxosLoading);

export const selectUtxoCount = createSelector(selectUtxos, utxos => utxos.length);

export const selectSpendableUtxos = createSelector(selectUtxos, utxos =>
  utxos.filter(u => u.spendable && u.safe)
);

// ============================================================
// Addresses
// ============================================================

export const selectCurrentReceiveAddress = createSelector(
  selectWalletState,
  state => state.currentReceiveAddress
);

export const selectAddressHistory = createSelector(
  selectWalletState,
  state => state.addressHistory
);

// ============================================================
// Status
// ============================================================

export const selectIsLoading = createSelector(selectWalletState, state => state.isLoading);

export const selectIsRefreshing = createSelector(selectWalletState, state => state.isRefreshing);

export const selectError = createSelector(selectWalletState, state => state.error);

export const selectLastUpdated = createSelector(selectWalletState, state =>
  state.lastUpdated ? new Date(state.lastUpdated) : null
);

export const selectIsStale = createSelector(selectLastUpdated, lastUpdated => {
  if (!lastUpdated) return true;
  const staleThreshold = 60000; // 1 minute
  return Date.now() - lastUpdated.getTime() > staleThreshold;
});
