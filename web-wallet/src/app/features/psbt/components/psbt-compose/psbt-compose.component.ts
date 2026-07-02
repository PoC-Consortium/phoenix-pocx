import { Component, inject, signal, computed, output, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import { WalletRpcService, UTXO } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { validatePocxAddress } from '../../../../bitcoin/utils/address-validation';
import { selectNetwork } from '../../../../store/settings/settings.selectors';
import type { ComposeOutput } from '../../psbt.models';

interface FeeChip {
  labelKey: string;
  blocks: number;
  rate: number | null;
  custom: boolean;
}

interface Contact {
  id: string;
  name: string;
  address: string;
  createdAt: number;
}

const UTXO_PAGE_SIZE = 10;

/**
 * PSBT compose form — hand-roll a transaction with full control:
 * manual or automatic coin selection, arbitrary outputs, OP_RETURN data,
 * explicit fee rate, RBF and locktime. Funding and change are delegated to
 * walletcreatefundedpsbt; nothing is signed here.
 *
 * The summary at the bottom shows live estimates; the exact fee is fixed
 * when the PSBT is created (fee is paid on top of the output amounts,
 * unless an output was filled with Max — then it is subtracted there).
 */
@Component({
  selector: 'app-psbt-compose',
  standalone: true,
  imports: [
    FormsModule,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
    I18nPipe,
  ],
  template: `
    <div class="compose-wrap">
      <div class="compose-card">
        <!-- Coins to spend -->
        <div class="form-section">
          <div class="section-head">
            <h3 class="section-title">{{ 'psbt_coins_to_spend' | i18n }}</h3>
            <div class="segmented">
              <button [class.on]="!manualCoins()" (click)="setManualCoins(false)">
                <mat-icon>auto_awesome</mat-icon>
                {{ 'psbt_coins_automatic' | i18n }}
              </button>
              <button [class.on]="manualCoins()" (click)="setManualCoins(true)">
                <mat-icon>tune</mat-icon>
                {{ 'psbt_coins_manual' | i18n }}
              </button>
            </div>
          </div>

          @if (manualCoins()) {
            @if (loadingUtxos()) {
              <div class="loading-row"><mat-spinner diameter="24"></mat-spinner></div>
            } @else if (utxos().length === 0) {
              <div class="empty-hint">{{ 'psbt_no_utxos' | i18n }}</div>
            } @else {
              <!-- Filter: address/txid text + amount threshold -->
              <div class="filter-row">
                <mat-form-field appearance="outline" class="grow-field">
                  <mat-label>{{ 'psbt_filter_address' | i18n }}</mat-label>
                  <input
                    matInput
                    [ngModel]="utxoFilterText()"
                    (ngModelChange)="setUtxoFilterText($event)"
                    spellcheck="false"
                    class="mono"
                  />
                  <mat-icon matSuffix class="search-icon">search</mat-icon>
                </mat-form-field>
                <button
                  mat-stroked-button
                  class="square-button op-button"
                  (click)="toggleSizeOp()"
                  [matTooltip]="'psbt_filter_size_toggle' | i18n"
                >
                  {{ sizeOp() === 'gt' ? '&gt;' : '&lt;' }}
                </button>
                <mat-form-field appearance="outline" class="size-field">
                  <mat-label>{{ 'amount' | i18n }}</mat-label>
                  <input
                    matInput
                    type="number"
                    min="0"
                    step="0.00000001"
                    [ngModel]="sizeValue()"
                    (ngModelChange)="setSizeValue($event)"
                    autocomplete="off"
                  />
                </mat-form-field>
              </div>
              @if (filteredUtxos().length === 0) {
                <div class="empty-hint">{{ 'psbt_filter_no_match' | i18n }}</div>
              }
              @for (utxo of pagedUtxos(); track utxo.txid + utxo.vout) {
                <div
                  class="utxo-row"
                  [class.selected]="isSelected(utxo)"
                  (click)="toggleUtxo(utxo)"
                  (keydown.enter)="toggleUtxo(utxo)"
                  tabindex="0"
                  role="checkbox"
                  [attr.aria-checked]="isSelected(utxo)"
                >
                  <div class="checkbox" [class.checked]="isSelected(utxo)">
                    @if (isSelected(utxo)) {
                      <mat-icon>check</mat-icon>
                    }
                  </div>
                  <div class="utxo-main">
                    <div class="utxo-addr mono">{{ utxo.address }}</div>
                    <div class="utxo-meta mono">
                      {{ utxo.txid }}:{{ utxo.vout }} ·
                      {{ utxo.confirmations }} {{ 'psbt_confirmations' | i18n }}
                    </div>
                  </div>
                  <div class="utxo-amount mono">{{ utxo.amount | number: '1.8-8' }}</div>
                </div>
              }
              <div class="utxo-pager">
                <span class="selection-summary">
                  {{ 'psbt_selected' | i18n }}
                  <b class="mono">{{ selectedTotal() | number: '1.8-8' }}</b>
                  ({{ selectedOutpoints().size }})
                </span>
                <span class="pager-controls">
                  <button
                    mat-icon-button
                    [disabled]="utxoPage() === 0"
                    (click)="utxoPage.set(utxoPage() - 1)"
                  >
                    <mat-icon>chevron_left</mat-icon>
                  </button>
                  <span class="pager-range mono">{{ utxoRangeLabel() }}</span>
                  <button
                    mat-icon-button
                    [disabled]="(utxoPage() + 1) * pageSize >= filteredUtxos().length"
                    (click)="utxoPage.set(utxoPage() + 1)"
                  >
                    <mat-icon>chevron_right</mat-icon>
                  </button>
                </span>
              </div>
            }
          } @else {
            <div class="empty-hint">{{ 'psbt_coins_auto_hint' | i18n }}</div>
          }
        </div>

        <!-- Outputs -->
        <div class="form-section">
          <div class="section-head">
            <h3 class="section-title">{{ 'psbt_outputs' | i18n }}</h3>
            <span class="section-aside">{{ 'psbt_amounts_in_btcx' | i18n }}</span>
          </div>

          @for (out of outputs(); track $index) {
            <div class="output-row">
              <mat-form-field appearance="outline" class="addr-field">
                <mat-label>{{ 'psbt_recipient_address' | i18n }}</mat-label>
                <input
                  matInput
                  [ngModel]="out.address"
                  (ngModelChange)="updateOutput($index, 'address', $event)"
                  autocomplete="off"
                  spellcheck="false"
                  class="mono"
                />
                @if (out.address && addressError($index)) {
                  <mat-icon matSuffix class="invalid-icon" [matTooltip]="addressError($index)!"
                    >error</mat-icon
                  >
                } @else if (out.address) {
                  <mat-icon matSuffix class="valid-icon">check_circle</mat-icon>
                }
              </mat-form-field>
              <button
                mat-stroked-button
                class="square-button"
                [matMenuTriggerFor]="contactsMenu"
                [disabled]="contacts().length === 0"
                [matTooltip]="'select_contact' | i18n"
                (click)="contactTargetIndex = $index"
              >
                <mat-icon>contacts</mat-icon>
              </button>
              <mat-form-field appearance="outline" class="amount-field">
                <mat-label>{{ 'amount' | i18n }}</mat-label>
                <input
                  matInput
                  type="number"
                  step="0.00000001"
                  min="0"
                  [ngModel]="out.amount"
                  (ngModelChange)="updateOutput($index, 'amount', $event)"
                  autocomplete="off"
                />
              </mat-form-field>
              <button
                mat-stroked-button
                class="square-button"
                (click)="setMaxAmount($index)"
                [matTooltip]="'use_all_funds' | i18n"
              >
                <mat-icon>all_inclusive</mat-icon>
              </button>
              <button
                mat-stroked-button
                class="square-button"
                (click)="removeOutput($index)"
                [disabled]="outputs().length === 1"
                [matTooltip]="'psbt_remove_output' | i18n"
              >
                <mat-icon>close</mat-icon>
              </button>
            </div>
            @if (subtractFeeIndex() === $index) {
              <div class="subtract-note">
                <mat-icon>info</mat-icon>
                {{ 'psbt_subtract_fee_note' | i18n }}
              </div>
            }
          }

          <mat-menu #contactsMenu="matMenu">
            @for (contact of contacts(); track contact.address) {
              <button mat-menu-item (click)="selectContact(contact)">
                <mat-icon>person</mat-icon>
                <span class="contact-menu-item">
                  <span class="contact-name">{{ contact.name }}</span>
                  <small class="contact-address">{{ contact.address }}</small>
                </span>
              </button>
            }
          </mat-menu>

          <div class="add-row">
            <button mat-stroked-button class="add-button" (click)="addOutput()">
              <mat-icon>add_circle_outline</mat-icon>
              {{ 'psbt_add_output' | i18n }}
            </button>
            <button
              mat-stroked-button
              class="add-button"
              (click)="showListImport.set(!showListImport())"
            >
              <mat-icon>playlist_add</mat-icon>
              {{ 'psbt_import_list' | i18n }}
            </button>
            @if (!showData()) {
              <button mat-stroked-button class="add-button" (click)="showData.set(true)">
                <mat-icon>data_object</mat-icon>
                {{ 'psbt_add_data' | i18n }}
              </button>
            }
          </div>

          @if (showListImport()) {
            <div class="list-import">
              <mat-form-field appearance="outline" class="grow-field">
                <mat-label>{{ 'psbt_import_list_hint' | i18n }}</mat-label>
                <textarea
                  matInput
                  rows="5"
                  [(ngModel)]="listImportText"
                  spellcheck="false"
                  class="mono"
                  placeholder="pocx1q…, 0.50000000"
                ></textarea>
              </mat-form-field>
              <div class="list-import-actions">
                <button mat-stroked-button (click)="showListImport.set(false)">
                  {{ 'cancel' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!listImportText.trim()"
                  (click)="applyListImport()"
                >
                  <mat-icon>playlist_add_check</mat-icon>
                  {{ 'psbt_import_list_apply' | i18n }}
                </button>
              </div>
            </div>
          }

          @if (showData()) {
            <div class="output-row data-row">
              <mat-form-field appearance="outline" class="addr-field">
                <mat-label>{{ 'psbt_data_hex' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="dataHex"
                  autocomplete="off"
                  spellcheck="false"
                  class="mono"
                  placeholder="deadbeef"
                />
                @if (dataHex && dataHexError()) {
                  <mat-hint class="error-hint">{{ dataHexError() }}</mat-hint>
                }
              </mat-form-field>
              <button
                mat-stroked-button
                class="square-button"
                (click)="showData.set(false); dataHex = ''"
                [matTooltip]="'psbt_remove_output' | i18n"
              >
                <mat-icon>close</mat-icon>
              </button>
            </div>
          }

          <div class="change-row">
            <div class="option-info">
              <span class="option-label">{{ 'psbt_change_auto' | i18n }}</span>
              <span class="option-hint">{{ 'psbt_change_auto_hint' | i18n }}</span>
            </div>
            <mat-slide-toggle
              [checked]="autoChange()"
              (change)="onAutoChangeToggle($event.checked)"
            >
            </mat-slide-toggle>
          </div>
          @if (!autoChange()) {
            <div class="field-row">
              <mat-form-field appearance="outline" class="grow-field change-field">
                <mat-label>{{ 'psbt_change_address' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="changeAddress"
                  autocomplete="off"
                  spellcheck="false"
                  class="mono"
                />
              </mat-form-field>
              <button
                mat-stroked-button
                class="square-button change-pick-button"
                [matMenuTriggerFor]="changeAddrMenu"
                [disabled]="receiveAddresses().length === 0"
                [matTooltip]="'psbt_pick_change_address' | i18n"
              >
                <mat-icon>format_list_bulleted</mat-icon>
              </button>
              <mat-menu #changeAddrMenu="matMenu">
                @for (address of receiveAddresses(); track address) {
                  <button mat-menu-item (click)="changeAddress = address">
                    <span class="mono change-addr-item">{{ address }}</span>
                  </button>
                }
              </mat-menu>
            </div>
          }
        </div>

        <!-- Fee -->
        <div class="form-section">
          <div class="section-head">
            <h3 class="section-title">{{ 'fee' | i18n }}</h3>
            <button
              mat-icon-button
              class="refresh-button"
              (click)="loadFeeEstimates()"
              [disabled]="loadingFees()"
              [matTooltip]="'refresh_fees' | i18n"
            >
              <mat-icon [class.spinning]="loadingFees()">refresh</mat-icon>
            </button>
          </div>
          <div class="fee-chips">
            @for (chip of feeChips; track chip.labelKey) {
              <button
                class="fee-chip"
                [class.on]="selectedFee === chip"
                [disabled]="!chip.custom && chip.rate === null"
                (click)="selectFee(chip)"
              >
                <b>{{ chip.labelKey | i18n }}</b>
                @if (chip.custom) {
                  <span><mat-icon class="tune-icon">tune</mat-icon></span>
                } @else {
                  <span>{{ chip.rate !== null ? (chip.rate | number: '1.0-1') + ' sat/vB' : '--' }}</span>
                }
              </button>
            }
          </div>
          @if (selectedFee?.custom) {
            <mat-form-field appearance="outline" class="custom-fee-field">
              <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
              <input matInput type="number" min="0.1" step="0.1" [(ngModel)]="customFeeRate" />
            </mat-form-field>
          }
        </div>

        <!-- Options -->
        <div class="form-section">
          <div class="section-head">
            <h3 class="section-title">{{ 'options' | i18n }}</h3>
          </div>
          <div class="option-row">
            <div class="option-info">
              <span class="option-label">{{ 'replace_by_fee' | i18n }}</span>
              <span class="option-hint">{{ 'rbf_hint' | i18n }}</span>
            </div>
            <mat-slide-toggle [checked]="rbf()" (change)="rbf.set($event.checked)">
            </mat-slide-toggle>
          </div>
          <div class="option-row">
            <div class="option-info">
              <span class="option-label">{{ 'psbt_locktime' | i18n }}</span>
              <span class="option-hint">{{ 'psbt_locktime_hint' | i18n }}</span>
            </div>
            <mat-slide-toggle [checked]="useLocktime()" (change)="useLocktime.set($event.checked)">
            </mat-slide-toggle>
          </div>
          @if (useLocktime()) {
            <mat-form-field appearance="outline" class="locktime-field">
              <mat-label>{{ 'psbt_locktime_height' | i18n }}</mat-label>
              <input matInput type="number" min="0" step="1" [(ngModel)]="locktime" />
            </mat-form-field>
          }
        </div>

        <!-- Live summary -->
        <div class="form-section summary-section">
          <h3 class="section-title">{{ 'summary' | i18n }}</h3>
          <div class="summary-grid">
            <div class="summary-row">
              <span class="summary-label">{{ 'psbt_sending' | i18n }}:</span>
              <span class="summary-value mono"
                >{{ sendingTotal() | number: '1.8-8' }} BTCX</span
              >
            </div>
            <div class="summary-row">
              <span class="summary-label">{{ 'estimated_fee' | i18n }}:</span>
              <span class="summary-value mono">
                @if (estimatedFee() !== null) {
                  ≈ {{ estimatedFee() | number: '1.8-8' }} BTCX
                } @else {
                  —
                }
              </span>
            </div>
            <div class="summary-row">
              <span class="summary-label">{{ 'psbt_change' | i18n }}:</span>
              <span class="summary-value mono">
                @if (estimatedChange() !== null) {
                  ≈ {{ estimatedChange() | number: '1.8-8' }} BTCX
                } @else {
                  —
                }
              </span>
            </div>
            <mat-divider></mat-divider>
            <div class="summary-row total">
              <span class="summary-label">{{ 'total' | i18n }}:</span>
              <span class="summary-value mono" [class.error]="insufficientFunds()">
                {{ totalWithFee() | number: '1.8-8' }} BTCX
              </span>
            </div>
          </div>
          <div class="summary-note">{{ 'psbt_fee_note' | i18n }}</div>
          @if (insufficientFunds()) {
            <div class="balance-warning">
              <mat-icon>warning</mat-icon>
              <span>{{ 'insufficient_balance' | i18n }}</span>
            </div>
          }
        </div>

        @if (createError()) {
          <div class="error-banner">
            <mat-icon>error</mat-icon>
            <span>{{ createError() }}</span>
          </div>
        }

        <!-- Actions -->
        <div class="actions-row">
          <button mat-stroked-button (click)="cancelled.emit()">
            <mat-icon>arrow_back</mat-icon>
            {{ 'psbt_back' | i18n }}
          </button>
          <span class="spacer"></span>
          <button
            mat-raised-button
            color="primary"
            [disabled]="!canCreate() || creating()"
            (click)="create()"
          >
            @if (creating()) {
              <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
            } @else {
              <mat-icon>arrow_forward</mat-icon>
            }
            {{ 'psbt_create_and_review' | i18n }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      // Single-column layout, full width of the page container
      // (shared with the start and review steps)
      .compose-wrap {
        display: flex;
        justify-content: center;
      }

      .compose-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        width: 100%;
        padding: 16px 20px;
      }

      .form-section {
        margin-bottom: 14px;
      }

      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        gap: 12px;
      }

      .section-title {
        font-size: 13px;
        font-weight: 600;
        color: rgb(0, 35, 65);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0;
      }

      .section-aside {
        font-size: 11.5px;
        color: #6b7787;
      }

      // Segmented control
      .segmented {
        display: inline-flex;
        background: #f5f7fa;
        border-radius: 8px;
        padding: 3px;
        gap: 3px;

        button {
          border: 0;
          background: transparent;
          cursor: pointer;
          padding: 5px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #6b7787;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: inherit;

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }

          &.on {
            background: #fff;
            color: #1976d2;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
          }
        }
      }

      // UTXO rows
      .utxo-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border: 1px solid #e6ebf1;
        border-radius: 6px;
        margin-bottom: 6px;
        cursor: pointer;

        &.selected {
          border-color: #1976d2;
          background: rgba(25, 118, 210, 0.04);
        }

        .checkbox {
          width: 18px;
          height: 18px;
          border-radius: 4px;
          border: 2px solid #cdd6e0;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;

          &.checked {
            background: #1976d2;
            border-color: #1976d2;
          }

          mat-icon {
            font-size: 14px;
            width: 14px;
            height: 14px;
            color: #fff;
          }
        }

        .utxo-main {
          flex: 1;
          min-width: 0;
        }

        .utxo-addr {
          font-size: 12px;
          color: rgb(0, 35, 65);
          word-break: break-all;
        }

        .utxo-meta {
          font-size: 10.5px;
          color: #6b7787;
          word-break: break-all;
        }

        .utxo-amount {
          font-size: 12px;
          font-weight: 600;
          color: rgb(0, 35, 65);
        }
      }

      .filter-row {
        display: flex;
        gap: 6px;
        align-items: flex-start;
        margin-bottom: 8px;

        .grow-field {
          flex: 1;
          min-width: 0;

          input {
            font-size: 12px;
          }
        }

        .size-field {
          width: 170px;
          flex-shrink: 0;
        }

        .search-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #9aa7b5;
        }

        .op-button {
          font-family: 'Roboto Mono', monospace;
          font-size: 15px;
          font-weight: 600;
          color: #1976d2;
        }
      }

      .utxo-pager {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-top: 4px;

        .pager-controls {
          display: inline-flex;
          align-items: center;

          button {
            width: 32px;
            height: 32px;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        }

        .pager-range {
          font-size: 11px;
          color: #6b7787;
        }
      }

      .selection-summary {
        font-size: 12px;
        color: #6b7787;

        b {
          color: rgb(0, 35, 65);
        }
      }

      .loading-row {
        display: flex;
        justify-content: center;
        padding: 16px;
      }

      .empty-hint {
        font-size: 12.5px;
        color: #6b7787;
        padding: 4px 0;
      }

      .field-row {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin-bottom: 8px;

        .grow-field {
          flex: 1;
          min-width: 0;
        }
      }

      .list-import {
        margin-top: 8px;

        .grow-field {
          width: 100%;
        }

        textarea {
          font-family: 'Roboto Mono', monospace;
          font-size: 12px;
        }

        .list-import-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 4px;
        }
      }

      .change-addr-item {
        font-size: 12px;
        max-width: 420px;
        overflow: hidden;
        text-overflow: ellipsis;
        display: inline-block;
      }

      // Single-line output rows — every control exactly 40px tall,
      // aligned like the send page's recipient/amount rows
      .output-row {
        display: flex;
        gap: 6px;
        align-items: flex-start;

        .addr-field {
          flex: 1;
          min-width: 0;
        }

        .amount-field {
          width: 210px;
          flex-shrink: 0;
        }
      }

      .square-button {
        height: 36px;
        width: 36px;
        min-width: 36px;
        padding: 0;
        border-color: rgba(0, 0, 0, 0.12);
        flex-shrink: 0;

        ::ng-deep .mdc-button__label {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        mat-icon {
          margin: 0;
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #666;
        }

        &:hover:not([disabled]) {
          background: rgba(0, 0, 0, 0.04);

          mat-icon {
            color: #333;
          }
        }
      }

      .subtract-note {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: #1976d2;
        margin: -2px 0 8px 4px;

        mat-icon {
          font-size: 15px;
          width: 15px;
          height: 15px;
        }
      }

      .contact-menu-item {
        display: flex;
        flex-direction: column;
        margin-left: 8px;

        .contact-name {
          font-weight: 500;
        }

        .contact-address {
          font-size: 11px;
          color: #888;
          font-family: 'Roboto Mono', monospace;
          max-width: 250px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      .add-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 4px;

        .add-button {
          height: 36px;
          font-size: 12px;
          color: #1976d2;
          border-color: rgba(25, 118, 210, 0.4);

          mat-icon {
            margin-right: 6px;
            font-size: 18px;
            width: 18px;
            height: 18px;
          }

          &:hover {
            background: rgba(25, 118, 210, 0.06);
            border-color: #1976d2;
          }
        }
      }

      .change-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding-top: 10px;
        margin-top: 6px;
        border-top: 1px solid #f0f0f0;
      }

      .change-field,
      .custom-fee-field,
      .locktime-field {
        margin-top: 8px;
        max-width: 100%;
      }

      .custom-fee-field,
      .locktime-field {
        max-width: 200px;
      }

      .option-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 9px 0;
        border-bottom: 1px solid #f0f0f0;

        &:last-of-type {
          border-bottom: none;
        }
      }

      .option-info {
        display: flex;
        flex-direction: column;
        gap: 2px;

        .option-label {
          font-weight: 500;
          font-size: 13px;
          color: rgb(0, 35, 65);
        }

        .option-hint {
          font-size: 11.5px;
          color: #888;
        }
      }

      // Fee chips
      .fee-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .fee-chip {
        border: 1px solid #e0e0e0;
        background: #fff;
        border-radius: 6px;
        cursor: pointer;
        padding: 6px 10px;
        text-align: center;
        flex: 1;
        min-width: 76px;
        font-family: inherit;

        &.on {
          border-color: #1976d2;
          background: rgba(25, 118, 210, 0.07);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        b {
          display: block;
          font-size: 11px;
          color: rgb(0, 35, 65);
          font-weight: 600;
        }

        span {
          font-family: 'Roboto Mono', monospace;
          font-size: 11px;
          color: #1976d2;
        }

        .tune-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: #666;
        }
      }

      .refresh-button {
        width: 28px;
        height: 28px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: #666;

          &.spinning {
            animation: spin 1s linear infinite;
          }
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      // Summary (mirrors send page)
      .summary-section {
        background: #f9fafb;
        padding: 12px 16px;
        border-radius: 8px;
      }

      .summary-grid {
        .summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px 0;

          .summary-label {
            color: #666;
            font-size: 13px;
          }

          .summary-value {
            font-weight: 500;
            font-size: 13px;
            color: rgb(0, 35, 65);

            &.error {
              color: #f44336;
            }
          }

          &.total {
            padding-top: 8px;

            .summary-label,
            .summary-value {
              font-size: 14px;
              font-weight: 600;
            }
          }
        }

        mat-divider {
          margin: 4px 0;
        }
      }

      .summary-note {
        font-size: 11px;
        color: #888;
        margin-top: 6px;
      }

      .balance-warning {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        padding: 10px 12px;
        background: #fff3e0;
        border-radius: 4px;
        color: #e65100;

        mat-icon {
          font-size: 20px;
          height: 20px;
          width: 20px;
        }

        span {
          font-size: 13px;
          font-weight: 500;
        }
      }

      .valid-icon {
        color: #2e7d32;
      }

      .invalid-icon {
        color: #c62828;
      }

      .error-hint {
        color: #f44336;
      }

      .error-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #ffebee;
        color: #c62828;
        border-radius: 4px;
        margin-bottom: 16px;

        mat-icon {
          flex-shrink: 0;
        }
      }

      .actions-row {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e8e8e8;

        .spacer {
          flex: 1;
        }

        button {
          min-width: 110px;

          mat-icon {
            margin-right: 6px;
          }

          .button-spinner {
            display: inline-block;
            margin-right: 8px;
          }
        }
      }

      .mono {
        font-family: 'Roboto Mono', monospace;
        font-size: 12.5px;
        letter-spacing: -0.3px;
      }

      // Compact form fields (match send page) — must be scoped under
      // .form-section: a bare global selector loses the specificity race
      // against Material's own density rules and never applies
      .form-section {
        ::ng-deep {
          .mat-mdc-form-field-subscript-wrapper {
            min-height: 0;
            height: auto;
          }

          .mat-mdc-form-field-hint-wrapper,
          .mat-mdc-form-field-error-wrapper {
            padding: 0 12px;
          }

          .mat-mdc-text-field-wrapper {
            padding: 0 12px;
          }

          .mat-mdc-form-field-infix {
            min-height: 36px;
            padding-top: 6px;
            padding-bottom: 6px;
          }

          .mdc-floating-label {
            top: 50% !important;
            transform: translateY(-50%) !important;
          }

          .mdc-floating-label--float-above {
            top: 0 !important;
            transform: translateY(-34%) scale(0.75) !important;
          }
        }
      }

      // Dark theme
      :host-context(.dark-theme) {
        .compose-card {
          background: #424242;
        }

        .section-title,
        .option-label,
        .utxo-addr,
        .utxo-amount,
        .summary-value {
          color: #ffffff !important;
        }

        .summary-section {
          background: #333;
        }

        .segmented {
          background: #333;

          button.on {
            background: #555;
          }
        }

        .utxo-row {
          border-color: #555;
        }

        .fee-chip {
          border-color: #555;
          background: transparent;
        }

        .balance-warning {
          background: #4a3000;
        }

        .error-banner {
          background: #4a0000;
          color: #ff8a80;
        }
      }

      // Responsive
      @media (max-width: 600px) {
        .output-row {
          flex-wrap: wrap;

          .addr-field {
            width: 100%;
            flex: unset;
          }

          .amount-field {
            flex: 1;
          }
        }

        .fee-chip {
          min-width: calc(50% - 4px);
        }
      }
    `,
  ],
})
export class PsbtComposeComponent implements OnInit {
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly store = inject(Store);
  readonly network = toSignal(this.store.select(selectNetwork), { initialValue: 'mainnet' });

  /** Emits the funded PSBT (base64) once created */
  readonly created = output<{ psbt: string; fee: number }>();
  readonly cancelled = output<void>();

  readonly pageSize = UTXO_PAGE_SIZE;

  manualCoins = signal(false);
  utxos = signal<UTXO[]>([]);
  utxoPage = signal(0);
  loadingUtxos = signal(false);
  selectedOutpoints = signal<Set<string>>(new Set());

  utxoFilterText = signal('');
  sizeOp = signal<'gt' | 'lt'>('gt');
  sizeValue = signal<number | null>(null);

  outputs = signal<ComposeOutput[]>([{ address: '', amount: null }]);
  /** Output index the fee is subtracted from (set via Max), or null = fee on top */
  subtractFeeIndex = signal<number | null>(null);
  showData = signal(false);
  dataHex = '';

  contacts = signal<Contact[]>([]);
  contactTargetIndex = 0;

  autoChange = signal(true);
  changeAddress = '';
  receiveAddresses = signal<string[]>([]);

  showListImport = signal(false);
  listImportText = '';

  rbf = signal(true);
  useLocktime = signal(false);
  locktime: number | null = null;

  loadingFees = signal(false);
  creating = signal(false);
  createError = signal<string | null>(null);

  feeChips: FeeChip[] = [
    { labelKey: 'fee_slow', blocks: 144, rate: null, custom: false },
    { labelKey: 'fee_normal', blocks: 6, rate: null, custom: false },
    { labelKey: 'fee_fast', blocks: 1, rate: null, custom: false },
    { labelKey: 'fee_custom', blocks: 6, rate: null, custom: true },
  ];
  selectedFee: FeeChip | null = null;
  customFeeRate: number | null = 1;
  /** Bumped on fee selection/edit so computed summaries recalculate */
  private readonly feeVersion = signal(0);

  filteredUtxos = computed(() => {
    const text = this.utxoFilterText().trim().toLowerCase();
    const value = this.sizeValue();
    const op = this.sizeOp();
    return this.utxos().filter(utxo => {
      if (
        text &&
        !utxo.address.toLowerCase().includes(text) &&
        !utxo.txid.toLowerCase().includes(text)
      ) {
        return false;
      }
      if (value !== null && value > 0) {
        if (op === 'gt' ? utxo.amount <= value : utxo.amount >= value) return false;
      }
      return true;
    });
  });

  pagedUtxos = computed(() => {
    const start = this.utxoPage() * UTXO_PAGE_SIZE;
    return this.filteredUtxos().slice(start, start + UTXO_PAGE_SIZE);
  });

  setUtxoFilterText(value: string): void {
    this.utxoFilterText.set(value);
    this.utxoPage.set(0);
  }

  toggleSizeOp(): void {
    this.sizeOp.set(this.sizeOp() === 'gt' ? 'lt' : 'gt');
    this.utxoPage.set(0);
  }

  setSizeValue(value: number | null): void {
    this.sizeValue.set(value);
    this.utxoPage.set(0);
  }

  selectedTotal = computed(() => {
    const selected = this.selectedOutpoints();
    return this.utxos()
      .filter(u => selected.has(`${u.txid}:${u.vout}`))
      .reduce((sum, u) => sum + u.amount, 0);
  });

  /** Funds the transaction can draw from: selected coins, or wallet balance in automatic mode */
  availableFunds = computed(() =>
    this.manualCoins() ? this.selectedTotal() : this.walletService.balance()
  );

  sendingTotal = computed(() =>
    this.outputs().reduce((sum, o) => sum + (o.amount ?? 0), 0)
  );

  /**
   * Rough fee estimate for the summary: rate × estimated vsize
   * (P2WPKH: ~11 + 68/input + 31/output, +1 change output).
   * The exact fee is computed by the node when the PSBT is created.
   */
  estimatedFee = computed<number | null>(() => {
    this.feeVersion();
    const rate = this.effectiveFeeRate();
    if (rate === null || rate <= 0) return null;
    const nIn = this.manualCoins() ? Math.max(1, this.selectedOutpoints().size) : 1;
    const nOut = this.outputs().length + 1 + (this.showData() ? 1 : 0);
    const vsize = 11 + nIn * 68 + nOut * 31;
    return (rate * vsize) / 1e8;
  });

  estimatedChange = computed<number | null>(() => {
    // With automatic selection the node picks the coins, so the change is
    // unknown until the PSBT is created — showing balance minus total here
    // would be misleading
    if (!this.manualCoins()) return null;
    const fee = this.estimatedFee();
    if (fee === null) return null;
    const change = this.availableFunds() - this.totalWithFee();
    return Math.max(0, change);
  });

  totalWithFee = computed(() => {
    const fee = this.estimatedFee() ?? 0;
    // With Max, the fee comes out of that output — total equals the outputs
    if (this.subtractFeeIndex() !== null) return this.sendingTotal();
    return this.sendingTotal() + fee;
  });

  insufficientFunds = computed(
    () => this.sendingTotal() > 0 && this.totalWithFee() > this.availableFunds() + 1e-11
  );

  ngOnInit(): void {
    this.loadFeeEstimates();
    this.loadContacts();
  }

  loadContacts(): void {
    const stored = localStorage.getItem('wallet_contacts');
    if (stored) {
      try {
        const contacts = JSON.parse(stored) as Contact[];
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        this.contacts.set(contacts);
      } catch {
        // Invalid data
      }
    }
  }

  selectContact(contact: Contact): void {
    this.updateOutput(this.contactTargetIndex, 'address', contact.address);
  }

  onAutoChangeToggle(checked: boolean): void {
    this.autoChange.set(checked);
    if (!checked && this.receiveAddresses().length === 0) {
      this.loadReceiveAddresses();
    }
  }

  /** Wallet's known receive addresses for the custom-change picker */
  async loadReceiveAddresses(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;
    try {
      const byLabel = await this.walletRpc.getAddressesByLabel(walletName, '');
      const addresses = Object.entries(byLabel)
        .filter(([, info]) => info.purpose === 'receive')
        .map(([address]) => address);
      this.receiveAddresses.set(addresses.slice(-20).reverse());
    } catch {
      // No addresses under the default label yet
      this.receiveAddresses.set([]);
    }
  }

  /**
   * Bulk-add outputs from pasted text — one per line, "address, amount"
   * (comma, semicolon, tab or space separated).
   */
  applyListImport(): void {
    const lines = this.listImportText.split(/\r?\n/);
    const parsed: ComposeOutput[] = [];
    let invalid = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/[\s,;]+/).filter(Boolean);
      const amount = parts.length >= 2 ? Number(parts[1]) : NaN;
      if (parts.length >= 2 && parts[0] && Number.isFinite(amount) && amount > 0) {
        parsed.push({ address: parts[0], amount });
      } else {
        invalid++;
      }
    }
    if (parsed.length > 0) {
      // Drop pristine empty rows, keep rows the user already filled
      const kept = this.outputs().filter(o => o.address.trim() || o.amount !== null);
      this.outputs.set([...kept, ...parsed]);
      this.subtractFeeIndex.set(null);
      this.showListImport.set(false);
      this.listImportText = '';
    }
    if (invalid > 0) {
      this.notification.warning(
        this.i18n.get('psbt_import_list_invalid', { count: invalid })
      );
    }
  }

  setManualCoins(manual: boolean): void {
    this.manualCoins.set(manual);
    if (manual && this.utxos().length === 0) {
      this.loadUtxos();
    }
  }

  async loadUtxos(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;
    this.loadingUtxos.set(true);
    try {
      const utxos = await this.walletRpc.listUnspent(walletName, 0);
      utxos.sort((a, b) => b.amount - a.amount);
      this.utxos.set(utxos.filter(u => u.spendable));
      this.utxoPage.set(0);
    } catch (error) {
      console.error('Failed to load UTXOs:', error);
      this.notification.error(this.i18n.get('psbt_utxo_load_failed'));
    } finally {
      this.loadingUtxos.set(false);
    }
  }

  utxoRangeLabel(): string {
    const total = this.filteredUtxos().length;
    if (total === 0) return `0 / 0`;
    const start = this.utxoPage() * UTXO_PAGE_SIZE + 1;
    const end = Math.min(total, start + UTXO_PAGE_SIZE - 1);
    return `${start}–${end} / ${total}`;
  }

  async loadFeeEstimates(): Promise<void> {
    this.loadingFees.set(true);
    try {
      for (const chip of this.feeChips) {
        if (chip.custom) continue;
        const result = await this.blockchainRpc.estimateSmartFee(chip.blocks);
        if (result.feerate) {
          // BTC/kvB → sat/vB, one decimal
          chip.rate = Math.round((result.feerate * 1e8) / 100) / 10;
        }
      }
      const hasEstimates = this.feeChips.some(c => !c.custom && c.rate !== null);
      this.selectedFee = hasEstimates ? this.feeChips[1] : this.feeChips[3];
    } catch (error) {
      console.error('Failed to load fee estimates:', error);
      this.selectedFee = this.feeChips[3];
    } finally {
      this.loadingFees.set(false);
      this.feeVersion.update(v => v + 1);
    }
  }

  selectFee(chip: FeeChip): void {
    this.selectedFee = chip;
    this.feeVersion.update(v => v + 1);
  }

  isSelected(utxo: UTXO): boolean {
    return this.selectedOutpoints().has(`${utxo.txid}:${utxo.vout}`);
  }

  toggleUtxo(utxo: UTXO): void {
    const key = `${utxo.txid}:${utxo.vout}`;
    const next = new Set(this.selectedOutpoints());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.selectedOutpoints.set(next);
  }

  updateOutput(index: number, field: 'address' | 'amount', value: string | number | null): void {
    const next = [...this.outputs()];
    next[index] = { ...next[index], [field]: value };
    this.outputs.set(next);
    // Manually edited amount overrides an earlier Max fill
    if (field === 'amount' && this.subtractFeeIndex() === index) {
      this.subtractFeeIndex.set(null);
    }
    this.createError.set(null);
  }

  /**
   * Fill this output with everything left after the other outputs.
   * The network fee is then subtracted from this output on create.
   */
  setMaxAmount(index: number): void {
    const others = this.outputs().reduce(
      (sum, o, i) => (i === index ? sum : sum + (o.amount ?? 0)),
      0
    );
    const remaining = Math.max(0, this.availableFunds() - others);
    const next = [...this.outputs()];
    next[index] = { ...next[index], amount: Math.round(remaining * 1e8) / 1e8 };
    this.outputs.set(next);
    this.subtractFeeIndex.set(index);
  }

  addOutput(): void {
    this.outputs.set([...this.outputs(), { address: '', amount: null }]);
  }

  removeOutput(index: number): void {
    this.outputs.set(this.outputs().filter((_, i) => i !== index));
    const subtract = this.subtractFeeIndex();
    if (subtract !== null) {
      if (subtract === index) this.subtractFeeIndex.set(null);
      else if (subtract > index) this.subtractFeeIndex.set(subtract - 1);
    }
  }

  addressError(index: number): string | null {
    const address = this.outputs()[index]?.address?.trim();
    if (!address) return null;
    const result = validatePocxAddress(address);
    if (result.kind !== 'valid') return this.i18n.get('invalid_address');
    if (result.network !== this.network()) {
      return this.i18n.get('address_wrong_network', {
        addressNetwork: this.i18n.get(result.network),
        appNetwork: this.i18n.get(this.network()),
      });
    }
    return null;
  }

  dataHexError(): string | null {
    const hex = this.dataHex.trim();
    if (!hex) return null;
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
      return this.i18n.get('psbt_data_invalid_hex');
    }
    if (hex.length > 160) {
      return this.i18n.get('psbt_data_too_long');
    }
    return null;
  }

  private effectiveFeeRate(): number | null {
    if (!this.selectedFee) return null;
    return this.selectedFee.custom ? this.customFeeRate : this.selectedFee.rate;
  }

  canCreate(): boolean {
    const outs = this.outputs();
    const validOutputs =
      outs.length > 0 &&
      outs.every(
        (o, i) => o.address.trim() && o.amount !== null && o.amount > 0 && !this.addressError(i)
      );
    const validData = !this.showData() || (this.dataHex.trim() !== '' && !this.dataHexError());
    const feeRate = this.effectiveFeeRate();
    const validFee = feeRate !== null && feeRate > 0;
    const validCoins = !this.manualCoins() || this.selectedOutpoints().size > 0;
    const validLocktime = !this.useLocktime() || (this.locktime !== null && this.locktime >= 0);
    return (
      validOutputs &&
      validData &&
      validFee &&
      validCoins &&
      validLocktime &&
      !this.insufficientFunds()
    );
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.creating()) return;
    const walletName = this.walletManager.activeWallet;
    if (!walletName) {
      this.createError.set(this.i18n.get('psbt_no_wallet'));
      return;
    }

    this.creating.set(true);
    this.createError.set(null);

    try {
      const outputs: Array<Record<string, number | string>> = this.outputs().map(o => ({
        [o.address.trim()]: o.amount as number,
      }));
      if (this.showData() && this.dataHex.trim()) {
        outputs.push({ data: this.dataHex.trim().toLowerCase() });
      }

      const inputs = this.manualCoins()
        ? this.utxos()
            .filter(u => this.isSelected(u))
            .map(u => ({ txid: u.txid, vout: u.vout }))
        : [];

      const subtract = this.subtractFeeIndex();
      const result = await this.walletRpc.walletCreateFundedPsbt(
        walletName,
        inputs,
        outputs,
        this.useLocktime() ? (this.locktime ?? 0) : 0,
        {
          add_inputs: !this.manualCoins(),
          fee_rate: this.effectiveFeeRate() ?? undefined,
          replaceable: this.rbf(),
          ...(subtract !== null ? { subtractFeeFromOutputs: [subtract] } : {}),
          ...(this.autoChange() || !this.changeAddress.trim()
            ? {}
            : { changeAddress: this.changeAddress.trim() }),
        }
      );

      this.created.emit({ psbt: result.psbt, fee: result.fee });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.createError.set(message);
    } finally {
      this.creating.set(false);
    }
  }

}
