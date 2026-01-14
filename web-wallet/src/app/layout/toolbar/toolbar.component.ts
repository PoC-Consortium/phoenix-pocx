import { Component, inject, signal, input, output, OnInit, OnDestroy } from '@angular/core';

import { Router, RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, takeUntil } from 'rxjs';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService, LANGUAGES, Language } from '../../core/i18n';
import {
  WalletManagerService,
  WalletSummary,
} from '../../bitcoin/services/wallet/wallet-manager.service';
import { RpcClientService } from '../../bitcoin/services/rpc/rpc-client.service';
import { selectNetwork } from '../../store/settings/settings.selectors';
import { Network } from '../../store/settings/settings.state';
import { NodeService } from '../../node';
import { MiningService } from '../../mining/services';

/**
 * Shared toolbar component matching original Phoenix wallet design.
 * Used across all views (auth and protected routes).
 */
@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    I18nPipe,
  ],
  template: `
    <mat-toolbar class="toolbar">
      <!-- Network Stamp (centered) - matching original Phoenix style with stamp texture -->
      @if (network() !== 'mainnet') {
        <div
          class="network-stamp"
          [class.testnet]="network() === 'testnet'"
          [class.regtest]="network() === 'regtest'"
        >
          {{ network() === 'testnet' ? 'TestNet' : 'RegTest' }}
        </div>
      }

      <div class="toolbar-content">
        <!-- Left Side: Hamburger + Settings + Logo -->
        <div class="toolbar-left">
          <!-- Hamburger Menu Button (toggles sidenav) -->
          @if (showSidenavToggle()) {
            <button
              mat-button
              class="action-button icon-button"
              (click)="sidenavToggle.emit()"
              [matTooltip]="'toggle_menu' | i18n"
            >
              <mat-icon class="secondary-text">menu</mat-icon>
            </button>

            <div class="toolbar-separator"></div>
          }

          <!-- Status Indicators -->
          <div class="status-indicators">
            <!-- Node Indicator (only for managed node) -->
            @if (nodeService.isManaged()) {
              <div
                class="status-indicator"
                [matTooltip]="
                  nodeService.isRunning() ? ('node_running' | i18n) : ('node_stopped' | i18n)
                "
              >
                <mat-icon [class.active]="nodeService.isRunning()">share</mat-icon>
              </div>
            }

            <!-- Miner Indicator (only if mining configured) -->
            @if (miningService.isConfigured()) {
              <div
                class="status-indicator"
                [matTooltip]="
                  miningService.minerRunning() ? ('miner_running' | i18n) : ('miner_stopped' | i18n)
                "
              >
                <mat-icon [class.active]="miningService.minerRunning()">hardware</mat-icon>
              </div>
            }

            <!-- Plotter Indicator (visible when there's work to do or actively plotting) -->
            @if (miningService.plotterUIState() !== 'complete') {
              <div
                class="status-indicator"
                [matTooltip]="
                  miningService.plotterUIState() === 'plotting' ||
                  miningService.plotterUIState() === 'stopping'
                    ? ('plotting_active' | i18n)
                    : ('plotting_pending' | i18n)
                "
              >
                <mat-icon
                  [class.active]="
                    miningService.plotterUIState() === 'plotting' ||
                    miningService.plotterUIState() === 'stopping'
                  "
                  >storage</mat-icon
                >
              </div>
            }
          </div>

          <div class="logo">
            <img
              class="logo-icon"
              src="assets/images/logos/icon_white.svg"
              alt="Phoenix PoCX Logo"
            />
          </div>
        </div>

        <!-- Right Side: Wallet selector + Language -->
        <div class="toolbar-right">
          <!-- Wallet Selector (only if wallets available) -->
          @if (wallets().length > 0) {
            <button mat-button [matMenuTriggerFor]="walletMenu" class="action-button wallet-button">
              <div class="wallet-selector-content">
                <mat-icon class="wallet-icon" [class.has-wallet]="currentWalletName()"
                  >account_balance_wallet</mat-icon
                >
                <span class="wallet-name">{{
                  currentWalletName() || ('select_wallet' | i18n)
                }}</span>
                <mat-icon class="dropdown-arrow">keyboard_arrow_down</mat-icon>
              </div>
            </button>

            <mat-menu #walletMenu="matMenu" class="wallet-dropdown-menu">
              <button mat-menu-item (click)="manageWallets()" class="manage-wallets-item">
                <mat-icon>settings</mat-icon>
                <span>{{ 'manage_wallets' | i18n }}</span>
              </button>
              <mat-divider></mat-divider>
              @for (wallet of wallets(); track wallet.name) {
                <button
                  mat-menu-item
                  class="wallet-row"
                  [class.wallet-loaded]="wallet.isLoaded"
                  [class.wallet-unloaded]="!wallet.isLoaded"
                  (click)="selectWallet(wallet)"
                  [disabled]="isWalletLoading(wallet.name)"
                >
                  <div class="wallet-row-content">
                    <!-- Column 1: Wallet icon -->
                    <mat-icon class="wallet-row-icon">account_balance_wallet</mat-icon>
                    <!-- Column 2: Wallet name -->
                    <span class="wallet-row-name">{{ wallet.name || '(default)' }}</span>
                    <!-- Column 3: Watch-only indicator (only for loaded watch-only wallets) -->
                    @if (wallet.isLoaded && wallet.isWatchOnly) {
                      <mat-icon class="wallet-row-watch" matTooltip="{{ 'watch_only' | i18n }}"
                        >visibility</mat-icon
                      >
                    } @else {
                      <span class="wallet-row-watch-placeholder"></span>
                    }
                    <!-- Column 4: Lock status (only for loaded non-watch-only wallets) -->
                    @if (wallet.isLoaded && !wallet.isWatchOnly) {
                      <mat-icon class="wallet-row-lock">{{
                        wallet.isEncrypted ? 'lock' : 'lock_open'
                      }}</mat-icon>
                    } @else if (!wallet.isWatchOnly) {
                      <span class="wallet-row-lock-placeholder"></span>
                    }
                    <!-- Column 5: Eject button (only for loaded wallets) -->
                    @if (wallet.isLoaded) {
                      <mat-icon
                        class="wallet-row-eject"
                        (click)="ejectWallet(wallet, $event)"
                        matTooltip="{{ 'unload_wallet' | i18n }}"
                        >eject</mat-icon
                      >
                    } @else {
                      <span class="wallet-row-eject-placeholder"></span>
                    }
                    <!-- Loading spinner -->
                    @if (isWalletLoading(wallet.name)) {
                      <mat-spinner diameter="16" class="wallet-row-spinner"></mat-spinner>
                    }
                  </div>
                </button>
              }
            </mat-menu>

            <div class="toolbar-separator"></div>
          }

          <!-- Settings Button (gear icon) -->
          <button
            mat-button
            class="action-button icon-button"
            [routerLink]="['/settings']"
            [matTooltip]="'settings' | i18n"
          >
            <mat-icon class="secondary-text">settings</mat-icon>
          </button>

          <div class="toolbar-separator"></div>

          <!-- Language Selector -->
          <button mat-button [matMenuTriggerFor]="langMenu" class="action-button lang-button">
            <!-- Show language name on large screens -->
            <span class="lang-name-text">{{ i18n.currentLanguageName() }}</span>
            <!-- Show globe icon on small screens -->
            <mat-icon class="lang-icon secondary-text">language</mat-icon>
          </button>

          <mat-menu #langMenu="matMenu" class="lang-dropdown-menu">
            @for (lang of languages; track lang.code) {
              <button mat-menu-item (click)="setLanguage(lang)">
                {{ lang.nativeName }}
              </button>
            }
          </mat-menu>
        </div>
      </div>
    </mat-toolbar>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        flex: 0 0 auto;
        z-index: 4;
      }

      .toolbar {
        position: relative;
        background-color: white !important;
        color: rgba(0, 0, 0, 0.87) !important;
        padding: 0;
        height: 64px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

        /* Ensure all text/buttons inside toolbar have correct colors */
        button,
        a,
        span {
          color: inherit;
        }
      }

      /* TestNet stamp with worn texture effect matching original */
      .network-stamp {
        position: absolute;
        left: calc(50% - 45px);
        top: 50%;
        transform: translateY(-50%);
        font-size: 1.25rem;
        font-weight: 700;
        display: inline-block;
        padding: 0.15rem 0.6rem;
        text-transform: uppercase;
        border-radius: 0.5rem;
        font-family: 'Courier', serif;
        z-index: 1;
        pointer-events: none;
        mix-blend-mode: multiply;

        &.testnet {
          color: #d23;
          border: 3px double #d23;
        }

        &.regtest {
          color: #2196f3;
          border: 3px double #2196f3;
        }
      }

      .toolbar-content {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: space-between;
        color: rgba(0, 0, 0, 0.87);
      }

      .toolbar-left {
        display: flex;
        align-items: center;
        height: 100%;
      }

      .toolbar-right {
        display: flex;
        align-items: center;
        height: 100%;
      }

      .action-button {
        min-width: 64px;
        height: 64px;
        border-radius: 0;
      }

      .icon-button {
        min-width: 56px;
        width: 56px;
        padding: 0 !important;
        border: none;
        justify-content: center !important;

        mat-icon {
          font-size: 24px;
          width: 24px;
          height: 24px;
          margin: 0 !important;
        }
      }

      .toolbar-separator {
        height: 64px;
        width: 1px;
        background: rgba(0, 0, 0, 0.12);
      }

      .secondary-text {
        color: rgba(0, 0, 0, 0.54);
      }

      .logo {
        display: flex;
        align-items: center;
        padding: 0 16px;

        .logo-icon {
          width: 38px;
          height: 38px;
        }
      }

      /* Wallet button in toolbar */
      .wallet-button {
        .wallet-selector-content {
          display: flex;
          align-items: center;
          gap: 8px;

          .wallet-icon {
            color: rgba(0, 0, 0, 0.54);
            font-size: 20px;
            width: 20px;
            height: 20px;

            &.has-wallet {
              color: rgba(0, 0, 0, 0.87);
            }

            &.watch-only {
              color: #2196f3;
            }
          }

          .wallet-name {
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgba(0, 0, 0, 0.87);
          }

          .dropdown-arrow {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }
      }

      /* Language button - responsive behavior */
      .lang-button {
        .lang-name-text {
          color: rgba(0, 0, 0, 0.87);
          display: inline;
        }

        .lang-icon {
          display: none;
          font-size: 24px;
          width: 24px;
          height: 24px;
        }

        /* On screens < 1280px, show icon instead of text */
        @media (max-width: 1279px) {
          .lang-name-text {
            display: none;
          }

          .lang-icon {
            display: inline;
          }
        }
      }

      /* Manage wallets menu item */
      .manage-wallets-item {
        text-decoration: none !important;
      }

      /* Remove focus ring from icon buttons on initial load */
      .icon-button:focus {
        outline: none;
      }

      /* Status Indicators (node, miner, plotter) */
      .status-indicators {
        display: flex;
        align-items: center;
        height: 64px;
        padding: 0 12px;
        gap: 8px;
      }

      .status-indicator {
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 22px;
          width: 22px;
          height: 22px;
          color: rgba(0, 0, 0, 0.25);
          transition: color 0.2s ease;

          &.active {
            color: #4caf50;
          }
        }
      }

      /* Responsive */
      @media (max-width: 600px) {
        .toolbar {
          height: 56px;
        }

        .action-button {
          min-width: 56px;
          height: 56px;
        }

        .icon-button {
          min-width: 48px;
          width: 48px;

          mat-icon {
            font-size: 22px;
            width: 22px;
            height: 22px;
          }
        }

        .toolbar-separator {
          height: 56px;
        }

        .status-indicators {
          height: 56px;
          padding: 0 8px;
          gap: 6px;
        }

        .status-indicator mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }

        .network-stamp {
          font-size: 1rem;
          padding: 0.1rem 0.4rem;
          left: calc(50% - 35px);
        }
      }
    `,
  ],
})
export class ToolbarComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly store = inject(Store);
  private readonly walletManager = inject(WalletManagerService);
  private readonly rpcClient = inject(RpcClientService);
  readonly i18n = inject(I18nService);
  readonly nodeService = inject(NodeService);
  readonly miningService = inject(MiningService);
  private readonly destroy$ = new Subject<void>();

  // Inputs
  showSidenavToggle = input<boolean>(true);

  // Outputs
  sidenavToggle = output<void>();

  // State
  currentWalletName = signal<string | null>(null);
  wallets = signal<WalletSummary[]>([]);
  network = signal<Network>('testnet');

  // Loading tracking
  loadingWallets = new Set<string>();

  // Languages
  languages: Language[] = LANGUAGES;

  ngOnInit(): void {
    // Subscribe to network changes
    this.store
      .select(selectNetwork)
      .pipe(takeUntil(this.destroy$))
      .subscribe(network => {
        this.network.set(network);
      });

    // Subscribe to active wallet changes
    this.walletManager.activeWallet$.pipe(takeUntil(this.destroy$)).subscribe(walletName => {
      this.currentWalletName.set(walletName);
    });

    // Subscribe to wallet changes (sync with other components)
    this.walletManager.walletsChanged$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.loadWallets();
    });

    // Load wallets list
    this.loadWallets();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadWallets(): Promise<void> {
    try {
      const summaries = await this.walletManager.getWalletSummaries();
      this.wallets.set(summaries);
    } catch {
      // Ignore errors - wallets may not be available yet
      this.wallets.set([]);
    }
  }

  isCurrentWalletWatchOnly(): boolean {
    const currentName = this.currentWalletName();
    if (!currentName) return false;
    const wallet = this.wallets().find(w => w.name === currentName);
    return wallet?.isWatchOnly ?? false;
  }

  isWalletLoading(walletName: string): boolean {
    return this.loadingWallets.has(walletName);
  }

  async selectWallet(wallet: WalletSummary): Promise<void> {
    if (this.isWalletLoading(wallet.name)) return;

    this.loadingWallets.add(wallet.name);

    try {
      // Load wallet if not loaded
      if (!wallet.isLoaded) {
        await this.walletManager.loadWallet(wallet.name);
      }

      // Set as active wallet
      this.walletManager.setActiveWallet(wallet.name);

      // Smart navigation based on current route
      const currentUrl = this.router.url;
      const routesThatStay = [
        '/dashboard',
        '/transactions',
        '/send',
        '/receive',
        '/forging',
        '/settings',
        '/peers',
        '/contacts',
      ];

      // Check if current route should stay (exact match or starts with)
      const shouldStay = routesThatStay.some(
        route => currentUrl === route || currentUrl.startsWith(route + '/')
      );

      // Transaction detail pages should navigate to transactions list
      // (the txid may not exist in the new wallet)
      if (currentUrl.startsWith('/transactions/')) {
        this.router.navigate(['/transactions']);
      }
      // Wallet management and other pages navigate to dashboard
      else if (!shouldStay) {
        this.router.navigate(['/dashboard']);
      }
      // Otherwise stay on current page - data will auto-refresh via WalletService

      // Refresh wallet list
      await this.loadWallets();
    } catch (error) {
      console.error('Failed to select wallet:', error);
    } finally {
      this.loadingWallets.delete(wallet.name);
    }
  }

  async ejectWallet(wallet: WalletSummary, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.isWalletLoading(wallet.name)) return;

    this.loadingWallets.add(wallet.name);

    try {
      await this.walletManager.unloadWallet(wallet.name);

      // If we ejected the active wallet, navigate to wallet select
      if (this.currentWalletName() === wallet.name) {
        this.router.navigate(['/auth']);
      }

      // Refresh wallet list
      await this.loadWallets();
    } catch (error) {
      console.error('Failed to eject wallet:', error);
    } finally {
      this.loadingWallets.delete(wallet.name);
    }
  }

  setLanguage(lang: Language): void {
    this.i18n.setLanguageByCode(lang.code);
  }

  manageWallets(): void {
    // Clear active wallet and navigate to wallet selection
    this.walletManager.setActiveWallet(null);
    this.router.navigate(['/auth']);
  }
}
