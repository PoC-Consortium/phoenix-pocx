import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
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
import { MiningService } from '../../../../mining/services';

/** One fee choice — the desktop forging-assignment page's FeeOption, slim. */
interface FeeOption {
  label: string;
  feeRate: number | null;
}

/** A configured pool's forging address — the desktop page's PoolAddressOption. */
interface PoolAddressOption {
  poolName: string;
  label: string;
  address: string;
}

/**
 * WalletAssignmentComponent - forging assignments on mobile.
 *
 * A slim single-CARD take on the desktop forging-assignment feature,
 * driven entirely by the same client-side service methods the desktop
 * page uses in remote mode (BtcxWalletService.getAssignment /
 * createAssignment / revokeAssignment — OP_RETURN txs built and signed
 * via BDK, status derived from Electrum script history).
 *
 * One card carries the whole flow: pick a funded wallet address (the
 * assignment must spend a coin on the plot address), see its assignment
 * state — badge + details mirroring the desktop check tab — and the
 * matching action (create or revoke). Fee selection mirrors the desktop
 * page's fee section (slow/normal/fast/custom chips fed by
 * `fetchFeeEstimates`, custom sat/vB input), slimmed to fit the card.
 */
@Component({
  selector: 'app-wallet-assignment',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatMenuModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DecimalPipe,
    NgTemplateOutlet,
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
        <!-- Everything in ONE card: selector + status + matching action -->
        <div class="card">
          @if (fundedAddresses().length === 0) {
            <p class="hint-text">{{ 'mwallet_assignment_no_funded' | i18n }}</p>
          } @else {
            <mat-form-field appearance="outline" class="full-width slim-field">
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

          <!-- Status -->
          @if (plotAddress) {
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
                  <p class="hint-text small">{{ 'can_create_new_assignment' | i18n }}</p>
                }
              }

              <!-- Matching action -->
              @if (canCreate(s.state)) {
                <mat-divider class="section-divider"></mat-divider>

                <!-- Combo: free text + the configured pools' published
                     forging addresses (desktop's forging-address dropdown,
                     sourced from the mining chain configs) -->
                <mat-form-field appearance="outline" class="full-width slim-field">
                  <mat-label>
                    {{
                      (poolAddressOptions().length > 0
                        ? 'select_or_enter_forging_address'
                        : 'forging_address'
                      ) | i18n
                    }}
                  </mat-label>
                  <input
                    matInput
                    [matAutocomplete]="forgingAuto"
                    [(ngModel)]="forgingAddress"
                    (ngModelChange)="validateForgingAddress()"
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck="false"
                  />
                  <mat-autocomplete #forgingAuto="matAutocomplete">
                    @for (opt of poolAddressOptions(); track opt.address) {
                      <mat-option [value]="opt.address">
                        <div class="pool-option">
                          <span class="pool-option-name">{{ opt.label || opt.poolName }}</span>
                          <span class="pool-option-address">
                            {{ opt.address | hashTruncate: 14 : 8 }}
                          </span>
                        </div>
                      </mat-option>
                    }
                  </mat-autocomplete>
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

                <ng-container *ngTemplateOutlet="feeSection"></ng-container>

                <button
                  mat-raised-button
                  color="primary"
                  class="full-width action-button"
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
              } @else if (s.state === 'ASSIGNED') {
                <mat-divider class="section-divider"></mat-divider>

                <p class="hint-text small">{{ 'revoke_assignment_description' | i18n }}</p>

                <ng-container *ngTemplateOutlet="feeSection"></ng-container>

                <button
                  mat-stroked-button
                  class="full-width action-button revoke-button"
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
              }
            }
          }
        </div>
      }
    </div>

    <!-- Fee section — the desktop forging-assignment fee chips, slimmed -->
    <ng-template #feeSection>
      <div class="fee-section">
        <div class="fee-header">
          <span class="fee-title">{{ 'fee' | i18n }}</span>
          <button
            mat-icon-button
            type="button"
            class="fee-refresh"
            (click)="loadFeeEstimates()"
            [disabled]="isLoadingFees()"
            [matTooltip]="'refresh_fees' | i18n"
          >
            <mat-icon [class.spinning]="isLoadingFees()">refresh</mat-icon>
          </button>
        </div>

        <div class="fee-options">
          @for (option of feeOptions; track option.label) {
            <button
              mat-stroked-button
              type="button"
              class="fee-chip"
              [class.selected]="selectedFeeOption === option"
              (click)="selectFeeOption(option)"
              [disabled]="option.feeRate === null && option.label !== 'fee_custom'"
            >
              <span class="fee-label">{{ option.label | i18n }}</span>
              @if (option.label === 'fee_custom') {
                <mat-icon class="custom-icon">tune</mat-icon>
              } @else if (option.feeRate !== null) {
                <span class="fee-rate">{{ option.feeRate }} sat/vB</span>
              } @else {
                <span class="fee-rate">--</span>
              }
            </button>
          }
        </div>

        @if (selectedFeeOption?.label === 'fee_custom') {
          <mat-form-field appearance="outline" class="full-width slim-field custom-fee-field">
            <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
            <input
              matInput
              type="number"
              [(ngModel)]="customFeeRate"
              (ngModelChange)="onCustomFeeChange()"
              min="1"
              step="1"
              autocomplete="off"
            />
          </mat-form-field>
        }
      </div>
    </ng-template>
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
        padding: 16px;
      }

      .full-width {
        width: 100%;
      }

      .slim-field {
        margin-bottom: -8px;
      }

      .section-divider {
        margin: 12px 0;
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 12px;

        &.small {
          font-size: 12px;
          margin-bottom: 8px;
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
        padding: 20px;

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
        padding: 3px 12px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin: 8px 0;

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
        padding: 4px 0;
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

      /* Pool entries of the forging-address combo (desktop's dropdown rows). */
      .pool-option {
        display: flex;
        flex-direction: column;
        line-height: 1.3;

        .pool-option-name {
          font-size: 14px;
        }

        .pool-option-address {
          font-size: 11px;
          font-family: monospace;
          color: rgba(0, 0, 0, 0.55);
        }
      }

      /* Fee section — desktop's fee chips, mobile-sized. */
      .fee-section {
        margin: 12px 0 4px;
      }

      .fee-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;

        .fee-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: rgba(0, 0, 0, 0.5);
        }

        .fee-refresh {
          width: 32px;
          height: 32px;
          padding: 4px;

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            color: rgba(0, 0, 0, 0.45);
          }
        }
      }

      .fee-options {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;

        .fee-chip {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          min-width: 0;
          padding: 4px 2px;
          height: auto;
          line-height: 1.3;

          &.selected {
            border-color: #1976d2;
            background: rgba(25, 118, 210, 0.08);
          }

          /* Material wraps the projected content in .mdc-button__label, so
             the flex column above cannot stack the two spans — make them
             blocks and keep the rate on one line: "Slow" / "1 sat/vB"
             (the same fix the send page's fee chips carry). */
          .fee-label {
            display: block;
            font-size: 12px;
            font-weight: 500;
          }

          .fee-rate {
            display: block;
            white-space: nowrap;
            font-size: 10px;
            color: rgba(0, 0, 0, 0.55);
            font-variant-numeric: tabular-nums;
          }

          .custom-icon {
            display: block;
            margin: 0 auto;
            font-size: 14px;
            width: 14px;
            height: 14px;
            color: rgba(0, 0, 0, 0.55);
          }
        }
      }

      .custom-fee-field {
        margin-top: 10px;
      }

      .action-button {
        margin-top: 12px;
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

        .fee-header .fee-title {
          color: rgba(255, 255, 255, 0.5);
        }

        .fee-header .fee-refresh mat-icon {
          color: rgba(255, 255, 255, 0.55);
        }

        .fee-options .fee-chip {
          .fee-rate,
          .custom-icon {
            color: rgba(255, 255, 255, 0.55);
          }

          &.selected {
            border-color: #64b5f6;
            background: rgba(100, 181, 246, 0.12);
          }
        }
      }
    `,
  ],
})
export class WalletAssignmentComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly mining = inject(MiningService);
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

  /**
   * Forging addresses published by the configured pool chains, offered in
   * the forging-address combo — the desktop forging-assignment page's
   * poolAddressOptions, sourced from the same mining chain configs
   * (ChainConfig.poolAddresses). Free-text entry remains available.
   */
  readonly poolAddressOptions = computed<PoolAddressOption[]>(() => {
    const chains = this.mining.config()?.chains ?? [];
    const options: PoolAddressOption[] = [];
    for (const chain of chains) {
      for (const pa of chain.poolAddresses ?? []) {
        if (pa.address) {
          options.push({ poolName: chain.name, label: pa.label, address: pa.address });
        }
      }
    }
    return options;
  });

  plotAddress = '';
  forgingAddress = '';

  // Fee estimation — the desktop forging-assignment fee section, slimmed
  // (same options, same defaulting: normal when estimates load, custom
  // otherwise), fed by the SAME fetchFeeEstimates backend call desktop
  // remote mode uses.
  readonly isLoadingFees = signal(false);
  customFeeRate: number | null = 1;
  feeOptions: FeeOption[] = [
    { label: 'fee_slow', feeRate: null },
    { label: 'fee_normal', feeRate: null },
    { label: 'fee_fast', feeRate: null },
    { label: 'fee_custom', feeRate: null },
  ];
  selectedFeeOption: FeeOption | null = null;

  ngOnInit(): void {
    this.contactsStore.load();
    // Load the mining state so the pool combobox sees the chain configs.
    void this.mining.getState().catch(err => {
      console.warn('Failed to load mining state for pool addresses:', err);
    });
    void this.init();
  }

  private async init(): Promise<void> {
    await this.wallet.initialize();
    if (!this.wallet.walletActive()) return;
    void this.loadFeeEstimates();
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

  /** Same estimates + rounding + defaulting as the desktop fee section. */
  async loadFeeEstimates(): Promise<void> {
    if (this.isLoadingFees()) return;
    this.isLoadingFees.set(true);
    try {
      const estimates = await this.wallet.fetchFeeEstimates();
      const byLabel: Record<string, number | null | undefined> = {
        fee_slow: estimates.slow,
        fee_normal: estimates.normal,
        fee_fast: estimates.fast,
      };
      for (const option of this.feeOptions) {
        if (option.label === 'fee_custom') continue;
        const rate = byLabel[option.label];
        option.feeRate = rate != null ? Math.max(1, Math.round(rate)) : null;
      }
    } catch (error) {
      console.error('Failed to load fee estimates:', error);
    } finally {
      const hasEstimates = this.feeOptions.some(
        o => o.label !== 'fee_custom' && o.feeRate !== null
      );
      if (!this.selectedFeeOption || this.selectedFeeOption.feeRate === null) {
        this.selectedFeeOption = hasEstimates ? this.feeOptions[1] : this.feeOptions[3];
      }
      this.isLoadingFees.set(false);
    }
  }

  selectFeeOption(option: FeeOption): void {
    this.selectedFeeOption = option;
    if (option.label === 'fee_custom' && this.customFeeRate) {
      option.feeRate = this.customFeeRate;
    }
  }

  onCustomFeeChange(): void {
    if (this.selectedFeeOption?.label === 'fee_custom' && this.customFeeRate) {
      this.selectedFeeOption.feeRate = this.customFeeRate;
    }
  }

  /** Selected rate in sat/vB, or undefined for the backend's default. */
  private getSelectedFeeRate(): number | undefined {
    if (this.selectedFeeOption?.label === 'fee_custom') {
      return this.customFeeRate ?? undefined;
    }
    return this.selectedFeeOption?.feeRate ?? undefined;
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
      await this.wallet.createAssignment(
        this.plotAddress,
        this.forgingAddress.trim(),
        this.getSelectedFeeRate()
      );
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
      await this.wallet.revokeAssignment(this.plotAddress, this.getSelectedFeeRate());
      this.notifications.success(this.i18n.get('revocation_created_success'));
      await this.checkStatus();
    } catch (err) {
      this.notifications.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }
}
