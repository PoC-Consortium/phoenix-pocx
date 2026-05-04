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
   * Get the base explorer URL for the current network
   */
  private getBaseUrl(): string {
    const net = this.network();
    if (net === 'mainnet') {
      return 'https://explorer.bitcoin-pocx.org';
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
   * Open a block in the system browser
   */
  openBlock(hash: string): void {
    void this.electron.openExternal(this.getBlockUrl(hash));
  }

  /**
   * Open a transaction in the system browser
   */
  openTransaction(txid: string): void {
    void this.electron.openExternal(this.getTransactionUrl(txid));
  }

  /**
   * Open an address in the system browser
   */
  openAddress(address: string): void {
    void this.electron.openExternal(this.getAddressUrl(address));
  }
}
