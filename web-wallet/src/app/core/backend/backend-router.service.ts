import { Injectable, inject } from '@angular/core';
import { WalletRpcService } from '../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainRpcService } from '../../bitcoin/services/rpc/blockchain-rpc.service';
import { BtcxWalletService } from '../services/btcx-wallet.service';
import { NodeService } from '../../node/services/node.service';
import { WalletBackend, WalletCapabilities } from './wallet-backend.model';
import { CoreWalletBackend } from './core-wallet-backend';
import { ElectrumWalletBackend } from './electrum-wallet-backend';

/**
 * BackendRouterService hands out THE wallet backend for the current node
 * mode: Core JSON-RPC (managed/external) or the local BDK/Electrum stack
 * (remote). Node mode is fixed per app launch (mode changes route through
 * setup/settings and reset the wallet state), so routing is a cheap
 * per-call signal read — no hot-swap machinery.
 */
@Injectable({ providedIn: 'root' })
export class BackendRouterService {
  private readonly nodeService = inject(NodeService);

  private readonly coreBackend = new CoreWalletBackend(
    inject(WalletRpcService),
    inject(BlockchainRpcService)
  );
  private readonly electrumBackend = new ElectrumWalletBackend(inject(BtcxWalletService));

  /** The wallet backend of the current node mode. */
  wallet(): WalletBackend {
    return this.nodeService.isRemote() ? this.electrumBackend : this.coreBackend;
  }

  /** Whether the current mode runs over Electrum (no local node). */
  isRemote(): boolean {
    return this.nodeService.isRemote();
  }

  /** Capability matrix of the current backend (template convenience). */
  capabilities(): WalletCapabilities {
    return this.wallet().capabilities;
  }
}
