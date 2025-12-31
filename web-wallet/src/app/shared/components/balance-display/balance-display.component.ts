import { Component, Input } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AmountPipe, satoshisToBtc } from '../../pipes';
import { I18nPipe } from '../../../core/i18n';

/**
 * BalanceDisplayComponent shows a Bitcoin balance with optional styling.
 *
 * Features:
 * - Display in BTC or satoshis
 * - Color-coded for positive/negative amounts
 * - Short or full precision display
 * - Optional pending indicator
 *
 * Usage:
 * <app-balance-display [amount]="1.5" />
 * <app-balance-display [amount]="150000000" inputType="satoshis" />
 * <app-balance-display [amount]="balance" [pending]="hasPending" />
 * <app-balance-display [amount]="-0.5" [showSign]="true" />
 */
@Component({
  selector: 'app-balance-display',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, AmountPipe, I18nPipe],
  template: `
    <span
      class="balance"
      [class.positive]="showSign && numericAmount > 0"
      [class.negative]="showSign && numericAmount < 0"
      [class.pending]="pending"
      [class.large]="size === 'large'"
      [class.small]="size === 'small'"
    >
      @if (showSign && numericAmount > 0) {
        <span class="sign">+</span>
      }
      @if (showSign && numericAmount < 0) {
        <span class="sign">-</span>
      }
      {{ absAmount | amount: inputType : shortForm : noUnit : noSeparator }}
      @if (pending) {
        <mat-icon class="pending-icon" [matTooltip]="'pending_confirmation' | i18n">
          schedule
        </mat-icon>
      }
    </span>
  `,
  styles: [
    `
      .balance {
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 4px;

        &.positive {
          color: #4caf50;
        }
        &.negative {
          color: #f44336;
        }
        &.pending {
          color: #ff9800;
        }

        &.large {
          font-size: 24px;
          font-weight: 600;
        }

        &.small {
          font-size: 12px;
        }
      }

      .sign {
        font-weight: 600;
      }

      .pending-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        opacity: 0.8;
      }
    `,
  ],
})
export class BalanceDisplayComponent {
  @Input() amount: number | string = 0;
  @Input() inputType: 'satoshis' | 'btc' = 'btc';
  @Input() shortForm: boolean = false;
  @Input() noUnit: boolean = false;
  @Input() noSeparator: boolean = false;
  @Input() showSign: boolean = false;
  @Input() pending: boolean = false;
  @Input() size: 'small' | 'normal' | 'large' = 'normal';

  get numericAmount(): number {
    const value = typeof this.amount === 'string' ? parseFloat(this.amount) : this.amount;
    return this.inputType === 'satoshis' ? satoshisToBtc(value) : value;
  }

  get absAmount(): number {
    return Math.abs(this.numericAmount);
  }
}
