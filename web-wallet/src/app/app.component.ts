import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BlockchainStateService } from './bitcoin/services/blockchain-state.service';
import { ElectronService, UpdateInfo } from './core/services/electron.service';
import { NotificationService } from './shared/services';

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
export class AppComponent implements OnInit {
  private readonly blockchainState = inject(BlockchainStateService);
  private readonly electronService = inject(ElectronService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);

  ngOnInit(): void {
    // Start blockchain state polling - runs continuously for all components
    this.blockchainState.startPolling();

    // Set up update notification listeners (Electron only)
    this.initUpdateListeners();
  }

  /**
   * Initialize update notification listeners for Electron
   */
  private initUpdateListeners(): void {
    if (!this.electronService.isElectron) {
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
}
