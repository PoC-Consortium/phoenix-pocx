import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  BtcxWalletService,
  BtcxRestoreResult,
  BTCX_COIN_TYPE,
} from '../../../../core/services/btcx-wallet.service';
import { sanitizeReturnTo } from '../../return-to';

/**
 * WalletRestoreComponent - restore-from-mnemonic flow.
 *
 * The backend probes EVERY descriptor branch the seed's history could live
 * on (BIP-84/86 x BTCX-coin-type/legacy coin-0') against the configured
 * Electrum server before importing. The success screen surfaces the branch
 * it opened, notes when history also exists on OTHER branches (the mobile
 * wallet opens one branch — the desktop restore imports them all), and
 * gives an honest "no history anywhere — starting fresh" verdict with a
 * scan-again retry (the server could have been lagging). Restoring
 * therefore requires a configured Electrum server.
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
            @if (otherBranches()) {
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
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'passphrase' | i18n }}</mat-label>
              <textarea
                matInput
                rows="3"
                [(ngModel)]="phrase"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
              ></textarea>
              <mat-hint>{{ 'mwallet_restore_word_count' | i18n: { count: wordCount() } }}</mat-hint>
            </mat-form-field>

            @if (wordCount() > 0 && !validWordCount()) {
              <p class="error-text">{{ 'mwallet_restore_invalid_count' | i18n }}</p>
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
              [disabled]="!validWordCount() || restoring()"
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

      textarea {
        font-family: monospace;
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

  phrase = '';
  passphrase = '';

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
    const coin =
      policy.coinType === BTCX_COIN_TYPE ? 'BTCX' : this.i18n.get('mwallet_branch_legacy');
    return `${kind} / ${coin}`;
  });

  /** History also exists on branches this wallet does not open. */
  readonly otherBranches = computed(() => (this.result()?.hits.length ?? 0) > 1);

  ngOnInit(): void {
    void this.wallet.initialize();
  }

  wordCount(): number {
    return this.phrase.trim().split(/\s+/).filter(Boolean).length;
  }

  validWordCount(): boolean {
    const count = this.wordCount();
    return count === 12 || count === 24;
  }

  async restore(): Promise<void> {
    if (!this.validWordCount() || this.restoring()) return;
    this.restoring.set(true);
    this.restoreError.set(null);
    try {
      const normalized = this.phrase.trim().toLowerCase().split(/\s+/).join(' ');
      const result = await this.wallet.restore(normalized, this.passphrase || undefined);
      this.phrase = '';
      this.passphrase = '';
      this.result.set(result);
      this.restored.set(true);
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
