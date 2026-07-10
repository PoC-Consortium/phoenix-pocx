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
}

/**
 * Map one BDK wallet transaction onto the Core-style list entry the UI
 * renders. Fields with no Electrum equivalent (`address`, `label`,
 * `blockhash`) stay absent — templates null-guard them. Exported for unit
 * testing.
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
    const txs = await this.btcxWallet.refreshTransactions();
    return { txCount: txs.length, watchOnly: false };
  }

  async listTransactions(
    _walletName: string,
    count: number,
    skip = 0
  ): Promise<WalletTransaction[]> {
    // The full history is a local sqlite read — paginate client-side.
    const txs = await this.btcxWallet.refreshTransactions();
    return txs.slice(skip, skip + count).map(mapBtcxTxToWalletTransaction);
  }

  async getNewAddress(): Promise<string> {
    return this.btcxWallet.newAddress();
  }

  async listUnspent(): Promise<UTXO[]> {
    const utxos = await invoke<BtcxUtxoDto[]>('btcx_wallet_utxos');
    return utxos.map(mapBtcxUtxo);
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
