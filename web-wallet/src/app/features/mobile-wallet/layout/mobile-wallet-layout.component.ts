import { Component, computed, effect, inject, signal, viewChild, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, map } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
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
  BtcxCompartment,
  BtcxWalletGroup,
  BtcxChainInfo,
} from '../../../core/services/btcx-wallet.service';
import { ElectrumStatusService } from '../../../core/services/electrum-status.service';
import { MiningService } from '../../../mining/services/mining.service';
import { AppModeService } from '../../../core/services/app-mode.service';
import { ViewportService } from '../../../core/services/viewport.service';
import { AppUpdateService } from '../../../core/services/app-update.service';
import { BtcxPipe, TimeAgoPipe } from '../../../shared/pipes';
import { NotificationService } from '../../../shared/services';
import { WalletGroupMenuComponent } from '../../../shared/components';
import { MobileNavComponent } from '../../../shared/components/mobile-nav/mobile-nav.component';
import { FitTextDirective } from '../../../shared/directives';
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
    MatDialogModule,
    MatIconModule,
    MatDividerModule,
    MatListModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSidenavModule,
    MatTooltipModule,
    MobileNavComponent,
    ElectrumServerListComponent,
    WalletGroupMenuComponent,
    FitTextDirective,
    BtcxPipe,
    TimeAgoPipe,
    I18nPipe,
    DecimalPipe,
  ],
  template: `
    <mat-sidenav-container class="wallet-layout">
      <!-- Navigation drawer (the desktop main-layout sidenav, mobile-sized) -->
      <!-- Menu behavior is the shared app-wide rule (ViewportService.menuOverlay):
           overlay + hamburger up to the tablet tier, docked-open above it —
           identical to the desktop main-layout sidenav. -->
      <mat-sidenav
        #drawer
        [mode]="viewport.menuOverlay() ? 'over' : 'side'"
        [opened]="!viewport.menuOverlay()"
        class="drawer"
        [fixedInViewport]="false"
      >
        <div class="drawer-header">
          <img src="assets/images/logos/phoenix_v.svg" alt="Phoenix" class="drawer-logo" />
          <div class="drawer-title-block">
            <span class="drawer-title">Phoenix Wallet</span>
            @if (appVersion()) {
              <div class="header-version" (click)="onVersionClick()">
                <span class="version-text">v{{ appVersion() }}</span>
                @if (showUpdateBadge()) {
                  <span class="update-badge" title="{{ 'update_available' | i18n }}">
                    <mat-icon>arrow_upward</mat-icon>
                  </span>
                }
              </div>
            }
          </div>
          <button mat-icon-button class="drawer-close" (click)="drawer.close()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        @if (wallet.hasSeed()) {
          <div class="drawer-wallet-info">
            <div class="drawer-wallet-name">{{ activeLabel() }}</div>
            <div class="drawer-wallet-balance" appFitText [fitTextMinPx]="11">
              {{ (wallet.balance()?.totalSat ?? 0) / 100000000 | btcx }}&nbsp;BTCX
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
              (click)="viewport.menuOverlay() && drawer.close()"
            >
              <mat-icon matListItemIcon>dashboard</mat-icon>
              <span matListItemTitle>{{ 'dashboard' | i18n }}</span>
            </a>
          </mat-nav-list>

          @for (group of navGroups(); track group.id) {
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
                    (click)="!disabled && viewport.menuOverlay() && drawer.close()"
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
              (click)="viewport.menuOverlay() && drawer.close()"
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

              <!-- Miner indicator (the desktop toolbar's hardware icon,
                   right next to the electrum bolt; the plotter icon is
                   deliberately omitted — no toolbar space) -->
              @if (miningAvailable() && miningService.isConfigured()) {
                <div
                  class="status-indicator"
                  [matTooltip]="
                    miningService.minerActive()
                      ? ('miner_running' | i18n)
                      : ('miner_stopped' | i18n)
                  "
                >
                  <mat-icon [class.miner-active]="miningService.minerActive()">hardware</mat-icon>
                </div>
              }
            </div>

            <div class="toolbar-right">
              @if (wallet.hasSeed() && !onMiningPage()) {
                <!-- Wallet switcher chip (desktop toolbar's wallet selector) -->
                <!-- Icon-only chip: the toolbar is too narrow for names —
                     the drawer header carries the full wallet · pocket
                     label. -->
                <button
                  mat-button
                  class="action-button wallet-chip icon-chip"
                  #walletMenuTrigger="matMenuTrigger"
                  [matMenuTriggerFor]="walletMenu"
                  [matTooltip]="activeGroupName()"
                  (menuOpened)="onWalletMenuOpened()"
                >
                  <div class="wallet-chip-content">
                    <mat-icon class="wallet-icon">account_balance_wallet</mat-icon>
                  </div>
                </button>

                <mat-menu #walletMenu="matMenu" class="wallet-dropdown-menu">
                  <!-- Shared switcher content (also the desktop-remote
                       toolbar's): swipe-able GROUP rows + create/restore/
                       import — pockets live in the pocket chip. -->
                  <app-wallet-group-menu
                    #groupMenu
                    [switching]="switchingGroup()"
                    createLink="/wallet/create"
                    restoreLink="/wallet/restore"
                    importLink="/wallet/import"
                    (selectGroup)="switchToGroup($event)"
                    (requestClose)="walletMenuTrigger.closeMenu()"
                  /></mat-menu>

                <!-- Pocket chip (icon-only): the active wallet's
                     compartments, greyed out while nothing is open or
                     there is only one. -->
                <button
                  mat-button
                  class="action-button wallet-chip pocket-chip icon-chip"
                  [matMenuTriggerFor]="pocketMenu"
                  [disabled]="activePockets().length < 2 || switching() !== null"
                  [matTooltip]="activePocketShort() || ('wallet_pocket' | i18n)"
                  (menuOpened)="onPocketMenuOpened()"
                >
                  <div class="wallet-chip-content">
                    @if (switching() !== null) {
                      <mat-spinner diameter="14"></mat-spinner>
                    } @else {
                      <mat-icon class="wallet-icon">layers</mat-icon>
                    }
                  </div>
                </button>

                <mat-menu #pocketMenu="matMenu" class="wallet-dropdown-menu">
                  @for (c of activePockets(); track c.name) {
                    <button
                      mat-menu-item
                      class="wallet-row"
                      [disabled]="switching() !== null"
                      (click)="switchTo(c)"
                    >
                      <div class="wallet-row-content">
                        <mat-icon class="wallet-row-icon pocket-icon" [class.active]="c.isActive">{{
                          c.isActive ? 'radio_button_checked' : 'radio_button_unchecked'
                        }}</mat-icon>
                        <span class="wallet-row-name">{{ roleLabel(c) | i18n }}</span>
                        @if (c.policy.coinType === 0) {
                          <span class="wallet-row-badge legacy">{{
                            'wallet_legacy_badge' | i18n
                          }}</span>
                        }
                        @if (c.balanceSat !== undefined) {
                          <span class="wallet-row-balance">
                            {{ c.balanceSat / 100000000 | btcx }}
                            @if (staleness(c); as s) {
                              <span class="wallet-row-stale">· {{ s }}</span>
                            }
                          </span>
                        }
                        @if (switching() === c.name) {
                          <mat-spinner diameter="16" class="wallet-row-spinner"></mat-spinner>
                        }
                      </div>
                    </button>
                  }
                </mat-menu>

                <div class="toolbar-separator"></div>
              }

              <!-- On the mining pages the gear is the MINER's settings
                   (the setup wizard), like the mining-only shell. -->
              <button
                mat-button
                class="action-button icon-button"
                [routerLink]="onMiningPage() ? '/wallet/mining/setup' : '/wallet/settings'"
                [matTooltip]="(onMiningPage() ? 'mining_setup' : 'mwallet_settings_title') | i18n"
              >
                <mat-icon class="secondary-text">settings</mat-icon>
              </button>

              <div class="toolbar-separator"></div>

              <button mat-button [matMenuTriggerFor]="langMenu" class="action-button lang-button">
                <span class="lang-name-text">{{ i18n.currentLanguageName() }}</span>
                <mat-icon class="lang-icon secondary-text">language</mat-icon>
              </button>

              <!-- lang-menu-panel caps the panel height so the ~26-locale
                   list always fits in the space below the trigger and scrolls
                   internally, instead of the CDK overlay pushing it up to the
                   top of the viewport (under the status bar / notch). -->
              <mat-menu
                #langMenu="matMenu"
                class="lang-menu-panel"
                yPosition="below"
                [overlapTrigger]="false"
              >
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
      @use 'breakpoints' as bp;

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
        width: var(--menu-width);
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
        --mat-list-list-item-one-line-container-height: var(--menu-item-h);
        --mat-list-list-item-label-text-size: 14px;
      }

      .drawer-header {
        position: relative;
        display: flex;
        align-items: center;
        height: var(--toolbar-h);
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

      .drawer-title-block {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      /* The desktop sidenav's version line, following the same rule: visible
         only while the drawer is DOCKED (> tablet tier). */
      .header-version {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        margin-top: 1px;

        .version-text {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.5);
        }

        .update-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          background: #4caf50;
          border-radius: 50%;

          .mat-icon {
            font-size: 10px;
            width: 10px;
            height: 10px;
            color: white;
          }
        }

        &:hover .version-text {
          color: rgba(255, 255, 255, 0.8);
        }
      }

      @include bp.tablet-down {
        .header-version {
          display: none;
        }
      }

      .drawer-title {
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
        height: var(--menu-balance-h);
        padding: 0 16px;
        background: rgba(0, 0, 0, 0.2);
        text-align: center;
        flex-shrink: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;

        .drawer-wallet-name {
          font-size: 12px;
          opacity: 0.8;
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .drawer-wallet-balance {
          font-size: 17px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          /* Never break between amount and unit — FitText shrinks instead. */
          white-space: nowrap;
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
        height: var(--toolbar-h);
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

        .wallet-row-balance {
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: rgba(0, 0, 0, 0.5);
          flex-shrink: 0;

          .wallet-row-stale {
            font-size: 10px;
            color: rgba(0, 0, 0, 0.4);
          }
        }

        .pocket-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }

      /* Icon-only chips: the toolbar is too narrow for names — tooltips
         and the drawer header carry the labels. */
      .icon-chip {
        min-width: 40px;
        padding: 0 4px;

        &:disabled .wallet-chip-content {
          opacity: 0.45;
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

          &.miner-active {
            color: #4caf50;
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

        @include bp.phone {
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

          &.miner-active {
            color: #4caf50;
          }
        }
      }

      /* Cap the language menu so its ~26 items fit below the toolbar trigger
         and scroll internally, keeping the panel anchored under the button
         rather than pushed up under the Android status bar / notch. */
      ::ng-deep .lang-menu-panel {
        /* Fill from just below the trigger down to (near) the bottom of the
           screen, rather than a fixed cap that stops mid-screen. Subtract the
           top safe-area inset + toolbar height so the panel still fits in the
           space below the trigger (staying anchored below instead of flipping
           up under the notch). dvh (not vh) tracks the true visible height on
           iOS; content is already pushed down by env(safe-area-inset-top)
           globally (styles.scss), so subtract that inset + the 56px toolbar. */
        max-height: calc(100dvh - env(safe-area-inset-top, 0px) - 56px);
        overflow-y: auto;
      }
    `,
  ],
})
export class MobileWalletLayoutComponent implements OnInit {
  readonly i18n = inject(I18nService);
  readonly wallet = inject(BtcxWalletService);
  readonly electrumStatus = inject(ElectrumStatusService);
  readonly viewport = inject(ViewportService);
  readonly miningService = inject(MiningService);
  private readonly appMode = inject(AppModeService);
  /** Mining exists in this shell (hybrid flavors) — wallet-only has none. */
  readonly miningAvailable = computed(() => this.appMode.miningEnabled());

  private readonly router = inject(Router);

  /** Current router url (NavigationEnd-driven). */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url)
    ),
    { initialValue: this.router.url }
  );

  /** Mining dashboard/setup: wallet chrome (chips) hides, gear goes to setup. */
  readonly onMiningPage = computed(() => this.currentUrl().startsWith('/wallet/mining'));
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly appUpdateService = inject(AppUpdateService);

  readonly appVersion = computed(() => this.appUpdateService.currentVersion());
  readonly showUpdateBadge = computed(() => this.appUpdateService.showUpdateBadge());

  /** The desktop sidenav's version-tap: open the update dialog when one is pending. */
  async onVersionClick(): Promise<void> {
    const updateInfo = this.appUpdateService.updateInfo();
    if (!updateInfo) {
      return;
    }
    const { UpdateDialogComponent } =
      await import('../../../shared/components/update-dialog/update-dialog.component');
    const dialogRef = this.dialog.open(UpdateDialogComponent, {
      data: updateInfo,
      disableClose: false,
      autoFocus: false,
    });
    dialogRef.afterClosed().subscribe((result: { dismissed?: boolean } | null) => {
      if (result?.dismissed) {
        this.appUpdateService.dismissUpdate();
      }
    });
  }

  languages: Language[] = LANGUAGES;

  /**
   * Drawer groups — the desktop main-layout's navGroups, mapped to the
   * mobile routes: transactions (transactions/send/receive/contacts,
   * desktop's transactions group minus the Core-only PSBT builder) and
   * mining (forging assignment only — the Mining section itself lives in
   * the bottom navigation, so the drawer does not repeat it).
   *
   * Wallet-only mode is "transactions only": the mining group (forging
   * assignment) is omitted entirely there.
   */
  readonly navGroups = computed<NavGroup[]>(() => {
    const groups: NavGroup[] = [
      {
        id: 'transactions',
        titleKey: 'transactions',
        items: [
          { path: '/wallet/history', icon: 'compare_arrows', labelKey: 'transactions' },
          { path: '/wallet/send', icon: 'send', labelKey: 'send', needsWallet: true },
          {
            path: '/wallet/receive',
            icon: 'call_received',
            labelKey: 'receive',
            needsWallet: true,
          },
          {
            path: '/wallet/psbt',
            icon: 'edit_document',
            labelKey: 'psbt_title',
            needsWallet: true,
          },
          { path: '/wallet/contacts', icon: 'contacts', labelKey: 'contacts' },
        ],
      },
    ];

    if (!this.appMode.isWalletOnly()) {
      groups.push({
        id: 'mining',
        titleKey: 'mining',
        items: [
          // Mining dashboard in the menu whenever this build/mode actually
          // mines (hybrid mobile) — same destination as the bottom tab.
          ...(this.appMode.miningEnabled()
            ? [{ path: '/wallet/mining', icon: 'memory', labelKey: 'mining_dashboard' }]
            : []),
          { path: '/wallet/assignment', icon: 'swap_horiz', labelKey: 'forging_assignment' },
        ],
      });
    }

    return groups;
  });

  /** Name of the wallet a switch is in flight for, or null. */
  readonly switching = signal<string | null>(null);

  /**
   * Chain tip snapshot for the Electrum popover's "last block" row —
   * fetched when the popover opens (no polling of our own).
   */
  readonly chain = signal<BtcxChainInfo | null>(null);

  constructor() {
    // Hybrid flavors: hook up miner state + events so the toolbar's miner
    // indicator is live without ever visiting the mining dashboard.
    // Effect (not ngOnInit): launch-mode flags resolve ASYNC, so at init
    // time miningAvailable() may still be false — this fires when it
    // flips (initializeMining is idempotent).
    effect(() => {
      if (this.miningAvailable()) {
        void this.miningService.initializeMining();
      }
    });
  }

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

  /** Refresh the registry snapshots whenever the switcher opens. */
  onWalletMenuOpened(): void {
    void this.wallet.refreshWallets();
    void this.wallet.refreshGroups();
    this.groupMenu()?.resetReveal();
  }

  /**
   * Refresh the ACTIVE group's balance snapshots (sequential one-shot
   * sync) whenever the pocket chip opens — balances land as they sync.
   * Per-pocket failures keep their stale snapshot; they are SURFACED (a
   * silently-stale pocket balance reads as "frozen funds").
   */
  onPocketMenuOpened(): void {
    const group = this.activeGroup();
    if (!group) return;
    void this.wallet.groupSync(group.group).then(result => {
      if (result?.syncErrors?.length) {
        this.notification.error(result.syncErrors[0]);
      }
    });
  }

  /**
   * Relative age of a NON-LIVE pocket balance ("12m", "3h", "2d") — the
   * honesty marker for snapshot-sourced numbers. Empty for the open
   * pocket and for fresh (< 1 minute) snapshots.
   */
  staleness(c: BtcxCompartment): string {
    if (c.isOpen || !c.snapshotAt) return '';
    const secs = Math.max(0, Math.floor(Date.now() / 1000) - c.snapshotAt);
    if (secs < 60) return '';
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
    return `${Math.floor(secs / 86400)}d`;
  }

  /** The group holding the active wallet, if any. */
  readonly activeGroup = computed<BtcxWalletGroup | null>(() => {
    const name = this.wallet.walletName();
    return this.wallet.groups().find(g => g.compartments.some(c => c.name === name)) ?? null;
  });

  /** Wallet chip label: the GROUP name only (the pocket chip has the rest). */
  readonly activeGroupName = computed(() => this.activeGroup()?.group ?? this.wallet.walletName());

  /** The active group's pockets ([] while nothing matches). */
  readonly activePockets = computed<BtcxCompartment[]>(
    () => this.activeGroup()?.compartments ?? []
  );

  /** Pocket chip label: short role of the ACTIVE pocket ("SegWit·v30"). */
  readonly activePocketShort = computed<string | null>(() => {
    const name = this.wallet.walletName();
    const pocket = this.activePockets().find(c => c.name === name);
    if (!pocket) return null;
    const role = this.i18n.get(this.roleLabel(pocket));
    return pocket.policy.coinType === 0 ? `${role}·${this.i18n.get('wallet_legacy_badge')}` : role;
  });

  /** Drawer label of the active wallet: "group · Role". */
  readonly activeLabel = computed(() => {
    const short = this.activePocketShort();
    const group = this.activeGroupName();
    if (!short || this.activePockets().length < 2) return group;
    return `${group} · ${short}`;
  });

  /** i18n key of a pocket's role label. */
  roleLabel(c: BtcxCompartment): string {
    switch (c.policy.kind) {
      case 'bip86':
        return 'mwallet_kind_taproot';
      case 'legacy':
        return 'mwallet_kind_legacy';
      default:
        return 'mwallet_kind_segwit';
    }
  }

  /** Name of the group a switch is running for (chip spinner), or null. */
  readonly switchingGroup = computed<string | null>(() => {
    const name = this.switching();
    if (name === null) return null;
    return this.wallet.groups().find(g => g.compartments.some(c => c.name === name))?.group ?? name;
  });

  /**
   * Switch to a GROUP: opens its last-selected pocket (the registry's
   * active member), falling back to the primary (current SegWit).
   */
  async switchToGroup(g: BtcxWalletGroup): Promise<void> {
    if (g.isActive) return;
    const pocket = g.compartments.find(c => c.isActive) ?? g.compartments[0];
    await this.switchTo(pocket);
  }

  // ==========================================================================
  // Wallet switcher — the shared WalletGroupMenuComponent carries the rows
  // (swipe rename/delete included); this host only switches groups.
  // ==========================================================================

  private readonly groupMenu = viewChild(WalletGroupMenuComponent);

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
