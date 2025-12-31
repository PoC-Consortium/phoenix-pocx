import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Notification type
 */
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/**
 * Notification data
 */
export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  timestamp: Date;
  action?: string;
  duration?: number;
}

/**
 * NotificationService provides user notifications via Material snackbar
 * and maintains a notification history.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  private readonly historySubject = new BehaviorSubject<Notification[]>([]);
  private readonly maxHistory = 50;
  private notificationId = 0;

  /** Observable of notification history */
  readonly history$: Observable<Notification[]> = this.historySubject.asObservable();

  /** Get notification history */
  get history(): Notification[] {
    return this.historySubject.value;
  }

  /**
   * Show a success notification
   */
  success(message: string, action?: string, duration = 3000): void {
    this.show(message, 'success', action, duration);
  }

  /**
   * Show an error notification
   */
  error(message: string, action?: string, duration = 5000): void {
    this.show(message, 'error', action, duration);
  }

  /**
   * Show a warning notification
   */
  warning(message: string, action?: string, duration = 4000): void {
    this.show(message, 'warning', action, duration);
  }

  /**
   * Show an info notification
   */
  info(message: string, action?: string, duration = 3000): void {
    this.show(message, 'info', action, duration);
  }

  /**
   * Show a notification
   */
  show(message: string, type: NotificationType = 'info', action?: string, duration = 3000): void {
    // Create notification record
    const notification: Notification = {
      id: `notif-${++this.notificationId}`,
      message,
      type,
      timestamp: new Date(),
      action,
      duration,
    };

    // Add to history
    this.addToHistory(notification);

    // Configure snackbar
    const config: MatSnackBarConfig = {
      duration,
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      panelClass: this.getPanelClass(type),
    };

    // Show snackbar
    this.snackBar.open(message, action || 'Dismiss', config);
  }

  /**
   * Show a transaction notification
   */
  showTransaction(txid: string, type: 'sent' | 'received'): void {
    const shortTxid = `${txid.substring(0, 8)}...${txid.substring(txid.length - 8)}`;
    const message =
      type === 'sent' ? `Transaction sent: ${shortTxid}` : `Transaction received: ${shortTxid}`;
    this.success(message, 'View', 5000);
  }

  /**
   * Clear notification history
   */
  clearHistory(): void {
    this.historySubject.next([]);
  }

  /**
   * Add notification to history
   */
  private addToHistory(notification: Notification): void {
    const history = [notification, ...this.historySubject.value];
    // Keep only the most recent notifications
    if (history.length > this.maxHistory) {
      history.splice(this.maxHistory);
    }
    this.historySubject.next(history);
  }

  /**
   * Get CSS class for notification type
   */
  private getPanelClass(type: NotificationType): string[] {
    switch (type) {
      case 'success':
        return ['snackbar-success'];
      case 'error':
        return ['snackbar-error'];
      case 'warning':
        return ['snackbar-warning'];
      case 'info':
      default:
        return ['snackbar-info'];
    }
  }
}
