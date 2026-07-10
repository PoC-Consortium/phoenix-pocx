import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { I18nPipe } from '../../../../core/i18n';
import { BtcxPipe, HashTruncatePipe } from '../../../../shared/pipes';
import { ClipboardService, ContactsStoreService } from '../../../../shared/services';
import { BlockExplorerService } from '../../../../shared/services/block-explorer.service';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';

/**
 * TxRowComponent - ONE transaction row for every mobile list.
 *
 * The home "recent transactions" preview and the activity page render the
 * same row: direction icon + label, display address, time, signed amount
 * (BtcxPipe — the shared formatter) and confirmation state, plus the
 * per-row menu (copy txid/address, add the counterparty to the contacts
 * book, open in the block explorer). Extracted in feedback round 4 so the
 * two surfaces built separately in round 2 cannot drift apart.
 *
 * The row itself is click-transparent: the parent decides what a tap does
 * (home navigates to the activity page, activity toggles its inline
 * detail). Menu taps never bubble into that.
 */
@Component({
  selector: 'app-mwallet-tx-row',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    DatePipe,
    BtcxPipe,
    HashTruncatePipe,
    I18nPipe,
  ],
  template: `
    <div class="tx-row">
      <mat-icon
        class="tx-icon"
        [class.received]="tx().direction === 'received'"
        [class.sent]="tx().direction === 'sent'"
      >
        {{ tx().direction === 'received' ? 'arrow_downward' : 'arrow_upward' }}
      </mat-icon>

      <div class="tx-main">
        <span class="tx-direction">
          {{ (tx().direction === 'received' ? 'mwallet_received' : 'mwallet_sent') | i18n }}
        </span>
        @if (tx().address; as address) {
          <span class="tx-address mono">{{ address | hashTruncate: 12 : 6 }}</span>
        }
        <span class="tx-time">
          @if (tx().timestamp; as timestamp) {
            {{ timestamp * 1000 | date: 'short' }}
          }
        </span>
      </div>

      <div class="tx-right">
        <span
          class="tx-amount"
          [class.received]="tx().direction === 'received'"
          [class.sent]="tx().direction === 'sent'"
        >
          {{ tx().direction === 'received' ? '+' : '-' }}{{ tx().amountSat / 100000000 | btcx }}
        </span>
        <span class="tx-conf" [class.unconfirmed]="tx().confirmations === 0">
          @if (tx().confirmations === 0) {
            {{ 'mwallet_unconfirmed' | i18n }}
          } @else {
            {{ 'mwallet_confirmations_n' | i18n: { count: tx().confirmations } }}
          }
        </span>
      </div>

      <button
        mat-icon-button
        class="tx-menu-button"
        [matMenuTriggerFor]="txMenu"
        (click)="$event.stopPropagation()"
      >
        <mat-icon>more_vert</mat-icon>
      </button>
      <mat-menu #txMenu="matMenu">
        <button mat-menu-item (click)="copyTxid()">
          <mat-icon>content_copy</mat-icon>
          <span>{{ 'copy_transaction_id' | i18n }}</span>
        </button>
        @if (tx().address) {
          <button mat-menu-item (click)="copyAddress()">
            <mat-icon>content_copy</mat-icon>
            <span>{{ 'copy_address' | i18n }}</span>
          </button>
        }
        @if (canAddContact()) {
          <button mat-menu-item (click)="addToContacts()">
            <mat-icon>person_add</mat-icon>
            <span>{{ 'mwallet_add_to_contact' | i18n }}</span>
          </button>
        }
        <button mat-menu-item (click)="openInExplorer()">
          <mat-icon>open_in_new</mat-icon>
          <span>{{ 'view_in_explorer' | i18n }}</span>
        </button>
      </mat-menu>
    </div>
  `,
  styles: [
    `
      .tx-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .tx-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        flex-shrink: 0;

        &.received {
          color: #4caf50;
        }

        &.sent {
          color: #1976d2;
        }
      }

      .tx-main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;

        .tx-direction {
          font-size: 14px;
        }

        .tx-address {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.6);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tx-time {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.5);
        }
      }

      .tx-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;

        .tx-amount {
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          font-family: monospace;

          &.received {
            color: #2e7d32;
          }
        }

        .tx-conf {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.5);

          &.unconfirmed {
            color: #e65100;
          }
        }
      }

      .tx-menu-button {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        padding: 6px;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: rgba(0, 0, 0, 0.45);
        }
      }

      :host-context(.dark-theme) {
        .tx-main .tx-address {
          color: rgba(255, 255, 255, 0.6);
        }

        .tx-main .tx-time,
        .tx-right .tx-conf {
          color: rgba(255, 255, 255, 0.5);
        }

        .tx-right .tx-amount.received {
          color: #81c784;
        }

        .tx-menu-button mat-icon {
          color: rgba(255, 255, 255, 0.55);
        }
      }
    `,
  ],
})
export class TxRowComponent {
  private readonly wallet = inject(BtcxWalletService);
  private readonly contacts = inject(ContactsStoreService);
  private readonly clipboard = inject(ClipboardService);
  private readonly explorer = inject(BlockExplorerService);
  private readonly router = inject(Router);

  readonly tx = input.required<BtcxWalletTx>();

  /**
   * "Add to contact" only makes sense with an address that is not yet in
   * the book (the store is the same synchronous localStorage book the
   * contacts pages use, so the check is cheap and always fresh).
   */
  readonly canAddContact = computed(() => {
    const address = this.tx().address;
    return !!address && !this.contacts.hasAddress(this.wallet.network(), address);
  });

  async copyTxid(): Promise<void> {
    await this.clipboard.copyTxid(this.tx().txid);
  }

  async copyAddress(): Promise<void> {
    const address = this.tx().address;
    if (address) await this.clipboard.copyAddress(address);
  }

  /** Contacts page in add-mode with this row's address prefilled. */
  addToContacts(): void {
    const address = this.tx().address;
    if (!address) return;
    void this.router.navigate(['/wallet/contacts'], { queryParams: { add: address } });
  }

  openInExplorer(): void {
    this.explorer.openTransaction(this.tx().txid, this.wallet.network());
  }
}
