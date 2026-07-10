import { Component, inject, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService, LANGUAGES, Language } from '../../../core/i18n';
import { BtcxWalletService } from '../../../core/services/btcx-wallet.service';
import { ElectrumStatusService } from '../../../core/services/electrum-status.service';
import { MobileNavComponent } from '../../../shared/components/mobile-nav/mobile-nav.component';

/**
 * MobileWalletLayoutComponent - layout for the mobile wallet routes.
 *
 * Mirrors MiningLayoutComponent's minimal header (logo, name, language)
 * plus a network badge and wallet settings shortcut, with the shared
 * bottom navigation to switch between wallet and mining.
 */
@Component({
  selector: 'app-mobile-wallet-layout',
  standalone: true,
  imports: [
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
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
            <span class="app-name">{{ 'mwallet_title' | i18n }}</span>

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
        height: 100vh;
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

  languages: Language[] = LANGUAGES;

  ngOnInit(): void {
    // Lazy init: only mobile wallet routes touch the btcx wallet backend
    void this.wallet.initialize();
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
