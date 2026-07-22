import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { takeUntil, skip } from 'rxjs/operators';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { HashTruncatePipe } from '../../../../shared/pipes';
import { DecimalInputDirective } from '../../../../shared/directives';
import { Contact, ContactsStoreService, NotificationService } from '../../../../shared/services';
import { PassphraseDialogComponent } from '../../../../shared';
import type { PassphraseDialogResult } from '../../../../shared';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { validatePocxAddress } from '../../../../bitcoin/utils/address-validation';
import { selectNetwork } from '../../../../store/settings/settings.selectors';
import type { Network } from '../../../../store/settings/settings.state';
import {
  MiningRpcService,
  AssignmentState,
  AssignmentStatus,
} from '../../../../bitcoin/services/rpc/mining-rpc.service';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import { NodeService } from '../../../../node/services/node.service';
import { AppModeService } from '../../../../core/services/app-mode.service';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import { MiningService } from '../../../../mining/services';
import { PageHeaderComponent } from '../../../mobile-wallet/components/page-header/page-header.component';
import {
  PoolAddressOption,
  poolAddressOptionsForChains,
} from '../../../../mining/models/mining.models';

/** One fee choice — `blocks` feeds the Core-mode estimatesmartfee call. */
interface FeeOption {
  label: string;
  blocks: number;
  feeRate: number | null;
}

/**
 * Assumed vsize of an assignment/revocation tx for the fee preview:
 * 1 P2WPKH input + OP_RETURN payload + change, ~170 vB (the send page's
 * preview assumption, which the OP_RETURN output roughly matches).
 */
const ASSIGNMENT_PREVIEW_VSIZE_VB = 170;

/**
 * ForgingAssignmentComponent — the ONE responsive forging-assignment page,
 * serving both the desktop route (`/forging-assignment`, main-layout) and
 * the mobile-wallet route (`/wallet/assignment`, mobile-wallet-layout).
 *
 * The design is the mobile page's single-CARD flow: pick a wallet address
 * (the assignment must spend a coin on the plot address), see its
 * assignment state — badge + details — and the matching action (create or
 * revoke). Desktop widths render the same card a little wider with
 * send-page-style uppercase section labels above the input groups; at
 * phone widths the original mobile look is unchanged.
 *
 * Mode seam (the unified send page's pattern): remote (Electrum) mode
 * drives the client-side BtcxWalletService assignment methods (OP_RETURN
 * txs built and signed via BDK, status derived from Electrum script
 * history); node modes drive the node's assignment RPCs
 * (get_assignment / create_assignment / revoke_assignment) with the
 * wallet identity from `walletManager.activeWallet`.
 */
@Component({
  selector: 'app-forging-assignment',
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
    DecimalInputDirective,
    I18nPipe,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="forging_assignment" [backLink]="backTarget">
      <button
        mat-icon-button
        [disabled]="statusLoading() || !plotAddress"
        (click)="checkStatus()"
        [matTooltip]="'refresh' | i18n"
      >
        <mat-icon [class.spinning]="statusLoading()">refresh</mat-icon>
      </button>
    </app-mwallet-page-header>

    <div class="page">
      @if (walletGateClosed()) {
        <div class="card empty-card">
          <mat-icon class="empty-icon">lock</mat-icon>
          <p class="hint-text">{{ 'mwallet_wallet_not_open' | i18n }}</p>
          <button mat-stroked-button [routerLink]="backTarget">
            <mat-icon>arrow_back</mat-icon>
            {{ 'back' | i18n }}
          </button>
        </div>
      } @else if (walletNotSegwit()) {
        <!-- Remote mode, non-segwit wallet (taproot, or imported legacy
             descriptors): plot addresses are segwit-v0 witness programs, so
             this wallet can never create or revoke an assignment — gate the
             whole form (the wizard's hint pattern); the wallet switcher is
             the remedy. Node-mode Core wallets are never gated here. -->
        <div class="card empty-card">
          <mat-icon class="empty-icon">block</mat-icon>
          <p class="hint-text">{{ gateHintKey() | i18n }}</p>
          <button mat-stroked-button [routerLink]="backTarget">
            <mat-icon>arrow_back</mat-icon>
            {{ 'back' | i18n }}
          </button>
        </div>
      } @else {
        <!-- Everything in ONE card: selector + status + matching action -->
        <div class="card">
          @if (walletAddresses().length === 0) {
            <p class="hint-text">{{ 'mwallet_assignment_no_funded' | i18n }}</p>
          } @else {
            <!-- Send-page-style section label (desktop widths only) -->
            <h3 class="section-label">{{ 'plot_address' | i18n }}</h3>
            <mat-form-field appearance="outline" class="full-width slim-field">
              <mat-label>{{ 'plot_address' | i18n }}</mat-label>
              <mat-select
                [(ngModel)]="plotAddress"
                (ngModelChange)="checkStatus()"
                [disabled]="busy()"
              >
                @for (addr of walletAddresses(); track addr) {
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

                <h3 class="section-label">{{ 'forging_address' | i18n }}</h3>
                <!-- Combo: free text + the configured pools' published
                     forging addresses (sourced from the mining chain
                     configs) -->
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
                  [disabled]="!forgingValid() || busy() || watchOnly()"
                  [matTooltip]="watchOnly() ? ('watch_only' | i18n) : ''"
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
                  [disabled]="busy() || watchOnly()"
                  [matTooltip]="watchOnly() ? ('watch_only' | i18n) : ''"
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

    <!-- Fee section — the app's reference fee selector (assignment style) -->
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
                <!-- Break amount / unit — both don't fit the chip width. -->
                <span class="fee-rate">{{ option.feeRate | number: '1.3-3' }}<br />sat/vB</span>
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
              appDecimal
              inputmode="decimal"
              [(ngModel)]="customFeeRate"
              (ngModelChange)="onCustomFeeChange()"
              autocomplete="off"
            />
          </mat-form-field>
        }

        <!-- Live estimate for the assignment tx (the send page's
             .fee-summary treatment) -->
        <div class="fee-summary">
          <span class="fee-summary-label">{{ 'estimated_fee' | i18n }}:</span>
          <span class="fee-summary-value">
            ~{{ estimatedFeeSat() / 100000000 | number: '1.8-8' }} BTCX ({{
              estimatedFeeSat() | number: '1.0-0'
            }}
            sats)
          </span>
        </div>
      </div>
    </ng-template>
  `,
  styles: [
    `
      @use 'breakpoints' as bp;

      /* Base = desktop: a little wider than the phone column, send-page
         content padding. The phone tier below restores the exact original
         mobile geometry. */
      .page {
        padding: 24px 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 600px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
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

      /* Desktop rhythm — matches the send page's label/field spacing: the
         field keeps a little subscript air and sections separate clearly.
         The phone tier re-compresses below. */
      .slim-field {
        margin-bottom: 0;
      }

      .section-divider {
        margin: 18px 0;
      }

      /* Send-page section label (uppercase mini-header above the input
         group) — desktop widths only; hidden at the phone tier. */
      .section-label {
        font-size: 13px;
        font-weight: 600;
        color: rgb(0, 35, 65);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 4px 0 8px;
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

      /* Pool entries of the forging-address combo. */
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

      /* Fee section — the app's reference fee selector. The FEE title is a
         section label on desktop widths; the phone tier restores the
         original mobile mini-header. */
      .fee-section {
        margin: 12px 0 4px;
      }

      .fee-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;

        .fee-title {
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: rgb(0, 35, 65);
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
            text-align: center;
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

      /* Live fee line (the send page's .fee-summary, mobile-sized). */
      .fee-summary {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        margin-top: 10px;

        .fee-summary-label {
          color: rgba(0, 0, 0, 0.6);
          flex-shrink: 0;
        }

        .fee-summary-value {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
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

        .section-label {
          color: #ffffff;
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
          color: #ffffff;
        }

        .fee-summary .fee-summary-label {
          color: rgba(255, 255, 255, 0.6);
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

      /* Phone tier: the ORIGINAL mobile look, unchanged — narrow column,
         no section labels, the slim FEE mini-header. */
      @include bp.phone {
        .page {
          padding: 16px;
          max-width: 480px;
        }

        .section-label {
          display: none;
        }

        /* Phone re-compresses to the exact mobile rhythm. */
        .slim-field {
          margin-bottom: -8px;
        }

        .section-divider {
          margin: 12px 0;
        }

        .fee-header .fee-title {
          font-size: 11px;
          letter-spacing: 0.4px;
          color: rgba(0, 0, 0, 0.5);
        }

        :host-context(.dark-theme) .fee-header .fee-title {
          color: rgba(255, 255, 255, 0.5);
        }
      }
    `,
  ],
})
export class ForgingAssignmentComponent implements OnInit, OnDestroy {
  readonly wallet = inject(BtcxWalletService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);

  /** Watch-only Core wallet: no private keys, so create/revoke are disabled
   *  (send is nav-hidden for these wallets; assignment stays viewable). */
  readonly watchOnly = computed(() => this.walletService.activeWatchOnly());
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly miningRpc = inject(MiningRpcService);
  private readonly nodeService = inject(NodeService);
  private readonly appMode = inject(AppModeService);
  private readonly mining = inject(MiningService);
  private readonly contactsStore = inject(ContactsStoreService);
  private readonly i18n = inject(I18nService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly store = inject(Store);

  /** Remote (Electrum) mode: assignments run client-side, no node RPC. */
  readonly isRemote = this.nodeService.isRemote;

  /** Shell-aware back/exit target (desktop dashboard or mobile home). */
  readonly backTarget = this.appMode.pageRoute('/dashboard');

  private readonly destroy$ = new Subject<void>();

  /**
   * Wallet addresses offered as plot addresses. Remote mode: addresses
   * holding a spendable coin (assignment prerequisite — the assignment tx
   * spends a coin on the plot address). Node mode: the Core wallet's
   * SegWit-v0 receiving addresses via the node's label registry.
   */
  readonly walletAddresses = signal<string[]>([]);
  readonly status = signal<AssignmentStatus | null>(null);
  readonly statusLoading = signal(false);
  readonly statusError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly forgingValid = signal(false);
  readonly forgingError = signal<{ key: string; params?: Record<string, string> } | null>(null);

  private readonly storeNetwork = toSignal(this.store.select(selectNetwork), {
    initialValue: 'mainnet' as Network,
  });

  /** App network for validation/contacts, from the mode's source of truth. */
  readonly network = computed<Network>(() =>
    this.isRemote() ? this.wallet.network() : this.storeNetwork()
  );

  readonly contacts = computed(() => this.contactsStore.forNetwork(this.network()));

  /** Remote mode without an open local wallet: the whole page is gated. */
  readonly walletGateClosed = computed(() => this.isRemote() && !this.wallet.walletActive());

  /**
   * Remote mode with a NON-SEGWIT btcx wallet — taproot (BIP-86) or
   * imported legacy (pkh / sh-wpkh) descriptors: a plot address is a
   * 20-byte segwit-v0 witness program, so neither can ever own one (the
   * setup wizard's gate, applied to assignments). Node-mode Core wallets
   * are never gated here.
   */
  readonly walletNotSegwit = computed(() => {
    const kind = this.wallet.descriptorPolicy()?.kind;
    return this.isRemote() && !!kind && kind !== 'bip84';
  });

  /** The gate's explanation, matched to the wallet's actual script class. */
  readonly gateHintKey = computed(() =>
    this.wallet.descriptorPolicy()?.kind === 'legacy'
      ? 'assignment_legacy_hint'
      : 'assignment_taproot_hint'
  );

  /**
   * Forging addresses published by the configured pool chains, offered in
   * the forging-address combo via the shared helper: persisted
   * ChainConfig.poolAddresses first, falling back to the predefined-pool
   * registry (endpoint match) for configs that predate the field.
   * Free-text entry remains available.
   */
  readonly poolAddressOptions = computed<PoolAddressOption[]>(() =>
    poolAddressOptionsForChains(this.mining.config()?.chains)
  );

  plotAddress = '';
  forgingAddress = '';

  // Fee estimation — the app's reference fee selector (same options, same
  // defaulting: normal when estimates load, custom otherwise). Remote mode
  // uses the Electrum fee estimates; node mode uses estimatesmartfee per
  // preset (the `blocks` targets).
  readonly isLoadingFees = signal(false);
  customFeeRate: number | null = 1;
  feeOptions: FeeOption[] = [
    { label: 'fee_slow', blocks: 144, feeRate: null },
    { label: 'fee_normal', blocks: 6, feeRate: null },
    { label: 'fee_fast', blocks: 1, feeRate: null },
    { label: 'fee_custom', blocks: 6, feeRate: null },
  ];
  selectedFeeOption: FeeOption | null = null;

  ngOnInit(): void {
    this.contactsStore.load();
    // Load the mining state so the pool combobox sees the chain configs.
    void this.mining.getState().catch(err => {
      console.warn('Failed to load mining state for pool addresses:', err);
    });
    void this.init();

    // Reload on wallet switch — the manager is the one wallet-identity
    // source for every shell (fed by the btcx bridge in the nodeless one).
    this.walletManager.activeWallet$
      .pipe(skip(1), takeUntil(this.destroy$))
      .subscribe(() => this.onWalletChanged());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async init(): Promise<void> {
    if (this.isRemote()) {
      await this.wallet.initialize();
      if (!this.wallet.walletActive()) return;
    }
    void this.loadFeeEstimates();
    await this.loadWalletAddresses();
  }

  private onWalletChanged(): void {
    this.status.set(null);
    this.statusError.set(null);
    this.plotAddress = '';
    this.forgingAddress = '';
    this.forgingValid.set(false);
    this.forgingError.set(null);
    this.walletAddresses.set([]);
    if (this.isRemote() && !this.wallet.walletActive()) return;
    void this.loadFeeEstimates();
    void this.loadWalletAddresses();
  }

  private async loadWalletAddresses(): Promise<void> {
    try {
      let addresses: string[];
      if (this.isRemote()) {
        // Funded wallet addresses — non-change first, then change, deduped;
        // the current receive address leads regardless of funding (a fresh
        // wallet always has something to select).
        const utxos = await this.wallet.utxos();
        const sorted = [...utxos].sort((a, b) => Number(a.isChange) - Number(b.isChange));
        addresses = [];
        try {
          const current = await this.wallet.currentAddress();
          if (current) addresses.push(current);
        } catch {
          // no current address (e.g. spend-only) — funded list only
        }
        for (const utxo of sorted) {
          if (utxo.address && !addresses.includes(utxo.address)) {
            addresses.push(utxo.address);
          }
        }
      } else {
        const walletName = this.walletManager.activeWallet;
        if (!walletName) return;
        // FUNDED addresses via listunspent — matching the remote path's
        // semantics (the plot address must hold a coin anyway) and, unlike
        // the address book, rescan-discovered funds of a REIMPORTED
        // descriptor wallet show up here. SegWit v0 only — the node's
        // assignment RPCs reject everything else.
        const utxos = await this.walletRpc.listUnspent(walletName);
        const seen = new Set<string>();
        addresses = [];
        // The FIRST derivation of every external receive chain leads the
        // list regardless of funding (plots typically bind to it; a fresh
        // wallet always has something to select) — active current-coin-type
        // chain first, then legacy restore chains.
        try {
          const { descriptors } = await this.walletRpc.listDescriptors(walletName);
          const sorted = [...descriptors].sort(
            (a, b) => Number(b.active ?? false) - Number(a.active ?? false)
          );
          for (const d of sorted) {
            if (d.internal || !d.desc.startsWith('wpkh(')) continue;
            const derived = await this.walletRpc.deriveAddresses(d.desc, [0, 0]);
            const first = derived[0];
            if (
              first &&
              !seen.has(first) &&
              /^(bc1q|tb1q|pocx1q|tpocx1q)[a-z0-9]{38,}$/i.test(first)
            ) {
              seen.add(first);
              addresses.push(first);
            }
          }
        } catch {
          // pre-descriptor wallet — funded list below is all there is
        }
        for (const utxo of utxos) {
          if (
            utxo.address &&
            !seen.has(utxo.address) &&
            /^(bc1q|tb1q|pocx1q|tpocx1q)[a-z0-9]{38,}$/i.test(utxo.address)
          ) {
            seen.add(utxo.address);
            addresses.push(utxo.address);
          }
        }
      }
      this.walletAddresses.set(addresses);
      if (!this.plotAddress && addresses.length > 0) {
        this.plotAddress = addresses[0];
        await this.checkStatus();
      }
    } catch (err) {
      console.error('Failed to load wallet addresses:', err);
    }
  }

  /** Same estimates + rounding + defaulting as the send-page fee section. */
  async loadFeeEstimates(): Promise<void> {
    if (this.isLoadingFees()) return;
    this.isLoadingFees.set(true);
    try {
      if (this.isRemote()) {
        const estimates = await this.wallet.fetchFeeEstimates();
        const byLabel: Record<string, number | null | undefined> = {
          fee_slow: estimates.slow,
          fee_normal: estimates.normal,
          fee_fast: estimates.fast,
        };
        for (const option of this.feeOptions) {
          if (option.label === 'fee_custom') continue;
          const rate = byLabel[option.label];
          // floor stays (hard-coded 1); apply it at 0.001 resolution, no integer rounding
          option.feeRate = rate != null ? Math.max(1, Math.round(rate * 1000) / 1000) : null;
        }
      } else {
        for (const option of this.feeOptions) {
          if (option.label === 'fee_custom') continue;
          const result = await this.blockchainRpc.estimateSmartFee(option.blocks);
          if (result.feerate) {
            // feerate is in BTC/kvB, convert to sat/vB (0.001 resolution)
            option.feeRate = Math.round(result.feerate * 100000000) / 1000;
          }
        }
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

  /** Live fee preview for the assignment tx, sats (rate × assumed vsize). */
  estimatedFeeSat(): number {
    return Math.ceil((this.getSelectedFeeRate() ?? 1) * ASSIGNMENT_PREVIEW_VSIZE_VB);
  }

  async checkStatus(): Promise<void> {
    const address = this.plotAddress;
    if (!address || this.statusLoading()) return;
    this.statusLoading.set(true);
    this.statusError.set(null);
    this.status.set(null);
    try {
      // Identical DTOs from both backends: the node's `get_assignment` RPC
      // or the client-side Electrum script-history derivation.
      const status = this.isRemote()
        ? ((await this.wallet.getAssignment(address)) as AssignmentStatus)
        : await this.miningRpc.getAssignmentStatus(address);
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

  /** Rules enforced by both backends: segwit v0, right network, ≠ plot. */
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
        if (result.network !== this.network()) {
          this.forgingError.set({
            key: 'address_wrong_network',
            params: {
              addressNetwork: this.i18n.get(result.network),
              appNetwork: this.i18n.get(this.network()),
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

  /**
   * Encrypted-wallet unlock, per mode (the unified send page's flow):
   * remote checks the local seed lock, node mode the Core wallet's
   * `unlocked_until`. Prompts with the shared passphrase dialog.
   */
  private async ensureWalletUnlocked(walletName: string): Promise<boolean> {
    if (this.isRemote()) {
      // Local wallet: only a passphrase-encrypted seed can be locked.
      const status = await this.wallet.refreshStatus();
      if (status?.seed !== 'locked') return true;
      const dialogRef = this.dialog.open(PassphraseDialogComponent, {
        width: '400px',
        data: { walletName, timeout: 60 },
      });
      const result: PassphraseDialogResult | null = await dialogRef.afterClosed().toPromise();
      if (!result) return false; // user cancelled
      await this.wallet.unlock(result.passphrase);
      return true;
    }

    const info = await this.walletRpc.getWalletInfo(walletName);
    if (info.unlocked_until === undefined || info.unlocked_until > 0) {
      return true; // not encrypted, or already unlocked
    }
    const dialogRef = this.dialog.open(PassphraseDialogComponent, {
      width: '400px',
      data: { walletName, timeout: 60 },
    });
    const result: PassphraseDialogResult | null = await dialogRef.afterClosed().toPromise();
    if (!result) return false; // user cancelled
    await this.walletRpc.walletPassphrase(walletName, result.passphrase, result.timeout);
    return true;
  }

  async create(): Promise<void> {
    if (!this.forgingValid() || this.busy()) return;
    const walletName = this.walletManager.activeWallet;
    if (!walletName) {
      this.notifications.error(this.i18n.get('no_wallet_selected'));
      return;
    }
    this.busy.set(true);
    try {
      if (!(await this.ensureWalletUnlocked(walletName))) {
        return;
      }
      const feeRate = this.getSelectedFeeRate();
      if (this.isRemote()) {
        await this.wallet.createAssignment(this.plotAddress, this.forgingAddress.trim(), feeRate);
      } else {
        await this.miningRpc.createForgingAssignment(
          walletName,
          this.plotAddress,
          this.forgingAddress.trim(),
          feeRate
        );
      }
      this.notifications.success(this.i18n.get('assignment_created_success'));
      this.walletService.refresh();
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
    const walletName = this.walletManager.activeWallet;
    if (!walletName) {
      this.notifications.error(this.i18n.get('no_wallet_selected'));
      return;
    }
    this.busy.set(true);
    try {
      if (!(await this.ensureWalletUnlocked(walletName))) {
        return;
      }
      const feeRate = this.getSelectedFeeRate();
      if (this.isRemote()) {
        await this.wallet.revokeAssignment(this.plotAddress, feeRate);
      } else {
        await this.miningRpc.revokeForgingAssignment(walletName, this.plotAddress, feeRate);
      }
      this.notifications.success(this.i18n.get('revocation_created_success'));
      this.walletService.refresh();
      await this.checkStatus();
    } catch (err) {
      this.notifications.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }
}
