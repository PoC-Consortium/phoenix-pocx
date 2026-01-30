import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDialog } from '@angular/material/dialog';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Subject, takeUntil } from 'rxjs';
import { I18nPipe } from '../../core/i18n';
import { BalanceDisplayComponent } from '../../shared';
import { WalletManagerService } from '../../bitcoin/services/wallet/wallet-manager.service';
import { WalletService } from '../../bitcoin/services/wallet/wallet.service';
import { ToolbarComponent } from '../toolbar/toolbar.component';
import { AggregatorService } from '../../aggregator/services/aggregator.service';
import { AppUpdateService } from '../../core/services/app-update.service';

interface NavItem {
  path: string;
  icon: string;
  labelKey: string;
}

interface NavGroup {
  id: string;
  titleKey: string;
  items: NavItem[];
}

/**
 * MainLayoutComponent provides the application shell with:
 * - Responsive sidebar navigation
 * - Content area with router outlet
 * Note: Toolbar is now in app.component for consistent header across all views
 */
@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    RouterModule,
    MatSidenavModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    I18nPipe,
    BalanceDisplayComponent,
    ToolbarComponent,
  ],
  template: `
    <mat-sidenav-container class="sidenav-container">
      <!-- Sidebar -->
      <mat-sidenav
        #sidenav
        [mode]="isMobile() ? 'over' : 'side'"
        [opened]="!isMobile()"
        class="sidenav"
      >
        <!-- Header with Logo and Toggle -->
        <div class="sidenav-header">
          <img src="assets/images/logos/phoenix_v.svg" alt="Phoenix PoCX" class="logo" />
          <div class="logo-section">
            <span class="logo-text">Phoenix PoCX</span>
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
          <button mat-icon-button class="sidenav-toggle" (click)="sidenav.toggle()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Wallet Info -->
        <div class="wallet-info">
          <div class="wallet-name">{{ currentWalletName() }}</div>
          <app-balance-display
            [amount]="currentBalance()"
            [shortForm]="true"
            [noSeparator]="true"
            size="normal"
          >
          </app-balance-display>
        </div>

        <!-- Navigation with Categories -->
        <div class="nav-scroll-container">
          <!-- Dashboard (standalone) -->
          <mat-nav-list class="nav-section">
            <a
              mat-list-item
              routerLink="/dashboard"
              routerLinkActive="active"
              (click)="isMobile() && sidenav.close()"
            >
              <mat-icon matListItemIcon>dashboard</mat-icon>
              <span matListItemTitle>{{ 'dashboard' | i18n }}</span>
            </a>
          </mat-nav-list>

          <!-- Grouped Navigation -->
          @for (group of navGroups(); track group.id) {
            <div class="nav-group">
              <div class="nav-group-title">{{ group.titleKey | i18n }}</div>
              <mat-nav-list class="nav-section">
                @for (item of group.items; track item.path) {
                  <a
                    mat-list-item
                    [routerLink]="item.path"
                    routerLinkActive="active"
                    (click)="isMobile() && sidenav.close()"
                  >
                    <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
                    <span matListItemTitle>{{ item.labelKey | i18n }}</span>
                  </a>
                }
              </mat-nav-list>
            </div>
          }
        </div>

        <!-- Bottom Section -->
        <div class="sidenav-footer">
          <a mat-list-item routerLink="/settings" routerLinkActive="active">
            <mat-icon matListItemIcon>settings</mat-icon>
            <span matListItemTitle>{{ 'settings' | i18n }}</span>
          </a>
          <a mat-list-item (click)="logout()">
            <mat-icon matListItemIcon>logout</mat-icon>
            <span matListItemTitle>{{ 'logout' | i18n }}</span>
          </a>
        </div>
      </mat-sidenav>

      <!-- Main Content (toolbar + page content) -->
      <mat-sidenav-content class="main-content">
        <!-- Toolbar at top of content area -->
        <app-toolbar [showSidenavToggle]="!sidenav.opened" (sidenavToggle)="sidenav.toggle()">
        </app-toolbar>

        <!-- Page Content -->
        <div class="page-wrapper">
          <router-outlet></router-outlet>
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [
    `
      .sidenav-container {
        height: 100%;
      }

      .sidenav {
        width: 240px;
        background: linear-gradient(180deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        overflow-x: hidden;

        // Make the inner container a flex column so footer stays at bottom
        ::ng-deep .mat-drawer-inner-container {
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
        }

        // Override Material list item colors and sizes for sidenav
        --mat-list-list-item-label-text-color: rgba(255, 255, 255, 0.9);
        --mat-list-list-item-hover-label-text-color: white;
        --mat-list-list-item-focus-label-text-color: white;
        --mat-list-list-item-leading-icon-color: rgba(255, 255, 255, 0.9);
        --mat-list-list-item-hover-leading-icon-color: white;
        --mat-list-list-item-focus-leading-icon-color: white;
        --mat-list-active-indicator-color: rgba(255, 255, 255, 0.15);
        --mat-list-list-item-one-line-container-height: 40px;
        --mat-list-list-item-label-text-size: 13px;
      }

      .sidenav-header {
        position: relative;
        display: flex;
        align-items: center;
        height: 64px;
        padding: 0 16px;
        gap: 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        overflow: hidden;
        box-sizing: border-box;
      }

      .logo {
        width: 32px;
        height: 32px;
      }

      .logo-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .logo-text {
        font-size: 15px;
        font-weight: 600;
      }

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

      .sidenav-toggle {
        position: absolute;
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
        color: rgba(255, 255, 255, 0.7);
        width: 28px;
        height: 28px;
        min-width: 28px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        .mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          line-height: 18px;
        }

        &:hover {
          color: white;
          background: rgba(255, 255, 255, 0.1);
        }
      }

      .wallet-info {
        padding: 16px 24px;
        background: rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        box-sizing: border-box;

        .wallet-name {
          font-size: 12px;
          opacity: 0.8;
          margin-bottom: 4px;
        }

        // Increase balance display size
        ::ng-deep app-balance-display {
          font-size: 17px;
        }
      }

      .nav-scroll-container {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
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
          height: 40px;
          margin: 1px 12px;
          border-radius: 0 20px 20px 0;
          margin-right: 16px;

          &:hover {
            background: rgba(255, 255, 255, 0.1);
          }

          &.active {
            background: rgba(255, 255, 255, 0.15);
            --mat-list-list-item-label-text-color: white;
            --mat-list-list-item-leading-icon-color: white;
          }

          // Smaller icons (16px like original)
          .mat-icon {
            color: rgba(255, 255, 255, 0.9);
            font-size: 18px;
            width: 18px;
            height: 18px;
            margin-right: 12px;
          }

          .mdc-list-item__primary-text {
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px;
          }
        }
      }

      .sidenav-footer {
        margin-top: auto;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding: 8px 0;
        --mat-list-list-item-label-text-color: rgba(255, 255, 255, 0.7);
        --mat-list-list-item-leading-icon-color: rgba(255, 255, 255, 0.7);
        --mat-list-list-item-one-line-container-height: 36px;

        a.mat-mdc-list-item {
          height: 36px;
          margin: 1px 12px;
          border-radius: 0 20px 20px 0;
          margin-right: 16px;

          &:hover {
            background: rgba(255, 255, 255, 0.1);
            --mat-list-list-item-label-text-color: white;
            --mat-list-list-item-leading-icon-color: white;
          }

          .mat-icon {
            color: rgba(255, 255, 255, 0.7);
            font-size: 18px;
            width: 18px;
            height: 18px;
          }

          &:hover .mat-icon {
            color: white;
          }
        }
      }

      .main-content {
        display: flex;
        flex-direction: column;
        background: #eaf0f6;
      }

      .page-wrapper {
        flex: 1;
        overflow: auto;
        background: #eaf0f6;
        display: flex;
        flex-direction: column;
      }

      :host-context(.dark-theme) {
        .sidenav {
          background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
        }

        .main-content,
        .page-wrapper {
          background: #303030;
        }
      }
    `,
  ],
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);
  private readonly aggregatorService = inject(AggregatorService);
  private readonly appUpdateService = inject(AppUpdateService);
  private readonly dialog = inject(MatDialog);
  private readonly destroy$ = new Subject<void>();

  isMobile = signal(false);
  currentWalletName = signal('No Wallet');
  // Balance from centralized WalletService - auto-updates via polling
  currentBalance = computed(() => this.walletService.totalBalance());

  // App version and update badge
  appVersion = computed(() => this.appUpdateService.currentVersion());
  showUpdateBadge = computed(() => this.appUpdateService.showUpdateBadge());

  navGroups = computed<NavGroup[]>(() => {
    const miningItems: NavItem[] = [
      { path: '/mining', icon: 'hardware', labelKey: 'mining_dashboard' },
    ];

    // Aggregator sits right below mining dashboard when enabled
    if (this.aggregatorService.config().enabled) {
      miningItems.push({ path: '/aggregator', icon: 'hub', labelKey: 'aggregator' });
    }

    miningItems.push({ path: '/forging-assignment', icon: 'swap_horiz', labelKey: 'forging_assignment' });

    return [
      {
        id: 'transactions',
        titleKey: 'transactions',
        items: [
          { path: '/transactions', icon: 'compare_arrows', labelKey: 'transactions' },
          { path: '/send', icon: 'send', labelKey: 'send' },
          { path: '/receive', icon: 'call_received', labelKey: 'receive' },
          { path: '/contacts', icon: 'contacts', labelKey: 'contacts' },
        ],
      },
      {
        id: 'mining',
        titleKey: 'mining',
        items: miningItems,
      },
      {
        id: 'network',
        titleKey: 'network',
        items: [
          { path: '/blocks', icon: 'apps', labelKey: 'blocks' },
          { path: '/peers', icon: 'device_hub', labelKey: 'peers' },
        ],
      },
    ];
  });

  ngOnInit(): void {
    // Handle responsive breakpoints
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntil(this.destroy$))
      .subscribe(result => {
        this.isMobile.set(result.matches);
      });

    // Subscribe to active wallet changes for wallet name display
    this.walletManager.activeWallet$.pipe(takeUntil(this.destroy$)).subscribe(walletName => {
      this.currentWalletName.set(walletName || 'No Wallet');
    });
    // Note: Balance is now handled by WalletService with auto-refresh

    // Load aggregator config so nav shows/hides aggregator item
    this.aggregatorService.loadConfig();

    // Subscribe to menu:check-update events to show update dialog
    this.appUpdateService.showUpdateDialog$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.onVersionClick();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  logout(): void {
    this.walletManager.setActiveWallet(null);
    this.router.navigate(['/auth']);
  }

  /**
   * Handle click on version display - show update dialog if available
   */
  async onVersionClick(): Promise<void> {
    const updateInfo = this.appUpdateService.updateInfo();
    if (!updateInfo) {
      return;
    }

    const { UpdateDialogComponent } = await import(
      '../../shared/components/update-dialog/update-dialog.component'
    );

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
}
