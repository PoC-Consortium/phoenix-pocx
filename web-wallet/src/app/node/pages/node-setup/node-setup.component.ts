import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NodeService } from '../../services';
import {
  NodeMode,
  NodeConfig,
  ReleaseInfo,
  ReleaseAsset,
  formatBytes,
  formatSpeed,
  getEtaValues,
  getStageKey,
} from '../../models';
import { I18nPipe, I18nService } from '../../../core/i18n';
import { CookieAuthService } from '../../../core/auth/cookie-auth.service';

@Component({
  selector: 'app-node-setup',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressBarModule, MatSnackBarModule, I18nPipe],
  template: `
    <div class="setup-container">
      <div class="logo-container">
        <img src="assets/images/logos/phoenix_trans.svg" alt="Phoenix PoCX" class="logo" />
      </div>

      <div class="setup-box">
        <!-- Step 1: Mode Selection -->
        @if (currentStep() === 0) {
          <div class="box-header">
            <h2>{{ 'node_setup_title' | i18n }}</h2>
          </div>

          <div class="box-content">
            <p class="intro-text">{{ 'node_setup_intro_text' | i18n }}</p>

            <div class="mode-options">
              <div
                class="mode-option"
                [class.selected]="selectedMode() === 'managed'"
                (click)="selectMode('managed')"
              >
                <mat-icon class="mode-icon">cloud_download</mat-icon>
                <div class="mode-details">
                  <div class="mode-title">
                    {{ 'node_setup_managed_title' | i18n }}
                    <span class="recommended-badge">{{ 'node_setup_recommended_badge' | i18n }}</span>
                  </div>
                  <div class="mode-desc">
                    {{ 'node_setup_managed_desc' | i18n }}
                  </div>
                </div>
              </div>

              <div
                class="mode-option"
                [class.selected]="selectedMode() === 'external'"
                (click)="selectMode('external')"
              >
                <mat-icon class="mode-icon">link</mat-icon>
                <div class="mode-details">
                  <div class="mode-title">{{ 'node_setup_external_title' | i18n }}</div>
                  <div class="mode-desc">
                    {{ 'node_setup_external_desc' | i18n }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="box-actions">
            <div class="left-actions"></div>
            <div class="right-actions">
              <button mat-raised-button color="primary" (click)="continueFromModeSelection()">
                <mat-icon>arrow_forward</mat-icon>
                {{ 'node_setup_continue' | i18n }}
              </button>
            </div>
          </div>
        }

        <!-- Step 2: Node Installation (Managed only) -->
        @if (currentStep() === 1) {
          <div class="box-header">
            <h2>{{ 'node_setup_install_title' | i18n }}</h2>
          </div>

          <div class="box-content">
            @if (isInstalled()) {
              <div class="status-container success">
                <mat-icon class="status-icon">check_circle</mat-icon>
                <h3>{{ 'node_setup_installed_success' | i18n }}</h3>
                <p>{{ 'version' | i18n }}: {{ nodeService.currentVersion() }}</p>
                <p class="verified-hint">
                  <mat-icon class="verified-icon">verified</mat-icon>
                  {{ 'node_setup_sha256_verified' | i18n }}
                </p>
              </div>
            } @else if (downloadProgress()) {
              <div class="status-container">
                <div class="progress-info">
                  <span class="progress-stage">{{ getStageKey(downloadProgress()!.stage) | i18n }}</span>
                  @if (downloadProgress()!.stage === 'downloading') {
                    <span class="progress-percent">{{ downloadPercent() | number: '1.0-0' }}%</span>
                  }
                </div>

                @if (downloadProgress()!.stage === 'downloading') {
                  <mat-progress-bar
                    mode="determinate"
                    [value]="downloadPercent()"
                  ></mat-progress-bar>
                  <div class="progress-details">
                    <span
                      >{{ formatBytes(downloadProgress()!.downloadedBytes) }} /
                      {{ formatBytes(downloadProgress()!.totalBytes) }}</span
                    >
                    <span>{{ formatSpeed(downloadProgress()!.speedBytesPerSec) }}</span>
                    <span>{{ getEtaString() }}</span>
                  </div>
                } @else if (
                  downloadProgress()!.stage === 'verifying' ||
                  downloadProgress()!.stage === 'extracting'
                ) {
                  <mat-progress-bar mode="indeterminate"></mat-progress-bar>
                } @else if (downloadProgress()!.stage === 'failed') {
                  <div class="error-container">
                    <div class="error-message">
                      <mat-icon>error_outline</mat-icon>
                      <span>{{ nodeService.error() }}</span>
                    </div>
                    <button mat-stroked-button class="dismiss-btn" (click)="dismissError()">
                      OK
                    </button>
                  </div>
                }
              </div>
            } @else {
              <div class="status-container">
                @if (isFetchingRelease()) {
                  <mat-progress-bar mode="indeterminate" class="fetch-progress"></mat-progress-bar>
                  <p>{{ 'node_setup_fetching_release' | i18n }}</p>
                } @else if (releaseInfo()) {
                  <div class="release-info">
                    <div class="release-header">
                      <div class="release-title">
                        <span class="version">{{ 'node_setup_bitcoin_pocx_core' | i18n }}</span>
                        <span class="version-badge">{{ releaseInfo()!.tag }}</span>
                      </div>
                    </div>
                    <div class="release-details">
                      <div class="detail-row">
                        <span class="label">{{ 'node_setup_platform_label' | i18n }}</span>
                        <span class="value">{{ getOsName() }} ({{ platformArch() }})</span>
                      </div>
                      @if (platformAsset()) {
                        <div class="detail-row">
                          <span class="label">{{ 'node_setup_download_size_label' | i18n }}</span>
                          <span class="value">{{ formatBytes(platformAsset()!.size) }}</span>
                        </div>
                        <div class="detail-row">
                          <span class="label">{{ 'node_setup_file_label' | i18n }}</span>
                          <span class="value file-name">{{ platformAsset()!.name }}</span>
                        </div>
                      }
                      @if (platformAsset()?.sha256) {
                        <div class="detail-row">
                          <span class="label">{{ 'node_setup_sha256_label' | i18n }}</span>
                          <span class="value sha-value">{{ platformAsset()!.sha256 }}</span>
                        </div>
                      }
                      <div class="detail-row">
                        <span class="label">{{ 'node_setup_source_label' | i18n }}</span>
                        <span class="value">github.com/PoC-Consortium/bitcoin</span>
                      </div>
                    </div>
                  </div>
                } @else {
                  <mat-icon class="download-icon">cloud_download</mat-icon>
                  <p>{{ 'node_setup_download_instruction' | i18n }}</p>
                  <p class="source-hint">{{ 'node_setup_source_hint' | i18n }}</p>
                }
                @if (nodeService.error()) {
                  <div class="error-message">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{ nodeService.error() }}</span>
                  </div>
                }
              </div>
            }
          </div>

          <div class="box-actions">
            <div class="left-actions">
              <button mat-stroked-button (click)="back()">
                <mat-icon>arrow_back</mat-icon>
                {{ 'back' | i18n }}
              </button>
            </div>
            <div class="right-actions">
              @if (isInstalled()) {
                @if (isStartingNode()) {
                  <button mat-raised-button color="primary" disabled>
                    <mat-icon class="spin">sync</mat-icon>
                    {{ 'node_setup_starting_node' | i18n }}
                  </button>
                } @else {
                  <button mat-raised-button color="primary" (click)="finish()">
                    <mat-icon>arrow_forward</mat-icon>
                    {{ 'node_setup_get_started' | i18n }}
                  </button>
                }
              } @else if (isDownloading()) {
                <button mat-stroked-button color="warn" (click)="cancelDownload()">{{ 'cancel' | i18n }}</button>
              } @else {
                <button mat-raised-button color="primary" (click)="startDownload()">
                  <mat-icon>download</mat-icon>
                  {{ 'node_setup_download_install' | i18n }}
                </button>
              }
            </div>
          </div>
        }
      </div>

      <p class="version-info">v2.0.0</p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: auto;
      }

      .setup-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        background: #eceff1;
        padding: 24px;
        gap: 24px;
        box-sizing: border-box;
      }

      .logo-container {
        text-align: center;
      }

      .logo {
        width: 140px;
        height: auto;
      }

      .setup-box {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        width: 580px;
        max-width: 100%;
        overflow: hidden;
      }

      .box-header {
        padding: 24px 24px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);

        h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.87);
        }
      }

      .box-content {
        padding: 24px;
      }

      .intro-text {
        margin: 0 0 20px;
        color: rgba(0, 0, 0, 0.6);
        font-size: 14px;
      }

      /* Mode Options */
      .mode-options {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .mode-option {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 16px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .mode-option:hover {
        background: rgba(0, 0, 0, 0.02);
      }

      .mode-option.selected {
        border-color: #1976d2;
        background: rgba(33, 150, 243, 0.08);
      }

      .mode-icon {
        color: rgba(0, 0, 0, 0.54);
        font-size: 28px;
        width: 28px;
        height: 28px;
        margin-top: 2px;
      }

      .mode-option.selected .mode-icon {
        color: #1976d2;
      }

      .mode-details {
        flex: 1;
      }

      .mode-title {
        font-weight: 500;
        font-size: 15px;
        color: rgba(0, 0, 0, 0.87);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .recommended-badge {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        padding: 2px 6px;
        border-radius: 4px;
        background: #4caf50;
        color: white;
      }

      .mode-desc {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.6);
        line-height: 1.5;
      }

      /* Box Actions */
      .box-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(0, 0, 0, 0.02);
      }

      .left-actions,
      .right-actions {
        display: flex;
        gap: 8px;
      }

      .box-actions button mat-icon {
        margin-right: 4px;
      }

      /* Status Container */
      .status-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 24px 0;

        p {
          margin: 8px 0 0;
          color: rgba(0, 0, 0, 0.6);
          font-size: 14px;
        }

        h3 {
          margin: 16px 0 0;
          font-size: 18px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.87);
        }
      }

      .status-container.success .status-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        color: #4caf50;
      }

      .verified-hint {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        color: rgba(0, 0, 0, 0.5) !important;
        font-size: 12px !important;
        margin-top: 8px !important;
      }

      .verified-icon {
        font-size: 14px !important;
        width: 14px !important;
        height: 14px !important;
        color: #4caf50;
      }

      .download-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        color: rgba(0, 0, 0, 0.26);
      }

      .source-hint {
        font-size: 12px !important;
        color: rgba(0, 0, 0, 0.38) !important;
      }

      /* Release Info */
      .fetch-progress {
        width: 200px;
        margin-bottom: 16px;
      }

      .release-info {
        width: 100%;
        text-align: left;
      }

      .release-header {
        margin-bottom: 16px;
        padding-left: 16px;
      }

      .release-title {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      .release-title .version {
        font-size: 17px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.87);
      }

      .version-badge {
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 4px;
        background: #1976d2;
        color: white;
      }

      .release-details {
        background: rgba(0, 0, 0, 0.02);
        border-radius: 8px;
        padding: 16px;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      }

      .detail-row:last-child {
        border-bottom: none;
      }

      .detail-row .label {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.6);
      }

      .detail-row .value {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.87);
        font-weight: 500;
      }

      .detail-row .file-name {
        font-family: monospace;
        font-size: 12px;
        font-weight: 400;
      }

      .detail-row .sha-value {
        font-family: monospace !important;
        font-size: 12px !important;
        font-weight: 400 !important;
        color: rgba(0, 0, 0, 0.4) !important;
        text-align: right;
      }

      /* Progress */
      .progress-info {
        display: flex;
        justify-content: space-between;
        width: 100%;
        margin-bottom: 12px;
      }

      .progress-stage {
        font-weight: 500;
        color: rgba(0, 0, 0, 0.87);
      }

      .progress-percent {
        color: #1976d2;
        font-weight: 500;
      }

      mat-progress-bar {
        width: 100%;
        border-radius: 4px;
      }

      .progress-details {
        display: flex;
        justify-content: space-between;
        width: 100%;
        margin-top: 8px;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.54);
      }

      /* Error */
      .error-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        gap: 16px;
      }

      .error-message {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: #ffebee;
        border-radius: 4px;
        color: #c62828;
        font-size: 13px;
        text-align: left;
        width: 100%;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          flex-shrink: 0;
        }
      }

      .dismiss-btn {
        min-width: 80px;
      }

      .status-container .error-message {
        margin-top: 16px;
      }

      .version-info {
        color: rgba(0, 0, 0, 0.54);
        font-size: 12px;
        margin: 0;
      }

      .spin {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class NodeSetupComponent implements OnInit, OnDestroy {
  readonly nodeService = inject(NodeService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  private readonly cookieAuth = inject(CookieAuthService);

  // State
  readonly currentStep = signal(0);
  readonly selectedMode = signal<NodeMode>('managed');
  readonly releaseInfo = signal<ReleaseInfo | null>(null);
  readonly isFetchingRelease = signal(false);
  readonly platformArch = signal<string>('unknown');
  readonly isStartingNode = signal(false);

  // Computed values
  readonly isInstalled = computed(() => this.nodeService.isInstalled());
  readonly isDownloading = computed(() => this.nodeService.isDownloading());
  readonly downloadProgress = computed(() => this.nodeService.downloadProgress());
  readonly downloadPercent = computed(() => this.nodeService.downloadPercent());
  readonly platformAsset = computed(() => this.findPlatformAsset(this.releaseInfo()));

  // Helper methods exposed to template
  formatBytes = formatBytes;
  formatSpeed = formatSpeed;
  getStageKey = getStageKey;

  async ngOnInit(): Promise<void> {
    await this.nodeService.initialize();
    const config = this.nodeService.config();
    this.selectedMode.set(config.mode);
  }

  ngOnDestroy(): void {}

  /**
   * Find the platform-specific asset from release info
   */
  private findPlatformAsset(release: ReleaseInfo | null): ReleaseAsset | null {
    if (!release) return null;

    const platform = navigator.platform.toLowerCase();
    const arch = this.platformArch();
    const isWindows = platform.includes('win');

    // Build search patterns based on OS and architecture
    let patterns: string[] = [];

    if (isWindows) {
      patterns = ['win64'];
    } else if (platform.includes('mac')) {
      if (arch.includes('aarch64') || arch.includes('ARM')) {
        patterns = ['arm64-apple-darwin', 'aarch64-apple-darwin'];
      } else {
        patterns = ['x86_64-apple-darwin'];
      }
    } else if (platform.includes('linux')) {
      if (arch.includes('aarch64') || arch.includes('ARM')) {
        patterns = ['aarch64-linux-gnu', 'arm64-linux-gnu'];
      } else {
        patterns = ['x86_64-linux-gnu'];
      }
    }

    // Find matching asset, preferring .zip over .exe on Windows
    for (const pattern of patterns) {
      const matchingAssets = release.assets.filter(a => a.name.includes(pattern));

      if (isWindows) {
        // Prefer .zip files on Windows (avoid NSIS installers)
        const zipAsset = matchingAssets.find(a => a.name.endsWith('.zip'));
        if (zipAsset) return zipAsset;
      }

      const asset = matchingAssets[0];
      if (asset) return asset;
    }

    return null;
  }

  /**
   * Get a human-readable OS name (translated)
   */
  getOsName(): string {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) return this.i18n.get('node_os_windows');
    if (platform.includes('mac')) return this.i18n.get('node_os_macos');
    if (platform.includes('linux')) return this.i18n.get('node_os_linux');
    return this.i18n.get('unknown');
  }

  /**
   * Get translated ETA string for download progress
   */
  getEtaString(): string {
    const progress = this.downloadProgress();
    if (!progress) return '--';

    const { key, params } = getEtaValues(
      progress.totalBytes - progress.downloadedBytes,
      progress.speedBytesPerSec
    );

    if (!key) return '--';
    return this.i18n.get(key, params);
  }

  selectMode(mode: NodeMode): void {
    this.selectedMode.set(mode);
  }

  async continueFromModeSelection(): Promise<void> {
    if (this.selectedMode() === 'external') {
      // External: save and go to wallet selector
      const config = this.nodeService.config();
      const updatedConfig: NodeConfig = {
        ...config,
        mode: 'external',
      };
      await this.nodeService.saveConfig(updatedConfig);
      this.router.navigate(['/auth']);
    } else {
      // Managed: go to step 2 (installation) and fetch release info
      this.currentStep.set(1);
      this.fetchReleaseInfo();
    }
  }

  private async fetchReleaseInfo(): Promise<void> {
    if (this.releaseInfo() || this.isFetchingRelease()) return;

    this.isFetchingRelease.set(true);
    try {
      // Fetch release info and platform arch in parallel
      const [release, arch] = await Promise.all([
        this.nodeService.fetchLatestRelease(),
        this.nodeService.getPlatformArch(),
      ]);

      this.releaseInfo.set(release);
      this.platformArch.set(arch);
    } catch (err) {
      console.error('Failed to fetch release info:', err);
    } finally {
      this.isFetchingRelease.set(false);
    }
  }

  back(): void {
    this.currentStep.set(0);
  }

  async startDownload(): Promise<void> {
    const release = this.releaseInfo();
    const asset = this.platformAsset();

    if (!release || !asset) {
      this.nodeService.clearError();
      return;
    }

    this.nodeService.clearError();
    const version = await this.nodeService.downloadAndInstallFromAsset(
      release.tag,
      asset.downloadUrl,
      asset.name,
      asset.sha256
    );

    if (version) {
      this.snackBar.open(this.i18n.get('node_setup_install_success', { version }), 'OK', {
        duration: 5000,
      });
    }
  }

  cancelDownload(): void {
    this.nodeService.cancelDownload();
  }

  dismissError(): void {
    this.nodeService.clearDownloadProgress();
    this.nodeService.clearError();
  }

  async finish(): Promise<void> {
    if (this.nodeService.isInstalled()) {
      this.isStartingNode.set(true);

      try {
        // Unified flow: detect, start if needed, wait for RPC, refresh credentials
        const ready = await this.nodeService.ensureNodeReadyAndAuthenticated(
          () => this.cookieAuth.refreshCredentials()
        );

        if (!ready) {
          this.snackBar.open(this.i18n.get('node_setup_rpc_not_ready'), 'OK', {
            duration: 5000,
          });
        }
      } catch (err) {
        console.error('Failed to start node:', err);
        this.snackBar.open(this.i18n.get('node_setup_start_failed'), 'OK', {
          duration: 3000,
        });
      } finally {
        this.isStartingNode.set(false);
      }
    }
    this.router.navigate(['/auth']);
  }
}
