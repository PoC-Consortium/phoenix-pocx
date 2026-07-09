import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { I18nPipe } from '../../../core/i18n';
import { AppModeService } from '../../../core/services/app-mode.service';

/**
 * MobileNavComponent - bottom navigation for the nodeless wallet layouts.
 *
 * Mobile mode (Android): lets wallet and mining coexist — two tabs,
 * Mining (/miner) and Wallet (/wallet). Rendered by MiningLayoutComponent
 * (mobile mode only) and MobileWalletLayoutComponent.
 *
 * Wallet-only mode: the wallet is the only section, so the nav renders
 * nothing at all.
 *
 * Desktop (experimental nodeless wallet): the Mining tab makes no sense —
 * a Dashboard tab leads back to the desktop wallet instead.
 */
@Component({
  selector: 'app-mobile-nav',
  standalone: true,
  imports: [RouterModule, MatIconModule, I18nPipe],
  template: `
    @if (!appMode.isWalletOnly()) {
      <nav class="mobile-nav">
        @if (appMode.isMobileMode()) {
          <a routerLink="/miner" routerLinkActive="active" class="nav-item">
            <mat-icon>hardware</mat-icon>
            <span class="nav-label">{{ 'mining' | i18n }}</span>
          </a>
        } @else {
          <a routerLink="/dashboard" routerLinkActive="active" class="nav-item">
            <mat-icon>dashboard</mat-icon>
            <span class="nav-label">{{ 'dashboard' | i18n }}</span>
          </a>
        }
        <a routerLink="/wallet" routerLinkActive="active" class="nav-item">
          <mat-icon>account_balance_wallet</mat-icon>
          <span class="nav-label">{{ 'mwallet_title' | i18n }}</span>
        </a>
      </nav>
    }
  `,
  styles: [
    `
      .mobile-nav {
        display: flex;
        flex-shrink: 0;
        background: white;
        border-top: 1px solid rgba(0, 0, 0, 0.12);
        padding-bottom: env(safe-area-inset-bottom);
      }

      .nav-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 8px 0 6px;
        text-decoration: none;
        color: rgba(0, 0, 0, 0.54);

        mat-icon {
          font-size: 22px;
          width: 22px;
          height: 22px;
        }

        .nav-label {
          font-size: 11px;
          line-height: 14px;
        }

        &.active {
          color: #1976d2;
        }
      }

      :host-context(.dark-theme) {
        .mobile-nav {
          background: #424242;
          border-top-color: rgba(255, 255, 255, 0.12);
        }

        .nav-item {
          color: rgba(255, 255, 255, 0.6);

          &.active {
            color: #90caf9;
          }
        }
      }
    `,
  ],
})
export class MobileNavComponent {
  readonly appMode = inject(AppModeService);
}
