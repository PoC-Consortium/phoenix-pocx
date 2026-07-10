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
