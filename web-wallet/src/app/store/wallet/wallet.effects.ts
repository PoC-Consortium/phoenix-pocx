import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, exhaustMap, switchMap, withLatestFrom } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { WalletActions } from './wallet.actions';
import { selectActiveWallet } from './wallet.selectors';
import { WalletRpcService } from '../../bitcoin/services/rpc';
import { WalletManagerService, WalletService } from '../../bitcoin/services/wallet';

/**
 * Wallet effects - handles side effects for wallet actions
 */
@Injectable()
export class WalletEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);

  /**
   * Load available wallets
   */
  loadWallets$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.loadWallets),
      exhaustMap(() =>
        this.walletManager.refreshLoadedWallets().then(
          wallets => WalletActions.loadWalletsSuccess({ wallets }),
          error => WalletActions.loadWalletsFailure({ error: error.message })
        )
      )
    )
  );

  /**
   * Refresh balance for active wallet
   */
  refreshBalance$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.refreshBalance),
      withLatestFrom(this.store.select(selectActiveWallet)),
      exhaustMap(([, walletName]) => {
        if (!walletName) {
          return of(WalletActions.refreshBalanceFailure({ error: 'No active wallet' }));
        }
        return this.walletRpc.getBalances(walletName).then(
          balances =>
            WalletActions.refreshBalanceSuccess({
              balance: balances.mine.trusted,
              unconfirmedBalance: balances.mine.untrusted_pending,
              immatureBalance: balances.mine.immature,
            }),
          error => WalletActions.refreshBalanceFailure({ error: error.message })
        );
      })
    )
  );

  /**
   * Load transactions for active wallet
   */
  loadTransactions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.loadTransactions),
      withLatestFrom(this.store.select(selectActiveWallet)),
      exhaustMap(([{ count = 100, skip = 0 }, walletName]) => {
        if (!walletName) {
          return of(WalletActions.loadTransactionsFailure({ error: 'No active wallet' }));
        }
        return this.walletRpc.listTransactions(walletName, '*', count, skip).then(
          transactions => WalletActions.loadTransactionsSuccess({ transactions }),
          error => WalletActions.loadTransactionsFailure({ error: error.message })
        );
      })
    )
  );

  /**
   * Load UTXOs for active wallet
   */
  loadUtxos$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.loadUTXOs),
      withLatestFrom(this.store.select(selectActiveWallet)),
      exhaustMap(([, walletName]) => {
        if (!walletName) {
          return of(WalletActions.loadUTXOsFailure({ error: 'No active wallet' }));
        }
        return this.walletRpc.listUnspent(walletName).then(
          utxos => WalletActions.loadUTXOsSuccess({ utxos }),
          error => WalletActions.loadUTXOsFailure({ error: error.message })
        );
      })
    )
  );

  /**
   * Generate new address
   */
  generateAddress$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.generateAddress),
      withLatestFrom(this.store.select(selectActiveWallet)),
      exhaustMap(([{ label, type }, walletName]) => {
        if (!walletName) {
          return of(WalletActions.generateAddressFailure({ error: 'No active wallet' }));
        }
        return this.walletRpc.getNewAddress(walletName, label, type).then(
          address => WalletActions.generateAddressSuccess({ address }),
          error => WalletActions.generateAddressFailure({ error: error.message })
        );
      })
    )
  );

  /**
   * Send transaction
   */
  sendTransaction$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.sendTransaction),
      withLatestFrom(this.store.select(selectActiveWallet)),
      exhaustMap(([{ address, amount, options }, walletName]) => {
        if (!walletName) {
          return of(WalletActions.sendTransactionFailure({ error: 'No active wallet' }));
        }
        return this.walletRpc.sendToAddress(walletName, address, amount, options || {}).then(
          txid => WalletActions.sendTransactionSuccess({ txid }),
          error => WalletActions.sendTransactionFailure({ error: error.message })
        );
      })
    )
  );

  /**
   * Refresh all data after sending transaction
   */
  refreshAfterSend$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.sendTransactionSuccess),
      map(() => WalletActions.refreshAll())
    )
  );

  /**
   * Refresh all wallet data
   */
  refreshAll$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.refreshAll, WalletActions.setActiveWallet),
      switchMap(() => [
        WalletActions.refreshBalance(),
        WalletActions.loadTransactions({ count: 100 }),
        WalletActions.loadUTXOs(),
      ])
    )
  );
}
