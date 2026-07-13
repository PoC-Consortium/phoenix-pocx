import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService, LANGUAGES, Language } from '../../../core/i18n';
import {
  BtcxWalletService,
  BtcxWalletSummary,
  BtcxChainInfo,
} from '../../../core/services/btcx-wallet.service';
import { ElectrumStatusService } from '../../../core/services/electrum-status.service';
import { BtcxPipe, TimeAgoPipe } from '../../../shared/pipes';
import { NotificationService } from '../../../shared/services';
import { MobileNavComponent } from '../../../shared/components/mobile-nav/mobile-nav.component';
import { ElectrumServerListComponent } from '../../../shared/components/electrum-server-list/electrum-server-list.component';

/** One drawer navigation entry (the desktop main-layout's NavItem, slim). */
interface NavItem {
  path: string;
  icon: string;
  labelKey: string;
  /** Exact route match for the active highlight (the home entry). */
  exact?: boolean;
  /** Needs an open wallet runtime; stays visible but does not navigate. */
  needsWallet?: boolean;
}

/** One titled drawer group (the desktop main-layout's NavGroup). */
interface NavGroup {
  id: string;
  titleKey: string;
  items: NavItem[];
}

/**
 * MobileWalletLayoutComponent - layout for the mobile wallet routes.
 *
 * The header mirrors the desktop toolbar's arrangement: hamburger on the
 * far left (opening the navigation drawer), status (network badge +
 * Electrum dot) next to it, and the wallet switcher chip on the RIGHT next
 * to the settings gear and language selector, separated by the same
 * `.toolbar-separator` idiom.
 *
 * The drawer is the desktop main-layout sidenav, mobile-sized: same
 * gradient, same grouped nav lists (a standalone home entry, a
 * transactions group, a mining group) with icons and active-route
 * highlight, and a footer pinned to the bottom (settings — the desktop
 * footer minus logout, which the mobile wallet does not have).
 *
 * The wallet switcher chip is the desktop toolbar's wallet selector,
 * compact: wallet icon + active name + dropdown arrow, opening a menu of
 * the current network's wallets plus create/restore entries. Selecting a
 * row closes the open wallet and opens the tapped one (the backend's
 * one-open-wallet-at-a-time flow, same as desktop remote mode).
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
    MatListModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSidenavModule,
    MatTooltipModule,
    MobileNavComponent,
    ElectrumServerListComponent,
    BtcxPipe,
    TimeAgoPipe,
    I18nPipe,
    DecimalPipe,
  ],
  template: `
    <mat-sidenav-container class="wallet-layout">
      <!-- Navigation drawer (the desktop main-layout sidenav, mobile-sized) -->
      <mat-sidenav #drawer mode="over" class="drawer" [fixedInViewport]="false">
        <div class="drawer-header">
          <img src="assets/images/logos/phoenix_v.svg" alt="Phoenix" class="drawer-logo" />
          <span class="drawer-title">Phoenix</span>
          <button mat-icon-button class="drawer-close" (click)="drawer.close()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        @if (wallet.hasSeed()) {
          <div class="drawer-wallet-info">
            <div class="drawer-wallet-name">{{ wallet.walletName() }}</div>
            <div class="drawer-wallet-balance">
              {{ (wallet.balance()?.totalSat ?? 0) / 100000000 | btcx }} BTCX
            </div>
          </div>
        }

        <div class="drawer-scroll">
          <!-- Home (standalone, the desktop Dashboard entry) -->
          <mat-nav-list class="nav-section">
            <a
              mat-list-item
              routerLink="/wallet"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: true }"
              (click)="drawer.close()"
            >
              <mat-icon matListItemIcon>dashboard</mat-icon>
              <span matListItemTitle>{{ 'dashboard' | i18n }}</span>
            </a>
          </mat-nav-list>

          @for (group of navGroups; track group.id) {
            <div class="nav-group">
              <div class="nav-group-title">{{ group.titleKey | i18n }}</div>
              <mat-nav-list class="nav-section">
                @for (item of group.items; track item.path) {
                  @let disabled = item.needsWallet && !wallet.walletActive();
                  <a
                    mat-list-item
                    [routerLink]="disabled ? null : item.path"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
                    [class.nav-disabled]="disabled"
                    (click)="!disabled && drawer.close()"
                  >
                    <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
                    <span matListItemTitle>{{ item.labelKey | i18n }}</span>
                  </a>
                }
              </mat-nav-list>
            </div>
          }
        </div>

        <!-- Footer pinned to the bottom (desktop sidenav-footer, minus logout) -->
        <div class="drawer-footer">
          <mat-nav-list class="nav-section">
            <a
              mat-list-item
              routerLink="/wallet/settings"
              routerLinkActive="active"
              (click)="drawer.close()"
            >
              <mat-icon matListItemIcon>settings</mat-icon>
              <span matListItemTitle>{{ 'settings' | i18n }}</span>
            </a>
          </mat-nav-list>
        </div>
      </mat-sidenav>

      <mat-sidenav-content class="wallet-shell">
        <mat-toolbar class="wallet-toolbar">
          <div class="toolbar-content">
            <div class="toolbar-left">
              <!-- Hamburger (desktop toolbar's sidenav toggle) -->
              <button
                mat-button
                class="action-button icon-button"
                (click)="drawer.toggle()"
                [matTooltip]="'toggle_menu' | i18n"
              >
                <mat-icon class="secondary-text">menu</mat-icon>
              </button>

              <div class="toolbar-separator"></div>

              @if (!wallet.hasSeed()) {
                <span class="app-name">{{ 'mwallet_title' | i18n }}</span>
              }

              @if (wallet.network() !== 'mainnet') {
                <span class="network-badge">{{ wallet.network() | i18n }}</span>
              }

              <!-- Electrum indicator (the desktop toolbar's remote-mode
                   indicator: bolt icon + status popover) -->
              <div
                class="status-indicator clickable"
                [matTooltip]="electrumTooltip()"
                [matMenuTriggerFor]="electrumMenu"
                (menuOpened)="onElectrumMenuOpened()"
              >
                <mat-icon
                  [class.electrum-healthy]="electrumStatus.overall() === 'healthy'"
                  [class.electrum-degraded]="electrumStatus.overall() === 'degraded'"
                  [class.electrum-down]="electrumStatus.overall() === 'down'"
                  [class.electrum-connecting]="electrumStatus.overall() === 'connecting'"
                  >bolt</mat-icon
                >
              </div>
              <mat-menu #electrumMenu="matMenu" class="electrum-menu">
                <div class="electrum-popover" (click)="$event.stopPropagation()">
                  <div class="electrum-popover-title">
                    {{ 'electrum_servers' | i18n }}
                  </div>

                  <!-- Aggregate status (desktop keeps this in the hover
                       tooltip; touch has no hover, so it lives here) -->
                  <div class="electrum-summary-row">
                    <span
                      class="dot"
                      [class.ok]="electrumStatus.overall() === 'healthy'"
                      [class.degraded]="electrumStatus.overall() === 'degraded'"
                      [class.down]="electrumStatus.overall() === 'down'"
                    ></span>
                    <span class="summary-text">
                      {{ 'electrum_status_' + electrumStatus.overall() | i18n }}
                    </span>
                    @if (electrumStatus.height(); as height) {
                      <span class="summary-meta">#{{ height | number }}</span>
                    }
                  </div>

                  <app-electrum-server-list [servers]="electrumStatus.servers()" />

                  @let age = electrumStatus.syncAgeSecs();
                  @if (age !== null || chain() !== null) {
                    <mat-divider class="electrum-popover-divider"></mat-divider>
                    @if (age !== null) {
                      <div class="electrum-footer-row">
                        <span class="footer-label">{{ 'mwallet_last_update' | i18n }}</span>
                        <span class="footer-value">
                          {{ 'electrum_synced_ago' | i18n: { seconds: age } }}
                        </span>
                      </div>
                    }
                    @if (chain(); as info) {
                      <div class="electrum-footer-row">
                        <span class="footer-label">{{ 'last_block_time' | i18n }}</span>
                        <span class="footer-value">{{ info.headerTime | timeAgo }}</span>
                      </div>
                    }
                  }
                </div>
              </mat-menu>
            </div>

            <div class="toolbar-right">
              @if (wallet.hasSeed()) {
                <!-- Wallet switcher chip (desktop toolbar's wallet selector) -->
                <button
                  mat-button
                  class="action-button wallet-chip"
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
                        } @else if (w.policy.kind === 'legacy') {
                          <span class="wallet-row-badge legacy">{{
                            'mwallet_legacy_badge' | i18n
                          }}</span>
                        } @else {
                          <span class="wallet-row-badge segwit">{{
                            'mwallet_segwit_badge' | i18n
                          }}</span>
                        }
                        @if (w.singleAddress) {
                          <span class="wallet-row-badge single">{{
                            'mwallet_single_badge' | i18n
                          }}</span>
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
                  <button mat-menu-item routerLink="/wallet/import">
                    <mat-icon>input</mat-icon>
                    <span>{{ 'mwallet_import_wallet' | i18n }}</span>
                  </button>
                </mat-menu>

                <div class="toolbar-separator"></div>
              }

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
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [
    `
      .wallet-layout {
        /* Visible viewport minus the Android status-bar padding on <body>:
           100vh fallback, 100dvh override — plain 100vh overflows on
           Android WebView and clips the bottom navigation. */
        height: calc(100vh - var(--android-safe-top, 0px));
        height: calc(100dvh - var(--android-safe-top, 0px));
        background: #eaf0f6;
      }

      /* Drawer — the desktop main-layout sidenav, mobile-sized. */
      .drawer {
        width: 250px;
        background: linear-gradient(180deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        overflow-x: hidden;

        ::ng-deep .mat-drawer-inner-container {
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
        }

        --mat-list-list-item-label-text-color: rgba(255, 255, 255, 0.9);
        --mat-list-list-item-hover-label-text-color: white;
        --mat-list-list-item-focus-label-text-color: white;
        --mat-list-list-item-leading-icon-color: rgba(255, 255, 255, 0.9);
        --mat-list-list-item-hover-leading-icon-color: white;
        --mat-list-list-item-focus-leading-icon-color: white;
        --mat-list-active-indicator-color: rgba(255, 255, 255, 0.15);
        --mat-list-list-item-one-line-container-height: 44px;
        --mat-list-list-item-label-text-size: 14px;
      }

      .drawer-header {
        position: relative;
        display: flex;
        align-items: center;
        height: 56px;
        padding: 0 16px;
        gap: 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        flex-shrink: 0;
        box-sizing: border-box;
      }

      .drawer-logo {
        width: 28px;
        height: 28px;
      }

      .drawer-title {
        flex: 1;
        font-size: 15px;
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .drawer-close {
        color: rgba(255, 255, 255, 0.7);
        width: 32px;
        height: 32px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .drawer-wallet-info {
        padding: 12px 16px;
        background: rgba(0, 0, 0, 0.2);
        text-align: center;
        flex-shrink: 0;

        .drawer-wallet-name {
          font-size: 12px;
          opacity: 0.8;
          margin-bottom: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .drawer-wallet-balance {
          font-size: 16px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }
      }

      .drawer-scroll {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding-top: 4px;
      }

      .nav-group {
        margin-top: 4px;
      }

      .nav-group-title {
        display: flex;
        align-items: center;
        height: 32px;
        padding-left: 20px;
        margin-top: 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.5px;
      }

      .nav-section {
        padding: 0;

        a.mat-mdc-list-item {
          height: 44px;
          margin: 1px 12px;
          border-radius: 0 22px 22px 0;
          margin-right: 16px;

          &:hover {
            background: rgba(255, 255, 255, 0.1);
          }

          &.active {
            background: rgba(255, 255, 255, 0.15);
            --mat-list-list-item-label-text-color: white;
            --mat-list-list-item-leading-icon-color: white;
          }

          .mat-icon {
            color: rgba(255, 255, 255, 0.9);
            font-size: 20px;
            width: 20px;
            height: 20px;
            margin-right: 12px;
          }

          .mdc-list-item__primary-text {
            color: rgba(255, 255, 255, 0.9);
            font-size: 14px;
          }

          &.nav-disabled {
            cursor: default;

            &:hover {
              background: transparent;
            }

            .mat-icon,
            .mdc-list-item__primary-text {
              color: rgba(255, 255, 255, 0.35);
            }
          }
        }
      }

      .drawer-footer {
        margin-top: auto;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding: 8px 0;
        flex-shrink: 0;
        --mat-list-list-item-label-text-color: rgba(255, 255, 255, 0.7);
        --mat-list-list-item-leading-icon-color: rgba(255, 255, 255, 0.7);
        --mat-list-list-item-one-line-container-height: 40px;

        a.mat-mdc-list-item {
          height: 40px;
        }
      }

      .wallet-shell {
        display: flex;
        flex-direction: column;
        background: #eaf0f6;
      }

      /* Plain white toolbar — the desktop toolbar (layout/toolbar), which
         is white with dark text/icons. The Phoenix identity gradient lives
         on the page headers and the drawer, not on the top bar. */
      .wallet-toolbar {
        position: relative;
        background-color: white !important;
        color: rgba(0, 0, 0, 0.87) !important;
        padding: 0;
        height: 56px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        flex-shrink: 0;
        z-index: 2;
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
        gap: 10px;
        min-width: 0;
      }

      .app-name {
        font-size: 16px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.87);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Wallet switcher chip — the desktop toolbar's .wallet-button, compact. */
      .wallet-chip {
        min-width: 0;
        padding: 0 8px;
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
          max-width: 96px;
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

          /* BIP-84 sibling of the taproot badge: same family, neutral hue. */
          &.segwit {
            color: #546e7a;
          }

          /* Imported pre-segwit (pkh / sh-wpkh) wallets: amber hue. */
          &.legacy {
            color: #b26a00;
          }

          /* Single-address (wpkh(WIF)) wallets: teal hue, beside segwit. */
          &.single {
            color: #00796b;
          }
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
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* Electrum indicator (the desktop toolbar's .status-indicator),
         sized as a touch target. Same colors as the desktop toolbar. */
      .status-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 56px;
        flex-shrink: 0;

        mat-icon {
          font-size: 22px;
          width: 22px;
          height: 22px;
          color: rgba(0, 0, 0, 0.25);
          transition: color 0.2s ease;

          &.electrum-healthy {
            color: #4caf50;
          }

          &.electrum-degraded {
            color: #ff9800;
          }

          &.electrum-down {
            color: #e53935;
          }

          &.electrum-connecting {
            color: rgba(0, 0, 0, 0.38);
          }
        }

        &.clickable {
          cursor: pointer;
        }
      }

      /* Electrum popover (desktop toolbar's .electrum-popover + the
         summary/footer rows touch needs, since it has no hover tooltip). */
      .electrum-popover {
        padding: 8px 16px 12px;
        min-width: 260px;
        max-width: 92vw;

        /* inherit + opacity: the overlay panel is theme-colored, and
           :host-context can't reach overlay content from this layout. */
        .electrum-popover-title {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: inherit;
          opacity: 0.65;
          margin-bottom: 8px;
        }
      }

      .electrum-summary-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 0 6px;

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          background: rgba(0, 0, 0, 0.25);

          &.ok {
            background: #4caf50;
          }
          &.degraded {
            background: #ff9800;
          }
          &.down {
            background: #e53935;
          }
        }

        .summary-text {
          flex: 1;
          font-size: 12px;
        }

        .summary-meta {
          font-size: 11px;
          color: inherit;
          opacity: 0.55;
          font-variant-numeric: tabular-nums;
        }
      }

      .electrum-popover-divider {
        margin: 6px 0;
      }

      .electrum-footer-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 2px 0;
        font-size: 11px;

        .footer-label {
          color: inherit;
          opacity: 0.55;
        }

        .footer-value {
          font-variant-numeric: tabular-nums;
        }
      }

      .toolbar-right {
        display: flex;
        align-items: center;
        height: 100%;
        flex-shrink: 0;
      }

      .toolbar-separator {
        height: 56px;
        width: 1px;
        background: rgba(0, 0, 0, 0.12);
        flex-shrink: 0;
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
        .wallet-layout,
        .wallet-shell {
          background: #303030;
        }

        .drawer {
          background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
        }

        /* Dark surface with light text — the pre-gradient dark toolbar. */
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

        .status-indicator mat-icon {
          color: rgba(255, 255, 255, 0.3);

          &.electrum-healthy {
            color: #4caf50;
          }

          &.electrum-degraded {
            color: #ff9800;
          }

          &.electrum-down {
            color: #e53935;
          }

          &.electrum-connecting {
            color: rgba(255, 255, 255, 0.45);
          }
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

  /**
   * Drawer groups — the desktop main-layout's navGroups, mapped to the
   * mobile routes: transactions (transactions/send/receive/contacts,
   * desktop's transactions group minus the Core-only PSBT builder) and
   * mining (forging assignment only — the Mining section itself lives in
   * the bottom navigation, so the drawer does not repeat it).
   */
  readonly navGroups: NavGroup[] = [
    {
      id: 'transactions',
      titleKey: 'transactions',
      items: [
        { path: '/wallet/history', icon: 'compare_arrows', labelKey: 'transactions' },
        { path: '/wallet/send', icon: 'send', labelKey: 'send', needsWallet: true },
        { path: '/wallet/receive', icon: 'call_received', labelKey: 'receive', needsWallet: true },
        { path: '/wallet/contacts', icon: 'contacts', labelKey: 'contacts' },
      ],
    },
    {
      id: 'mining',
      titleKey: 'mining',
      items: [{ path: '/wallet/assignment', icon: 'swap_horiz', labelKey: 'forging_assignment' }],
    },
  ];

  /** Name of the wallet a switch is in flight for, or null. */
  readonly switching = signal<string | null>(null);

  /**
   * Chain tip snapshot for the Electrum popover's "last block" row —
   * fetched when the popover opens (no polling of our own).
   */
  readonly chain = signal<BtcxChainInfo | null>(null);

  ngOnInit(): void {
    // Lazy init: only mobile wallet routes touch the btcx wallet backend
    void this.wallet.initialize();
  }

  /** Popover open: fresh server snapshots + tip header (last block time). */
  onElectrumMenuOpened(): void {
    void this.electrumStatus.refreshServers();
    if (this.wallet.hasElectrumServer()) {
      void this.wallet
        .chainInfo()
        .then(info => this.chain.set(info))
        .catch(err => console.warn('Failed to fetch chain info:', err));
    }
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

  /** Tooltip of the Electrum indicator (the desktop toolbar's, slim). */
  electrumTooltip(): string {
    const parts = [this.i18n.get(`electrum_status_${this.electrumStatus.overall()}`)];
    const height = this.electrumStatus.height();
    if (height !== null) parts.push(`#${height}`);
    return parts.join(' · ');
  }

  setLanguage(lang: Language): void {
    this.i18n.setLanguageByCode(lang.code);
  }
}
