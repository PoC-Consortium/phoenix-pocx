import {
  WalletRpcService,
  WalletTransaction,
  UTXO,
} from '../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainRpcService } from '../../bitcoin/services/rpc/blockchain-rpc.service';
import {
  WalletBackend,
  WalletBackendBalances,
  WalletBackendDetails,
  WalletBackendFeeEstimates,
  WalletBackendSendOptions,
  WalletCapabilities,
  WalletCoin,
  CoreAddressType,
  CORE_CAPABILITIES,
} from './wallet-backend.model';

/**
 * Bitcoin Core JSON-RPC implementation of the wallet backend — a thin
 * move-only wrapper over the existing RPC services (managed/external node
 * modes). Server-side descriptor wallets; amounts stay the BTC floats Core
 * returns.
 */
export class CoreWalletBackend implements WalletBackend {
  readonly capabilities: WalletCapabilities = CORE_CAPABILITIES;

  constructor(
    private readonly walletRpc: WalletRpcService,
    private readonly blockchainRpc: BlockchainRpcService
  ) {}

  async getBalances(walletName: string): Promise<WalletBackendBalances> {
    const balances = await this.walletRpc.getBalances(walletName);
    return {
      trusted: balances.mine.trusted,
      untrustedPending: balances.mine.untrusted_pending,
      immature: balances.mine.immature,
    };
  }

  async getWalletDetails(walletName: string): Promise<WalletBackendDetails> {
    const info = await this.walletRpc.getWalletInfo(walletName);
    return {
      txCount: info.txcount,
      watchOnly: info.private_keys_enabled === false,
    };
  }

  async listTransactions(
    walletName: string,
    count: number,
    skip = 0
  ): Promise<WalletTransaction[]> {
    return this.walletRpc.listTransactions(walletName, '*', count, skip);
  }

  async getNewAddress(walletName: string, label = '', type?: CoreAddressType): Promise<string> {
    return this.walletRpc.getNewAddress(walletName, label, type);
  }

  async listUnspent(walletName: string): Promise<UTXO[]> {
    return this.walletRpc.listUnspent(walletName);
  }

  async listCoins(walletName: string): Promise<WalletCoin[]> {
    const utxos = await this.walletRpc.listUnspent(walletName);
    // Resolve change classification once per unique funded address.
    const uniq = [...new Set(utxos.map(u => u.address))];
    const change = new Map<string, boolean>();
    await Promise.all(
      uniq.map(async a => {
        try {
          change.set(a, (await this.walletRpc.getAddressInfo(walletName, a)).ischange);
        } catch {
          change.set(a, false);
        }
      })
    );
    // Address reuse: listreceivedbyaddress groups all received funds per
    // address, so an entry with more than one txid was paid in more than one
    // transaction. minconf=0 counts unconfirmed receives too; include_empty
    // stays false (only funded addresses matter here). Best-effort — leave
    // reuse unflagged if the RPC is unavailable.
    const reused = new Set<string>();
    try {
      const received = await this.walletRpc.listReceivedByAddress(walletName, 0, false);
      for (const r of received) {
        if (r.txids.length > 1) reused.add(r.address);
      }
    } catch {
      // ignore — coins still render without the reuse flag.
    }
    return utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address,
      amount: u.amount,
      confirmations: u.confirmations,
      isChange: change.get(u.address) ?? false,
      spendable: u.spendable,
      reused: reused.has(u.address),
    }));
  }

  async sendToAddress(
    walletName: string,
    address: string,
    amount: number,
    options: WalletBackendSendOptions = {}
  ): Promise<string> {
    return this.walletRpc.sendToAddress(walletName, address, amount, {
      comment: options.comment,
      subtractFeeFromAmount: options.subtractFeeFromAmount,
      replaceable: options.replaceable ?? true,
      confTarget: options.confTarget ?? 6,
      feeRate: options.feeRate,
    });
  }

  async bumpFee(walletName: string, txid: string, feeRateSatVb?: number): Promise<string> {
    const result = await this.walletRpc.bumpFee(
      walletName,
      txid,
      feeRateSatVb !== undefined ? { feeRate: feeRateSatVb } : undefined
    );
    return result.txid;
  }

  async getCpfpParentInfo(
    _walletName: string,
    parentTxid: string
  ): Promise<{ vsize: number; fee: number }> {
    // getmempoolentry: vsize in vB, fees.base is the parent's own fee in BTC.
    const entry = await this.blockchainRpc.getMempoolEntry(parentTxid);
    return { vsize: entry.vsize, fee: entry.fees.base };
  }

  async cpfpBumpFee(
    walletName: string,
    parentTxid: string,
    vout: number,
    childFeeRateSatVb: number
  ): Promise<string> {
    // Resolve the value of the specific parent output we're going to spend —
    // it becomes the child output, with the child fee subtracted from it.
    const parent = await this.blockchainRpc.getRawTransaction(parentTxid, true);
    if (typeof parent === 'string') {
      throw new Error('Parent transaction not found');
    }
    const out = parent.vout.find(o => o.n === vout);
    if (!out) {
      throw new Error(`Parent output ${vout} not found`);
    }

    // Fresh receive address for the child output — keeps the swept funds in-wallet.
    const childAddress = await this.walletRpc.getNewAddress(walletName);

    // Explicit parent input drags the parent into the child's package; add_inputs
    // lets Core add confirmed top-up coins if the parent output can't cover the
    // fee. subtractFeeFromOutputs pays the fee from the child output so the bump
    // needs no external funding. replaceable keeps the child itself RBF-able.
    //
    // NOTE: for an unconfirmed wallet input, Core's walletcreatefundedpsbt does
    // ancestor-aware bumping — fee_rate is the TARGET PACKAGE rate (it lifts the
    // child's own fee to bring parent+child to that rate). So childFeeRateSatVb
    // is the package target, not the child's isolated rate (see cpfp-dialog).
    const funded = await this.walletRpc.walletCreateFundedPsbt(
      walletName,
      [{ txid: parentTxid, vout }],
      [{ [childAddress]: out.value }],
      0,
      {
        add_inputs: true,
        subtractFeeFromOutputs: [0],
        fee_rate: childFeeRateSatVb,
        replaceable: true,
      }
    );

    const processed = await this.walletRpc.walletProcessPsbt(walletName, funded.psbt);
    const finalized = await this.walletRpc.finalizePsbt(processed.psbt);
    if (!finalized.complete || !finalized.hex) {
      throw new Error('Failed to finalize CPFP transaction');
    }
    return this.blockchainRpc.sendRawTransaction(finalized.hex);
  }

  async feeEstimates(): Promise<WalletBackendFeeEstimates> {
    // estimatesmartfee returns BTC/kvB; sat/vB = BTC/kvB × 1e5.
    const at = async (target: number): Promise<number | null> => {
      try {
        const result = await this.blockchainRpc.estimateSmartFee(target);
        return result.feerate != null ? result.feerate * 100_000 : null;
      } catch {
        return null;
      }
    };
    const [fast, normal, slow] = await Promise.all([at(1), at(6), at(144)]);
    return { minSatPerVb: 1, fast, normal, slow };
  }
}
