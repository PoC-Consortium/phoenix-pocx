import { Injectable, inject } from '@angular/core';
import { I18nService } from '../../core/i18n';
import { NotificationService } from './notification.service';

@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  async copy(text: string, successKey = 'copied_to_clipboard'): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      this.notification.success(this.i18n.get(successKey));
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.notification.error(this.i18n.get('copy_failed'));
      return false;
    }
  }

  async copyAddress(address: string): Promise<boolean> {
    return this.copy(address, 'address_copied');
  }

  async copyTxid(txid: string): Promise<boolean> {
    return this.copy(txid);
  }

  async read(): Promise<string | null> {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error('Failed to read from clipboard:', error);
      return null;
    }
  }
}
