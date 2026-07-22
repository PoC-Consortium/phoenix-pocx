import {
  Component,
  inject,
  signal,
  computed,
  input,
  output,
  OnInit,
  OnDestroy,
} from '@angular/core';

import { DecimalPipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { Subject, takeUntil } from 'rxjs';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService, LANGUAGES, Language } from '../../core/i18n';
import {
  WalletManagerService,
  WalletSummary,
} from '../../bitcoin/services/wallet/wallet-manager.service';
import { WalletUnlockService } from '../../shared/services/wallet-unlock.service';
import { RpcClientService } from '../../bitcoin/services/rpc/rpc-client.service';
import { selectNetwork } from '../../store/settings/settings.selectors';
import { Network } from '../../store/settings/settings.state';
import { NodeService } from '../../node';
import { MiningService } from '../../mining/services';
import { ClockDriftService } from '../../core/services/clock-drift.service';
import { ElectrumStatusService } from '../../core/services/electrum-status.service';
import { BlockchainStateService } from '../../bitcoin/services/blockchain-state.service';
import { BtcxWalletService, BtcxCompartment } from '../../core/services/btcx-wallet.service';
import { ClockDriftDialogComponent } from '../../shared/components/clock-drift-dialog/clock-drift-dialog.component';
import { ElectrumServerListComponent } from '../../shared/components/electrum-server-list/electrum-server-list.component';

/**
 * Shared toolbar component matching original Phoenix wallet design.
 * Used across all views (auth and protected routes).
 */
@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [
    DecimalPipe,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    I18nPipe,
    ElectrumServerListComponent,
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
            <!-- Node Indicator (Core/RPC modes: managed + external) — traffic
                 light: green = peers, orange = connected but 0 peers (own-fork
                 risk), red = disconnected. -->
            @if (!nodeService.isRemote()) {
              <div class="status-indicator" [matTooltip]="nodeIndicatorTooltip()">
                <mat-icon
                  [class.node-ok]="nodeIndicatorState() === 'peers'"
                  [class.node-warning]="nodeIndicatorState() === 'no-peers'"
                  [class.node-critical]="nodeIndicatorState() === 'disconnected'"
                  >share</mat-icon
                >
              </div>
            }

            <!-- Electrum Indicator (remote mode: replaces the node icon) -->
            @if (nodeService.isRemote()) {
              <div
                class="status-indicator clickable"
                [matTooltip]="electrumTooltip()"
                [matMenuTriggerFor]="electrumMenu"
                (menuOpened)="electrumStatus.refreshServers()"
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
                  <app-electrum-server-list [servers]="electrumStatus.servers()" />
                </div>
              </mat-menu>
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

            <!-- Clock-drift Indicator (visible when monitoring is enabled) -->
            @if (clockDrift.enabled()) {
              <div
                class="status-indicator clock-drift-indicator"
                [class.clickable]="true"
                [matTooltip]="clockDriftTooltip()"
                (click)="openClockDriftDialog()"
              >
                <mat-icon
                  [class.clock-ok]="clockDrift.status() === 'ok'"
                  [class.clock-warning]="clockDrift.status() === 'warning'"
                  [class.clock-critical]="clockDrift.status() === 'critical'"
                  >schedule</mat-icon
                >
              </div>
            }

            <!-- Wallet Lock Indicator (visible only when at least one encrypted wallet is loaded) -->
            @if (hasEncryptedWalletsLoaded()) {
              @if (anyWalletUnlocked()) {
                <div
                  class="status-indicator"
                  [matTooltip]="
                    'wallet_lock_status_some_unlocked'
                      | i18n
                        : {
                            unlocked: unlockedEncryptedWallets().length,
                            total: encryptedWallets().length,
                          }
                  "
                >
                  <mat-icon class="wallet-status-unlocked">lock_open</mat-icon>
                </div>
              } @else {
                <div class="status-indicator" [matTooltip]="'wallet_lock_status_all_locked' | i18n">
                  <mat-icon class="wallet-status-locked">lock</mat-icon>
                </div>
              }
            }
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
                    <!-- Column 2: Wallet name (+ multisig glyph) -->
                    <span class="wallet-row-name">{{ wallet.name || '(default)' }}</span>
                    @if (wallet.multisig) {
                      <mat-icon
                        class="wallet-row-multisig"
                        [matTooltip]="
                          'msig_wallet_tooltip'
                            | i18n
                              : {
                                  required: wallet.multisig.requiredSigs,
                                  total: wallet.multisig.totalKeys,
                                }
                        "
                        >group</mat-icon
                      >
                    }
                    <!-- Column 3: Watch-only indicator (only for loaded watch-only wallets) -->
                    @if (wallet.isLoaded && wallet.isWatchOnly) {
                      <mat-icon class="wallet-row-watch" matTooltip="{{ 'watch_only' | i18n }}"
                        >visibility</mat-icon
                      >
                    } @else {
                      <span class="wallet-row-watch-placeholder"></span>
                    }
                    <!-- Column 4: Lock status (only for loaded encrypted non-watch-only wallets) -->
                    @if (wallet.isLoaded && !wallet.isWatchOnly && wallet.isEncrypted) {
                      @if (isWalletLocked(wallet)) {
                        <mat-icon
                          class="wallet-row-lock wallet-row-lock-action wallet-lock-encrypted-locked"
                          (click)="onUnlockClick(wallet, $event)"
                          [matTooltip]="'unlock_wallet_for_session_tooltip' | i18n"
                          >lock</mat-icon
                        >
                      } @else {
                        <mat-icon
                          class="wallet-row-lock wallet-row-lock-action wallet-lock-encrypted-unlocked"
                          (click)="onLockClick(wallet, $event)"
                          [matTooltip]="'lock_wallet_tooltip' | i18n"
                          >lock_open</mat-icon
                        >
                      }
                    } @else if (!wallet.isWatchOnly) {
                      <span class="wallet-row-lock-placeholder"></span>
                    }
                    <!-- Column 5: Load (unloaded) / Eject (loaded) action -->
                    @if (wallet.isLoaded) {
                      <mat-icon
                        class="wallet-row-eject"
                        (click)="ejectWallet(wallet, $event)"
                        matTooltip="{{ 'unload_wallet' | i18n }}"
                        >eject</mat-icon
                      >
                    } @else {
                      <mat-icon
                        class="wallet-row-load"
                        (click)="onLoadClick(wallet, $event)"
                        matTooltip="{{ 'load_wallet' | i18n }}"
                        >play_arrow</mat-icon
                      >
                    }
                    <!-- Loading spinner -->
                    @if (isWalletLoading(wallet.name)) {
                      <mat-spinner diameter="16" class="wallet-row-spinner"></mat-spinner>
                    }
                  </div>
                </button>
              }
            </mat-menu>

            <!-- Pocket selector (remote mode): the loaded wallet's
                 compartments — greyed out while nothing is loaded. -->
            @if (nodeService.isRemote()) {
              <button
                mat-button
                [matMenuTriggerFor]="pocketMenu"
                class="action-button wallet-button pocket-button"
                [disabled]="activePockets().length < 2 || switchingPocket()"
              >
                <div class="wallet-selector-content">
                  @if (switchingPocket()) {
                    <mat-spinner diameter="16"></mat-spinner>
                  } @else {
                    <mat-icon class="wallet-icon" [class.has-wallet]="activePocketLabel()"
                      >layers</mat-icon
                    >
                  }
                  <span class="wallet-name">{{
                    activePocketLabel() || ('wallet_pocket' | i18n)
                  }}</span>
                  <mat-icon class="dropdown-arrow">keyboard_arrow_down</mat-icon>
                </div>
              </button>
              <mat-menu #pocketMenu="matMenu">
                @for (c of activePockets(); track c.name) {
                  <button mat-menu-item (click)="selectPocket(c)">
                    <mat-icon>{{
                      c.isOpen ? 'radio_button_checked' : 'radio_button_unchecked'
                    }}</mat-icon>
                    <span class="pocket-item-role">{{ pocketRoleLabel(c) }}</span>
                    @if (c.balanceSat !== undefined) {
                      <span class="pocket-item-balance">
                        {{ c.balanceSat / 100000000 | number: '1.8-8' }}
                      </span>
                    }
                  </button>
                }
              </mat-menu>
            }

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
      @use 'breakpoints' as bp;

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
        height: var(--toolbar-h);
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
        height: var(--toolbar-h);
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

      /* Pocket selector (remote mode), next to the wallet selector. */
      .pocket-button:disabled .wallet-selector-content {
        opacity: 0.45;
      }

      .pocket-item-role {
        font-weight: 500;
      }

      .pocket-item-balance {
        margin-left: 16px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: rgba(0, 0, 0, 0.5);
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
        @include bp.desktop-down {
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

          &.active,
          &.wallet-status-locked {
            color: #4caf50;
          }

          &.wallet-status-unlocked,
          &.clock-warning {
            color: #ff9800;
          }

          &.clock-ok,
          &.node-ok {
            color: #4caf50;
          }

          &.node-warning {
            color: #ff9800;
          }

          &.clock-critical,
          &.node-critical {
            color: #e53935;
          }

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

      .clock-drift-indicator.clickable {
        cursor: pointer;
      }

      /* Server rows live in the shared app-electrum-server-list. */
      .electrum-popover {
        padding: 8px 16px 12px;
        min-width: 300px;
        max-width: 420px;

        /* inherit + opacity: the overlay panel is theme-colored, and
           :host-context can't reach overlay content from this toolbar. */
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

      /* Responsive */
      @include bp.phone {
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
  private readonly walletUnlock = inject(WalletUnlockService);
  private readonly dialog = inject(MatDialog);
  readonly i18n = inject(I18nService);
  readonly nodeService = inject(NodeService);
  readonly miningService = inject(MiningService);
  readonly clockDrift = inject(ClockDriftService);
  readonly electrumStatus = inject(ElectrumStatusService);
  readonly blockchainState = inject(BlockchainStateService);
  private readonly btcxWallet = inject(BtcxWalletService);

  /** True while a pocket switch is in flight (remote mode). */
  readonly switchingPocket = signal(false);

  /**
   * The LOADED remote wallet's pockets — empty (selector greyed out) while
   * nothing is loaded. Singleton wallets also grey out (one pocket is not
   * a choice).
   */
  readonly activePockets = computed<BtcxCompartment[]>(() => {
    if (!this.nodeService.isRemote()) return [];
    const group = this.btcxWallet.groups().find(g => g.compartments.some(c => c.isOpen));
    return group?.compartments ?? [];
  });

  /** Role label of the OPEN pocket, or null while nothing is loaded. */
  readonly activePocketLabel = computed<string | null>(() => {
    const open = this.activePockets().find(c => c.isOpen);
    return open ? this.pocketRoleLabel(open) : null;
  });

  /** Display label of one pocket ("SegWit", "Taproot", "SegWit · v30"). */
  pocketRoleLabel(c: BtcxCompartment): string {
    const role = this.i18n.get(
      c.policy.kind === 'bip86'
        ? 'mwallet_kind_taproot'
        : c.policy.kind === 'legacy'
          ? 'mwallet_kind_legacy'
          : 'mwallet_kind_segwit'
    );
    return c.policy.coinType === 0 ? `${role} · ${this.i18n.get('wallet_legacy_badge')}` : role;
  }

  /** Switch the loaded wallet to another of its pockets. */
  async selectPocket(pocket: BtcxCompartment): Promise<void> {
    if (pocket.isOpen || this.switchingPocket()) return;
    this.switchingPocket.set(true);
    try {
      await this.walletManager.loadRemotePocket(pocket.name);
    } catch (err) {
      console.error('Failed to switch pocket:', err);
    } finally {
      this.switchingPocket.set(false);
    }
  }
  private readonly destroy$ = new Subject<void>();

  /** Tooltip of the remote-mode Electrum indicator. */
  electrumTooltip(): string {
    const overall = this.electrumStatus.overall();
    const parts = [this.i18n.get(`electrum_status_${overall}`)];
    const primary = this.electrumStatus.primaryServer();
    if (primary) parts.push(primary);
    const height = this.electrumStatus.height();
    if (height !== null) parts.push(`#${height}`);
    const age = this.electrumStatus.syncAgeSecs();
    if (age !== null) parts.push(this.i18n.get('electrum_synced_ago', { seconds: age }));
    return parts.join(' · ');
  }

  // Inputs
  showSidenavToggle = input<boolean>(true);

  // Outputs
  sidenavToggle = output<void>();

  // State
  currentWalletName = signal<string | null>(null);
  wallets = signal<WalletSummary[]>([]);
  network = signal<Network>('mainnet');

  // Encrypted-wallet lock state, surfaced in the toolbar as a security indicator.
  // Visible only when at least one encrypted wallet is loaded; reflects whether
  // any are currently unlocked (i.e. keys exposed for the session).
  readonly encryptedWallets = computed(() =>
    this.wallets().filter(w => w.isLoaded && !w.isWatchOnly && w.isEncrypted)
  );
  readonly unlockedEncryptedWallets = computed(() =>
    this.encryptedWallets().filter(w => (w.unlockedUntil ?? 0) > 0)
  );
  readonly hasEncryptedWalletsLoaded = computed(() => this.encryptedWallets().length > 0);
  readonly anyWalletUnlocked = computed(() => this.unlockedEncryptedWallets().length > 0);

  /**
   * Node traffic-light state (Core/RPC modes). A managed process that isn't
   * running is definitively disconnected; otherwise "connected" means the last
   * chain refresh succeeded (no error, at least one update). Green when peers,
   * orange when connected with 0 peers (isolated / own-fork risk), red when
   * unreachable. No debounce — a brief orange at startup is accurate.
   */
  readonly nodeIndicatorState = computed<'peers' | 'no-peers' | 'disconnected'>(() => {
    if (this.nodeService.isManaged() && !this.nodeService.isRunning()) return 'disconnected';
    const connected =
      this.blockchainState.lastError() === null && this.blockchainState.lastUpdated() !== null;
    if (!connected) return 'disconnected';
    return this.blockchainState.peerCount() > 0 ? 'peers' : 'no-peers';
  });

  readonly nodeIndicatorTooltip = computed(() => {
    // Re-evaluate when language changes
    this.i18n.translations();
    switch (this.nodeIndicatorState()) {
      case 'peers':
        return this.i18n.get('node_indicator_peers', { count: this.blockchainState.peerCount() });
      case 'no-peers':
        return this.i18n.get('node_indicator_no_peers');
      default:
        return this.i18n.get('node_indicator_disconnected');
    }
  });

  readonly clockDriftTooltip = computed(() => {
    // Re-evaluate when language changes
    this.i18n.translations();
    const status = this.clockDrift.status();
    const offset = this.clockDrift.offsetMs();
    if (status === 'unknown' || offset === null) {
      return this.i18n.get('clock_drift_tooltip_unknown');
    }
    const absSec = Math.abs(offset) / 1000;
    const value = absSec < 1 ? `${Math.round(Math.abs(offset))} ms` : `${absSec.toFixed(1)} s`;
    const direction =
      offset > 0
        ? this.i18n.get('clock_drift_direction_ahead')
        : this.i18n.get('clock_drift_direction_behind');
    return this.i18n.get('clock_drift_tooltip', { value, direction });
  });

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

  isWalletLocked(wallet: WalletSummary): boolean {
    return !!wallet.isEncrypted && (wallet.unlockedUntil ?? 0) === 0;
  }

  async onUnlockClick(wallet: WalletSummary, event: Event): Promise<void> {
    event.stopPropagation();
    await this.walletUnlock.promptAndUnlockSession(wallet.name);
  }

  async onLockClick(wallet: WalletSummary, event: Event): Promise<void> {
    event.stopPropagation();
    await this.walletUnlock.lockNow(wallet.name);
  }

  async onLoadClick(wallet: WalletSummary, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.isWalletLoading(wallet.name)) return;

    this.loadingWallets.add(wallet.name);
    try {
      await this.walletManager.loadWallet(wallet.name, true);
      await this.loadWallets();
    } catch (error) {
      console.error('Failed to load wallet:', error);
    } finally {
      this.loadingWallets.delete(wallet.name);
    }
  }

  async selectWallet(wallet: WalletSummary): Promise<void> {
    if (this.isWalletLoading(wallet.name)) return;

    this.loadingWallets.add(wallet.name);

    try {
      // Load wallet if not loaded
      if (!wallet.isLoaded) {
        await this.walletManager.loadWallet(wallet.name, true);
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

  openClockDriftDialog(): void {
    this.dialog.open(ClockDriftDialogComponent, {
      width: '480px',
      autoFocus: false,
    });
  }
}
