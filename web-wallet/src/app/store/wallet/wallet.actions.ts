import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { WalletTransaction, UTXO } from '../../bitcoin/services/rpc';

/**
 * Wallet actions
 */
export const WalletActions = createActionGroup({
  source: 'Wallet',
  events: {
    // Wallet selection
    'Set Active Wallet': props<{ walletName: string }>(),
    'Clear Active Wallet': emptyProps(),
    'Load Wallets': emptyProps(),
    'Load Wallets Success': props<{ wallets: string[] }>(),
    'Load Wallets Failure': props<{ error: string }>(),

    // Balance
    'Refresh Balance': emptyProps(),
    'Refresh Balance Success': props<{
      balance: number;
      unconfirmedBalance: number;
      immatureBalance: number;
    }>(),
    'Refresh Balance Failure': props<{ error: string }>(),

    // Transactions
    'Load Transactions': props<{ count?: number; skip?: number }>(),
    'Load Transactions Success': props<{ transactions: WalletTransaction[] }>(),
    'Load Transactions Failure': props<{ error: string }>(),
    'Add Transaction': props<{ transaction: WalletTransaction }>(),

    // UTXOs
    'Load UTXOs': emptyProps(),
    'Load UTXOs Success': props<{ utxos: UTXO[] }>(),
    'Load UTXOs Failure': props<{ error: string }>(),

    // Addresses
    'Generate Address': props<{
      label?: string;
      type?: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';
    }>(),
    'Generate Address Success': props<{ address: string }>(),
    'Generate Address Failure': props<{ error: string }>(),
    'Add Address To History': props<{ address: string }>(),

    // Send
    'Send Transaction': props<{
      address: string;
      amount: number;
      options?: {
        subtractFeeFromAmount?: boolean;
        replaceable?: boolean;
        confTarget?: number;
        feeRate?: number;
        comment?: string;
      };
    }>(),
    'Send Transaction Success': props<{ txid: string }>(),
    'Send Transaction Failure': props<{ error: string }>(),

    // General
    'Refresh All': emptyProps(),
    'Clear Error': emptyProps(),
    'Reset State': emptyProps(),
  },
});
