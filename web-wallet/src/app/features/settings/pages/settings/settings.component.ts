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
import { CookieAuthService } from '../../../../core/auth/cookie-auth.service';
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
import { MiningService } from '../../../../mining/services';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';

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

                <div class="danger-actions">
                  <div class="danger-action-item">
                    <div class="danger-action-info">
                      <strong>{{ 'reset_mining_config' | i18n }}</strong>
                      <p>{{ 'reset_mining_config_description' | i18n }}</p>
                    </div>
                    <button mat-stroked-button color="warn" (click)="confirmResetMiningConfig()">
                      <mat-icon>restart_alt</mat-icon>
                      {{ 'reset' | i18n }}
                    </button>
                  </div>
                  <mat-divider></mat-divider>
                  <div class="danger-action-item">
                    <div class="danger-action-info">
                      <strong>{{ 'reset_wallet' | i18n }}</strong>
                      <p>{{ 'reset_wallet_description' | i18n }}</p>
                    </div>
                    <button mat-raised-button color="warn" (click)="confirmResetWallet()">
                      <mat-icon>delete_forever</mat-icon>
                      {{ 'reset' | i18n }}
                    </button>
                  </div>
                </div>

                <!-- Import WIF Key Section -->
                <div class="wif-import-section">
                  <h3 class="section-title">{{ 'import_wif_wpkh' | i18n }}</h3>
                  <p class="section-description">
                    {{ 'import_wif_description' | i18n }}
                    @if (activeWalletName) {
                      <strong>"{{ activeWalletName }}"</strong>
                    }
                  </p>

                  <div class="wif-form">
                    <div class="wif-input-row">
                      <mat-form-field appearance="outline" class="wif-field">
                        <mat-label>{{ 'wif_private_key' | i18n }}</mat-label>
                        <input
                          matInput
                          [type]="wifShowKey() ? 'text' : 'password'"
                          [value]="wifInput()"
                          (input)="onWifInputChange($event)"
                          placeholder="5... / K... / L... / c..."
                          autocomplete="off"
                        />
                        <button
                          mat-icon-button
                          matSuffix
                          (click)="wifShowKey.set(!wifShowKey())"
                          [matTooltip]="wifShowKey() ? 'Hide key' : 'Show key'"
                        >
                          <mat-icon>{{ wifShowKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                        </button>
                      </mat-form-field>
                    </div>

                    <mat-form-field appearance="outline" class="label-field">
                      <mat-label>{{ 'address_label_optional' | i18n }}</mat-label>
                      <input
                        matInput
                        [value]="wifLabel()"
                        (input)="wifLabel.set($any($event.target).value)"
                        placeholder="e.g., Cold storage"
                      />
                    </mat-form-field>

                    @if (wifError()) {
                      <div class="wif-error">
                        <mat-icon>error</mat-icon>
                        <span>{{ wifError() }}</span>
                      </div>
                    }

                    @if (wifPreview()) {
                      <div class="wif-preview">
                        <div class="preview-row">
                          <span class="preview-label">{{ 'address' | i18n }}:</span>
                          <code class="preview-value">{{ wifPreview()!.address }}</code>
                        </div>
                      </div>
                    }

                    <div class="wif-actions">
                      <button
                        mat-stroked-button
                        (click)="validateWif()"
                        [disabled]="!wifInput() || isValidatingWif() || isImportingWif()"
                      >
                        @if (isValidatingWif()) {
                          <mat-spinner diameter="18"></mat-spinner>
                        } @else {
                          <mat-icon>preview</mat-icon>
                        }
                        {{ 'preview_address' | i18n }}
                      </button>
                      <button
                        mat-raised-button
                        color="warn"
                        (click)="importWif()"
                        [disabled]="!wifPreview() || isImportingWif()"
                      >
                        @if (isImportingWif()) {
                          <mat-spinner diameter="18"></mat-spinner>
                        } @else {
                          <mat-icon>key</mat-icon>
                        }
                        {{ 'import_to_wallet' | i18n }}
                      </button>
                    </div>
                  </div>
                </div>
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
        max-width: 600px;
        margin: 0 auto;
        padding: 24px;
      }

      .danger-warning {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        margin-bottom: 32px;
        color: rgba(0, 0, 0, 0.6);
        text-align: center;

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

      .danger-actions {
        background: #ffffff;
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: 8px;
        overflow: hidden;
      }

      .danger-action-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        gap: 16px;
      }

      .danger-action-info {
        flex: 1;

        strong {
          display: block;
          margin-bottom: 4px;
          color: rgba(0, 0, 0, 0.87);
        }

        p {
          margin: 0;
          font-size: 13px;
          color: rgba(0, 0, 0, 0.6);
        }
      }

      /* WIF Import Styles */
      .wif-import-section {
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 20px;
        margin-top: 24px;

        .section-title {
          margin: 0 0 8px 0;
          font-size: 14px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: rgba(0, 0, 0, 0.6);
        }

        .section-description {
          margin: 0 0 16px 0;
          font-size: 13px;
          color: rgba(0, 0, 0, 0.6);

          strong {
            color: rgba(0, 0, 0, 0.87);
          }
        }
      }

      .wif-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .wif-input-row {
        display: flex;
        gap: 8px;
      }

      .wif-field {
        flex: 1;

        /* Hide browser's native password reveal button */
        input::-ms-reveal,
        input::-ms-clear {
          display: none;
        }
      }

      .label-field {
        width: 100%;
      }

      .wif-error {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: rgba(244, 67, 54, 0.1);
        border-radius: 4px;
        color: #c62828;
        font-size: 13px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .wif-preview {
        padding: 12px;
        background: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
        border-radius: 4px;

        .preview-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 8px;

          &:last-child {
            margin-bottom: 0;
          }
        }

        .preview-label {
          font-size: 12px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.6);
          min-width: 70px;
        }

        .preview-value {
          font-size: 12px;
          font-family: monospace;
          background: rgba(0, 0, 0, 0.05);
          padding: 2px 6px;
          border-radius: 3px;
          word-break: break-all;

          &.descriptor {
            font-size: 11px;
          }
        }
      }

      .wif-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 8px;

        button {
          min-width: 120px;

          mat-spinner {
            display: inline-block;
            margin-right: 8px;
          }
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
  private readonly cookieAuth = inject(CookieAuthService);
  private readonly miningService = inject(MiningService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly destroy$ = new Subject<void>();

  // Expose only the active wallet name for template
  get activeWalletName(): string | null {
    return this.walletManager.activeWallet;
  }

  // WIF Import state
  wifInput = signal('');
  wifLabel = signal('');
  wifShowKey = signal(false);
  wifPreview = signal<{ address: string; descriptor: string } | null>(null);
  wifError = signal<string | null>(null);
  isValidatingWif = signal(false);
  isImportingWif = signal(false);

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
    // Clear sensitive WIF data
    this.clearWifForm();
  }

  private clearWifForm(): void {
    this.wifInput.set('');
    this.wifLabel.set('');
    this.wifPreview.set(null);
    this.wifError.set(null);
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
      // Get credentials based on auth method from form values
      let credentials: { username: string; password: string } | null = null;

      if (this.nodeConfig.authMethod === 'cookie') {
        // Read cookie with form's dataDirectory and network (not from store)
        credentials = await this.cookieAuth.readCookieWithConfig(
          this.nodeConfig.dataDirectory,
          this.nodeConfig.network
        );
      } else {
        // Use credentials from form
        credentials = {
          username: this.nodeConfig.username,
          password: this.nodeConfig.password,
        };
      }

      // Test connection with form values
      const result = await this.rpcClient.testWithConfig({
        host: this.nodeConfig.rpcHost,
        port: this.nodeConfig.rpcPort,
        credentials,
      });

      this.testResult.set(result);
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
      // Dispatch action to save config to store
      this.store.dispatch(SettingsActions.setNodeConfig({ config: { ...this.nodeConfig } }));

      // Refresh global cookie cache with new settings
      if (this.nodeConfig.authMethod === 'cookie') {
        await this.cookieAuth.refreshCredentials();
      }

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

  confirmResetMiningConfig(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.i18n.get('reset_mining_config'),
        message: this.i18n.get('reset_mining_config_confirm'),
        confirmText: this.i18n.get('reset'),
        cancelText: this.i18n.get('cancel'),
        type: 'danger',
      },
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (confirmed) {
        try {
          await this.miningService.resetConfig();
          this.notification.success(this.i18n.get('mining_config_reset'));
          this.router.navigate(['/mining/setup']);
        } catch (error) {
          console.error('Failed to reset mining config:', error);
          this.notification.error(this.i18n.get('reset_mining_config_failed'));
        }
      }
    });
  }

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

  // ============================================================
  // WIF Import
  // ============================================================

  onWifInputChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.wifInput.set(value);
    // Clear previous preview/error when input changes
    this.wifPreview.set(null);
    this.wifError.set(null);
  }

  async validateWif(): Promise<void> {
    const wif = this.wifInput().trim();
    if (!wif) return;

    // Check wallet is selected
    if (!this.walletManager.activeWallet) {
      this.wifError.set(this.i18n.get('no_wallet_selected'));
      return;
    }

    this.isValidatingWif.set(true);
    this.wifError.set(null);
    this.wifPreview.set(null);

    try {
      // Create descriptor without checksum
      const descriptorWithoutChecksum = `wpkh(${wif})`;

      // Use Bitcoin Core's getdescriptorinfo to validate and get checksum
      const info = await this.walletRpc.getDescriptorInfo(descriptorWithoutChecksum);

      if (!info.issolvable) {
        throw new Error('Invalid WIF key - descriptor is not solvable');
      }

      if (!info.hasprivatekeys) {
        throw new Error('Invalid WIF key - no private key detected');
      }

      // Keep original descriptor with WIF, just append the checksum
      // (info.descriptor converts WIF to pubkey, which we don't want for import)
      const descriptorWithChecksum = `${descriptorWithoutChecksum}#${info.checksum}`;

      // Derive the address using the public key version (for display only)
      const addresses = await this.walletRpc.deriveAddresses(info.descriptor);

      if (!addresses || addresses.length === 0) {
        throw new Error('Could not derive address from WIF');
      }

      this.wifPreview.set({
        address: addresses[0],
        descriptor: descriptorWithChecksum,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid WIF key';
      this.wifError.set(message);
    } finally {
      this.isValidatingWif.set(false);
    }
  }

  async importWif(): Promise<void> {
    const preview = this.wifPreview();
    const walletName = this.walletManager.activeWallet;

    if (!preview || !walletName) return;

    this.isImportingWif.set(true);

    try {
      const label = this.wifLabel().trim() || undefined;

      // Use short timeout (5s) - if it times out, import likely succeeded but wallet is rescanning
      const result = await this.walletRpc.importDescriptors(walletName, [
        {
          desc: preview.descriptor,
          timestamp: 'now',
          label,
        },
      ], 5000);

      if (result && result.length > 0 && result[0].success) {
        this.notification.success(
          this.i18n.get('wif_import_success').replace('{address}', preview.address)
        );
        this.clearWifForm();
      } else {
        const errorMsg = result?.[0]?.error?.message || 'Unknown error';
        throw new Error(errorMsg);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      // Check if it's a timeout - import may have succeeded but wallet is rescanning
      if (message.toLowerCase().includes('timeout')) {
        this.notification.info(this.i18n.get('wif_import_timeout'));
        this.clearWifForm();
      } else {
        this.wifError.set(message);
        this.notification.error(this.i18n.get('wif_import_failed') + ': ' + message);
      }
    } finally {
      this.isImportingWif.set(false);
    }
  }
}
