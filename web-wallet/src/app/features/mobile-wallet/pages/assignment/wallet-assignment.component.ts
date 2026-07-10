import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { HashTruncatePipe } from '../../../../shared/pipes';
import { Contact, ContactsStoreService, NotificationService } from '../../../../shared/services';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { validatePocxAddress } from '../../../../bitcoin/utils/address-validation';
import type {
  AssignmentState,
  AssignmentStatus,
} from '../../../../bitcoin/services/rpc/mining-rpc.service';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';

/**
 * WalletAssignmentComponent - forging assignments on mobile.
 *
 * A slim single-page take on the desktop forging-assignment feature,
 * driven entirely by the same client-side service methods the desktop
 * page uses in remote mode (BtcxWalletService.getAssignment /
 * createAssignment / revokeAssignment — OP_RETURN txs built and signed
 * via BDK, status derived from Electrum script history).
 *
 * Pick a funded wallet address (the assignment must spend a coin on the
 * plot address), see its assignment state — badge + details mirroring
 * the desktop check tab, slimmed — and create or revoke depending on the
 * state. Fees use the backend's market default.
 */
@Component({
  selector: 'app-wallet-assignment',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatMenuModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DecimalPipe,
    HashTruncatePipe,
    I18nPipe,
  ],
  template: `
    <div class="page">
      <div class="header-row">
        <button mat-icon-button routerLink="/wallet">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h2>{{ 'forging_assignment' | i18n }}</h2>
        <span class="spacer"></span>
        <button
          mat-icon-button
          [disabled]="statusLoading() || !plotAddress"
          (click)="checkStatus()"
          [matTooltip]="'refresh' | i18n"
        >
          <mat-icon [class.spinning]="statusLoading()">refresh</mat-icon>
        </button>
      </div>

      @if (!wallet.walletActive()) {
        <div class="card empty-card">
          <mat-icon class="empty-icon">lock</mat-icon>
          <p class="hint-text">{{ 'mwallet_wallet_not_open' | i18n }}</p>
          <button mat-stroked-button routerLink="/wallet">
            <mat-icon>arrow_back</mat-icon>
            {{ 'back' | i18n }}
          </button>
        </div>
      } @else {
        <!-- Plot address -->
        <div class="card">
          <h3>{{ 'plot_address' | i18n }}</h3>
          @if (fundedAddresses().length === 0) {
            <p class="hint-text">{{ 'mwallet_assignment_no_funded' | i18n }}</p>
          } @else {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'plot_address' | i18n }}</mat-label>
              <mat-select
                [(ngModel)]="plotAddress"
                (ngModelChange)="checkStatus()"
                [disabled]="busy()"
              >
                @for (addr of fundedAddresses(); track addr) {
                  <mat-option [value]="addr">{{ addr | hashTruncate: 16 : 8 }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
        </div>

        <!-- Status -->
        @if (plotAddress) {
          <div class="card">
            <h3>{{ 'assignment_status' | i18n }}</h3>

            @if (statusLoading()) {
              <div class="status-loading">
                <mat-spinner diameter="24"></mat-spinner>
              </div>
            } @else if (statusError()) {
              <p class="error-text">{{ 'error_checking_status' | i18n }}: {{ statusError() }}</p>
            } @else if (status(); as s) {
              <div class="state-badge" [class]="badgeClass(s.state)">{{ s.state }}</div>

              @switch (s.state) {
                @case ('UNASSIGNED') {
                  <p class="hint-text">{{ 'no_assignment_exists' | i18n }}</p>
                  <p class="hint-text small">{{ 'can_create_assignment' | i18n }}</p>
                }
                @case ('ASSIGNING') {
                  <div class="detail-row">
                    <span class="detail-label">{{ 'forging_address' | i18n }}</span>
                    <span class="detail-value mono">{{ s.forging_address }}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">{{ 'activates_at_block' | i18n }}</span>
                    <span class="detail-value">
                      {{ s.activation_height | number }}
                      · {{ blocksRemaining(s) }} {{ 'blocks_remaining' | i18n }}
                    </span>
                  </div>
                }
                @case ('ASSIGNED') {
                  <div class="detail-row">
                    <span class="detail-label">{{ 'forging_address' | i18n }}</span>
                    <span class="detail-value mono">{{ s.forging_address }}</span>
                  </div>
                  @if (s.activation_height) {
                    <div class="detail-row">
                      <span class="detail-label">{{ 'activated_at_block' | i18n }}</span>
                      <span class="detail-value">{{ s.activation_height | number }}</span>
                    </div>
                  }
                  <p class="hint-text small success-hint">{{ 'assignment_active' | i18n }}</p>
                }
                @case ('REVOKING') {
                  <div class="detail-row">
                    <span class="detail-label">
                      {{ 'forging_address' | i18n }} ({{ 'still_active' | i18n }})
                    </span>
                    <span class="detail-value mono">{{ s.forging_address }}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">{{ 'effective_at_block' | i18n }}</span>
                    <span class="detail-value">
                      {{ s.revocation_effective_height | number }}
                      · {{ blocksRemaining(s) }} {{ 'blocks_remaining' | i18n }}
                    </span>
                  </div>
                }
                @case ('REVOKED') {
                  @if (s.forging_address) {
                    <div class="detail-row">
                      <span class="detail-label">{{ 'previously_assigned_to' | i18n }}</span>
                      <span class="detail-value mono">{{ s.forging_address }}</span>
                    </div>
                  }
                  <p class="hint-text small">{{ 'assignment_revoked' | i18n }}</p>
                  <p class="hint-text small">{{ 'can_create_new_assignment' | i18n }}</p>
                }
              }
            }
          </div>

          <!-- Actions -->
          @if (status(); as s) {
            @if (canCreate(s.state)) {
              <div class="card">
                <h3>{{ 'create_assignment' | i18n }}</h3>
                <p class="hint-text small">{{ 'create_assignment_description' | i18n }}</p>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>{{ 'forging_address' | i18n }}</mat-label>
                  <input
                    matInput
                    [(ngModel)]="forgingAddress"
                    (ngModelChange)="validateForgingAddress()"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck="false"
                  />
                  @if (forgingValid()) {
                    <mat-icon matSuffix class="suffix-valid">check_circle</mat-icon>
                  }
                  @if (contacts().length > 0) {
                    <button
                      mat-icon-button
                      matSuffix
                      type="button"
                      [matMenuTriggerFor]="contactsMenu"
                      [matTooltip]="'select_contact' | i18n"
                    >
                      <mat-icon>contacts</mat-icon>
                    </button>
                  }
                </mat-form-field>
                <mat-menu #contactsMenu="matMenu">
                  @for (contact of contacts(); track contact.id) {
                    <button mat-menu-item (click)="selectContact(contact)">
                      <div class="contact-option">
                        <span class="contact-option-name">{{ contact.name }}</span>
                        <span class="contact-option-address">
                          {{ contact.address | hashTruncate: 14 : 8 }}
                        </span>
                      </div>
                    </button>
                  }
                </mat-menu>
                @let forgErr = forgingError();
                @if (forgErr) {
                  <p class="error-text">{{ forgErr.key | i18n: forgErr.params }}</p>
                }

                <button
                  mat-raised-button
                  color="primary"
                  class="full-width"
                  [disabled]="!forgingValid() || busy()"
                  (click)="create()"
                >
                  @if (busy()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  } @else {
                    <mat-icon>assignment_turned_in</mat-icon>
                  }
                  {{ 'create_assignment' | i18n }}
                </button>
              </div>
            } @else if (s.state === 'ASSIGNED') {
              <div class="card">
                <h3>{{ 'revoke_assignment' | i18n }}</h3>
                <p class="hint-text small">{{ 'revoke_assignment_description' | i18n }}</p>
                <button
                  mat-stroked-button
                  class="full-width revoke-button"
                  [disabled]="busy()"
                  (click)="revoke()"
                >
                  @if (busy()) {
                    <mat-spinner diameter="20"></mat-spinner>
                  } @else {
                    <mat-icon>assignment_return</mat-icon>
                  }
                  {{ 'revoke_assignment' | i18n }}
                </button>
              </div>
            }
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .page {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 480px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
      }

      .header-row {
        display: flex;
        align-items: center;
        gap: 8px;

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 500;
        }

        .spacer {
          flex: 1;
        }
      }

      .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;

        h3 {
          margin: 0 0 12px;
          font-size: 15px;
          font-weight: 500;
        }
      }

      .full-width {
        width: 100%;
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 12px;

        &.small {
          font-size: 12px;
        }

        &.success-hint {
          color: #2e7d32;
        }
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      .suffix-valid {
        color: #4caf50;
      }

      .empty-card {
        text-align: center;

        .empty-icon {
          font-size: 36px;
          width: 36px;
          height: 36px;
          color: rgba(0, 0, 0, 0.3);
        }
      }

      .status-loading {
        display: flex;
        justify-content: center;
        padding: 12px 0;
      }

      /* Desktop forging-assignment badge, slimmed. */
      .state-badge {
        display: inline-block;
        padding: 4px 14px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 12px;

        &.badge-unassigned {
          background: #e0e0e0;
          color: #666;
        }

        &.badge-assigning {
          background: #fff3e0;
          color: #e65100;
        }

        &.badge-assigned {
          background: #e8f5e9;
          color: #2e7d32;
        }

        &.badge-revoking {
          background: #fbe9e7;
          color: #d84315;
        }

        &.badge-revoked {
          background: #ffebee;
          color: #c62828;
        }
      }

      .detail-row {
        display: flex;
        flex-direction: column;
        padding: 6px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);

        &:last-of-type {
          border-bottom: none;
        }

        .detail-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: rgba(0, 0, 0, 0.5);
          margin-bottom: 2px;
        }

        .detail-value {
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
      }

      .mono {
        font-family: monospace;
        word-break: break-all;
      }

      .contact-option {
        display: flex;
        flex-direction: column;
        line-height: 1.3;

        .contact-option-name {
          font-size: 14px;
        }

        .contact-option-address {
          font-size: 11px;
          font-family: monospace;
          color: rgba(0, 0, 0, 0.55);
        }
      }

      .revoke-button {
        color: #d84315;
        border-color: currentColor;
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text {
          color: rgba(255, 255, 255, 0.6);

          &.success-hint {
            color: #81c784;
          }
        }

        .empty-card .empty-icon {
          color: rgba(255, 255, 255, 0.3);
        }

        .detail-row {
          border-bottom-color: rgba(255, 255, 255, 0.08);

          .detail-label {
            color: rgba(255, 255, 255, 0.5);
          }
        }
      }
    `,
  ],
})
export class WalletAssignmentComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly contactsStore = inject(ContactsStoreService);
  private readonly i18n = inject(I18nService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);

  /** Wallet addresses holding a spendable coin (assignment prerequisite). */
  readonly fundedAddresses = signal<string[]>([]);
  readonly status = signal<AssignmentStatus | null>(null);
  readonly statusLoading = signal(false);
  readonly statusError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly forgingValid = signal(false);
  readonly forgingError = signal<{ key: string; params?: Record<string, string> } | null>(null);

  readonly contacts = computed(() => this.contactsStore.forNetwork(this.wallet.network()));

  plotAddress = '';
  forgingAddress = '';

  ngOnInit(): void {
    this.contactsStore.load();
    void this.init();
  }

  private async init(): Promise<void> {
    await this.wallet.initialize();
    if (!this.wallet.walletActive()) return;
    try {
      const utxos = await this.wallet.utxos();
      // Non-change addresses first, then change — deduplicated.
      const sorted = [...utxos].sort((a, b) => Number(a.isChange) - Number(b.isChange));
      const addresses: string[] = [];
      for (const utxo of sorted) {
        if (utxo.address && !addresses.includes(utxo.address)) {
          addresses.push(utxo.address);
        }
      }
      this.fundedAddresses.set(addresses);
      if (!this.plotAddress && addresses.length > 0) {
        this.plotAddress = addresses[0];
        await this.checkStatus();
      }
    } catch (err) {
      console.error('Failed to load wallet UTXOs:', err);
    }
  }

  async checkStatus(): Promise<void> {
    const address = this.plotAddress;
    if (!address || this.statusLoading()) return;
    this.statusLoading.set(true);
    this.statusError.set(null);
    this.status.set(null);
    try {
      const status = (await this.wallet.getAssignment(address)) as AssignmentStatus;
      this.status.set(status);
    } catch (err) {
      this.statusError.set(`${err}`);
    } finally {
      this.statusLoading.set(false);
    }
  }

  canCreate(state: AssignmentState): boolean {
    return state === 'UNASSIGNED' || state === 'REVOKED';
  }

  /** Blocks until a pending create activates / a pending revoke lands. */
  blocksRemaining(status: AssignmentStatus): number {
    const target =
      status.state === 'ASSIGNING' ? status.activation_height : status.revocation_effective_height;
    if (!target) return 0;
    return Math.max(0, target - status.height);
  }

  badgeClass(state: AssignmentState): string {
    return `badge-${state.toLowerCase()}`;
  }

  selectContact(contact: Contact): void {
    this.forgingAddress = contact.address;
    this.validateForgingAddress();
  }

  /** Same rules the desktop page enforces: segwit v0, right network, ≠ plot. */
  validateForgingAddress(): void {
    this.forgingValid.set(false);
    const result = validatePocxAddress(this.forgingAddress);
    switch (result.kind) {
      case 'empty':
        this.forgingError.set(null);
        break;
      case 'invalid_format':
        this.forgingError.set({ key: 'address_invalid_format' });
        break;
      case 'invalid_checksum':
        this.forgingError.set({ key: 'address_invalid_checksum' });
        break;
      case 'valid':
        if (result.network !== this.wallet.network()) {
          this.forgingError.set({
            key: 'address_wrong_network',
            params: {
              addressNetwork: this.i18n.get(result.network),
              appNetwork: this.i18n.get(this.wallet.network()),
            },
          });
        } else if (result.type !== 'Bech32 (SegWit)') {
          this.forgingError.set({ key: 'address_must_be_segwit_v0' });
        } else if (this.forgingAddress.trim() === this.plotAddress) {
          this.forgingError.set({ key: 'forging_address_must_differ' });
        } else {
          this.forgingError.set(null);
          this.forgingValid.set(true);
        }
        break;
    }
  }

  async create(): Promise<void> {
    if (!this.forgingValid() || this.busy()) return;
    this.busy.set(true);
    try {
      await this.wallet.createAssignment(this.plotAddress, this.forgingAddress.trim());
      this.notifications.success(this.i18n.get('assignment_created_success'));
      this.forgingAddress = '';
      this.forgingValid.set(false);
      await this.checkStatus();
    } catch (err) {
      this.notifications.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }

  revoke(): void {
    if (this.busy()) return;
    const data: ConfirmDialogData = {
      title: this.i18n.get('revoke_assignment'),
      message: this.i18n.get('revoke_assignment_description'),
      confirmText: this.i18n.get('revoke_assignment'),
      cancelText: this.i18n.get('cancel'),
      type: 'danger',
    };
    this.dialog
      .open(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe((confirmed: boolean) => {
        if (!confirmed) return;
        void this.doRevoke();
      });
  }

  private async doRevoke(): Promise<void> {
    this.busy.set(true);
    try {
      await this.wallet.revokeAssignment(this.plotAddress);
      this.notifications.success(this.i18n.get('revocation_created_success'));
      await this.checkStatus();
    } catch (err) {
      this.notifications.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }
}
