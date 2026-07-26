import {
  Component,
  OnInit,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { I18nPipe, I18nService } from '../../core/i18n';
import { NodeService } from '../../node/services/node.service';
import {
  BtcxWalletService,
  BtcxRestoreResult,
  BTCX_COIN_TYPE,
} from '../../core/services/btcx-wallet.service';
import {
  WalletManagerService,
  RestoreBranchReport,
} from '../../bitcoin/services/wallet/wallet-manager.service';
import { selectIsTestnet } from '../../store/settings/settings.selectors';
import {
  MnemonicEntryComponent,
  Bip39PassphraseSectionComponent,
  AtRestPassphraseSectionComponent,
  StepHeaderComponent,
} from '../../shared/components';
import type { MnemonicEntryState } from '../../shared/components';
import { WalletNameSectionComponent } from '../mobile-wallet/components/wallet-name-section/wallet-name-section.component';
import {
  isInvalidWalletName,
  isWalletNameTaken,
  suggestWalletName,
} from '../mobile-wallet/wallet-name';

/**
 * RestoreWalletFlowComponent — THE restore-from-mnemonic page, shared by
 * the desktop auth flow ("Import Wallet") and the mobile shell. Single
 * page, mobile shape: name first (shared section), the shared entry grid,
 * BIP39 25th word, optional at-rest secret, then restore.
 *
 * Commit branches on NodeService.isRemote:
 * - Remote/BDK: `btcxWallet.restore` probes EVERY descriptor branch the
 *   seed's history could live on (BIP-84/86 x BTCX/legacy coin-0') over
 *   Electrum and opens the best hit; a "fresh" verdict offers scan-again
 *   (the server could have been lagging). Requires a configured server.
 * - Core RPC: `createWalletFromMnemonic(rescan+restore)` — the restore-time
 *   UTXO scan produces the same kind of branch report.
 *
 * Hosts handle post-restore navigation via `done` (label via
 * `doneLabelKey`) and provide their own chrome.
 */
@Component({
  selector: 'app-restore-wallet-flow',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    I18nPipe,
    StepHeaderComponent,
    MnemonicEntryComponent,
    Bip39PassphraseSectionComponent,
    AtRestPassphraseSectionComponent,
    WalletNameSectionComponent,
  ],
  template: `
    <div class="flow">
      <!-- Title bar only where the host has no page header of its own
           (desktop auth); empty titleKey suppresses it. -->
      @if (titleKey()) {
        <app-step-header [title]="titleKey() | i18n" [currentStep]="1" [totalSteps]="0" />
      }

      <div class="card" [class.no-header]="!titleKey()">
        @if (restored()) {
          <!-- Success: branch verdict of the restore -->
          <div class="success-card">
            <mat-icon class="success-icon">check_circle</mat-icon>
            <h3>{{ 'mwallet_restore_success' | i18n }}</h3>

            @if (isFresh()) {
              <!-- Honest empty verdict (+ scan-again retry over Electrum) -->
              <p class="hint-text">{{ 'mwallet_restore_fresh' | i18n }}</p>
              @if (isRemote()) {
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
              }
            } @else {
              @if (isRemote()) {
                @if (branchLabel()) {
                  <p class="hint-text">
                    {{ 'mwallet_restore_branch' | i18n: { branch: branchLabel() } }}
                  </p>
                }
                @if (legacyBranches()) {
                  <p class="hint-text small">{{ 'mwallet_restore_other_branches' | i18n }}</p>
                }
              } @else if (coreReport(); as report) {
                <p class="hint-text">
                  {{ 'restore_history_found' | i18n: { branches: branchList(report) } }}
                </p>
              }
            }

            <button mat-raised-button color="primary" class="full-width" (click)="done.emit()">
              {{ doneLabelKey() | i18n }}
            </button>
          </div>
        } @else {
          @if (isRemote() && !wallet.hasElectrumServer()) {
            <!-- The Electrum probe needs a configured server first -->
            <div class="notice-box">
              <mat-icon class="notice-icon">cloud_off</mat-icon>
              <span>{{ 'mwallet_restore_needs_server' | i18n }}</span>
            </div>
            <button mat-stroked-button class="full-width" [routerLink]="settingsLink()">
              <mat-icon>settings</mat-icon>
              {{ 'mwallet_server_settings' | i18n }}
            </button>
          } @else {
            <!-- Wallet name FIRST (owner rule) — shared section with the
                 pre-filled default and live naming rules. -->
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

            <!-- BIP39 25th word — reads as part of the phrase; must match
                 what the seed was created with. -->
            <app-bip39-passphrase-section
              mode="restore"
              [disabled]="restoring()"
              [(enabled)]="useBip39"
              [(passphrase)]="bip39Word"
            />

            <app-at-rest-passphrase-section
              #protect
              [hintKey]="isRemote() ? 'mwallet_passphrase_hint' : 'wallet_encryption_info'"
              [disabled]="restoring()"
              [(passphrase)]="protectPassphrase"
              [(passphraseConfirm)]="protectPassphraseConfirm"
            />

            <p class="hint-text small">
              {{ (isRemote() ? 'mwallet_restore_probe_note' : 'rescan_info') | i18n }}
            </p>

            @if (restoreError()) {
              <p class="error-text">{{ 'mwallet_restore_failed' | i18n }}: {{ restoreError() }}</p>
            }

            <div class="button-row">
              @if (showCancel()) {
                <button mat-stroked-button [disabled]="restoring()" (click)="cancelled.emit()">
                  {{ 'back' | i18n }}
                </button>
              } @else {
                <span></span>
              }
              <button
                mat-raised-button
                color="primary"
                [disabled]="
                  !mnemonicValid() || nameSection.hasError() || !protect.valid() || restoring()
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
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .flow {
        max-width: 600px;
        width: 100%;
        margin: 0 auto;
      }

      .card {
        background: white;
        border-radius: 0 0 8px 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;

        &.no-header {
          border-radius: 8px;
        }

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

      .button-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
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
export class RestoreWalletFlowComponent implements OnInit {
  protected readonly wallet = inject(BtcxWalletService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly nodeService = inject(NodeService);
  private readonly store = inject(Store);
  private readonly i18n = inject(I18nService);

  /** Post-restore continue button label; host navigates on `done`. */
  readonly doneLabelKey = input('mwallet_title');
  readonly done = output<void>();
  /** Back button on the form (auth host: return to wallet select). */
  readonly showCancel = input(false);
  readonly cancelled = output<void>();
  /** Where the missing-Electrum-server notice sends the user. */
  readonly settingsLink = input('/wallet/settings');
  /** Title-bar key; '' hides the bar (hosts with their own page header). */
  readonly titleKey = input('mwallet_restore_wallet');

  readonly isRemote = this.nodeService.isRemote;
  private readonly isTestnet = toSignal(this.store.select(selectIsTestnet), { initialValue: true });

  walletName = '';
  readonly existingNames = signal<string[]>([]);

  private mnemonic = '';
  readonly mnemonicValid = signal(false);
  @ViewChild(MnemonicEntryComponent) private mnemonicEntry?: MnemonicEntryComponent;

  /** BIP39 25th word — SEPARATE from the at-rest secret below. */
  useBip39 = false;
  bip39Word = '';

  protectPassphrase = '';
  protectPassphraseConfirm = '';

  readonly restoring = signal(false);
  readonly restored = signal(false);
  readonly restoreError = signal<string | null>(null);

  /** Remote probe outcome (selected branch, hit list, fresh verdict). */
  readonly btcxResult = signal<BtcxRestoreResult | null>(null);
  /** Core restore-time scan outcome (null when the scan could not run). */
  readonly coreReport = signal<RestoreBranchReport | null>(null);
  readonly reprobing = signal(false);
  readonly reprobeError = signal<string | null>(null);

  readonly isFresh = computed(() =>
    this.isRemote() ? (this.btcxResult()?.fresh ?? false) : (this.coreReport()?.fresh ?? false)
  );

  readonly branchLabel = computed(() => {
    const policy = this.btcxResult()?.selected ?? this.wallet.descriptorPolicy();
    if (!policy) return '';
    const kind = policy.kind === 'bip86' ? 'BIP-86' : 'BIP-84';
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

  /** Legacy (coin-0') branches with history — spend-only v30 pockets. */
  readonly legacyBranches = computed(() => {
    const result = this.btcxResult();
    return !!result && result.hits.some(h => h.policy.coinType === 0);
  });

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      if (this.isRemote()) {
        await this.wallet.initialize();
        this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      } else {
        this.existingNames.set(await this.walletManager.listAllWallets());
      }
    } catch {
      // Registry unreachable — commit-time errors will surface the real cause.
    }
    if (!this.walletName) {
      this.walletName = suggestWalletName(this.existingNames());
    }
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
    if (this.protectPassphrase && this.protectPassphrase !== this.protectPassphraseConfirm) {
      return;
    }
    this.restoring.set(true);
    this.restoreError.set(null);
    try {
      // An emptied name field falls back to the suggested default.
      const name = this.walletName.trim() || suggestWalletName(this.existingNames());
      const atRest = this.protectPassphrase || undefined;
      const bip39Passphrase = this.useBip39 ? this.bip39Word || undefined : undefined;

      if (this.isRemote()) {
        const result = await this.wallet.restore(
          this.mnemonic,
          atRest,
          name,
          undefined,
          bip39Passphrase
        );
        this.btcxResult.set(result);
        try {
          const loaded = await this.walletManager.refreshLoadedWallets();
          if (loaded.includes(name)) {
            this.walletManager.setActiveWallet(name);
          }
        } catch {
          // Mobile shell tracks the active wallet in BtcxWalletService itself.
        }
        this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      } else {
        const result = await this.walletManager.createWalletFromMnemonic({
          walletName: name,
          mnemonic: this.mnemonic,
          mnemonicPassphrase: bip39Passphrase,
          isTestnet: this.isTestnet(),
          rescan: true, // always rescan for restored wallets
          restore: true, // POCX branch active + funded legacy branches watched
        });
        if (!result.success) {
          throw new Error(result.errors?.join(', ') || 'Restore failed');
        }
        this.coreReport.set(result.branchReport ?? null);
        if (atRest) {
          await this.walletManager.encryptWallet(name, atRest);
        }
      }

      this.clearSecrets();
      this.restored.set(true);
    } catch (err) {
      console.error('Failed to restore wallet:', err);
      // Tauri command rejections are plain strings, not Error instances.
      this.restoreError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.restoring.set(false);
    }
  }

  /**
   * Re-run the Electrum probe after a fresh verdict — the server could have
   * been lagging. A found branch replaces the (empty) fresh wallet.
   */
  async scanAgain(): Promise<void> {
    if (this.reprobing()) return;
    this.reprobing.set(true);
    this.reprobeError.set(null);
    try {
      this.btcxResult.set(await this.wallet.reprobe());
    } catch (err) {
      console.error('Failed to re-probe wallet branches:', err);
      this.reprobeError.set(`${err}`);
    } finally {
      this.reprobing.set(false);
    }
  }

  /** Compact era-labelled list, e.g. "legacy desktop (84'/0'), mobile (84'/BTCX)". */
  branchList(report: RestoreBranchReport): string {
    const parts: string[] = [];
    if (report.legacy.length > 0) {
      parts.push(`${this.i18n.get('restore_branch_legacy')} (${report.legacy.join(', ')})`);
    }
    if (report.pocx.length > 0) {
      parts.push(`${this.i18n.get('restore_branch_pocx')} (${report.pocx.join(', ')})`);
    }
    return parts.join(', ');
  }

  private clearSecrets(): void {
    this.mnemonic = '';
    this.mnemonicValid.set(false);
    this.mnemonicEntry?.reset();
    this.bip39Word = '';
    this.useBip39 = false;
    this.protectPassphrase = '';
    this.protectPassphraseConfirm = '';
  }
}
