import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Clipboard } from '@angular/cdk/clipboard';
import { I18nPipe, I18nService } from '../../../core/i18n';
import { AddressPipe } from '../../pipes';
import { NotificationService } from '../../services';

/**
 * AddressDisplayComponent shows a Bitcoin address with optional actions.
 *
 * Features:
 * - Display full or shortened address
 * - Copy to clipboard
 * - Open in block explorer
 * - Quick actions menu
 *
 * Usage:
 * <app-address-display [address]="btcAddress" />
 * <app-address-display [address]="btcAddress" [shortForm]="true" />
 * <app-address-display [address]="btcAddress" [showActions]="false" />
 */
@Component({
  selector: 'app-address-display',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    I18nPipe,
    AddressPipe,
  ],
  template: `
    @if (address) {
      <div class="address-container" [class.inline]="inline">
        <span class="address mono" [class.clickable]="clickable" (click)="onAddressClick()">
          {{ address | address: shortForm : startChars : endChars }}
        </span>

        @if (showCopyButton) {
          <button
            mat-icon-button
            class="copy-button"
            [matTooltip]="'copy_address' | i18n"
            (click)="copyAddress()"
          >
            <mat-icon class="small-icon">{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
          </button>
        }

        @if (showActions) {
          <button
            mat-icon-button
            [matMenuTriggerFor]="actionsMenu"
            [matTooltip]="'actions' | i18n"
            class="actions-button"
          >
            <mat-icon>more_vert</mat-icon>
          </button>

          <mat-menu #actionsMenu="matMenu">
            <button mat-menu-item (click)="copyAddress()">
              <mat-icon>content_copy</mat-icon>
              <span>{{ 'copy_address' | i18n }}</span>
            </button>
            <button mat-menu-item (click)="openInExplorer()">
              <mat-icon>open_in_new</mat-icon>
              <span>{{ 'show_in_explorer' | i18n }}</span>
            </button>
            @if (showSendAction) {
              <button mat-menu-item (click)="onSend()">
                <mat-icon>send</mat-icon>
                <span>{{ 'send_to_address' | i18n }}</span>
              </button>
            }
          </mat-menu>
        }
      </div>
    }
  `,
  styles: [
    `
      .address-container {
        display: flex;
        align-items: center;
        gap: 4px;

        &.inline {
          display: inline-flex;
        }
      }

      .address {
        font-size: 13px;
        word-break: break-all;

        &.clickable {
          cursor: pointer;
          color: var(--mdc-theme-primary, #0075d4);

          &:hover {
            text-decoration: underline;
          }
        }
      }

      .copy-button,
      .actions-button {
        width: 28px;
        height: 28px;
        line-height: 28px;

        .small-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          line-height: 16px;
        }
      }
    `,
  ],
})
export class AddressDisplayComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  @Input() address: string = '';
  @Input() shortForm: boolean = false;
  @Input() startChars: number = 4;
  @Input() endChars: number = 4;
  @Input() showCopyButton: boolean = true;
  @Input() showActions: boolean = false;
  @Input() showSendAction: boolean = false;
  @Input() clickable: boolean = false;
  @Input() inline: boolean = true;
  @Input() explorerUrl: string = '';

  @Output() addressClick = new EventEmitter<string>();
  @Output() sendClick = new EventEmitter<string>();

  copied = signal(false);

  copyAddress(): void {
    if (this.address) {
      this.clipboard.copy(this.address);
      this.notification.success(this.i18n.get('address_copied'));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  openInExplorer(): void {
    if (this.address) {
      const url = this.explorerUrl || this.getDefaultExplorerUrl();
      window.open(url, '_blank');
    }
  }

  onAddressClick(): void {
    if (this.clickable) {
      this.addressClick.emit(this.address);
    }
  }

  onSend(): void {
    this.sendClick.emit(this.address);
  }

  private getDefaultExplorerUrl(): string {
    // Default to mempool.space for Bitcoin addresses
    // For testnet, would need to use mempool.space/testnet
    return `https://mempool.space/address/${this.address}`;
  }
}
