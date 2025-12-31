import { createReducer, on } from '@ngrx/store';
import { WalletActions } from './wallet.actions';
import { WalletState, initialWalletState } from './wallet.state';

/**
 * Wallet reducer
 */
export const walletReducer = createReducer(
  initialWalletState,

  // Wallet selection
  on(
    WalletActions.setActiveWallet,
    (state, { walletName }): WalletState => ({
      ...state,
      activeWallet: walletName,
      error: null,
    })
  ),

  on(
    WalletActions.clearActiveWallet,
    (state): WalletState => ({
      ...initialWalletState,
      loadedWallets: state.loadedWallets,
    })
  ),

  on(
    WalletActions.loadWallets,
    (state): WalletState => ({
      ...state,
      isLoading: true,
      error: null,
    })
  ),

  on(
    WalletActions.loadWalletsSuccess,
    (state, { wallets }): WalletState => ({
      ...state,
      loadedWallets: wallets,
      isLoading: false,
    })
  ),

  on(
    WalletActions.loadWalletsFailure,
    (state, { error }): WalletState => ({
      ...state,
      isLoading: false,
      error,
    })
  ),

  // Balance
  on(
    WalletActions.refreshBalance,
    (state): WalletState => ({
      ...state,
      isRefreshing: true,
    })
  ),

  on(
    WalletActions.refreshBalanceSuccess,
    (state, { balance, unconfirmedBalance, immatureBalance }): WalletState => ({
      ...state,
      balance,
      unconfirmedBalance,
      immatureBalance,
      isRefreshing: false,
      lastUpdated: Date.now(),
    })
  ),

  on(
    WalletActions.refreshBalanceFailure,
    (state, { error }): WalletState => ({
      ...state,
      isRefreshing: false,
      error,
    })
  ),

  // Transactions
  on(
    WalletActions.loadTransactions,
    (state): WalletState => ({
      ...state,
      transactionsLoading: true,
      transactionsError: null,
    })
  ),

  on(
    WalletActions.loadTransactionsSuccess,
    (state, { transactions }): WalletState => ({
      ...state,
      transactions,
      transactionsLoading: false,
    })
  ),

  on(
    WalletActions.loadTransactionsFailure,
    (state, { error }): WalletState => ({
      ...state,
      transactionsLoading: false,
      transactionsError: error,
    })
  ),

  on(
    WalletActions.addTransaction,
    (state, { transaction }): WalletState => ({
      ...state,
      transactions: [transaction, ...state.transactions],
    })
  ),

  // UTXOs
  on(
    WalletActions.loadUTXOs,
    (state): WalletState => ({
      ...state,
      utxosLoading: true,
    })
  ),

  on(
    WalletActions.loadUTXOsSuccess,
    (state, { utxos }): WalletState => ({
      ...state,
      utxos,
      utxosLoading: false,
    })
  ),

  on(
    WalletActions.loadUTXOsFailure,
    (state): WalletState => ({
      ...state,
      utxosLoading: false,
    })
  ),

  // Addresses
  on(
    WalletActions.generateAddressSuccess,
    (state, { address }): WalletState => ({
      ...state,
      currentReceiveAddress: address,
      addressHistory: [address, ...state.addressHistory.filter(a => a !== address)],
    })
  ),

  on(
    WalletActions.addAddressToHistory,
    (state, { address }): WalletState => ({
      ...state,
      addressHistory: [address, ...state.addressHistory.filter(a => a !== address)],
    })
  ),

  // Send
  on(
    WalletActions.sendTransaction,
    (state): WalletState => ({
      ...state,
      isLoading: true,
      error: null,
    })
  ),

  on(
    WalletActions.sendTransactionSuccess,
    (state): WalletState => ({
      ...state,
      isLoading: false,
    })
  ),

  on(
    WalletActions.sendTransactionFailure,
    (state, { error }): WalletState => ({
      ...state,
      isLoading: false,
      error,
    })
  ),

  // General
  on(
    WalletActions.refreshAll,
    (state): WalletState => ({
      ...state,
      isRefreshing: true,
    })
  ),

  on(
    WalletActions.clearError,
    (state): WalletState => ({
      ...state,
      error: null,
      transactionsError: null,
    })
  ),

  on(WalletActions.resetState, (): WalletState => initialWalletState)
);
