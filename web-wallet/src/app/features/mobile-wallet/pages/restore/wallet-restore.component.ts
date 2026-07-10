import { Component, inject, signal, computed, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { MnemonicEntryComponent } from '../../../../shared/components';
import type { MnemonicEntryState } from '../../../../shared/components';
import {
  BtcxWalletService,
  BtcxRestoreResult,
  BTCX_COIN_TYPE,
} from '../../../../core/services/btcx-wallet.service';
import { sanitizeReturnTo } from '../../return-to';
import {
  isInvalidWalletName,
  isWalletNameTaken,
  suggestSiblingWalletName,
  suggestWalletName,
} from '../../wallet-name';

/**
 * WalletRestoreComponent - restore-from-mnemonic flow.
 *
 * The phrase is entered through the shared MnemonicEntryComponent (the
 * desktop import-wallet grid): 12/24-word selector, per-word BIP39
 * autocomplete and validation, checksum warning. The wallet name is
 * pre-filled with the next free default (desktop naming rules).
 *
 * The backend probes EVERY descriptor branch the seed's history could live
 * on (BIP-84/86 x BTCX-coin-type/legacy coin-0') against the configured
 * Electrum server before importing. The success screen surfaces the branch
 * it opened and gives an honest "no history anywhere — starting fresh"
 * verdict with a scan-again retry (the server could have been lagging).
 * Restoring therefore requires a configured Electrum server.
 *
 * When the probe finds history on BOTH descriptor families (BIP-84 segwit
 * AND BIP-86 taproot), the success screen offers to create a SECOND named
 * wallet over the same mnemonic for the other family (e.g. "Name" +
 * "Name-taproot"), so no funds are ever invisible: a wallet opens exactly
 * one family. The mnemonic is held in memory only until that offer is
 * resolved (or the page is left). Extra same-family legacy branches (coin
 * type 0') still show the restore-on-desktop note.
 *
 * Accepts a `returnTo` query param (app-internal path, e.g. the mining
 * setup wizard's address step): the success screen's button then continues
 * there instead of going to /wallet.
 */
@Component({
  selector: 'app-wallet-restore',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MnemonicEntryComponent,
    I18nPipe,
  ],
  template: `
    <div class="page">
      <div class="header-row">
        <button mat-icon-button routerLink="/wallet">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h2>{{ 'mwallet_restore_wallet' | i18n }}</h2>
      </div>

      @if (restored()) {
        <!-- Success: branch verdict of the restore probe -->
        <div class="card success-card">
          <mat-icon class="success-icon">check_circle</mat-icon>
          <h3>{{ 'mwallet_restore_success' | i18n }}</h3>
          @if (result()?.fresh) {
            <!-- Honest empty verdict + scan-again retry -->
            <p class="hint-text">{{ 'mwallet_restore_fresh' | i18n }}</p>
            @if (reprobeError()) {
              <p class="error-text">{{ reprobeError() }}</p>
            }
            <button
              mat-stroked-button
              class="full-width scan-again"
              [disabled]="reprobing()"
              (click)="scanAgain()"
            >
              @if (reprobing()) {
                <mat-spinner diameter="18"></mat-spinner>
              } @else {
                <mat-icon>refresh</mat-icon>
              }
              {{ 'mwallet_restore_scan_again' | i18n }}
            </button>
          } @else {
            @if (branchLabel()) {
              <p class="hint-text">
                {{ 'mwallet_restore_branch' | i18n: { branch: branchLabel() } }}
              </p>
            }
            @if (secondCreated(); as second) {
              <!-- Both wallets exist — say so and point at the switcher -->
              <p class="hint-text both-done">
                {{ 'mwallet_restore_both_done' | i18n: { first: restoredName(), second: second } }}
              </p>
            } @else if (otherKind()) {
              <!-- History on BOTH address families: offer the second wallet -->
              <div class="dual-offer">
                <h4>{{ 'mwallet_restore_both_title' | i18n }}</h4>
                <p class="hint-text small">
                  {{ 'mwallet_restore_both_text' | i18n: { name: secondName() } }}
                </p>
                @if (secondError()) {
                  <p class="error-text">
                    {{ 'mwallet_restore_both_failed' | i18n }}: {{ secondError() }}
                  </p>
                }
                <button
                  mat-stroked-button
                  class="full-width"
                  [disabled]="creatingSecond()"
                  (click)="createSecondWallet()"
                >
                  @if (creatingSecond()) {
                    <mat-spinner diameter="18"></mat-spinner>
                  } @else {
                    <mat-icon>library_add</mat-icon>
                  }
                  {{ 'mwallet_restore_create_both' | i18n }}
                </button>
              </div>
            }
            @if (legacyBranches()) {
              <p class="hint-text small">{{ 'mwallet_restore_other_branches' | i18n }}</p>
            }
          }
          @if (returnTo()) {
            <button mat-raised-button color="primary" class="full-width" (click)="continueSetup()">
              {{ 'mwallet_continue_setup' | i18n }}
            </button>
          } @else {
            <button mat-raised-button color="primary" class="full-width" routerLink="/wallet">
              {{ 'mwallet_title' | i18n }}
            </button>
          }
        </div>
      } @else {
        <div class="card">
          <p class="hint-text">{{ 'import_mnemonic_description' | i18n }}</p>

          @if (!wallet.hasElectrumServer()) {
            <div class="notice-box">
              <mat-icon class="notice-icon">cloud_off</mat-icon>
              <span>{{ 'mwallet_restore_needs_server' | i18n }}</span>
            </div>
            <button mat-stroked-button class="full-width" routerLink="/wallet/settings">
              <mat-icon>settings</mat-icon>
              {{ 'mwallet_server_settings' | i18n }}
            </button>
          } @else {
            <app-mnemonic-entry
              [disabled]="restoring()"
              (changed)="onMnemonicChanged($event)"
            ></app-mnemonic-entry>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'wallet_name' | i18n }}</mat-label>
              <input
                matInput
                [(ngModel)]="walletName"
                (ngModelChange)="onWalletNameChange()"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
              />
              @if (walletNameConflict()) {
                <mat-error>{{ 'wallet_name_conflict' | i18n }}</mat-error>
              } @else if (walletNameInvalid()) {
                <mat-error>{{ 'wallet_name_invalid_local' | i18n }}</mat-error>
              } @else {
                <mat-hint>{{ 'wallet_name_hint_local' | i18n }}</mat-hint>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'mwallet_passphrase_optional' | i18n }}</mat-label>
              <input matInput type="password" [(ngModel)]="passphrase" autocomplete="off" />
            </mat-form-field>
            <p class="hint-text small">{{ 'mwallet_passphrase_hint' | i18n }}</p>

            <p class="hint-text small">{{ 'mwallet_restore_probe_note' | i18n }}</p>

            @if (restoreError()) {
              <p class="error-text">{{ 'mwallet_restore_failed' | i18n }}: {{ restoreError() }}</p>
            }

            <button
              mat-raised-button
              color="primary"
              class="full-width"
              [disabled]="
                !mnemonicValid() || walletNameConflict() || walletNameInvalid() || restoring()
              "
              (click)="restore()"
            >
              @if (restoring()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                <mat-icon>restore</mat-icon>
              }
              {{ 'mwallet_restore_wallet' | i18n }}
            </button>
          }
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

      .header-row {
        display: flex;
        align-items: center;
        gap: 8px;

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 500;
        }
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
      }

      .notice-box {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        background: rgba(230, 81, 0, 0.08);
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 13px;
        margin: 0 0 12px;

        .notice-icon {
          color: #e65100;
          font-size: 18px;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
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

        .scan-again {
          margin-bottom: 12px;
        }

        .both-done {
          color: #2e7d32;
        }
      }

      .dual-offer {
        text-align: left;
        background: rgba(25, 118, 210, 0.06);
        border: 1px solid rgba(25, 118, 210, 0.25);
        border-radius: 6px;
        padding: 12px;
        margin: 0 0 16px;

        h4 {
          margin: 0 0 6px;
          font-size: 14px;
          font-weight: 500;
        }

        button {
          margin-top: 4px;
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .notice-box {
          background: rgba(255, 183, 77, 0.12);
        }

        .success-card .both-done {
          color: #81c784;
        }

        .dual-offer {
          background: rgba(100, 181, 246, 0.08);
          border-color: rgba(100, 181, 246, 0.3);
        }
      }
    `,
  ],
})
export class WalletRestoreComponent implements OnInit, OnDestroy {
  readonly wallet = inject(BtcxWalletService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  passphrase = '';

  /** Wallet name — pre-filled with the next free default; desktop rules. */
  walletName = '';
  readonly walletNameConflict = signal(false);
  readonly walletNameInvalid = signal(false);
  /** Registry names for suggestion + case-insensitive conflict checks. */
  private readonly existingNames = signal<string[]>([]);

  /** Lower-cased, space-joined phrase from the shared entry grid. */
  private mnemonic = '';
  readonly mnemonicValid = signal(false);
  @ViewChild(MnemonicEntryComponent) private mnemonicEntry?: MnemonicEntryComponent;

  readonly restoring = signal(false);
  readonly restored = signal(false);
  readonly restoreError = signal<string | null>(null);

  /** Outcome of the restore probe (selected branch, hit list, fresh verdict). */
  readonly result = signal<BtcxRestoreResult | null>(null);
  readonly reprobing = signal(false);
  readonly reprobeError = signal<string | null>(null);

  /**
   * The phrase + passphrase, held ONLY while the dual-branch offer is on
   * screen — the "create both wallets" button restores a second time with
   * them. Cleared as soon as the offer is resolved or the page is left.
   */
  private heldMnemonic = '';
  private heldPassphrase = '';

  readonly creatingSecond = signal(false);
  readonly secondError = signal<string | null>(null);
  /** Name of the successfully created second wallet, or null. */
  readonly secondCreated = signal<string | null>(null);

  /** Sanitized returnTo target (app-internal path), or null. */
  readonly returnTo = computed(() =>
    sanitizeReturnTo(this.route.snapshot.queryParamMap.get('returnTo'))
  );

  /** Continue the flow that launched the restore (e.g. mining setup). */
  continueSetup(): void {
    const target = this.returnTo();
    if (target) {
      void this.router.navigateByUrl(target);
    }
  }

  readonly branchLabel = computed(() => {
    const policy = this.result()?.selected ?? this.wallet.descriptorPolicy();
    if (!policy) return '';
    const kind = policy.kind === 'bip86' ? 'BIP-86' : 'BIP-84';
    const coin =
      policy.coinType === BTCX_COIN_TYPE ? 'BTCX' : this.i18n.get('mwallet_branch_legacy');
    return `${kind} / ${coin}`;
  });

  /** Name the wallet was restored under (the first wallet of a dual pair). */
  readonly restoredName = computed(() => this.result()?.status.walletName ?? '');

  /**
   * The OTHER descriptor family with history — set when the probe hit both
   * BIP-84 and BIP-86 branches, which is what triggers the "create both
   * wallets" offer (a wallet opens exactly one family).
   */
  readonly otherKind = computed<'bip84' | 'bip86' | null>(() => {
    const result = this.result();
    if (!result) return null;
    const other = result.hits.find(h => h.policy.kind !== result.selected.kind);
    return other?.policy.kind ?? null;
  });

  /** Proposed name of the second wallet (first name + family qualifier). */
  readonly secondName = computed(() => {
    const kind = this.otherKind();
    if (!kind) return '';
    return suggestSiblingWalletName(this.restoredName(), kind, this.existingNames());
  });

  /**
   * Extra SAME-family legacy branches (coin type 0') the opened wallets do
   * not cover — the restore-on-desktop note. The other-family case gets
   * the dual-wallet offer instead.
   */
  readonly legacyBranches = computed(() => {
    const result = this.result();
    if (!result) return false;
    const kinds = new Set(result.hits.map(h => h.policy.kind));
    return result.hits.length > kinds.size;
  });

  ngOnInit(): void {
    void this.wallet.initialize().then(async () => {
      this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      if (!this.walletName) {
        this.walletName = suggestWalletName(this.existingNames());
      }
    });
  }

  ngOnDestroy(): void {
    this.clearHeldSecrets();
  }

  private clearHeldSecrets(): void {
    this.heldMnemonic = '';
    this.heldPassphrase = '';
  }

  /** Mirror the Rust-side naming rules before the commit (desktop parity). */
  onWalletNameChange(): void {
    this.walletNameConflict.set(isWalletNameTaken(this.walletName, this.existingNames()));
    this.walletNameInvalid.set(isInvalidWalletName(this.walletName));
  }

  onMnemonicChanged(state: MnemonicEntryState): void {
    this.mnemonic = state.mnemonic;
    this.mnemonicValid.set(state.valid);
  }

  async restore(): Promise<void> {
    if (!this.mnemonicValid() || this.restoring()) return;
    if (this.walletNameConflict() || this.walletNameInvalid()) return;
    this.restoring.set(true);
    this.restoreError.set(null);
    try {
      // An emptied name field falls back to the suggested default.
      const name = this.walletName.trim() || suggestWalletName(this.existingNames());
      const passphrase = this.passphrase || undefined;
      const result = await this.wallet.restore(this.mnemonic, passphrase, name);
      this.result.set(result);
      this.restored.set(true);
      this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      // Hold the secrets ONLY while the dual-branch offer needs them.
      if (this.otherKind()) {
        this.heldMnemonic = this.mnemonic;
        this.heldPassphrase = this.passphrase;
      }
      this.mnemonic = '';
      this.mnemonicValid.set(false);
      this.mnemonicEntry?.reset();
      this.passphrase = '';
    } catch (err) {
      console.error('Failed to restore wallet:', err);
      this.restoreError.set(`${err}`);
    } finally {
      this.restoring.set(false);
    }
  }

  /**
   * The dual-branch payoff: restore the SAME mnemonic a second time as a
   * new named wallet FORCED onto the other descriptor family, then switch
   * back to the first wallet (the probe's priority branch stays active).
   */
  async createSecondWallet(): Promise<void> {
    const kind = this.otherKind();
    if (!kind || this.creatingSecond() || !this.heldMnemonic) return;
    this.creatingSecond.set(true);
    this.secondError.set(null);
    try {
      const name = this.secondName();
      const firstName = this.restoredName();
      await this.wallet.restore(this.heldMnemonic, this.heldPassphrase || undefined, name, kind);
      // Re-activate the first wallet — it opened the higher-priority branch.
      await this.wallet.select(firstName);
      this.secondCreated.set(name);
      this.clearHeldSecrets();
    } catch (err) {
      console.error('Failed to create the second (other-family) wallet:', err);
      this.secondError.set(`${err}`);
    } finally {
      this.creatingSecond.set(false);
    }
  }

  /**
   * Re-run the probe after a fresh verdict — the server could have been
   * lagging. A found branch replaces the (empty) fresh wallet.
   */
  async scanAgain(): Promise<void> {
    if (this.reprobing()) return;
    this.reprobing.set(true);
    this.reprobeError.set(null);
    try {
      this.result.set(await this.wallet.reprobe());
    } catch (err) {
      console.error('Failed to re-probe wallet branches:', err);
      this.reprobeError.set(`${err}`);
    } finally {
      this.reprobing.set(false);
    }
  }
}
