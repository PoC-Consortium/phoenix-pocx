import { WalletTransaction, UTXO } from '../../bitcoin/services/rpc/wallet-rpc.service';
import { BtcxWalletService, BtcxWalletTx } from '../services/btcx-wallet.service';
import { invoke } from '@tauri-apps/api/core';
import {
  WalletBackend,
  WalletBackendBalances,
  WalletBackendDetails,
  WalletBackendFeeEstimates,
  WalletBackendSendOptions,
  WalletCapabilities,
  WalletCoin,
  ELECTRUM_CAPABILITIES,
} from './wallet-backend.model';

const SATS_PER_BTC = 100_000_000;

/** Wire shape of one `btcx_wallet_utxos` item. */
interface BtcxUtxoDto {
  txid: string;
  vout: number;
  amountSat: number;
  address?: string;
  confirmations: number;
  isChange: boolean;
  /** The address' pubkey is on-chain (it has been spent from before). */
  exposed: boolean;
}

/**
 * Map one BDK wallet transaction onto the Core-style list entry the UI
 * renders. Fields with no Electrum equivalent (`label`, `blockhash`) stay
 * absent — templates null-guard them. Exported for unit testing.
 */
export function mapBtcxTxToWalletTransaction(tx: BtcxWalletTx): WalletTransaction {
  const sign = tx.direction === 'sent' ? -1 : 1;
  return {
    category: tx.direction === 'sent' ? 'send' : 'receive',
    amount: (sign * tx.amountSat) / SATS_PER_BTC,
    fee: tx.feeSat != null ? -tx.feeSat / SATS_PER_BTC : undefined,
    confirmations: tx.confirmations,
    txid: tx.txid,
    time: tx.timestamp ?? 0,
    timereceived: tx.timestamp ?? 0,
    // Display address derived backend-side from the tx outputs.
    address: tx.address ?? undefined,
    // BDK sends always signal RBF (ENABLE_RBF_NO_LOCKTIME).
    bip125_replaceable: tx.direction === 'sent' && tx.confirmations === 0 ? 'yes' : 'no',
  };
}

/** Map one `btcx_wallet_utxos` item onto the Core `listunspent` shape. */
export function mapBtcxUtxo(utxo: BtcxUtxoDto): UTXO {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    address: utxo.address ?? '',
    scriptPubKey: '',
    amount: utxo.amountSat / SATS_PER_BTC,
    confirmations: utxo.confirmations,
    spendable: true,
    solvable: true,
    safe: utxo.confirmations > 0,
  };
}

/**
 * Electrum/BDK implementation of the wallet backend (remote node mode) —
 * wraps the nodeless btcx wallet stack. One OPEN wallet at a time (selected
 * via `btcx_wallet_select`), so `walletName` parameters are ignored.
 */
export class ElectrumWalletBackend implements WalletBackend {
  readonly capabilities: WalletCapabilities = ELECTRUM_CAPABILITIES;

  constructor(private readonly btcxWallet: BtcxWalletService) {}

  async getBalances(): Promise<WalletBackendBalances> {
    const balance = await this.btcxWallet.refreshBalance();
    if (!balance) {
      throw new Error('Wallet not open');
    }
    return {
      // bdk trusted = confirmed + own unconfirmed change.
      trusted: (balance.confirmedSat + balance.trustedPendingSat) / SATS_PER_BTC,
      untrustedPending: balance.untrustedPendingSat / SATS_PER_BTC,
      immature: balance.immatureSat / SATS_PER_BTC,
    };
  }

  async getWalletDetails(): Promise<WalletBackendDetails> {
    // limit 0 = count-only: total without items, DTO mapping or IPC bulk.
    const { total } = await this.btcxWallet.fetchTransactionsPage(0);
    return { txCount: total, watchOnly: false };
  }

  async listTransactions(
    _walletName: string,
    count: number,
    skip = 0
  ): Promise<WalletTransaction[]> {
    // Page on the Rust side; only the requested slice crosses the IPC
    // boundary (and fetchTransactionsPage leaves the mobile UI's window
    // signals alone).
    const { items } = await this.btcxWallet.fetchTransactionsPage(count, skip);
    return items.map(mapBtcxTxToWalletTransaction);
  }

  async getNewAddress(): Promise<string> {
    return this.btcxWallet.newAddress();
  }

  async listUnspent(): Promise<UTXO[]> {
    const utxos = await invoke<BtcxUtxoDto[]>('btcx_wallet_utxos');
    return utxos.map(mapBtcxUtxo);
  }

  async listCoins(): Promise<WalletCoin[]> {
    // Map the raw DTO directly — it already carries `isChange` (which
    // `mapBtcxUtxo`'s Core `UTXO` shape drops).
    const utxos = await invoke<BtcxUtxoDto[]>('btcx_wallet_utxos');
    return utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address ?? '',
      amount: u.amountSat / SATS_PER_BTC,
      confirmations: u.confirmations,
      isChange: u.isChange,
      spendable: true,
      exposed: u.exposed,
    }));
  }

  async sendToAddress(
    _walletName: string,
    address: string,
    amount: number,
    options: WalletBackendSendOptions = {}
  ): Promise<string> {
    // subtractFeeFromAmount is the "send max" affordance — BDK expresses it
    // as a sweep (fee off the swept amount).
    if (options.subtractFeeFromAmount) {
      return this.btcxWallet.send({
        address,
        sendAll: true,
        feeRateSatVb: options.feeRate,
        feeTarget: options.feeRate === undefined ? (options.confTarget ?? 6) : undefined,
      });
    }
    return this.btcxWallet.send({
      address,
      amountSat: Math.round(amount * SATS_PER_BTC),
      feeRateSatVb: options.feeRate,
      feeTarget: options.feeRate === undefined ? (options.confTarget ?? 6) : undefined,
    });
  }

  async bumpFee(_walletName: string, txid: string, feeRateSatVb?: number): Promise<string> {
    if (feeRateSatVb === undefined) {
      // BDK bumps need an explicit target rate; derive one from the market.
      const estimates = await this.btcxWallet.fetchFeeEstimates();
      feeRateSatVb = estimates.fast ?? estimates.normal ?? estimates.minSatPerVb * 2;
    }
    return this.btcxWallet.bumpFee(txid, feeRateSatVb);
  }

  async cpfpBumpFee(): Promise<string> {
    // CPFP needs a parent vsize/fee source (getmempoolentry) the Electrum
    // stack doesn't expose — gated off in the capability matrix.
    throw new Error('feature_unavailable_remote');
  }

  async getCpfpParentInfo(): Promise<{ vsize: number; fee: number }> {
    throw new Error('feature_unavailable_remote');
  }

  async feeEstimates(): Promise<WalletBackendFeeEstimates> {
    const estimates = await this.btcxWallet.fetchFeeEstimates();
    return {
      minSatPerVb: estimates.minSatPerVb,
      fast: estimates.fast,
      normal: estimates.normal,
      slow: estimates.slow,
    };
  }
}
