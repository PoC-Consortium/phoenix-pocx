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
    // Core's listtransactions returns OLDEST-first; the backend contract
    // (matching the Electrum/BDK side) is newest-first, so consumers never
    // re-sort.
    const txs = await this.walletRpc.listTransactions(walletName, '*', count, skip);
    return [...txs].sort((a, b) => b.time - a.time);
  }

  async getNewAddress(walletName: string, label = '', type?: CoreAddressType): Promise<string> {
    return this.walletRpc.getNewAddress(walletName, label, type);
  }

  /**
   * First VIRGIN receive address, reconstructed for a Core descriptor wallet
   * (Core has no native next-unused). Strategy:
   *
   * 1. `listreceivedbyaddress 0 true` — one call that returns EVERY revealed
   *    receive address with its total received (minconf 0 counts unconfirmed)
   *    and the txids that paid it. Virgin = received 0 sats AND no txids
   *    (real on-chain usage, not the old `labels.length` heuristic). Change
   *    addresses never appear here, so only external receive keys are considered.
   * 2. If NO virgin exists (all revealed addresses used, or a fresh wallet with
   *    none revealed), reveal a fresh unused one via `getnewaddress` — matching
   *    BDK's reveal-only-when-none-outstanding contract.
   * 3. Otherwise order the virgins by derivation index (`getaddressinfo`
   *    hdkeypath) and return the lowest — the same "first unused" BDK gives.
   *    `getaddressinfo` is called only on the (usually tiny) virgin subset.
   *
   * Any RPC failure falls back to `getnewaddress` so the page still shows a
   * usable address.
   */
  async currentReceiveAddress(walletName: string): Promise<string> {
    try {
      const received = await this.walletRpc.listReceivedByAddress(walletName, 0, true);
      const virgins = received
        .filter(r => Math.round(r.amount * 1e8) === 0 && r.txids.length === 0)
        .map(r => r.address)
        .filter(a => this.isReceiveBech32(a));

      if (virgins.length === 0) {
        return this.walletRpc.getNewAddress(walletName, '', 'bech32');
      }

      const withIndex = await Promise.all(
        virgins.map(async address => ({
          address,
          index: await this.receiveIndex(walletName, address),
        }))
      );
      withIndex.sort((a, b) => a.index - b.index);
      return withIndex[0].address;
    } catch {
      return this.walletRpc.getNewAddress(walletName, '', 'bech32');
    }
  }

  /** Derivation index of a receive address from its `getaddressinfo` hdkeypath. */
  private async receiveIndex(walletName: string, address: string): Promise<number> {
    try {
      const info = await this.walletRpc.getAddressInfo(walletName, address);
      const path = info.hdkeypath;
      if (!path) return Number.MAX_SAFE_INTEGER;
      const last = path.split('/').pop() ?? '';
      const idx = Number.parseInt(last.replace(/['h]/g, ''), 10);
      return Number.isFinite(idx) ? idx : Number.MAX_SAFE_INTEGER;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  /** A bech32(m) receive address for the wallet's networks (not legacy/script). */
  private isReceiveBech32(address: string): boolean {
    const lower = address.toLowerCase();
    // All PoCX networks incl. regtest (rpocx1) + both witness versions
    // (…1q SegWit / …1p Taproot). Standard Bitcoin HRPs kept defensively.
    return (
      lower.startsWith('pocx1') ||
      lower.startsWith('tpocx1') ||
      lower.startsWith('rpocx1') ||
      lower.startsWith('bc1') ||
      lower.startsWith('tb1') ||
      lower.startsWith('bcrt1')
    );
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
    // Pubkey exposure: an address reveals its pubkey the first time it is
    // SPENT from. We detect that without walking tx inputs — listreceivedbyaddress
    // gives the TOTAL ever received per address; if that exceeds what the address
    // still holds unspent, some was spent, so the address appeared as a tx input
    // and its pubkey is on-chain. (received only grows, so received==unspent iff
    // never spent.) Compared in sats to avoid float drift. Best-effort.
    const exposed = new Set<string>();
    try {
      const unspentSatByAddr = new Map<string, number>();
      for (const u of utxos) {
        unspentSatByAddr.set(
          u.address,
          (unspentSatByAddr.get(u.address) ?? 0) + Math.round(u.amount * 1e8)
        );
      }
      const received = await this.walletRpc.listReceivedByAddress(walletName, 0, false);
      for (const r of received) {
        const receivedSat = Math.round(r.amount * 1e8);
        const unspentSat = unspentSatByAddr.get(r.address) ?? 0;
        if (receivedSat > unspentSat) exposed.add(r.address);
      }
    } catch {
      // ignore — coins still render without the exposure flag.
    }
    return utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address,
      amount: u.amount,
      confirmations: u.confirmations,
      isChange: change.get(u.address) ?? false,
      spendable: u.spendable,
      exposed: exposed.has(u.address),
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
