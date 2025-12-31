import { Injectable, inject, OnDestroy } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { ElectronService } from '../../core/services/electron.service';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  selectNotifications,
  selectNotificationsEnabled,
  selectCurrencySymbol,
} from '../../store/settings/settings.selectors';

/**
 * Pending notification for batching
 */
interface PendingNotification {
  type: string;
  count: number;
  totalAmount: number;
}

/**
 * PocxNotificationService handles desktop notifications for wallet events.
 * Features:
 * - Respects user notification preferences from settings store
 * - Batches rapid events to avoid notification spam (2s delay)
 * - Uses Electron for native OS notifications
 */
@Injectable({ providedIn: 'root' })
export class PocxNotificationService implements OnDestroy {
  private readonly store = inject(Store);
  private readonly electronService = inject(ElectronService);
  private readonly i18n = inject(I18nService);

  // Settings signals
  private readonly notificationsEnabled = toSignal(this.store.select(selectNotificationsEnabled), {
    initialValue: true,
  });
  private readonly notificationSettings = toSignal(this.store.select(selectNotifications), {
    initialValue: null,
  });
  private readonly currencySymbol = toSignal(this.store.select(selectCurrencySymbol), {
    initialValue: 'BTCX',
  });

  // Batching state
  private readonly BATCH_DELAY = 2000; // 2 seconds
  private pendingNotifications: Map<string, PendingNotification> = new Map();
  private batchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  ngOnDestroy(): void {
    // Clear all pending timers
    this.batchTimers.forEach(timer => clearTimeout(timer));
    this.batchTimers.clear();
    this.pendingNotifications.clear();
  }

  /**
   * Notify about an incoming payment
   */
  notifyIncomingPayment(amount: number): void {
    const settings = this.notificationSettings();
    if (!this.notificationsEnabled() || !settings?.incomingPayment) {
      return;
    }
    this.batchNotification('incoming', amount);
  }

  /**
   * Notify about a payment being confirmed
   */
  notifyPaymentConfirmed(amount: number): void {
    const settings = this.notificationSettings();
    if (!this.notificationsEnabled() || !settings?.paymentConfirmed) {
      return;
    }
    this.batchNotification('confirmed', amount);
  }

  /**
   * Notify about a block being mined
   */
  notifyBlockMined(reward: number): void {
    const settings = this.notificationSettings();
    if (!this.notificationsEnabled() || !settings?.blockMined) {
      return;
    }
    this.batchNotification('mined', reward);
  }

  /**
   * Notify about a block reward maturing
   */
  notifyBlockRewardMatured(amount: number): void {
    const settings = this.notificationSettings();
    if (!this.notificationsEnabled() || !settings?.blockRewardMatured) {
      return;
    }
    this.batchNotification('matured', amount);
  }

  /**
   * Notify about node connection
   */
  notifyNodeConnected(): void {
    const settings = this.notificationSettings();
    if (!this.notificationsEnabled() || !settings?.nodeConnected) {
      return;
    }
    this.showNotification(
      this.i18n.get('notification_node_connected_title'),
      this.i18n.get('notification_node_connected')
    );
  }

  /**
   * Notify about node disconnection
   */
  notifyNodeDisconnected(): void {
    const settings = this.notificationSettings();
    if (!this.notificationsEnabled() || !settings?.nodeDisconnected) {
      return;
    }
    this.showNotification(
      this.i18n.get('notification_node_disconnected_title'),
      this.i18n.get('notification_node_disconnected')
    );
  }

  /**
   * Notify about sync completion
   */
  notifySyncComplete(): void {
    const settings = this.notificationSettings();
    if (!this.notificationsEnabled() || !settings?.syncComplete) {
      return;
    }
    this.showNotification(
      this.i18n.get('notification_sync_complete_title'),
      this.i18n.get('notification_sync_complete')
    );
  }

  /**
   * Batch notifications of the same type
   */
  private batchNotification(type: string, amount: number): void {
    const existing = this.pendingNotifications.get(type);

    if (existing) {
      existing.count++;
      existing.totalAmount += amount;
    } else {
      this.pendingNotifications.set(type, {
        type,
        count: 1,
        totalAmount: amount,
      });
    }

    // Reset or set timer for this type
    const existingTimer = this.batchTimers.get(type);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.flushNotification(type);
    }, this.BATCH_DELAY);

    this.batchTimers.set(type, timer);
  }

  /**
   * Flush a batched notification
   */
  private flushNotification(type: string): void {
    const pending = this.pendingNotifications.get(type);
    if (!pending) return;

    const { count, totalAmount } = pending;
    const symbol = this.currencySymbol();
    const formattedAmount = this.formatAmount(totalAmount);

    let title: string;
    let body: string;

    switch (type) {
      case 'incoming':
        title = this.i18n.get('notification_incoming_title');
        body =
          count === 1
            ? this.i18n.get('notification_incoming_single', {
                amount: formattedAmount,
                symbol,
              })
            : this.i18n.get('notification_incoming_multiple', {
                count,
                amount: formattedAmount,
                symbol,
              });
        break;

      case 'confirmed':
        title = this.i18n.get('notification_confirmed_title');
        body =
          count === 1
            ? this.i18n.get('notification_confirmed_single', {
                amount: formattedAmount,
                symbol,
              })
            : this.i18n.get('notification_confirmed_multiple', {
                count,
                amount: formattedAmount,
                symbol,
              });
        break;

      case 'mined':
        title = this.i18n.get('notification_mined_title');
        body =
          count === 1
            ? this.i18n.get('notification_mined_single', {
                amount: formattedAmount,
                symbol,
              })
            : this.i18n.get('notification_mined_multiple', {
                count,
                amount: formattedAmount,
                symbol,
              });
        break;

      case 'matured':
        title = this.i18n.get('notification_matured_title');
        body =
          count === 1
            ? this.i18n.get('notification_matured_single', {
                amount: formattedAmount,
                symbol,
              })
            : this.i18n.get('notification_matured_multiple', {
                count,
                amount: formattedAmount,
                symbol,
              });
        break;

      default:
        return;
    }

    this.showNotification(title, body);

    // Clean up
    this.pendingNotifications.delete(type);
    this.batchTimers.delete(type);
  }

  /**
   * Format amount for display
   */
  private formatAmount(amount: number): string {
    // Convert from satoshis if needed, or format BTC amount
    if (amount >= 1) {
      return amount.toFixed(8).replace(/\.?0+$/, '');
    }
    return amount.toFixed(8);
  }

  /**
   * Show the actual notification via Electron
   */
  private async showNotification(title: string, body: string): Promise<void> {
    await this.electronService.showDesktopNotification(title, body);
  }
}
