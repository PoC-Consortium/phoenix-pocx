import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService, LANGUAGES, Language } from '../../../core/i18n';
import { BtcxWalletService, BtcxWalletSummary } from '../../../core/services/btcx-wallet.service';
import { ElectrumStatusService } from '../../../core/services/electrum-status.service';
import { NotificationService } from '../../../shared/services';
import { MobileNavComponent } from '../../../shared/components/mobile-nav/mobile-nav.component';

/**
 * MobileWalletLayoutComponent - layout for the mobile wallet routes.
 *
 * Mirrors MiningLayoutComponent's minimal header (logo, name, language)
 * plus a network badge and wallet settings shortcut, with the shared
 * bottom navigation to switch between wallet and mining.
 *
 * Once a wallet exists, the static app name gives way to the wallet
 * switcher chip — the mobile-compact mirror of the desktop toolbar's
 * wallet selector (wallet icon + active name + dropdown arrow, opening a
 * menu of the current network's wallets plus create/restore entries).
 * Selecting a row closes the open wallet and opens the tapped one (the
 * backend's one-open-wallet-at-a-time flow, same as desktop remote mode).
 */
@Component({
  selector: 'app-mobile-wallet-layout',
  standalone: true,
  imports: [
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MobileNavComponent,
    I18nPipe,
  ],
  template: `
    <div class="wallet-layout">
      <mat-toolbar class="wallet-toolbar">
        <div class="toolbar-content">
          <div class="toolbar-left">
            <img src="assets/images/logos/phoenix_v.svg" alt="Phoenix PoCX" class="logo" />

            @if (wallet.hasSeed()) {
              <!-- Wallet switcher chip (desktop toolbar's wallet selector) -->
              <button
                mat-button
                class="wallet-chip"
                [matMenuTriggerFor]="walletMenu"
                (menuOpened)="onWalletMenuOpened()"
              >
                <div class="wallet-chip-content">
                  <mat-icon class="wallet-icon">account_balance_wallet</mat-icon>
                  <span class="wallet-chip-name">{{ wallet.walletName() }}</span>
                  <mat-icon class="dropdown-arrow">keyboard_arrow_down</mat-icon>
                </div>
              </button>

              <mat-menu #walletMenu="matMenu" class="wallet-dropdown-menu">
                @for (w of wallet.wallets(); track w.name) {
                  <button
                    mat-menu-item
                    class="wallet-row"
                    [disabled]="switching() !== null"
                    (click)="switchTo(w)"
                  >
                    <div class="wallet-row-content">
                      <mat-icon class="wallet-row-icon" [class.active]="w.isActive"
                        >account_balance_wallet</mat-icon
                      >
                      <span class="wallet-row-name">{{ w.name }}</span>
                      @if (w.policy.kind === 'bip86') {
                        <span class="wallet-row-badge">{{ 'mwallet_taproot_badge' | i18n }}</span>
                      }
                      @if (w.seedEncrypted && w.seedLocked) {
                        <mat-icon class="wallet-row-lock">lock</mat-icon>
                      }
                      @if (switching() === w.name) {
                        <mat-spinner diameter="16" class="wallet-row-spinner"></mat-spinner>
                      } @else if (w.isActive) {
                        <mat-icon class="wallet-row-check">check</mat-icon>
                      }
                    </div>
                  </button>
                }
                <mat-divider></mat-divider>
                <button mat-menu-item routerLink="/wallet/create">
                  <mat-icon>add</mat-icon>
                  <span>{{ 'mwallet_create_wallet' | i18n }}</span>
                </button>
                <button mat-menu-item routerLink="/wallet/restore">
                  <mat-icon>restore</mat-icon>
                  <span>{{ 'mwallet_restore_wallet' | i18n }}</span>
                </button>
              </mat-menu>
            } @else {
              <span class="app-name">{{ 'mwallet_title' | i18n }}</span>
            }

            @if (wallet.network() !== 'mainnet') {
              <span class="network-badge">{{ wallet.network() | i18n }}</span>
            }

            <span
              class="conn-dot"
              [class.healthy]="electrumStatus.overall() === 'healthy'"
              [class.degraded]="electrumStatus.overall() === 'degraded'"
              [class.down]="electrumStatus.overall() === 'down'"
              [matTooltip]="connTooltip()"
            ></span>
          </div>

          <div class="toolbar-right">
            <button
              mat-button
              class="action-button icon-button"
              [routerLink]="['/wallet/settings']"
              [matTooltip]="'mwallet_settings_title' | i18n"
            >
              <mat-icon class="secondary-text">settings</mat-icon>
            </button>

            <div class="toolbar-separator"></div>

            <button mat-button [matMenuTriggerFor]="langMenu" class="action-button lang-button">
              <span class="lang-name-text">{{ i18n.currentLanguageName() }}</span>
              <mat-icon class="lang-icon secondary-text">language</mat-icon>
            </button>

            <mat-menu #langMenu="matMenu">
              @for (lang of languages; track lang.code) {
                <button mat-menu-item (click)="setLanguage(lang)">
                  {{ lang.nativeName }}
                </button>
              }
            </mat-menu>
          </div>
        </div>
      </mat-toolbar>

      <div class="wallet-content">
        <router-outlet></router-outlet>
      </div>

      <app-mobile-nav />
    </div>
  `,
  styles: [
    `
      .wallet-layout {
        display: flex;
        flex-direction: column;
        /* Visible viewport minus the Android status-bar padding on <body>:
           100vh fallback, 100dvh override — plain 100vh overflows on
           Android WebView and clips the bottom navigation. */
        height: calc(100vh - var(--android-safe-top, 0px));
        height: calc(100dvh - var(--android-safe-top, 0px));
        background: #eaf0f6;
      }

      .wallet-toolbar {
        position: relative;
        background-color: white !important;
        color: rgba(0, 0, 0, 0.87) !important;
        padding: 0;
        height: 56px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        flex-shrink: 0;
      }

      .toolbar-content {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: space-between;
      }

      .toolbar-left {
        display: flex;
        align-items: center;
        height: 100%;
        padding-left: 16px;
        gap: 12px;
      }

      .logo {
        width: 28px;
        height: 28px;
      }

      .app-name {
        font-size: 16px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.87);
      }

      /* Wallet switcher chip — the desktop toolbar's .wallet-button, compact. */
      .wallet-chip {
        min-width: 0;
        padding: 0 4px;
        margin-left: -8px;
      }

      .wallet-chip-content {
        display: flex;
        align-items: center;
        gap: 4px;

        .wallet-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: rgba(0, 0, 0, 0.54);
        }

        .wallet-chip-name {
          font-size: 15px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.87);
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dropdown-arrow {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: rgba(0, 0, 0, 0.54);
          margin: 0;
        }
      }

      .wallet-row-content {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 180px;

        .wallet-row-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: rgba(0, 0, 0, 0.4);
          margin: 0;

          &.active {
            color: #1976d2;
          }
        }

        .wallet-row-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .wallet-row-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #7b1fa2;
          border: 1px solid currentColor;
          border-radius: 8px;
          padding: 0 6px;
          flex-shrink: 0;
        }

        .wallet-row-lock {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: #4caf50;
          margin: 0;
          flex-shrink: 0;
        }

        .wallet-row-check {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #1976d2;
          margin: 0;
          flex-shrink: 0;
        }

        .wallet-row-spinner {
          flex-shrink: 0;
        }
      }

      .network-badge {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #e65100;
        border: 1px solid currentColor;
        border-radius: 10px;
        padding: 1px 8px;
      }

      .conn-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.26); /* connecting/unknown */
        flex-shrink: 0;

        &.healthy {
          background: #4caf50;
        }
        &.degraded {
          background: #ff9800;
        }
        &.down {
          background: #f44336;
        }
      }

      .toolbar-right {
        display: flex;
        align-items: center;
        height: 100%;
      }

      .toolbar-separator {
        height: 56px;
        width: 1px;
        background: rgba(0, 0, 0, 0.12);
      }

      .action-button {
        min-width: 48px;
        height: 56px;
        border-radius: 0;
      }

      .icon-button {
        min-width: 48px;
        width: 48px;
        padding: 0 !important;
        justify-content: center !important;

        mat-icon {
          font-size: 22px;
          width: 22px;
          height: 22px;
          margin: 0 !important;
        }
      }

      .secondary-text {
        color: rgba(0, 0, 0, 0.54);
      }

      .lang-button {
        .lang-name-text {
          color: rgba(0, 0, 0, 0.87);
          display: inline;
        }

        .lang-icon {
          display: none;
          font-size: 22px;
          width: 22px;
          height: 22px;
        }

        @media (max-width: 600px) {
          .lang-name-text {
            display: none;
          }

          .lang-icon {
            display: inline;
          }
        }
      }

      .wallet-content {
        flex: 1;
        overflow: auto;
        display: flex;
        flex-direction: column;
        /* Don't chain a boundary scroll to the document (overscroll glitch). */
        overscroll-behavior: contain;
      }

      :host-context(.dark-theme) {
        .wallet-layout {
          background: #303030;
        }

        .wallet-toolbar {
          background-color: #424242 !important;
          color: white !important;
        }

        .app-name {
          color: white;
        }

        .wallet-chip-content {
          .wallet-icon,
          .dropdown-arrow {
            color: rgba(255, 255, 255, 0.7);
          }

          .wallet-chip-name {
            color: white;
          }
        }

        .secondary-text {
          color: rgba(255, 255, 255, 0.7);
        }

        .toolbar-separator {
          background: rgba(255, 255, 255, 0.12);
        }

        .network-badge {
          color: #ffb74d;
        }
      }
    `,
  ],
})
export class MobileWalletLayoutComponent implements OnInit {
  readonly i18n = inject(I18nService);
  readonly wallet = inject(BtcxWalletService);
  readonly electrumStatus = inject(ElectrumStatusService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  languages: Language[] = LANGUAGES;

  /** Name of the wallet a switch is in flight for, or null. */
  readonly switching = signal<string | null>(null);

  ngOnInit(): void {
    // Lazy init: only mobile wallet routes touch the btcx wallet backend
    void this.wallet.initialize();
  }

  /** Refresh the registry snapshot whenever the switcher opens. */
  onWalletMenuOpened(): void {
    void this.wallet.refreshWallets();
  }

  /**
   * Switch to another registered wallet: the backend closes the open
   * runtime and opens the tapped one (a locked seed lands on the home
   * unlock form). Lands on the wallet home so the new state is visible.
   */
  async switchTo(w: BtcxWalletSummary): Promise<void> {
    if (w.isActive || this.switching() !== null) return;
    this.switching.set(w.name);
    try {
      await this.wallet.select(w.name);
      await this.router.navigate(['/wallet']);
    } catch (err) {
      console.error('Failed to switch wallet:', err);
      this.notification.error(`${err}`);
    } finally {
      this.switching.set(null);
    }
  }

  /** Tooltip of the connection dot: status text plus synced height. */
  connTooltip(): string {
    const parts = [this.i18n.get(`electrum_status_${this.electrumStatus.overall()}`)];
    const height = this.electrumStatus.height();
    if (height !== null) parts.push(`#${height}`);
    return parts.join(' · ');
  }

  setLanguage(lang: Language): void {
    this.i18n.setLanguageByCode(lang.code);
  }
}
