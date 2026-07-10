import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { selectNetwork } from '../../store/settings/settings.selectors';
import { ElectronService } from '../../core/services/electron.service';

/**
 * BlockExplorerService provides URLs and navigation to the Bitcoin-PoCX block explorer.
 *
 * URLs are network-aware:
 * - Testnet: https://explorer.testnet.bitcoin-pocx.org/testnet
 * - Mainnet: https://explorer.bitcoin-pocx.org
 *
 * Navigation is routed through ElectronService.openExternal so the OS browser
 * opens in the Tauri desktop build (plain window.open is blocked by the
 * webview's security policy).
 */
@Injectable({ providedIn: 'root' })
export class BlockExplorerService {
  private readonly store = inject(Store);
  private readonly electron = inject(ElectronService);
  private readonly network = toSignal(this.store.select(selectNetwork), {
    initialValue: 'mainnet',
  });

  /**
   * Get the base explorer URL for a network. Defaults to the settings
   * store's network; callers whose network lives elsewhere (the mobile
   * btcx wallet) pass theirs explicitly.
   */
  private getBaseUrl(network?: string): string {
    const net = network ?? this.network();
    if (net === 'mainnet') {
      return 'https://explorer.bitcoin-pocx.org';
    }
    // Default to testnet for both testnet and regtest
    return 'https://explorer.testnet.bitcoin-pocx.org/testnet';
  }

  private getBlockUrl(hash: string, network?: string): string {
    return `${this.getBaseUrl(network)}/block/${hash}`;
  }

  private getTransactionUrl(txid: string, network?: string): string {
    return `${this.getBaseUrl(network)}/tx/${txid}`;
  }

  private getAddressUrl(address: string, network?: string): string {
    return `${this.getBaseUrl(network)}/address/${address}`;
  }

  /**
   * Open a block in the system browser
   */
  openBlock(hash: string, network?: string): void {
    void this.electron.openExternal(this.getBlockUrl(hash, network));
  }

  /**
   * Open a transaction in the system browser
   */
  openTransaction(txid: string, network?: string): void {
    void this.electron.openExternal(this.getTransactionUrl(txid, network));
  }

  /**
   * Open an address in the system browser
   */
  openAddress(address: string, network?: string): void {
    void this.electron.openExternal(this.getAddressUrl(address, network));
  }
}
