import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { Subject, takeUntil } from 'rxjs';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import { RpcClientService } from '../../../../bitcoin/services/rpc/rpc-client.service';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { PlatformService } from '../../../../core/services/platform.service';
import { ElectronService } from '../../../../core/services/electron.service';
import { SettingsActions } from '../../../../store/settings/settings.actions';
import {
  selectNodeConfig,
  selectNotifications,
} from '../../../../store/settings/settings.selectors';
import {
  NodeConfig,
  NotificationSettings,
  getDefaultRpcPort,
  getDefaultCurrencySymbol,
  getDefaultTestnetSubdir,
  getDefaultDataDirectory,
} from '../../../../store/settings/settings.state';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

interface ConnectionTestResult {
  success: boolean;
  version?: string;
  chain?: string;
  blocks?: number;
  error?: string;
}

/**
 * Settings page with 3 tabs: Node Configuration, Notifications, Danger Zone
 * Matches the original Phoenix wallet design.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatRadioModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatDialogModule,
    MatTooltipModule,
    I18nPipe,
  ],
  template: `
    <div class="settings-page">
      <!-- Header -->
      <div class="settings-header">
        <button mat-icon-button class="back-button" (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h1>{{ 'settings' | i18n }}</h1>
      </div>

      <!-- Tab Content -->
      <div class="settings-content">
        <mat-tab-group animationDuration="200ms">
          <!-- Tab 1: Node Configuration -->
          <mat-tab [label]="'node_configuration' | i18n">
            <div class="tab-content">
              <div class="config-container">
                <!-- Coin Type Section -->
                <div class="config-section">
                  <h3 class="section-title">{{ 'coin_type' | i18n }}</h3>
                  <mat-radio-group
                    [(ngModel)]="nodeConfig.coinType"
                    (change)="onCoinTypeChange()"
                    class="vertical-radio-group"
                  >
                    <mat-radio-button value="bitcoin-pocx">Bitcoin-PoCX</mat-radio-button>
                    <mat-radio-button value="bitcoin-og">Bitcoin (Original)</mat-radio-button>
                    <mat-radio-button value="custom">{{ 'custom' | i18n }}</mat-radio-button>
                  </mat-radio-group>
                </div>

                <!-- Network Section -->
                <div class="config-section">
                  <h3 class="section-title">{{ 'network' | i18n }}</h3>
                  <mat-radio-group
                    [(ngModel)]="nodeConfig.network"
                    (change)="onNetworkChange()"
                    class="horizontal-radio-group"
                  >
                    <mat-radio-button value="mainnet">Mainnet</mat-radio-button>
                    <mat-radio-button value="testnet">Testnet</mat-radio-button>
                    <mat-radio-button value="regtest">Regtest</mat-radio-button>
                  </mat-radio-group>
                </div>

                <!-- Currency Symbol -->
                <div class="config-section">
                  <h3 class="section-title">{{ 'currency_symbol' | i18n }}</h3>
                  <mat-form-field appearance="outline" class="half-width">
                    <mat-label>{{ 'currency_symbol' | i18n }}</mat-label>
                    <input matInput [(ngModel)]="nodeConfig.currencySymbol" maxlength="10" />
                    <mat-hint>{{ 'max_10_characters' | i18n }}</mat-hint>
                  </mat-form-field>
                </div>

                <!-- Connection Settings Section -->
                <div class="config-section">
                  <h3 class="section-title">{{ 'connection_settings' | i18n }}</h3>
                  <div class="form-row">
                    <mat-form-field appearance="outline" class="half-width">
                      <mat-label>{{ 'rpc_host' | i18n }}</mat-label>
                      <input matInput [(ngModel)]="nodeConfig.rpcHost" />
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="half-width">
                      <mat-label>{{ 'rpc_port' | i18n }}</mat-label>
                      <input
                        matInput
                        type="number"
                        [(ngModel)]="nodeConfig.rpcPort"
                        min="1"
                        max="65535"
                      />
                    </mat-form-field>
                  </div>

                  <div class="form-row">
                    <mat-form-field appearance="outline" class="full-width">
                      <mat-label>{{ 'data_directory' | i18n }}</mat-label>
                      <input matInput [(ngModel)]="nodeConfig.dataDirectory" />
                      <button
                        mat-icon-button
                        matSuffix
                        (click)="browseDataDirectory()"
                        [matTooltip]="'browse' | i18n"
                      >
                        <mat-icon>folder_open</mat-icon>
                      </button>
                    </mat-form-field>
                  </div>

                  @if (nodeConfig.network !== 'mainnet') {
                    <mat-form-field appearance="outline" class="half-width">
                      <mat-label>{{ 'testnet_subdirectory' | i18n }}</mat-label>
                      <input matInput [(ngModel)]="nodeConfig.testnetSubdir" />
                    </mat-form-field>
                  }
                </div>

                <!-- Authentication Section -->
                <div class="config-section">
                  <h3 class="section-title">{{ 'authentication' | i18n }}</h3>
                  <mat-radio-group [(ngModel)]="nodeConfig.authMethod" class="vertical-radio-group">
                    <mat-radio-button value="cookie"
                      >{{ 'cookie_based' | i18n }} ({{ 'recommended' | i18n }})</mat-radio-button
                    >
                    <mat-radio-button value="credentials">{{
                      'username_password' | i18n
                    }}</mat-radio-button>
                  </mat-radio-group>

                  @if (nodeConfig.authMethod === 'credentials') {
                    <div class="credentials-fields">
                      <mat-form-field appearance="outline" class="full-width">
                        <mat-label>{{ 'username' | i18n }}</mat-label>
                        <input matInput [(ngModel)]="nodeConfig.username" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="full-width">
                        <mat-label>{{ 'password' | i18n }}</mat-label>
                        <input matInput type="password" [(ngModel)]="nodeConfig.password" />
                      </mat-form-field>
                    </div>
                  }
                </div>

                <!-- Connection Test Result -->
                @if (testResult()) {
                  <div
                    class="test-result"
                    [class.success]="testResult()!.success"
                    [class.error]="!testResult()!.success"
                  >
                    <div class="test-result-header">
                      <mat-icon>{{ testResult()!.success ? 'check_circle' : 'error' }}</mat-icon>
                      <span>{{
                        testResult()!.success
                          ? ('connection_successful' | i18n)
                          : ('connection_failed' | i18n)
                      }}</span>
                    </div>
                    @if (testResult()!.success) {
                      <div class="test-result-details">
                        <p>
                          <strong>{{ 'version' | i18n }}:</strong> {{ testResult()!.version }}
                        </p>
                        <p>
                          <strong>{{ 'chain' | i18n }}:</strong> {{ testResult()!.chain }}
                        </p>
                        <p>
                          <strong>{{ 'blocks' | i18n }}:</strong>
                          {{ testResult()!.blocks | number }}
                        </p>
                      </div>
                    } @else {
                      <div class="test-result-details">
                        <p>{{ testResult()!.error }}</p>
                      </div>
                    }
                  </div>
                }

                <!-- Action Buttons -->
                <div class="action-buttons">
                  <button mat-stroked-button (click)="testConnection()" [disabled]="isTesting()">
                    @if (isTesting()) {
                      <mat-spinner diameter="20"></mat-spinner>
                    } @else {
                      <mat-icon>sync</mat-icon>
                    }
                    {{ 'test_connection' | i18n }}
                  </button>
                  <button
                    mat-raised-button
                    color="primary"
                    (click)="saveNodeConfig()"
                    [disabled]="isSaving()"
                  >
                    @if (isSaving()) {
                      <mat-spinner diameter="20"></mat-spinner>
                    } @else {
                      <mat-icon>save</mat-icon>
                    }
                    {{ 'save_apply' | i18n }}
                  </button>
                </div>
              </div>
            </div>
          </mat-tab>

          <!-- Tab 2: Notifications -->
          <mat-tab [label]="'notifications' | i18n">
            <div class="tab-content">
              <div class="notifications-container">
                <!-- Master Toggle -->
                <div class="notification-master">
                  <mat-slide-toggle
                    [(ngModel)]="notifications.enabled"
                    (change)="onNotificationChange()"
                  >
                    {{
                      notifications.enabled
                        ? ('notifications_enabled' | i18n)
                        : ('notifications_disabled' | i18n)
                    }}
                  </mat-slide-toggle>
                </div>

                @if (notifications.enabled) {
                  <!-- Transaction Notifications -->
                  <div class="notification-group">
                    <h3 class="section-title">{{ 'transaction_notifications' | i18n }}</h3>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.incomingPayment"
                        (change)="onNotificationChange()"
                      >
                        {{ 'incoming_payment' | i18n }}
                      </mat-slide-toggle>
                    </div>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.paymentConfirmed"
                        (change)="onNotificationChange()"
                      >
                        {{ 'payment_confirmed' | i18n }}
                      </mat-slide-toggle>
                    </div>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.blockMined"
                        (change)="onNotificationChange()"
                      >
                        {{ 'block_mined' | i18n }}
                      </mat-slide-toggle>
                    </div>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.blockRewardMatured"
                        (change)="onNotificationChange()"
                      >
                        {{ 'block_reward_matured' | i18n }}
                      </mat-slide-toggle>
                    </div>
                  </div>

                  <!-- Wallet Status Notifications -->
                  <div class="notification-group">
                    <h3 class="section-title">{{ 'wallet_status_notifications' | i18n }}</h3>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.nodeConnected"
                        (change)="onNotificationChange()"
                      >
                        {{ 'node_connected' | i18n }}
                      </mat-slide-toggle>
                    </div>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.nodeDisconnected"
                        (change)="onNotificationChange()"
                      >
                        {{ 'node_disconnected' | i18n }}
                      </mat-slide-toggle>
                    </div>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.syncComplete"
                        (change)="onNotificationChange()"
                      >
                        {{ 'sync_complete' | i18n }}
                      </mat-slide-toggle>
                    </div>
                  </div>
                }
              </div>
            </div>
          </mat-tab>

          <!-- Tab 3: Danger Zone -->
          <mat-tab [label]="'danger_zone' | i18n">
            <div class="tab-content">
              <div class="danger-zone-container">
                <div class="danger-warning">
                  <mat-icon>warning</mat-icon>
                  <p>{{ 'danger_zone_warning' | i18n }}</p>
                </div>
                <button mat-raised-button color="warn" (click)="confirmResetWallet()">
                  <mat-icon>delete_forever</mat-icon>
                  {{ 'reset_wallet' | i18n }}
                </button>
              </div>
            </div>
          </mat-tab>
        </mat-tab-group>
      </div>
    </div>
  `,
  styles: [
    `
      .settings-page {
        min-height: 100vh;
        background: #eceff1;
      }

      .settings-header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        align-items: center;
        gap: 16px;

        .back-button {
          color: white;
        }

        h1 {
          margin: 0;
          font-size: 20px;
          font-weight: 500;
        }
      }

      .settings-content {
        padding: 24px;
        min-height: calc(100vh - 120px);
      }

      .tab-content {
        padding: 24px 0;
      }

      /* Node Configuration Styles */
      .config-container {
        max-width: 600px;
        margin: 0 auto;
      }

      .config-section {
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 24px;
      }

      .section-title {
        font-size: 14px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(0, 0, 0, 0.6);
        margin: 0 0 16px 0;
      }

      .vertical-radio-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .horizontal-radio-group {
        display: flex;
        flex-direction: row;
        gap: 24px;
      }

      .form-row {
        display: flex;
        gap: 16px;
        margin-bottom: 8px;
      }

      .half-width {
        flex: 1;
      }

      .full-width {
        width: 100%;
      }

      .credentials-fields {
        margin-top: 16px;
      }

      .test-result {
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 24px;

        &.success {
          background: #e8f5e9;
          border: 1px solid #4caf50;

          .test-result-header {
            color: #2e7d32;
          }
        }

        &.error {
          background: #ffebee;
          border: 1px solid #f44336;

          .test-result-header {
            color: #c62828;
          }
        }

        .test-result-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
          margin-bottom: 8px;
        }

        .test-result-details {
          padding-left: 32px;
          color: rgba(0, 0, 0, 0.6);

          p {
            margin: 4px 0;
          }
        }
      }

      .action-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 16px;

        button {
          min-width: 140px;

          mat-spinner {
            display: inline-block;
            margin-right: 8px;
          }
        }
      }

      /* Notifications Styles */
      .notifications-container {
        max-width: 500px;
        margin: 0 auto;
      }

      .notification-master {
        padding-bottom: 16px;
        border-bottom: 1px solid #e0e0e0;
        margin-bottom: 24px;
      }

      .notification-group {
        margin-bottom: 24px;
      }

      .notification-item {
        padding: 8px 0 8px 16px;
      }

      /* Danger Zone Styles */
      .danger-zone-container {
        max-width: 500px;
        margin: 0 auto;
        text-align: center;
        padding: 48px 24px;
      }

      .danger-warning {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        margin-bottom: 32px;
        color: rgba(0, 0, 0, 0.6);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: #f44336;
        }

        p {
          margin: 0;
          max-width: 400px;
        }
      }

      /* Responsive */
      @media (max-width: 600px) {
        .settings-content {
          padding: 16px;
        }

        .horizontal-radio-group {
          flex-direction: column;
          gap: 8px;
        }

        .form-row {
          flex-direction: column;
        }

        .half-width {
          width: 100%;
        }

        .action-buttons {
          flex-direction: column;

          button {
            width: 100%;
          }
        }
      }
    `,
  ],
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);
  private readonly notification = inject(NotificationService);
  private readonly rpcClient = inject(RpcClientService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly platform = inject(PlatformService);
  private readonly electron = inject(ElectronService);
  private readonly destroy$ = new Subject<void>();

  // Node configuration (local copy for editing)
  nodeConfig: NodeConfig = {
    coinType: 'bitcoin-pocx',
    network: 'testnet',
    currencySymbol: 'BTCX',
    rpcHost: '127.0.0.1',
    rpcPort: 18332,
    dataDirectory: '',
    testnetSubdir: 'testnet',
    authMethod: 'cookie',
    username: '',
    password: '',
  };

  // Notification settings (local copy for editing)
  notifications: NotificationSettings = {
    enabled: true,
    incomingPayment: true,
    paymentConfirmed: true,
    blockMined: true,
    blockRewardMatured: true,
    nodeConnected: false,
    nodeDisconnected: true,
    syncComplete: true,
  };

  // UI state
  isTesting = signal(false);
  isSaving = signal(false);
  testResult = signal<ConnectionTestResult | null>(null);

  ngOnInit(): void {
    // Load node config from store
    this.store
      .select(selectNodeConfig)
      .pipe(takeUntil(this.destroy$))
      .subscribe(config => {
        this.nodeConfig = { ...config };
        // Set default data directory if empty
        if (!this.nodeConfig.dataDirectory) {
          this.nodeConfig.dataDirectory = getDefaultDataDirectory(
            this.nodeConfig.coinType,
            this.platform.platform
          );
        }
      });

    // Load notification settings from store
    this.store
      .select(selectNotifications)
      .pipe(takeUntil(this.destroy$))
      .subscribe(notifications => {
        this.notifications = { ...notifications };
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    // Navigate back (could be to dashboard or wallet select)
    window.history.back();
  }

  // ============================================================
  // Node Configuration
  // ============================================================

  onCoinTypeChange(): void {
    const coinType = this.nodeConfig.coinType;

    // Update defaults based on coin type
    this.nodeConfig.dataDirectory = getDefaultDataDirectory(coinType, this.platform.platform);
    this.nodeConfig.testnetSubdir = getDefaultTestnetSubdir(coinType);
    this.nodeConfig.currencySymbol = getDefaultCurrencySymbol(coinType);

    // Clear test result
    this.testResult.set(null);
  }

  onNetworkChange(): void {
    // Update port based on network
    this.nodeConfig.rpcPort = getDefaultRpcPort(this.nodeConfig.network);

    // Clear test result
    this.testResult.set(null);
  }

  async browseDataDirectory(): Promise<void> {
    if (!this.platform.isDesktop) {
      this.notification.info(this.i18n.get('folder_browser_desktop_only'));
      return;
    }

    const selectedPath = await this.electron.showFolderDialog({
      title: this.i18n.get('select_data_directory'),
      defaultPath: this.nodeConfig.dataDirectory,
    });

    if (selectedPath) {
      this.nodeConfig.dataDirectory = selectedPath;
      this.testResult.set(null);
    }
  }

  async testConnection(): Promise<void> {
    this.isTesting.set(true);
    this.testResult.set(null);

    try {
      // Get blockchain info to test connection
      const info = await this.blockchainRpc.getBlockchainInfo();
      const networkInfo = await this.blockchainRpc.getNetworkInfo();

      this.testResult.set({
        success: true,
        version: networkInfo.subversion || `v${networkInfo.version}`,
        chain: info.chain,
        blocks: info.blocks,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      this.testResult.set({
        success: false,
        error: message,
      });
    } finally {
      this.isTesting.set(false);
    }
  }

  async saveNodeConfig(): Promise<void> {
    this.isSaving.set(true);

    try {
      // Dispatch action to save config
      this.store.dispatch(SettingsActions.setNodeConfig({ config: { ...this.nodeConfig } }));

      // Test connection after save
      await this.testConnection();

      if (this.testResult()?.success) {
        this.notification.success(this.i18n.get('settings_saved'));
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  // ============================================================
  // Notifications
  // ============================================================

  onNotificationChange(): void {
    // Dispatch action to save notification settings
    this.store.dispatch(
      SettingsActions.setNotifications({ notifications: { ...this.notifications } })
    );
  }

  // ============================================================
  // Danger Zone
  // ============================================================

  confirmResetWallet(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.i18n.get('reset_wallet'),
        message: this.i18n.get('reset_wallet_confirm'),
        confirmText: this.i18n.get('reset'),
        cancelText: this.i18n.get('cancel'),
        type: 'danger',
      },
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.resetWallet();
      }
    });
  }

  private resetWallet(): void {
    // Dispatch reset action
    this.store.dispatch(SettingsActions.resetAllData());
  }
}
