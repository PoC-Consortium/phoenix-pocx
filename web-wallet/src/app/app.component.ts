import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BlockchainStateService } from './bitcoin/services/blockchain-state.service';
import { ElectronService, UpdateInfo } from './core/services/electron.service';
import { NotificationService } from './shared/services';
import { MiningService } from './mining/services';
import { I18nService } from './core/i18n';
import { ConfirmDialogComponent } from './shared/components/confirm-dialog/confirm-dialog.component';

/**
 * Root app component - just a router outlet.
 * Layout (toolbar, sidenav) is handled by route-specific layout components:
 * - AuthLayoutComponent for auth routes (toolbar only)
 * - MainLayoutComponent for protected routes (sidenav + toolbar)
 *
 * Also initializes global state polling:
 * - BlockchainStateService starts polling on app init
 * - WalletService auto-starts when a wallet becomes active
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet></router-outlet>`,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
        overflow: hidden;
      }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly blockchainState = inject(BlockchainStateService);
  private readonly electronService = inject(ElectronService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly miningService = inject(MiningService);
  private readonly i18n = inject(I18nService);

  private closeUnlisten: (() => void) | null = null;

  ngOnInit(): void {
    // Start blockchain state polling - runs continuously for all components
    this.blockchainState.startPolling();

    // Set up update notification listeners (Electron only)
    this.initUpdateListeners();

    // Set up window close handler (Tauri only)
    this.initCloseHandler();
  }

  ngOnDestroy(): void {
    // Clean up close handler listener
    if (this.closeUnlisten) {
      this.closeUnlisten();
      this.closeUnlisten = null;
    }
  }

  /**
   * Initialize update notification listeners for desktop
   */
  private initUpdateListeners(): void {
    if (!this.electronService.isDesktop) {
      return;
    }

    // Listen for new version notifications
    this.electronService.onNewVersion((updateInfo: UpdateInfo) => {
      this.showUpdateDialog(updateInfo);
    });

    // Listen for "no update available" (manual check)
    this.electronService.onNewVersionCheckNoUpdate(() => {
      this.notification.info('You are running the latest version');
    });

    // Listen for download started
    this.electronService.onNewVersionDownloadStarted(() => {
      this.notification.success('Download started in your browser');
    });
  }

  /**
   * Show the update dialog (lazy-loaded to reduce initial bundle)
   */
  private async showUpdateDialog(updateInfo: UpdateInfo): Promise<void> {
    const { UpdateDialogComponent } =
      await import('./shared/components/update-dialog/update-dialog.component');

    const dialogRef = this.dialog.open(UpdateDialogComponent, {
      data: updateInfo,
      disableClose: false,
      autoFocus: false,
    });

    dialogRef.afterClosed().subscribe((assetUrl: string | null) => {
      if (assetUrl) {
        this.electronService.selectVersionAsset(assetUrl);
      }
    });
  }

  /**
   * Initialize window close handler to warn user if mining/plotting is active.
   * Only active in Tauri desktop environment.
   */
  private async initCloseHandler(): Promise<void> {
    if (!this.electronService.isDesktop) {
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();

      const { invoke } = await import('@tauri-apps/api/core');

      this.closeUnlisten = await currentWindow.onCloseRequested(async event => {
        const miningActive = this.miningService.minerRunning();
        const plottingActive =
          this.miningService.plotterUIState() === 'plotting' ||
          this.miningService.plotterUIState() === 'stopping';

        // If nothing active, exit immediately
        if (!miningActive && !plottingActive) {
          await invoke('exit_app');
          return;
        }

        // Prevent immediate close to show confirmation dialog
        event.preventDefault();

        // Build warning message
        let activityMessage: string;
        if (miningActive && plottingActive) {
          activityMessage = this.i18n.get('exit_confirm_mining_plotting');
        } else if (miningActive) {
          activityMessage = this.i18n.get('exit_confirm_mining');
        } else {
          activityMessage = this.i18n.get('exit_confirm_plotting');
        }

        const message = `${activityMessage}\n\n${this.i18n.get('exit_confirm_message')}`;

        // Show confirmation dialog
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          width: '420px',
          data: {
            title: this.i18n.get('exit_confirm_title'),
            message,
            confirmText: this.i18n.get('exit_anyway'),
            cancelText: this.i18n.get('cancel'),
            type: 'warning',
          },
        });

        dialogRef.afterClosed().subscribe(async (confirmed: boolean) => {
          if (confirmed) {
            // User confirmed - force exit the application
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('exit_app');
          }
        });
      });
    } catch (error) {
      console.error('Failed to initialize close handler:', error);
    }
  }
}
