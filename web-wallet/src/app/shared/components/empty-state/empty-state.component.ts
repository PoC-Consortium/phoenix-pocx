import { Component, Input, Output, EventEmitter } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

/**
 * EmptyStateComponent displays a friendly message when there's no data to show.
 *
 * Usage:
 * <app-empty-state
 *   icon="account_balance_wallet"
 *   title="No Transactions"
 *   message="Your transaction history will appear here">
 * </app-empty-state>
 *
 * With action button:
 * <app-empty-state
 *   icon="add_circle"
 *   title="No Wallets"
 *   message="Create your first wallet to get started"
 *   actionText="Create Wallet"
 *   (actionClick)="createWallet()">
 * </app-empty-state>
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  template: `
    <div class="empty-state">
      @if (icon) {
        <mat-icon class="empty-icon">{{ icon }}</mat-icon>
      }
      @if (title) {
        <h3 class="empty-title">{{ title }}</h3>
      }
      @if (message) {
        <p class="empty-message">{{ message }}</p>
      }
      @if (actionText) {
        <button mat-raised-button color="primary" (click)="onAction()">
          {{ actionText }}
        </button>
      }
      <ng-content></ng-content>
    </div>
  `,
  styles: [
    `
      .empty-state {
        text-align: center;
        padding: 48px 24px;
        color: rgba(0, 0, 0, 0.54);
      }

      .empty-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      .empty-title {
        margin: 0 0 8px 0;
        font-size: 18px;
        font-weight: 600;
        color: inherit;
      }

      .empty-message {
        margin: 0 0 24px 0;
        font-size: 14px;
        max-width: 400px;
        margin-left: auto;
        margin-right: auto;
      }

      :host-context(.dark-theme) .empty-state {
        color: rgba(255, 255, 255, 0.7);
      }
    `,
  ],
})
export class EmptyStateComponent {
  @Input() icon?: string;
  @Input() title?: string;
  @Input() message?: string;
  @Input() actionText?: string;

  @Output() actionClick = new EventEmitter<void>();

  onAction(): void {
    this.actionClick.emit();
  }
}
