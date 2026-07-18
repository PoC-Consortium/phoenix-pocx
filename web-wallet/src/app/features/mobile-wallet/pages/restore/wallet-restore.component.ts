import { Component, inject, signal, computed, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
import { isInvalidWalletName, isWalletNameTaken, suggestWalletName } from '../../wallet-name';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';
import { WalletNameSectionComponent } from '../../components/wallet-name-section/wallet-name-section.component';

/**
 * WalletRestoreComponent - restore-from-mnemonic flow.
 *
 * The wallet name leads the page (owner rule, round 8: name first — the
 * shared WalletNameSectionComponent), pre-filled with the next free
 * default (desktop naming rules). The phrase is then entered through the
 * shared MnemonicEntryComponent (the desktop import-wallet grid):
 * 12/24-word selector, per-word BIP39 autocomplete and validation,
 * checksum warning.
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
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MnemonicEntryComponent,
    I18nPipe,
    PageHeaderComponent,
    WalletNameSectionComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="mwallet_restore_wallet" />

    <div class="page">
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
            <!-- No create-both offer: the restore materialized every
                 compartment of the seed (SegWit + Taproot, plus any v30
                 pocket with history) as one group — the selector shows
                 them all. -->
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
            <!-- Wallet name FIRST (owner rule, round 8) — shared section
                 with the pre-filled default and live desktop naming rules. -->
            <app-mwallet-name-section
              #nameSection
              [(name)]="walletName"
              [existingNames]="existingNames()"
              [disabled]="restoring()"
            />

            <p class="hint-text">{{ 'import_mnemonic_description' | i18n }}</p>
            <app-mnemonic-entry
              [disabled]="restoring()"
              (changed)="onMnemonicChanged($event)"
            ></app-mnemonic-entry>

            <!-- BIP39 25th word — belongs right after the recovery phrase, so
                 it reads as part of the phrase (matching the create flow).
                 SEPARATE from the at-rest passphrase below. It must match what
                 the seed was created with, or the probe finds no history. -->
            <mat-checkbox [(ngModel)]="useBip39" [disabled]="restoring()" class="bip39-toggle">
              {{ 'mwallet_bip39_toggle' | i18n }}
            </mat-checkbox>

            @if (useBip39) {
              <p class="warning-text-inline">
                <mat-icon class="notice-icon">warning</mat-icon>
                <span>{{ 'mwallet_bip39_restore_warning' | i18n }}</span>
              </p>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'mwallet_bip39_label' | i18n }}</mat-label>
                <input matInput type="password" [(ngModel)]="bip39Passphrase" autocomplete="off" />
              </mat-form-field>
            }

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
              [disabled]="!mnemonicValid() || nameSection.hasError() || restoring()"
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

      .bip39-toggle {
        display: block;
        margin: 4px 0 8px;
      }

      .warning-text-inline {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        background: rgba(230, 81, 0, 0.08);
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 12px;
        margin: 0 0 12px;

        .notice-icon {
          color: #e65100;
          font-size: 18px;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }
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
      }
    `,
  ],
})
export class WalletRestoreComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  passphrase = '';

  /**
   * Optional BIP39 25th word — SEPARATE from the at-rest `passphrase`. Must
   * match the word the seed was created with, or the Electrum probe finds no
   * history (the mnemonic alone derives different keys).
   */
  useBip39 = false;
  bip39Passphrase = '';

  /** Wallet name — pre-filled with the next free default; desktop rules. */
  walletName = '';
  /** Registry names for suggestion + case-insensitive conflict checks. */
  readonly existingNames = signal<string[]>([]);

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
    // Only coin type 0' is legacy. The current branch is the BTCX coin type
    // on mainnet, or 1' on testnet/regtest.
    let coin: string;
    if (policy.coinType === 0) {
      coin = this.i18n.get('mwallet_branch_legacy');
    } else if (policy.coinType === BTCX_COIN_TYPE) {
      coin = 'BTCX';
    } else {
      coin = `${policy.coinType}'`;
    }
    return `${kind} / ${coin}`;
  });

  /**
   * Legacy (coin-0') branches with history — restored as spend-only v30
   * pockets of the same group; the note points the user at the selector.
   */
  readonly legacyBranches = computed(() => {
    const result = this.result();
    if (!result) return false;
    return result.hits.some(h => h.policy.coinType === 0);
  });

  ngOnInit(): void {
    void this.wallet.initialize().then(async () => {
      this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      if (!this.walletName) {
        this.walletName = suggestWalletName(this.existingNames());
      }
    });
  }

  onMnemonicChanged(state: MnemonicEntryState): void {
    this.mnemonic = state.mnemonic;
    this.mnemonicValid.set(state.valid);
  }

  async restore(): Promise<void> {
    if (!this.mnemonicValid() || this.restoring()) return;
    if (
      isWalletNameTaken(this.walletName, this.existingNames()) ||
      isInvalidWalletName(this.walletName)
    ) {
      return;
    }
    this.restoring.set(true);
    this.restoreError.set(null);
    try {
      // An emptied name field falls back to the suggested default.
      const name = this.walletName.trim() || suggestWalletName(this.existingNames());
      const passphrase = this.passphrase || undefined;
      const bip39Passphrase = this.useBip39 ? this.bip39Passphrase || undefined : undefined;
      const result = await this.wallet.restore(
        this.mnemonic,
        passphrase,
        name,
        undefined,
        bip39Passphrase
      );
      this.result.set(result);
      this.restored.set(true);
      this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      this.mnemonic = '';
      this.mnemonicValid.set(false);
      this.mnemonicEntry?.reset();
      this.passphrase = '';
      this.bip39Passphrase = '';
      this.useBip39 = false;
    } catch (err) {
      console.error('Failed to restore wallet:', err);
      this.restoreError.set(`${err}`);
    } finally {
      this.restoring.set(false);
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
