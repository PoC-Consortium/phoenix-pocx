import { WalletTransaction, UTXO } from '../../bitcoin/services/rpc';

/**
 * Wallet feature state
 */
export interface WalletState {
  // Active wallet
  activeWallet: string | null;
  loadedWallets: string[];

  // Balance
  balance: number;
  unconfirmedBalance: number;
  immatureBalance: number;

  // Transactions
  transactions: WalletTransaction[];
  transactionsLoading: boolean;
  transactionsError: string | null;

  // UTXOs
  utxos: UTXO[];
  utxosLoading: boolean;

  // Addresses
  currentReceiveAddress: string | null;
  addressHistory: string[];

  // Status
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
}

/**
 * Initial wallet state
 */
export const initialWalletState: WalletState = {
  activeWallet: null,
  loadedWallets: [],

  balance: 0,
  unconfirmedBalance: 0,
  immatureBalance: 0,

  transactions: [],
  transactionsLoading: false,
  transactionsError: null,

  utxos: [],
  utxosLoading: false,

  currentReceiveAddress: null,
  addressHistory: [],

  isLoading: false,
  isRefreshing: false,
  error: null,
  lastUpdated: null,
};
