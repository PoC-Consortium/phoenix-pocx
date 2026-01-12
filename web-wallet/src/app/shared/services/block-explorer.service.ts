import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { selectNetwork } from '../../store/settings/settings.selectors';

/**
 * BlockExplorerService provides URLs and navigation to the Bitcoin-PoCX block explorer.
 *
 * URLs are network-aware:
 * - Testnet: https://explorer.testnet.bitcoin-pocx.org/testnet
 * - Mainnet: https://explorer.bitcoin-pocx.org/mainnet
 */
@Injectable({ providedIn: 'root' })
export class BlockExplorerService {
  private readonly store = inject(Store);
  private readonly network = toSignal(this.store.select(selectNetwork), {
    initialValue: 'testnet',
  });

  /**
   * Get the base explorer URL for the current network
   */
  private getBaseUrl(): string {
    const net = this.network();
    if (net === 'mainnet') {
      return 'https://explorer.bitcoin-pocx.org/mainnet';
    }
    // Default to testnet for both testnet and regtest
    return 'https://explorer.testnet.bitcoin-pocx.org/testnet';
  }

  private getBlockUrl(hash: string): string {
    return `${this.getBaseUrl()}/block/${hash}`;
  }

  private getTransactionUrl(txid: string): string {
    return `${this.getBaseUrl()}/tx/${txid}`;
  }

  private getAddressUrl(address: string): string {
    return `${this.getBaseUrl()}/address/${address}`;
  }

  /**
   * Open a block in the explorer (new tab)
   * @param hash - Block hash
   */
  openBlock(hash: string): void {
    window.open(this.getBlockUrl(hash), '_blank');
  }

  /**
   * Open a transaction in the explorer (new tab)
   * @param txid - Transaction ID
   */
  openTransaction(txid: string): void {
    window.open(this.getTransactionUrl(txid), '_blank');
  }

  /**
   * Open an address in the explorer (new tab)
   * @param address - Bitcoin address
   */
  openAddress(address: string): void {
    window.open(this.getAddressUrl(address), '_blank');
  }
}
