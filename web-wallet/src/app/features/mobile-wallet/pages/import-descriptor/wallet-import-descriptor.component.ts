import { Component, inject, signal, computed, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  BtcxWalletService,
  BtcxImportResult,
  BtcxImportValidation,
  BtcxImportErrorCode,
} from '../../../../core/services/btcx-wallet.service';
import { isInvalidWalletName, isWalletNameTaken, suggestWalletName } from '../../wallet-name';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';
import { WalletNameSectionComponent } from '../../components/wallet-name-section/wallet-name-section.component';

/** Error code → translated message key (backend `descriptors::ImportError`). */
const ERROR_KEYS: Record<BtcxImportErrorCode, string> = {
  empty: '',
  watch_only: 'mwallet_import_watch_only',
  bare_key: 'mwallet_import_bare_key',
  wrong_network: 'mwallet_import_wrong_network',
  needs_internal: 'mwallet_import_needs_internal',
  unsupported_type: 'mwallet_import_unsupported',
  not_ranged: 'mwallet_import_not_ranged',
  pair_mismatch: 'mwallet_import_pair_mismatch',
  multipath_nonstandard: 'mwallet_import_multipath_nonstandard',
  too_many: 'mwallet_import_too_many',
  parse: 'mwallet_import_invalid',
};

/**
 * WalletImportDescriptorComponent - import-from-descriptors flow.
 *
 * One paste box, one or two PRIVATE descriptors (newline separated): a
 * single standard descriptor (`/0/*` or `/1/*` tail) infers its change
 * sibling; a multipath `<0;1>` descriptor carries both branches; anything
 * non-standard asks for both explicitly. Public-only (xpub) material is
 * rejected — watch-only wallets are not supported yet (this input is where
 * they will slot in later).
 *
 * The paste is validated live against `btcx_wallet_validate_import`
 * (debounced, offline): errors surface a translated message keyed by the
 * structured error code, a valid paste shows its script-type
 * classification (SegWit / Taproot / Legacy — legacy imports work for
 * funds but are gated from mining/assignments, same as taproot). The
 * wallet name leads the page (owner rule, round 8: name first — the
 * shared WalletNameSectionComponent) and the optional at-rest passphrase
 * mirrors the create/restore pages.
 *
 * Unlike restore there is no branch probe: the descriptors already say
 * which scripts the wallet owns, and the fresh store's first sync
 * gap-scans any existing history.
 */
@Component({
  selector: 'app-wallet-import-descriptor',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    I18nPipe,
    PageHeaderComponent,
    WalletNameSectionComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="mwallet_import_wallet" />

    <div class="page">
      @if (imported()) {
        <!-- Success: classification verdict -->
        <div class="card success-card">
          <mat-icon class="success-icon">check_circle</mat-icon>
          <h3>{{ 'mwallet_import_success' | i18n }}</h3>
          <p class="hint-text">
            {{ 'mwallet_import_recognized' | i18n: { kind: kindLabel(result()?.policy?.kind) } }}
          </p>
          @if (result()?.policy?.kind === 'legacy') {
            <p class="hint-text small">{{ 'mwallet_kind_legacy_desc' | i18n }}</p>
          } @else if (result()?.policy?.kind === 'bip86') {
            <p class="hint-text small">{{ 'mwallet_kind_taproot_desc' | i18n }}</p>
          }
          <p class="hint-text small">{{ 'mwallet_import_synced_note' | i18n }}</p>
          <button mat-raised-button color="primary" class="full-width" routerLink="/wallet">
            {{ 'mwallet_title' | i18n }}
          </button>
        </div>
      } @else {
        <div class="card">
          <!-- Wallet name FIRST (owner rule, round 8) — shared section
               with the pre-filled default and live desktop naming rules. -->
          <app-mwallet-name-section
            #nameSection
            [(name)]="walletName"
            [existingNames]="existingNames()"
            [disabled]="importing()"
          />

          <p class="hint-text">{{ 'mwallet_import_description' | i18n }}</p>

          <!-- subscriptSizing dynamic: the multi-line hint below the
               textarea must grow the field. In the default 'fixed' mode
               the hint wrapper is absolutely positioned in a one-line-high
               subscript box, so the wrapped hint painted OVER the section
               that followed (the wallet-name label overlay bug). -->
          <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
            <mat-label>{{ 'mwallet_import_input_label' | i18n }}</mat-label>
            <textarea
              matInput
              class="descriptor-input"
              rows="4"
              [(ngModel)]="input"
              (ngModelChange)="onInputChange()"
              [disabled]="importing()"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="wpkh([9a6a2580/84'/…/0']xprv…/0/*)#checksum"
            ></textarea>
            <mat-hint>{{ 'mwallet_import_input_hint' | i18n }}</mat-hint>
          </mat-form-field>

          <!-- Live validation verdict (debounced) -->
          @if (validationError(); as error) {
            <div class="verdict invalid">
              <mat-icon class="verdict-icon">error_outline</mat-icon>
              <div>
                <div>{{ error.key | i18n }}</div>
                @if (error.detail) {
                  <div class="verdict-detail">{{ error.detail }}</div>
                }
              </div>
            </div>
          } @else if (validation()?.valid) {
            <div class="verdict valid">
              <mat-icon class="verdict-icon">task_alt</mat-icon>
              <div>
                <div>
                  {{ 'mwallet_import_recognized' | i18n: { kind: kindLabel(validation()?.kind) } }}
                </div>
                @if (validation()?.kind === 'legacy') {
                  <div class="verdict-detail">{{ 'mwallet_kind_legacy_desc' | i18n }}</div>
                } @else if (validation()?.kind === 'bip86') {
                  <div class="verdict-detail">{{ 'mwallet_kind_taproot_desc' | i18n }}</div>
                }
                @if (validation()?.fromMultipath) {
                  <div class="verdict-detail">{{ 'mwallet_import_multipath' | i18n }}</div>
                } @else if (validation()?.inferredInternal) {
                  <div class="verdict-detail">{{ 'mwallet_import_inferred' | i18n }}</div>
                }
              </div>
            </div>
          }

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'mwallet_passphrase_optional' | i18n }}</mat-label>
            <input matInput type="password" [(ngModel)]="passphrase" autocomplete="off" />
          </mat-form-field>
          <p class="hint-text small">{{ 'mwallet_import_passphrase_hint' | i18n }}</p>

          @if (importError()) {
            <p class="error-text">{{ 'mwallet_import_failed' | i18n }}: {{ importError() }}</p>
          }

          <button
            mat-raised-button
            color="primary"
            class="full-width"
            [disabled]="!validation()?.valid || nameSection.hasError() || importing()"
            (click)="importWallet()"
          >
            @if (importing()) {
              <mat-spinner diameter="20"></mat-spinner>
            } @else {
              <mat-icon>input</mat-icon>
            }
            {{ 'mwallet_import_wallet' | i18n }}
          </button>
        </div>
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

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;

        h3 {
          margin: 8px 0 4px;
          font-size: 15px;
          font-weight: 500;
        }
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 16px;

        &.small {
          font-size: 12px;
          margin: 0 0 12px;
        }
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
        overflow-wrap: anywhere;
      }

      .descriptor-input {
        font-family: monospace;
        font-size: 12px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .verdict {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 13px;
        margin: 12px 0;

        .verdict-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        .verdict-detail {
          font-size: 12px;
          opacity: 0.75;
          margin-top: 2px;
          overflow-wrap: anywhere;
        }

        &.valid {
          background: rgba(46, 125, 50, 0.08);
          color: #2e7d32;
        }

        &.invalid {
          background: rgba(198, 40, 40, 0.08);
          color: #c62828;
        }
      }

      .full-width {
        width: 100%;
      }

      .success-card {
        text-align: center;

        .success-icon {
          color: #4caf50;
          font-size: 40px;
          width: 40px;
          height: 40px;
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .verdict.valid {
          background: rgba(129, 199, 132, 0.12);
          color: #81c784;
        }

        .verdict.invalid {
          background: rgba(239, 154, 154, 0.12);
          color: #ef9a9a;
        }
      }
    `,
  ],
})
export class WalletImportDescriptorComponent implements OnInit, OnDestroy {
  readonly wallet = inject(BtcxWalletService);
  private readonly i18n = inject(I18nService);

  /** The paste box: one or two private descriptors. */
  input = '';
  passphrase = '';

  /** Wallet name — pre-filled with the next free default; desktop rules. */
  walletName = '';
  /** Registry names for suggestion + case-insensitive conflict checks. */
  readonly existingNames = signal<string[]>([]);

  /** Latest validation verdict of the CURRENT paste (null while empty). */
  readonly validation = signal<BtcxImportValidation | null>(null);
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against out-of-order async validation results. */
  private validateSeq = 0;

  readonly importing = signal(false);
  readonly imported = signal(false);
  readonly importError = signal<string | null>(null);
  readonly result = signal<BtcxImportResult | null>(null);

  /** Structured error of an invalid paste: translated key + English detail. */
  readonly validationError = computed<{ key: string; detail: string | null } | null>(() => {
    const v = this.validation();
    if (!v || v.valid || !v.code || v.code === 'empty') return null;
    return { key: ERROR_KEYS[v.code] || 'mwallet_import_invalid', detail: v.message ?? null };
  });

  /** Human label of a script-type classification. */
  kindLabel(kind: 'bip84' | 'bip86' | 'legacy' | null | undefined): string {
    switch (kind) {
      case 'bip86':
        return this.i18n.get('mwallet_kind_taproot');
      case 'legacy':
        return this.i18n.get('mwallet_kind_legacy');
      default:
        return this.i18n.get('mwallet_kind_segwit');
    }
  }

  ngOnInit(): void {
    void this.wallet.initialize().then(async () => {
      this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      if (!this.walletName) {
        this.walletName = suggestWalletName(this.existingNames());
      }
    });
  }

  ngOnDestroy(): void {
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
    }
    this.input = '';
    this.passphrase = '';
  }

  /** Debounced live validation against the backend parser (offline). */
  onInputChange(): void {
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
    }
    const seq = ++this.validateSeq;
    if (!this.input.trim()) {
      this.validation.set(null);
      return;
    }
    this.validateTimer = setTimeout(() => {
      void this.wallet
        .validateImport(this.input)
        .then(verdict => {
          if (seq === this.validateSeq) {
            this.validation.set(verdict);
          }
        })
        .catch(err => console.error('Descriptor validation failed:', err));
    }, 300);
  }

  async importWallet(): Promise<void> {
    if (!this.validation()?.valid || this.importing()) return;
    if (
      isWalletNameTaken(this.walletName, this.existingNames()) ||
      isInvalidWalletName(this.walletName)
    ) {
      return;
    }
    this.importing.set(true);
    this.importError.set(null);
    try {
      // An emptied name field falls back to the suggested default.
      const name = this.walletName.trim() || suggestWalletName(this.existingNames());
      const result = await this.wallet.importDescriptor(
        this.input,
        this.passphrase || undefined,
        name
      );
      this.result.set(result);
      this.imported.set(true);
      // Drop the pasted key material as soon as it is committed.
      this.input = '';
      this.passphrase = '';
      this.validation.set(null);
      this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
    } catch (err) {
      console.error('Failed to import descriptor wallet:', err);
      this.importError.set(`${err}`);
    } finally {
      this.importing.set(false);
    }
  }
}
