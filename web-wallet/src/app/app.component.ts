import { Component, inject, OnInit, OnDestroy, signal, DOCUMENT } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BlockchainStateService } from './bitcoin/services/blockchain-state.service';
import { ElectronService, UpdateInfo } from './core/services/electron.service';
import { AppModeService } from './core/services/app-mode.service';
import { PlatformService } from './core/services/platform.service';
import { CookieAuthService } from './core/auth/cookie-auth.service';
import { NotificationService } from './shared/services';
import { MiningService } from './mining/services';
import { NodeService } from './node';
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
  imports: [RouterOutlet, MatProgressSpinnerModule],
  template: `
    @if (isStartingNode()) {
      <div class="node-startup-overlay">
        <mat-spinner diameter="48"></mat-spinner>
        <span class="startup-text">Starting node...</span>
      </div>
    } @else {
      <router-outlet></router-outlet>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
        overflow: hidden;
      }

      .node-startup-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: #eceff1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        color: rgba(0, 0, 0, 0.87);
      }

      .startup-text {
        margin-top: 16px;
        font-size: 16px;
        color: rgba(0, 0, 0, 0.6);
      }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly blockchainState = inject(BlockchainStateService);
  private readonly electronService = inject(ElectronService);
  private readonly appModeService = inject(AppModeService);
  private readonly platformService = inject(PlatformService);
  private readonly cookieAuth = inject(CookieAuthService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly miningService = inject(MiningService);
  private readonly nodeService = inject(NodeService);
  private readonly i18n = inject(I18nService);

  private closeUnlisten: (() => void) | null = null;
  private nodeStatusInterval: ReturnType<typeof setInterval> | null = null;

  /** Signal to show node startup overlay */
  readonly isStartingNode = signal(false);

  ngOnInit(): void {
    // Start blockchain state polling - runs continuously for all components
    this.blockchainState.startPolling();

    // Add platform class to body for platform-specific styling (e.g., Android safe area)
    this.initPlatformClass();

    // If in mining-only mode, redirect to miner route immediately
    if (this.appModeService.isMiningOnly()) {
      // Only redirect if we're not already on a miner route
      const currentUrl = this.router.url;
      if (!currentUrl.startsWith('/miner') && !currentUrl.startsWith('/node')) {
        this.router.navigate(['/miner']);
      }
    }

    // Check if we need to wait for node startup (set synchronously before async code)
    if (
      this.electronService.isDesktop &&
      this.nodeService.isManaged() &&
      this.nodeService.isInstalled()
    ) {
      this.isStartingNode.set(true);
    }

    // Initialize managed node service
    this.initNodeService();

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

    // Clean up node status polling
    if (this.nodeStatusInterval) {
      clearInterval(this.nodeStatusInterval);
      this.nodeStatusInterval = null;
    }
  }

  /**
   * Add platform-specific class to body for CSS targeting.
   * Adds 'platform-android' on Android for safe area inset handling.
   */
  private async initPlatformClass(): Promise<void> {
    await this.platformService.initialize();
    if (this.platformService.isAndroid) {
      this.document.body.classList.add('platform-android');
    }
  }

  /**
   * Initialize managed node service:
   * - Start node if managed mode and installed
   * - Wait for RPC to be ready
   * - Start periodic status refresh
   *
   * Shows a loading overlay while waiting for the node to start.
   *
   * Redirect to /node/setup is handled by nodeSetupGuard in routes,
   * which runs before authGuard and properly intercepts first-launch flow.
   */
  private async initNodeService(): Promise<void> {
    if (!this.electronService.isDesktop) {
      return;
    }

    // If we're showing the startup overlay, do the node startup
    if (this.isStartingNode()) {
      try {
        // Unified flow: detect, start if needed, wait for RPC, refresh credentials
        await this.nodeService.ensureNodeReadyAndAuthenticated(() =>
          this.cookieAuth.refreshCredentials()
        );
      } catch (err) {
        console.error('Error during node startup:', err);
      } finally {
        // Hide loading overlay
        this.isStartingNode.set(false);
      }
    }

    // Start periodic status refresh (every 30 seconds)
    this.nodeStatusInterval = setInterval(async () => {
      try {
        await this.nodeService.refreshNodeStatus();
      } catch {
        // Silently ignore status refresh errors
      }
    }, 30000);
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
        const nodeRunning = this.nodeService.isManaged() && this.nodeService.isRunning();
        const isMiningOnly = this.appModeService.isMiningOnly();

        // If nothing active and node not running, just exit
        if (!miningActive && !plottingActive && !nodeRunning) {
          await invoke('exit_app');
          return;
        }

        // Prevent immediate close to show confirmation/shutdown dialog
        event.preventDefault();

        // If only node needs to be stopped (no mining/plotting):
        // - In mining-only mode: just shut down and exit (no dialog)
        // - In wallet mode: ask user what to do
        if (!miningActive && !plottingActive && nodeRunning) {
          if (isMiningOnly) {
            await this.showNodeShutdownDialog();
          } else {
            await this.showKeepNodeRunningDialog();
          }
          return;
        }

        // Mining or plotting is active - show confirmation dialog
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
            // If node needs to be stopped, show shutdown dialog; otherwise just exit
            if (nodeRunning) {
              await this.showNodeShutdownDialog();
            } else {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('exit_app');
            }
          }
        });
      });
    } catch (error) {
      console.error('Failed to initialize close handler:', error);
    }
  }

  /**
   * Show a dialog asking the user if they want to keep the node running in background.
   */
  private async showKeepNodeRunningDialog(): Promise<void> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: this.i18n.get('exit_node_running_title') || 'Node Running',
        message:
          this.i18n.get('exit_node_running_message') ||
          'The Bitcoin node is currently running. Would you like to keep it running in the background or shut it down?',
        confirmText: this.i18n.get('shut_down_node') || 'Shut Down Node',
        cancelText: this.i18n.get('keep_running') || 'Keep Running',
        type: 'info',
      },
    });

    dialogRef.afterClosed().subscribe(async (shutDown: boolean) => {
      if (shutDown) {
        await this.showNodeShutdownDialog();
      } else {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('exit_app');
      }
    });
  }

  /**
   * Show a dialog while waiting for the node to shut down gracefully.
   * Like bitcoin-qt, we wait for the node to fully stop before exiting.
   */
  private async showNodeShutdownDialog(): Promise<void> {
    // Show non-closeable dialog with spinner
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '380px',
      disableClose: true,
      data: {
        title: this.i18n.get('node_shutting_down_title') || 'Shutting Down',
        message:
          this.i18n.get('node_shutting_down_message') ||
          'Please wait while the node shuts down safely...',
        showSpinner: true,
        hideActions: true,
        type: 'info',
      },
    });

    try {
      await this.nodeService.stopNodeGracefully();
      await this.waitForNodeToStop();
    } catch (err) {
      console.error('Error during node shutdown:', err);
    } finally {
      dialogRef.close();
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('exit_app');
    }
  }

  /**
   * Poll until the node process is no longer running.
   * Returns when node has stopped or after max attempts.
   */
  private async waitForNodeToStop(): Promise<void> {
    const maxAttempts = 120; // 60 seconds max (120 * 500ms)
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));

      const isRunning = await this.nodeService.isNodeRunning();
      if (!isRunning) {
        return;
      }

      attempts++;
    }
  }
}
