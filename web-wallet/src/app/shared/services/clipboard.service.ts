import { Injectable, inject } from '@angular/core';
import { NotificationService } from './notification.service';

/**
 * ClipboardService provides clipboard operations with notifications.
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly notification = inject(NotificationService);

  /**
   * Copy text to clipboard
   */
  async copy(text: string, label?: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      const message = label ? `${label} copied to clipboard` : 'Copied to clipboard';
      this.notification.success(message);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.notification.error('Failed to copy to clipboard');
      return false;
    }
  }

  /**
   * Copy an address to clipboard
   */
  async copyAddress(address: string): Promise<boolean> {
    return this.copy(address, 'Address');
  }

  /**
   * Copy a transaction ID to clipboard
   */
  async copyTxid(txid: string): Promise<boolean> {
    return this.copy(txid, 'Transaction ID');
  }

  /**
   * Read text from clipboard
   */
  async read(): Promise<string | null> {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error('Failed to read from clipboard:', error);
      return null;
    }
  }
}
