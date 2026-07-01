import { Component, inject, signal, computed, output, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
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

/**
 * PSBT compose form — hand-roll a transaction with full control:
 * manual or automatic coin selection, arbitrary outputs, OP_RETURN data,
 * explicit fee rate, RBF and locktime. Funding and change are delegated to
 * walletcreatefundedpsbt; nothing is signed here.
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
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    I18nPipe,
  ],
  template: `
    <!-- Coins to spend -->
    <div class="compose-card">
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
          @for (utxo of utxos(); track utxo.txid + utxo.vout) {
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
                <div class="utxo-addr mono">
                  {{ shortAddress(utxo.address) }} · {{ shortTxid(utxo.txid) }}:{{ utxo.vout }}
                </div>
                <div class="utxo-meta">
                  {{ utxo.confirmations }} {{ 'psbt_confirmations' | i18n }}
                </div>
              </div>
              <div class="utxo-amount mono">{{ utxo.amount | number: '1.8-8' }}</div>
            </div>
          }
          <div class="selection-summary">
            {{ 'psbt_selected' | i18n }}
            <b class="mono">{{ selectedTotal() | number: '1.8-8' }}</b>
            / {{ availableTotal() | number: '1.8-8' }} BTCX
          </div>
        }
      } @else {
        <div class="empty-hint">{{ 'psbt_coins_auto_hint' | i18n }}</div>
      }
    </div>

    <!-- Outputs -->
    <div class="compose-card">
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
            class="remove-button"
            (click)="removeOutput($index)"
            [disabled]="outputs().length === 1"
            [matTooltip]="'psbt_remove_output' | i18n"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      <div class="add-row">
        <button mat-button color="primary" (click)="addOutput()">
          <mat-icon>add_circle_outline</mat-icon>
          {{ 'psbt_add_output' | i18n }}
        </button>
        @if (!showData()) {
          <button mat-button color="primary" (click)="showData.set(true)">
            <mat-icon>data_object</mat-icon>
            {{ 'psbt_add_data' | i18n }}
          </button>
        }
      </div>

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
            class="remove-button"
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
        <mat-slide-toggle [checked]="autoChange()" (change)="autoChange.set($event.checked)">
        </mat-slide-toggle>
      </div>
      @if (!autoChange()) {
        <mat-form-field appearance="outline" class="change-field">
          <mat-label>{{ 'psbt_change_address' | i18n }}</mat-label>
          <input matInput [(ngModel)]="changeAddress" autocomplete="off" spellcheck="false" class="mono" />
        </mat-form-field>
      }
    </div>

    <!-- Fee & options -->
    <div class="compose-card">
      <div class="two-col">
        <div>
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
                (click)="selectedFee = chip"
              >
                <b>{{ chip.labelKey | i18n }}</b>
                @if (chip.custom) {
                  <span><mat-icon class="tune-icon">tune</mat-icon></span>
                } @else {
                  <span>{{ chip.rate !== null ? chip.rate + ' sat/vB' : '--' }}</span>
                }
              </button>
            }
          </div>
          @if (selectedFee?.custom) {
            <mat-form-field appearance="outline" class="custom-fee-field">
              <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
              <input matInput type="number" min="1" step="1" [(ngModel)]="customFeeRate" />
            </mat-form-field>
          }
        </div>
        <div>
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
      </div>
    </div>

    @if (createError()) {
      <div class="error-banner">
        <mat-icon>error</mat-icon>
        <span>{{ createError() }}</span>
      </div>
    }

    <!-- Actions -->
    <div class="actions-row">
      <button mat-stroked-button (click)="cancelled.emit()">{{ 'cancel' | i18n }}</button>
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
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .compose-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        padding: 16px 20px;
        margin-bottom: 16px;
      }

      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
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
          padding: 6px 14px;
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
        padding: 9px 12px;
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
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .utxo-meta {
          font-size: 10.5px;
          color: #6b7787;
        }

        .utxo-amount {
          font-size: 12.5px;
          font-weight: 600;
          color: rgb(0, 35, 65);
        }
      }

      .selection-summary {
        margin-top: 10px;
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

      // Output rows
      .output-row {
        display: flex;
        gap: 8px;
        align-items: flex-start;

        .addr-field {
          flex: 1;
        }

        .amount-field {
          width: 170px;
          flex-shrink: 0;
        }

        .remove-button {
          height: 40px;
          width: 40px;
          min-width: 40px;
          padding: 0;
          border-color: rgba(0, 0, 0, 0.12);

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

          &:hover:not([disabled]) mat-icon {
            color: #f44336;
          }
        }
      }

      .add-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;

        button mat-icon {
          margin-right: 4px;
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .change-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding-top: 12px;
        margin-top: 8px;
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
        padding: 10px 0;
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
        gap: 6px;
      }

      .fee-chip {
        border: 1px solid #e0e0e0;
        background: #fff;
        border-radius: 6px;
        cursor: pointer;
        padding: 7px 14px;
        text-align: center;
        min-width: 80px;
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

      .two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }

      @media (max-width: 800px) {
        .two-col {
          grid-template-columns: 1fr;
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

        .spacer {
          flex: 1;
        }

        button {
          min-width: 120px;

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
      }

      // Compact form fields (match send page)
      ::ng-deep {
        .mat-mdc-form-field-subscript-wrapper {
          min-height: 0;
          height: auto;
        }

        .mat-mdc-text-field-wrapper {
          padding: 0 12px;
        }

        .mat-mdc-form-field-infix {
          min-height: 40px;
          padding-top: 8px;
          padding-bottom: 8px;
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

      // Responsive
      @media (max-width: 600px) {
        .output-row {
          flex-wrap: wrap;

          .amount-field {
            width: calc(100% - 48px);
          }
        }
      }
    `,
  ],
})
export class PsbtComposeComponent implements OnInit {
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly store = inject(Store);
  readonly network = toSignal(this.store.select(selectNetwork), { initialValue: 'mainnet' });

  /** Emits the funded PSBT (base64) once created */
  readonly created = output<{ psbt: string; fee: number }>();
  readonly cancelled = output<void>();

  manualCoins = signal(false);
  utxos = signal<UTXO[]>([]);
  loadingUtxos = signal(false);
  selectedOutpoints = signal<Set<string>>(new Set());

  outputs = signal<ComposeOutput[]>([{ address: '', amount: null }]);
  showData = signal(false);
  dataHex = '';

  autoChange = signal(true);
  changeAddress = '';

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

  selectedTotal = computed(() => {
    const selected = this.selectedOutpoints();
    return this.utxos()
      .filter(u => selected.has(`${u.txid}:${u.vout}`))
      .reduce((sum, u) => sum + u.amount, 0);
  });

  availableTotal = computed(() => this.utxos().reduce((sum, u) => sum + u.amount, 0));

  ngOnInit(): void {
    this.loadFeeEstimates();
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
    } catch (error) {
      console.error('Failed to load UTXOs:', error);
      this.notification.error(this.i18n.get('psbt_utxo_load_failed'));
    } finally {
      this.loadingUtxos.set(false);
    }
  }

  async loadFeeEstimates(): Promise<void> {
    this.loadingFees.set(true);
    try {
      for (const chip of this.feeChips) {
        if (chip.custom) continue;
        const result = await this.blockchainRpc.estimateSmartFee(chip.blocks);
        if (result.feerate) {
          chip.rate = Math.max(1, Math.round((result.feerate * 1e8) / 1000));
        }
      }
      const hasEstimates = this.feeChips.some(c => !c.custom && c.rate !== null);
      this.selectedFee = hasEstimates ? this.feeChips[1] : this.feeChips[3];
    } catch (error) {
      console.error('Failed to load fee estimates:', error);
      this.selectedFee = this.feeChips[3];
    } finally {
      this.loadingFees.set(false);
    }
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
    this.createError.set(null);
  }

  addOutput(): void {
    this.outputs.set([...this.outputs(), { address: '', amount: null }]);
  }

  removeOutput(index: number): void {
    this.outputs.set(this.outputs().filter((_, i) => i !== index));
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
    return validOutputs && validData && validFee && validCoins && validLocktime;
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

      const result = await this.walletRpc.walletCreateFundedPsbt(
        walletName,
        inputs,
        outputs,
        this.useLocktime() ? (this.locktime ?? 0) : 0,
        {
          add_inputs: !this.manualCoins(),
          fee_rate: this.effectiveFeeRate() ?? undefined,
          replaceable: this.rbf(),
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

  shortAddress(address: string): string {
    if (!address || address.length <= 16) return address;
    return `${address.slice(0, 10)}…${address.slice(-6)}`;
  }

  shortTxid(txid: string): string {
    return `${txid.slice(0, 8)}…`;
  }
}
