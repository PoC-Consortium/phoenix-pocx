import { WalletTransaction, UTXO } from '../../bitcoin/services/rpc/wallet-rpc.service';

/**
 * Wallet backend abstraction — the seam between the desktop wallet UI and
 * its data source. Two implementations:
 *
 * - `CoreWalletBackend` — Bitcoin Core JSON-RPC (managed/external node
 *   modes): server-side descriptor wallets, amounts in BTC floats as Core
 *   returns them.
 * - `ElectrumWalletBackend` — the local BDK wallet over Electrum (remote
 *   node mode): client-side derivation, mapped onto the SAME UI models
 *   (Core-style `WalletTransaction`/`UTXO`) so pages render either source.
 *
 * `walletName` parameters name a Core wallet; the Electrum backend has one
 * OPEN wallet at a time (selection happens via `btcx_wallet_select`), so it
 * ignores the name — callers still pass it for the Core path.
 */
export interface WalletBackend {
  /** Balance snapshot in BTC (Core `getbalances.mine` shape). */
  getBalances(walletName: string): Promise<WalletBackendBalances>;

  /** Transaction count + watch-only flag of the wallet. */
  getWalletDetails(walletName: string): Promise<WalletBackendDetails>;

  /** Transaction history, newest first, in the Core list-entry shape. */
  listTransactions(walletName: string, count: number, skip?: number): Promise<WalletTransaction[]>;

  /** Fresh receive address. Label/type are Core-only (capabilities). */
  getNewAddress(walletName: string, label?: string, type?: CoreAddressType): Promise<string>;

  /** Spendable outputs in the Core `listunspent` shape. */
  listUnspent(walletName: string): Promise<UTXO[]>;

  /**
   * Spendable coins with per-address change classification — the
   * "Coins & Addresses" view. Distinct from `listUnspent` in that it
   * carries `isChange`, resolved per source (Core `getaddressinfo`, BDK
   * `keychain`).
   */
  listCoins(walletName: string): Promise<WalletCoin[]>;

  /** Send `amount` BTC to `address`; returns the txid. */
  sendToAddress(
    walletName: string,
    address: string,
    amount: number,
    options?: WalletBackendSendOptions
  ): Promise<string>;

  /** RBF-bump a wallet transaction; returns the replacement txid. */
  bumpFee(walletName: string, txid: string, feeRateSatVb?: number): Promise<string>;

  /** Market fee estimates in sat/vB (null where the source has no data). */
  feeEstimates(): Promise<WalletBackendFeeEstimates>;

  /** What this backend can do — pages hide actions the backend lacks. */
  readonly capabilities: WalletCapabilities;
}

/**
 * One spendable coin (UTXO) with the fields the coins view needs: the
 * funding address and whether it belongs to the change keychain.
 */
export interface WalletCoin {
  txid: string;
  vout: number;
  address: string;
  /** Amount in BTC. */
  amount: number;
  confirmations: number;
  isChange: boolean;
  spendable: boolean;
}

/** Balance snapshot in BTC. */
export interface WalletBackendBalances {
  /** Confirmed + own-change trusted balance. */
  trusted: number;
  /** Unconfirmed receives from others. */
  untrustedPending: number;
  /** Immature coinbase. */
  immature: number;
}

export interface WalletBackendDetails {
  txCount: number;
  watchOnly: boolean;
}

export type CoreAddressType = 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';

export interface WalletBackendSendOptions {
  comment?: string;
  /** Deduct the fee from the sent amount (sweep-style sends). */
  subtractFeeFromAmount?: boolean;
  replaceable?: boolean;
  confTarget?: number;
  /** Explicit fee rate in sat/vB. */
  feeRate?: number;
}

export interface WalletBackendFeeEstimates {
  /** Coin feerate floor in sat/vB. */
  minSatPerVb: number;
  /** ~1-block target, sat/vB. */
  fast: number | null;
  /** ~6-block target, sat/vB. */
  normal: number | null;
  /** ~144-block target, sat/vB. */
  slow: number | null;
}

/**
 * Feature matrix of a backend. Pages/components gate Core-only affordances
 * on these flags instead of sniffing the node mode.
 */
export interface WalletCapabilities {
  /** `abandontransaction` (Core-only). */
  abandonTransaction: boolean;
  /** Address type choice + labels on receive (Core keypool features). */
  addressTypes: boolean;
  labels: boolean;
  /** `sendmany` batching. */
  sendMany: boolean;
  /** Core wallet passphrase management (encrypt/unlock/change). */
  walletEncryption: boolean;
  /** `rescanblockchain` / `backupwallet`. */
  rescan: boolean;
  backup: boolean;
  /** Watch-only / multisig wallet creation. */
  watchOnly: boolean;
  multisig: boolean;
  /** `gettransaction` detail lookup (remote uses the cached list). */
  transactionDetail: boolean;
  /** `testmempoolaccept` before broadcast. */
  testMempoolAccept: boolean;
}

export const CORE_CAPABILITIES: WalletCapabilities = {
  abandonTransaction: true,
  addressTypes: true,
  labels: true,
  sendMany: true,
  walletEncryption: true,
  rescan: true,
  backup: true,
  watchOnly: true,
  multisig: true,
  transactionDetail: true,
  testMempoolAccept: true,
};

export const ELECTRUM_CAPABILITIES: WalletCapabilities = {
  abandonTransaction: false,
  addressTypes: false,
  labels: false,
  sendMany: false,
  walletEncryption: false,
  rescan: false,
  backup: false,
  watchOnly: false,
  multisig: false,
  transactionDetail: false,
  testMempoolAccept: false,
};
