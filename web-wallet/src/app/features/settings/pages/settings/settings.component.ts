import { Component, effect, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTabsModule, MatTabChangeEvent } from '@angular/material/tabs';
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
import { PlatformService } from '../../../../core/services/platform.service';
import { ElectronService, DebugPaths } from '../../../../core/services/electron.service';
import { AppModeService } from '../../../../core/services/app-mode.service';
import { CookieAuthService } from '../../../../core/auth/cookie-auth.service';
import { SettingsActions } from '../../../../store/settings/settings.actions';
import { WalletActions } from '../../../../store/wallet/wallet.actions';
import {
  selectNodeConfig,
  selectNotifications,
} from '../../../../store/settings/settings.selectors';
import {
  BtcxWalletService,
  BtcxWalletSummary,
} from '../../../../core/services/btcx-wallet.service';
import { ElectrumServersEditorComponent } from '../../../../shared/components/electrum-servers-editor/electrum-servers-editor.component';
import {
  NodeConfig,
  NotificationSettings,
  getDefaultRpcPort,
  getDefaultDataDirectory,
  defaultNodeConfig,
} from '../../../../store/settings/settings.state';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { MiningService } from '../../../../mining/services';
import { ChainConfig } from '../../../../mining/models';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import {
  WalletManagerService,
  WatchOnlyRescan,
  rescanToTimestamp,
} from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { NodeService, NodeMode } from '../../../../node';
import { AggregatorService } from '../../../../aggregator/services/aggregator.service';
import { AggregatorConfig } from '../../../../aggregator/models/aggregator.models';

interface ConnectionTestResult {
  success: boolean;
  version?: string;
  chain?: string;
  blocks?: number;
  error?: string;
}

/** Extract the port from an "addr:port" listen address. Returns null if unparseable. */
function parseListenAddressPort(listenAddress: string): number | null {
  const idx = listenAddress.lastIndexOf(':');
  if (idx < 0) return null;
  const port = Number(listenAddress.slice(idx + 1));
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

interface CustomArgRow {
  key: string;
  value: string;
}

/** Keys the wallet manages itself — emitted by us in bitcoin.conf or on the CLI.
 * Anything the user enters here would either be overridden or break wallet plumbing. */
const RESERVED_NODE_ARG_KEYS: ReadonlySet<string> = new Set([
  'rpcport',
  'rpcbind',
  'rpcallowip',
  'server',
  'datadir',
  'testnet',
  'regtest',
  'chain',
]);

function normalizeArgKey(raw: string): string {
  return raw.trim().replace(/^-+/, '').toLowerCase();
}

function parseCustomArgsString(raw: string): CustomArgRow[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .filter(token => token.length > 0)
    .map(token => {
      const stripped = token.replace(/^-+/, '');
      const eqIdx = stripped.indexOf('=');
      if (eqIdx < 0) return { key: stripped, value: '' };
      return { key: stripped.slice(0, eqIdx), value: stripped.slice(eqIdx + 1) };
    });
}

function serializeCustomArgRows(rows: CustomArgRow[]): string {
  return rows
    .map(r => ({ key: r.key.trim().replace(/^-+/, ''), value: r.value }))
    .filter(r => r.key.length > 0)
    .map(r => (r.value === '' ? `-${r.key}` : `-${r.key}=${r.value}`))
    .join(' ');
}

/** Replace the port in an "addr:port" listen address. */
function withListenPort(listenAddress: string, port: number): string {
  const idx = listenAddress.lastIndexOf(':');
  const host = idx >= 0 ? listenAddress.slice(0, idx) : '0.0.0.0';
  return `${host}:${port}`;
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
    ElectrumServersEditorComponent,
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
        <mat-tab-group animationDuration="200ms" (selectedTabChange)="onTabChange($event)">
          <!-- Tab 1: Node Configuration -->
          <mat-tab [label]="'node_configuration' | i18n">
            <div class="tab-content">
              <div class="config-container">
                <!-- Connection Mode Section -->
                <div class="config-section">
                  <h3 class="section-title">{{ 'connection_mode' | i18n }}</h3>
                  <mat-radio-group
                    [ngModel]="nodeMode()"
                    (ngModelChange)="onNodeModeToggle($event)"
                    class="horizontal-radio-group"
                  >
                    <mat-radio-button value="managed">{{
                      'node_managed_node' | i18n
                    }}</mat-radio-button>
                    <mat-radio-button value="external">{{
                      'node_external_node' | i18n
                    }}</mat-radio-button>
                    <mat-radio-button value="remote">{{
                      'node_remote_node' | i18n
                    }}</mat-radio-button>
                  </mat-radio-group>
                </div>

                <!-- Managed Node Section -->
                @if (nodeMode() === 'managed') {
                  <div class="config-section">
                    <h3 class="section-title">{{ 'node_managed_status' | i18n }}</h3>
                    @if (nodeService.isInstalled()) {
                      <div class="node-status-card">
                        <div class="status-row">
                          <span class="status-label">{{ 'status' | i18n }}:</span>
                          <span
                            class="status-value"
                            [class.running]="nodeService.isRunning()"
                            [class.stopped]="!nodeService.isRunning()"
                          >
                            <mat-icon>{{
                              nodeService.isRunning() ? 'check_circle' : 'cancel'
                            }}</mat-icon>
                            {{ nodeService.isRunning() ? ('running' | i18n) : ('stopped' | i18n) }}
                          </span>
                        </div>
                        <div class="status-row">
                          <span class="status-label">{{ 'version' | i18n }}:</span>
                          <span class="status-value">{{
                            nodeService.currentVersion() || ('unknown' | i18n)
                          }}</span>
                        </div>
                        <div class="status-row">
                          <span class="status-label">{{ 'network' | i18n }}:</span>
                          <span class="status-value">{{ nodeService.network() }}</span>
                        </div>
                        @if (nodeService.status().pid) {
                          <div class="status-row">
                            <span class="status-label">{{ 'pid' | i18n }}:</span>
                            <span class="status-value">{{ nodeService.status().pid }}</span>
                          </div>
                        }
                      </div>

                      <div class="node-controls">
                        @if (nodeService.isRunning() || isStoppingNode()) {
                          <button
                            mat-stroked-button
                            color="warn"
                            (click)="stopManagedNode()"
                            [disabled]="isStoppingNode()"
                          >
                            @if (isStoppingNode()) {
                              <mat-spinner diameter="18"></mat-spinner>
                              {{ 'node_stopping' | i18n }}
                            } @else {
                              <ng-container>
                                <mat-icon>stop</mat-icon>
                                {{ 'node_stop' | i18n }}
                              </ng-container>
                            }
                          </button>
                          @if (!isStoppingNode()) {
                            <button mat-stroked-button (click)="restartManagedNode()">
                              <mat-icon>refresh</mat-icon>
                              {{ 'node_restart' | i18n }}
                            </button>
                          }
                        } @else {
                          <button
                            mat-raised-button
                            color="primary"
                            (click)="startManagedNode()"
                            [disabled]="isStartingNode()"
                          >
                            @if (isStartingNode()) {
                              <mat-spinner diameter="18"></mat-spinner>
                            } @else {
                              <mat-icon>play_arrow</mat-icon>
                            }
                            {{ 'node_start' | i18n }}
                          </button>
                        }
                      </div>
                    } @else {
                      <div class="node-not-installed">
                        <mat-icon>cloud_download</mat-icon>
                        <p>{{ 'node_not_installed' | i18n }}</p>
                        <button mat-raised-button color="primary" (click)="navigateToNodeSetup()">
                          <mat-icon>download</mat-icon>
                          {{ 'node_download_install' | i18n }}
                        </button>
                      </div>
                    }
                  </div>

                  @if (nodeService.isInstalled()) {
                    <div class="config-section">
                      <h3 class="section-title">{{ 'network' | i18n }}</h3>
                      <mat-radio-group
                        [(ngModel)]="activeConfig.network"
                        (change)="onManagedNetworkChange()"
                        class="horizontal-radio-group"
                      >
                        <mat-radio-button value="mainnet">{{ 'mainnet' | i18n }}</mat-radio-button>
                        <mat-radio-button value="testnet">{{ 'testnet' | i18n }}</mat-radio-button>
                      </mat-radio-group>
                      @if (
                        nodeService.isRunning() ||
                        isStoppingNode() ||
                        miningService.minerRunning() ||
                        aggregatorService.isRunning()
                      ) {
                        <p class="hint-text">
                          <mat-icon class="hint-icon">info</mat-icon>
                          {{ 'node_network_change_stop_hint' | i18n }}
                        </p>
                      }
                    </div>

                    <div class="config-section advanced-config-section">
                      <div class="advanced-header">
                        <h3 class="section-title">{{ 'setup_advanced_options' | i18n }}</h3>
                        <button
                          type="button"
                          class="collapse-toggle"
                          (click)="managedAdvancedOpen.update(v => !v)"
                        >
                          <span>{{
                            managedAdvancedOpen() ? ('setup_hide' | i18n) : ('setup_show' | i18n)
                          }}</span>
                          <span>{{ managedAdvancedOpen() ? '&#9660;' : '&#9654;' }}</span>
                        </button>
                      </div>
                      @if (managedAdvancedOpen()) {
                        <div class="form-row">
                          <mat-form-field appearance="outline" class="half-width">
                            <mat-label>{{ 'node_wallet_rpc_port' | i18n }}</mat-label>
                            <input
                              matInput
                              type="number"
                              [(ngModel)]="activeConfig.rpcPort"
                              min="1"
                              max="65535"
                              [disabled]="isManagedNodeBusy()"
                            />
                          </mat-form-field>
                          <mat-form-field appearance="outline" class="half-width">
                            <mat-label>{{ 'aggregator_listen_port' | i18n }}</mat-label>
                            <input
                              matInput
                              type="number"
                              [(ngModel)]="aggregatorListenPort"
                              min="1"
                              max="65535"
                              [disabled]="isAggregatorPortBusy()"
                            />
                          </mat-form-field>
                        </div>
                        @if (isManagedNodeBusy()) {
                          <p class="hint-text">
                            <mat-icon class="hint-icon">info</mat-icon>
                            {{ 'node_rpc_port_change_stop_hint' | i18n }}
                          </p>
                        }
                        @if (isAggregatorPortBusy()) {
                          <p class="hint-text">
                            <mat-icon class="hint-icon">info</mat-icon>
                            {{ 'aggregator_port_change_stop_hint' | i18n }}
                          </p>
                        }

                        <div class="custom-args-section">
                          <h4 class="custom-args-title">
                            {{ 'node_custom_args_title' | i18n }}
                          </h4>
                          <p class="custom-args-hint">
                            {{ 'node_custom_args_hint' | i18n }}
                          </p>

                          @if (customArgRows().length === 0) {
                            <p class="custom-args-empty">
                              {{ 'node_custom_args_empty' | i18n }}
                            </p>
                          } @else {
                            @for (row of customArgRows(); track $index) {
                              <div class="custom-arg-row">
                                <mat-form-field appearance="outline" class="arg-key">
                                  <mat-label>{{ 'node_custom_arg_key' | i18n }}</mat-label>
                                  <input
                                    matInput
                                    [ngModel]="row.key"
                                    (ngModelChange)="updateCustomArgKey($index, $event)"
                                    [disabled]="isManagedNodeBusy()"
                                  />
                                  @if (isReservedArgKey(row.key)) {
                                    <mat-icon
                                      matSuffix
                                      class="reserved-warn-icon"
                                      [matTooltip]="reservedKeyWarning(row.key)"
                                      >warning</mat-icon
                                    >
                                  }
                                </mat-form-field>
                                <mat-form-field appearance="outline" class="arg-value">
                                  <mat-label>{{ 'node_custom_arg_value' | i18n }}</mat-label>
                                  <input
                                    matInput
                                    [ngModel]="row.value"
                                    (ngModelChange)="updateCustomArgValue($index, $event)"
                                    [placeholder]="'node_custom_arg_value_placeholder' | i18n"
                                    [disabled]="isManagedNodeBusy()"
                                  />
                                </mat-form-field>
                                <button
                                  mat-icon-button
                                  type="button"
                                  class="arg-remove-btn"
                                  (click)="removeCustomArgRow($index)"
                                  [disabled]="isManagedNodeBusy()"
                                  [matTooltip]="'node_custom_arg_remove' | i18n"
                                >
                                  <mat-icon>close</mat-icon>
                                </button>
                              </div>
                              @if (isReservedArgKey(row.key)) {
                                <p class="reserved-key-warning">
                                  <mat-icon class="hint-icon">warning</mat-icon>
                                  {{ reservedKeyWarning(row.key) }}
                                </p>
                              }
                            }
                          }

                          <button
                            mat-stroked-button
                            type="button"
                            class="add-arg-btn"
                            (click)="addCustomArgRow()"
                            [disabled]="isManagedNodeBusy()"
                          >
                            <mat-icon>add</mat-icon>
                            {{ 'node_custom_arg_add' | i18n }}
                          </button>

                          <p class="hint-text custom-args-restart-hint">
                            <mat-icon class="hint-icon">info</mat-icon>
                            {{ 'node_custom_args_restart_hint' | i18n }}
                          </p>
                        </div>
                      }
                    </div>

                    <div class="config-section">
                      <h3 class="section-title">{{ 'node_updates' | i18n }}</h3>
                      <div class="update-row">
                        <div class="update-info">
                          <span
                            >{{ 'current' | i18n }}:
                            {{ nodeService.currentVersion() || ('unknown' | i18n) }}</span
                          >
                          @if (nodeService.hasUpdate()) {
                            <span class="update-badge"
                              >{{ 'update_available' | i18n }}:
                              {{ nodeService.updateInfo()?.latestVersion }}</span
                            >
                          }
                        </div>
                        <div class="update-actions">
                          <button mat-stroked-button (click)="checkForNodeUpdate()">
                            <mat-icon>update</mat-icon>
                            {{ 'node_check_updates' | i18n }}
                          </button>
                          @if (nodeService.hasUpdate()) {
                            <button mat-raised-button color="primary" (click)="updateNode()">
                              <mat-icon>download</mat-icon>
                              {{ 'node_update' | i18n }}
                            </button>
                          }
                        </div>
                      </div>
                      @if (nodeService.hasUpdate()) {
                        <p class="hint-text">
                          <mat-icon class="hint-icon">info</mat-icon>
                          {{ 'node_update_restart_hint' | i18n }}
                        </p>
                      }
                    </div>
                  }

                  <!-- Save & Apply (managed mode) -->
                  <div class="action-buttons">
                    <button
                      mat-raised-button
                      color="primary"
                      (click)="saveAndApply()"
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
                }

                <!-- External Node Section -->
                @if (nodeMode() === 'external') {
                  <!-- Network Section -->
                  <div class="config-section">
                    <h3 class="section-title">{{ 'network' | i18n }}</h3>
                    <mat-radio-group
                      [(ngModel)]="activeConfig.network"
                      (change)="onNetworkChange()"
                      class="horizontal-radio-group"
                    >
                      <mat-radio-button value="mainnet">{{ 'mainnet' | i18n }}</mat-radio-button>
                      <mat-radio-button value="testnet">{{ 'testnet' | i18n }}</mat-radio-button>
                      <mat-radio-button value="regtest">{{ 'regtest' | i18n }}</mat-radio-button>
                    </mat-radio-group>
                  </div>

                  <!-- Connection Settings Section -->
                  <div class="config-section">
                    <h3 class="section-title">{{ 'connection_settings' | i18n }}</h3>
                    <div class="form-row">
                      <mat-form-field appearance="outline" class="half-width">
                        <mat-label>{{ 'rpc_host' | i18n }}</mat-label>
                        <input matInput [(ngModel)]="activeConfig.rpcHost" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="half-width">
                        <mat-label>{{ 'rpc_port' | i18n }}</mat-label>
                        <input
                          matInput
                          type="number"
                          [(ngModel)]="activeConfig.rpcPort"
                          min="1"
                          max="65535"
                        />
                      </mat-form-field>
                    </div>
                  </div>

                  <!-- Authentication Section -->
                  <div class="config-section">
                    <h3 class="section-title">{{ 'authentication' | i18n }}</h3>
                    <mat-radio-group
                      [(ngModel)]="activeConfig.authMethod"
                      class="vertical-radio-group"
                    >
                      <mat-radio-button value="cookie"
                        >{{ 'cookie_based' | i18n }} ({{ 'local_node' | i18n }})</mat-radio-button
                      >

                      @if (activeConfig.authMethod === 'cookie') {
                        <div class="auth-sub-fields">
                          <div class="form-row">
                            <mat-form-field appearance="outline" class="full-width">
                              <mat-label>{{ 'data_directory' | i18n }}</mat-label>
                              <input matInput [(ngModel)]="activeConfig.dataDirectory" />
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

                          @if (activeConfig.network !== 'mainnet') {
                            <mat-form-field appearance="outline" class="half-width">
                              <mat-label>{{ 'testnet_subdirectory' | i18n }}</mat-label>
                              <input matInput [(ngModel)]="activeConfig.testnetSubdir" />
                            </mat-form-field>
                          }
                        </div>
                      }

                      <mat-radio-button value="credentials">{{
                        'username_password' | i18n
                      }}</mat-radio-button>

                      @if (activeConfig.authMethod === 'credentials') {
                        <div class="auth-sub-fields">
                          <mat-form-field appearance="outline" class="full-width">
                            <mat-label>{{ 'username' | i18n }}</mat-label>
                            <input
                              matInput
                              [(ngModel)]="activeConfig.username"
                              autocomplete="off"
                            />
                          </mat-form-field>
                          <mat-form-field appearance="outline" class="full-width">
                            <mat-label>{{ 'password' | i18n }}</mat-label>
                            <input
                              matInput
                              type="password"
                              [(ngModel)]="activeConfig.password"
                              autocomplete="off"
                            />
                          </mat-form-field>
                        </div>
                      }
                    </mat-radio-group>
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
                    <button mat-stroked-button (click)="resetExternalToDefaults()">
                      <mat-icon>restart_alt</mat-icon>
                      {{ 'reset_to_defaults' | i18n }}
                    </button>
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
                      (click)="saveAndApply()"
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
                }

                <!-- Remote (Electrum) Section -->
                @if (nodeMode() === 'remote') {
                  <!-- Network Section -->
                  <div class="config-section">
                    <h3 class="section-title">{{ 'network' | i18n }}</h3>
                    <mat-radio-group
                      [ngModel]="remoteNetwork()"
                      (ngModelChange)="onRemoteNetworkChange($event)"
                      class="horizontal-radio-group"
                    >
                      <mat-radio-button value="mainnet">{{ 'mainnet' | i18n }}</mat-radio-button>
                      <mat-radio-button value="testnet">{{ 'testnet' | i18n }}</mat-radio-button>
                      <mat-radio-button value="regtest">{{ 'regtest' | i18n }}</mat-radio-button>
                    </mat-radio-group>
                  </div>

                  <!-- Electrum Servers Section -->
                  <div class="config-section">
                    <h3 class="section-title">{{ 'electrum_servers' | i18n }}</h3>
                    <p class="section-description">{{ 'electrum_servers_desc' | i18n }}</p>
                    <app-electrum-servers-editor
                      [servers]="remoteServers()"
                      [network]="remoteNetwork()"
                      [showTest]="true"
                      [disabled]="isSaving()"
                      (serversChange)="remoteServers.set($event)"
                    />
                  </div>

                  <!-- Wallets (the remote-mode switcher's list) — carries the
                       "Legacy v30" badge on pre-v31 (coin-0') wallets, and the
                       manual re-probe for older funds on the open wallet. -->
                  @if (btcxWallet.wallets().length > 0) {
                    <div class="config-section">
                      <h3 class="section-title">{{ 'wallets' | i18n }}</h3>
                      <div class="remote-wallet-list">
                        @for (w of btcxWallet.wallets(); track w.name) {
                          <div class="remote-wallet-row" [class.active]="w.isActive">
                            <mat-icon class="remote-wallet-icon" [class.active]="w.isActive"
                              >account_balance_wallet</mat-icon
                            >
                            <span class="remote-wallet-name">{{ w.name }}</span>
                            @if (w.policy.coinType === 0) {
                              <span class="remote-wallet-badge legacy">{{
                                'wallet_legacy_badge' | i18n
                              }}</span>
                            }
                            @if (w.policy.coinType === 0 && !w.v30Migrated && w.source === 'seed') {
                              <button
                                mat-stroked-button
                                class="remote-wallet-upgrade"
                                [disabled]="upgradingV31() !== null"
                                (click)="upgradeToV31(w)"
                              >
                                @if (upgradingV31() === w.name) {
                                  <mat-spinner diameter="16"></mat-spinner>
                                } @else {
                                  <mat-icon>upgrade</mat-icon>
                                }
                                {{ 'mwallet_upgrade_v31' | i18n }}
                              </button>
                            }
                            @if (w.isActive) {
                              <mat-icon class="remote-wallet-check">check</mat-icon>
                            }
                          </div>
                        }
                      </div>

                      @if (btcxWallet.walletActive()) {
                        <button
                          mat-stroked-button
                          class="rescan-legacy-button"
                          [disabled]="rescanningLegacy()"
                          (click)="rescanLegacy()"
                        >
                          @if (rescanningLegacy()) {
                            <mat-spinner diameter="18"></mat-spinner>
                          } @else {
                            <mat-icon>manage_search</mat-icon>
                          }
                          {{ 'wallet_rescan_legacy' | i18n }}
                        </button>
                      }
                    </div>
                  }

                  <!-- Action Buttons -->
                  <div class="action-buttons">
                    <button
                      mat-raised-button
                      color="primary"
                      (click)="saveAndApply()"
                      [disabled]="isSaving() || remoteServers().length === 0"
                    >
                      @if (isSaving()) {
                        <mat-spinner diameter="20"></mat-spinner>
                      } @else {
                        <mat-icon>save</mat-icon>
                      }
                      {{ 'save_apply' | i18n }}
                    </button>
                  </div>
                }
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

                  <!-- System Notifications -->
                  <div class="notification-group">
                    <h3 class="section-title">{{ 'system_notifications' | i18n }}</h3>
                    <div class="notification-item">
                      <mat-slide-toggle
                        [(ngModel)]="notifications.clockDriftWarning"
                        (change)="onNotificationChange()"
                      >
                        {{ 'clock_drift_warning' | i18n }}
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

                <!-- Import WIF Key Section (Core wallets only: imports a
                     single-key descriptor via importdescriptors — the local
                     BDK wallet is one fixed BIP-84 descriptor and cannot
                     adopt foreign keys) -->
                @if (nodeMode() !== 'remote') {
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
                            [matTooltip]="wifShowKey() ? ('hide_key' | i18n) : ('show_key' | i18n)"
                          >
                            <mat-icon>{{
                              wifShowKey() ? 'visibility_off' : 'visibility'
                            }}</mat-icon>
                          </button>
                        </mat-form-field>
                      </div>

                      <mat-form-field appearance="outline" class="label-field">
                        <mat-label>{{ 'address_label_optional' | i18n }}</mat-label>
                        <input
                          matInput
                          [value]="wifLabel()"
                          (input)="wifLabel.set($any($event.target).value)"
                          [placeholder]="'address_label_placeholder' | i18n"
                        />
                      </mat-form-field>

                      <div class="wif-rescan-section">
                        <p class="wif-rescan-label">{{ 'watch_only_rescan_label' | i18n }}</p>
                        <mat-radio-group
                          class="wif-rescan-group"
                          [value]="wifRescanKind()"
                          (change)="wifRescanKind.set($event.value)"
                          [disabled]="isImportingWif()"
                        >
                          <mat-radio-button value="now">
                            {{ 'watch_only_rescan_now' | i18n }}
                          </mat-radio-button>
                          <mat-radio-button value="date">
                            {{ 'watch_only_rescan_date' | i18n }}
                          </mat-radio-button>
                          <mat-radio-button value="genesis">
                            {{ 'watch_only_rescan_genesis' | i18n }}
                          </mat-radio-button>
                        </mat-radio-group>

                        @if (wifRescanKind() === 'date') {
                          <mat-form-field appearance="outline" class="wif-rescan-date-field">
                            <mat-label>{{ 'watch_only_rescan_date_label' | i18n }}</mat-label>
                            <input
                              matInput
                              type="date"
                              [(ngModel)]="wifRescanDateInput"
                              [disabled]="isImportingWif()"
                            />
                          </mat-form-field>
                        }

                        @if (wifRescanKind() === 'now') {
                          <p class="wif-rescan-warning">
                            <mat-icon>warning</mat-icon>
                            {{ 'watch_only_rescan_warning_now' | i18n }}
                          </p>
                        }
                      </div>

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
                          [disabled]="!wifPreview() || isImportingWif() || !canImportWif()"
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
                }
              </div>
            </div>
          </mat-tab>
          <!-- Tab 4: Debug & Logs -->
          <mat-tab [label]="'debug_logs' | i18n">
            <div class="tab-content">
              <div class="debug-container">
                <!-- App Data Directory -->
                <div class="config-section">
                  <div class="debug-info-header">
                    <mat-icon>folder</mat-icon>
                    <h3 class="section-title">{{ 'debug_app_data_dir' | i18n }}</h3>
                  </div>
                  <p class="debug-description">{{ 'debug_app_data_dir_desc' | i18n }}</p>
                  @if (debugPaths()) {
                    <div class="debug-path">{{ debugPaths()!.appDataDir }}</div>
                    <div class="debug-actions-row">
                      <button mat-stroked-button (click)="revealFolder(debugPaths()!.appDataDir)">
                        <mat-icon>folder_open</mat-icon>
                        {{ 'debug_open_folder' | i18n }}
                      </button>
                    </div>
                  }
                </div>

                <!-- Configuration Files -->
                <div class="config-section">
                  <div class="debug-info-header">
                    <mat-icon>settings</mat-icon>
                    <h3 class="section-title">{{ 'debug_config_files' | i18n }}</h3>
                  </div>
                  @if (debugPaths()) {
                    <div class="debug-file-item">
                      <div class="debug-file-info">
                        <span class="debug-file-label">{{ 'debug_node_config' | i18n }}</span>
                        <span class="debug-file-name">node_config.json</span>
                      </div>
                      <button mat-stroked-button (click)="openConfigFile(debugPaths()!.nodeConfig)">
                        <mat-icon>open_in_new</mat-icon>
                        {{ 'debug_open' | i18n }}
                      </button>
                    </div>
                    <div class="debug-file-item">
                      <div class="debug-file-info">
                        <span class="debug-file-label">{{ 'debug_mining_config' | i18n }}</span>
                        <span class="debug-file-name">mining-config.json</span>
                      </div>
                      <button
                        mat-stroked-button
                        (click)="openConfigFile(debugPaths()!.miningConfig)"
                      >
                        <mat-icon>open_in_new</mat-icon>
                        {{ 'debug_open' | i18n }}
                      </button>
                    </div>
                    <div class="debug-file-item">
                      <div class="debug-file-info">
                        <span class="debug-file-label">{{ 'debug_aggregator_config' | i18n }}</span>
                        <span class="debug-file-name">aggregator-config.json</span>
                      </div>
                      <button
                        mat-stroked-button
                        (click)="openConfigFile(debugPaths()!.aggregatorConfig)"
                      >
                        <mat-icon>open_in_new</mat-icon>
                        {{ 'debug_open' | i18n }}
                      </button>
                    </div>
                    <div class="debug-file-item">
                      <div class="debug-file-info">
                        <span class="debug-file-label">{{ 'debug_bitcoin_config' | i18n }}</span>
                        <span class="debug-file-name">bitcoin.conf</span>
                      </div>
                      <button
                        mat-stroked-button
                        (click)="openConfigFile(debugPaths()!.bitcoinConf)"
                      >
                        <mat-icon>open_in_new</mat-icon>
                        {{ 'debug_open' | i18n }}
                      </button>
                    </div>
                  }
                </div>

                <!-- Log Files -->
                <div class="config-section">
                  <div class="debug-info-header">
                    <mat-icon>description</mat-icon>
                    <h3 class="section-title">{{ 'debug_log_files' | i18n }}</h3>
                  </div>
                  @if (debugPaths()) {
                    <div class="debug-file-item">
                      <div class="debug-file-info">
                        <span class="debug-file-label">{{ 'debug_app_log' | i18n }}</span>
                        <span class="debug-file-name">logs/</span>
                      </div>
                      <button mat-stroked-button (click)="revealFolder(debugPaths()!.logsDir)">
                        <mat-icon>folder_open</mat-icon>
                        {{ 'debug_open_folder' | i18n }}
                      </button>
                    </div>
                    <div class="debug-file-item">
                      <div class="debug-file-info">
                        <span class="debug-file-label">{{ 'debug_bitcoin_log' | i18n }}</span>
                        <span class="debug-file-name">debug.log</span>
                      </div>
                      <button
                        mat-stroked-button
                        (click)="openConfigFile(debugPaths()!.bitcoinDebugLog)"
                      >
                        <mat-icon>open_in_new</mat-icon>
                        {{ 'debug_open' | i18n }}
                      </button>
                    </div>
                  }
                </div>

                <!-- System Info -->
                <div class="config-section">
                  <div class="debug-info-header">
                    <mat-icon>info</mat-icon>
                    <h3 class="section-title">{{ 'debug_system_info' | i18n }}</h3>
                  </div>
                  <div class="debug-system-info">
                    <div class="debug-info-row">
                      <span class="debug-info-label">{{ 'debug_app_version' | i18n }}</span>
                      <span class="debug-info-value">{{ debugAppVersion() }}</span>
                    </div>
                    <div class="debug-info-row">
                      <span class="debug-info-label">{{ 'debug_platform' | i18n }}</span>
                      <span class="debug-info-value">{{ debugPlatform() }}</span>
                    </div>
                    <div class="debug-info-row">
                      <span class="debug-info-label">{{ 'debug_node_version' | i18n }}</span>
                      <span class="debug-info-value">{{
                        nodeService.currentVersion() || 'N/A'
                      }}</span>
                    </div>
                  </div>
                  <div class="debug-actions-row">
                    <button mat-stroked-button (click)="copySystemInfo()">
                      <mat-icon>content_copy</mat-icon>
                      {{ 'debug_copy_all' | i18n }}
                    </button>
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

      .advanced-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;

        .section-title {
          margin-bottom: 0;
        }

        .collapse-toggle {
          background: rgba(0, 0, 0, 0.06);
          border: none;
          color: rgba(0, 0, 0, 0.7);
          padding: 3px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          display: flex;
          gap: 4px;
          align-items: center;
          transition: background 0.2s;

          &:hover {
            background: rgba(0, 0, 0, 0.12);
          }
        }
      }

      .advanced-config-section .form-row {
        margin-top: 8px;
      }

      .custom-args-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }

      .custom-args-title {
        font-size: 13px;
        font-weight: 500;
        margin: 0 0 4px 0;
        color: rgba(0, 0, 0, 0.75);
      }

      .custom-args-hint {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.55);
        margin: 0 0 12px 0;
      }

      .custom-args-empty {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.45);
        font-style: italic;
        margin: 8px 0 12px 0;
      }

      .custom-arg-row {
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }

      .custom-arg-row .arg-key {
        flex: 0 0 200px;
      }

      .custom-arg-row .arg-value {
        flex: 1;
      }

      .custom-arg-row .arg-remove-btn {
        margin-top: 6px;
      }

      .reserved-key-warning {
        margin: -4px 0 8px 0;
        font-size: 12px;
        color: #b26100;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .reserved-warn-icon {
        color: #b26100;
      }

      .add-arg-btn {
        margin-top: 4px;
      }

      .custom-args-restart-hint {
        margin-top: 12px;
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

      .auth-sub-fields {
        margin: 8px 0 0 32px;
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

      /* Remote-mode wallet list (the switcher's list in settings) */
      .remote-wallet-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
      }

      .remote-wallet-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.03);

        &.active {
          background: rgba(25, 118, 210, 0.08);
        }

        .remote-wallet-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: rgba(0, 0, 0, 0.4);

          &.active {
            color: #1976d2;
          }
        }

        .remote-wallet-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .remote-wallet-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          border: 1px solid currentColor;
          border-radius: 8px;
          padding: 0 6px;
          flex-shrink: 0;

          /* v30 legacy wallets: amber hue (the kind-badge legacy family). */
          &.legacy {
            color: #b26a00;
          }
        }

        .remote-wallet-check {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #1976d2;
          flex-shrink: 0;
        }
      }

      .rescan-legacy-button {
        mat-spinner {
          display: inline-block;
          margin-right: 8px;
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

      .wif-rescan-section {
        margin-top: -8px;
      }

      .wif-rescan-label {
        font-weight: 500;
        margin-bottom: 8px;
      }

      .wif-rescan-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .wif-rescan-date-field {
        margin-top: 12px;
        width: 240px;
      }

      .wif-rescan-warning {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #f57c00;
        font-size: 13px;
        margin-top: 12px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
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

      /* Managed Node Styles */
      .node-status-card {
        background: #f5f5f5;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .status-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);

        &:last-child {
          border-bottom: none;
        }
      }

      .status-label {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.6);
      }

      .status-value {
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &.running {
          color: #4caf50;
        }

        &.stopped {
          color: #f44336;
        }
      }

      .node-controls {
        display: flex;
        gap: 12px;
        margin-top: 8px;

        button {
          min-width: 120px;

          mat-spinner {
            display: inline-block;
            margin-right: 8px;
          }
        }
      }

      .node-not-installed {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 32px 16px;
        text-align: center;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: rgba(0, 0, 0, 0.38);
          margin-bottom: 16px;
        }

        p {
          margin: 0 0 16px 0;
          color: rgba(0, 0, 0, 0.6);
        }
      }

      .update-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .update-info {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .update-badge {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        padding: 2px 8px;
        border-radius: 4px;
        background: #ff9800;
        color: white;
      }

      .update-actions {
        display: flex;
        gap: 8px;
      }

      .hint-text {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 8px 0 0;
        font-size: 12px;
        opacity: 0.7;
      }

      .hint-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      /* Debug & Logs Styles */
      .debug-container {
        max-width: 600px;
        margin: 0 auto;
      }

      .debug-info-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;

        mat-icon {
          color: rgba(0, 0, 0, 0.54);
          font-size: 20px;
          width: 20px;
          height: 20px;
        }

        .section-title {
          margin: 0;
        }
      }

      .debug-description {
        margin: 0 0 12px 0;
        font-size: 13px;
        color: rgba(0, 0, 0, 0.6);
      }

      .debug-path {
        font-family: monospace;
        font-size: 13px;
        background: #f5f5f5;
        padding: 8px 12px;
        border-radius: 4px;
        word-break: break-all;
        margin-bottom: 12px;
        color: rgba(0, 0, 0, 0.87);
      }

      .debug-file-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        gap: 12px;

        &:last-child {
          border-bottom: none;
        }
      }

      .debug-file-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .debug-file-label {
        font-size: 14px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.87);
      }

      .debug-file-name {
        font-family: monospace;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.54);
      }

      .debug-actions-row {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }

      .debug-system-info {
        background: #f5f5f5;
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 12px;
      }

      .debug-info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);

        &:last-child {
          border-bottom: none;
        }
      }

      .debug-info-label {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.6);
      }

      .debug-info-value {
        font-size: 13px;
        font-weight: 500;
        font-family: monospace;
        color: rgba(0, 0, 0, 0.87);
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
  private readonly platform = inject(PlatformService);
  private readonly electron = inject(ElectronService);
  private readonly cookieAuth = inject(CookieAuthService);
  protected readonly miningService = inject(MiningService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly walletManager = inject(WalletManagerService);
  readonly nodeService = inject(NodeService);
  protected readonly aggregatorService = inject(AggregatorService);
  private readonly appMode = inject(AppModeService);
  protected readonly btcxWallet = inject(BtcxWalletService);
  private readonly destroy$ = new Subject<void>();

  /** True while a remote-mode legacy (v30) re-probe is in flight. */
  readonly rescanningLegacy = signal(false);
  /** Name of the wallet whose v30→v31 upgrade is in flight, or null. */
  readonly upgradingV31 = signal<string | null>(null);

  // Managed node state
  nodeMode = signal<NodeMode>('managed');
  isStartingNode = signal(false);
  isStoppingNode = signal(false);

  // Remote (Electrum) mode state — the network + ordered endpoint list the
  // remote block edits; persisted via NodeService.saveRemoteConfig.
  readonly remoteNetwork = signal<'mainnet' | 'testnet' | 'regtest'>('mainnet');
  readonly remoteServers = signal<string[]>([]);

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
  wifRescanKind = signal<'now' | 'date' | 'genesis'>('now');
  wifRescanDateInput = '';

  // Independent temp configs for each mode (switching radio doesn't lose settings)
  managedTempConfig: NodeConfig = { ...defaultNodeConfig };
  externalTempConfig: NodeConfig = { ...defaultNodeConfig };

  /** Aggregator listen port (managed mode advanced) — bound to a number-input. */
  aggregatorListenPort: number | null = null;

  /** Whether the managed-mode Advanced section is expanded. */
  readonly managedAdvancedOpen = signal(false);

  /** Editable rows for managed-mode custom bitcoind args. Serialized to/from
   * the rust-side `customArgs` whitespace-separated string on save/load. */
  readonly customArgRows = signal<CustomArgRow[]>([]);

  /** Returns the temp config for the currently selected mode */
  get activeConfig(): NodeConfig {
    return this.nodeMode() === 'managed' ? this.managedTempConfig : this.externalTempConfig;
  }

  addCustomArgRow(): void {
    this.customArgRows.update(rows => [...rows, { key: '', value: '' }]);
  }

  removeCustomArgRow(index: number): void {
    this.customArgRows.update(rows => rows.filter((_, i) => i !== index));
  }

  updateCustomArgKey(index: number, key: string): void {
    this.customArgRows.update(rows => rows.map((r, i) => (i === index ? { ...r, key } : r)));
  }

  updateCustomArgValue(index: number, value: string): void {
    this.customArgRows.update(rows => rows.map((r, i) => (i === index ? { ...r, value } : r)));
  }

  isReservedArgKey(key: string): boolean {
    const normalized = normalizeArgKey(key);
    return normalized.length > 0 && RESERVED_NODE_ARG_KEYS.has(normalized);
  }

  reservedKeyWarning(key: string): string {
    return this.i18n.get('node_custom_args_reserved', { key: normalizeArgKey(key) });
  }

  /** Disable the Node/Wallet RPC port edit while node/miner/aggregator is running. */
  isManagedNodeBusy(): boolean {
    return (
      this.nodeService.isRunning() ||
      this.isStoppingNode() ||
      this.miningService.minerRunning() ||
      this.aggregatorService.isRunning()
    );
  }

  /**
   * Disable the Aggregator Listen Port edit while the miner or aggregator is
   * running. Unlike the RPC port, a running node does not block this edit — the
   * node does not depend on the aggregator's listen port.
   */
  isAggregatorPortBusy(): boolean {
    return this.miningService.minerRunning() || this.aggregatorService.isRunning();
  }

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
    clockDriftWarning: true,
  };

  // Debug & Logs state
  debugPaths = signal<DebugPaths | null>(null);
  debugAppVersion = signal('');
  debugPlatform = signal('');

  // UI state
  isTesting = signal(false);
  isSaving = signal(false);
  testResult = signal<ConnectionTestResult | null>(null);

  constructor() {
    // Keep the remote wallet list fresh whenever remote mode is active. The
    // page can switch INTO remote mode after ngOnInit's one-shot refresh (or
    // load while still in managed mode, where the list comes back empty), so
    // ride the nodeMode signal to re-list once remote is showing.
    effect(() => {
      if (this.nodeMode() === 'remote') {
        void this.btcxWallet.refreshWallets();
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Initialize managed node service
    await this.nodeService.initialize();
    this.nodeMode.set(this.nodeService.mode());

    // Seed the remote block from the persisted btcx wallet config (network
    // follows node config when already in remote mode).
    void this.btcxWallet.refreshConfig().then(() => {
      const network =
        this.nodeService.mode() === 'remote'
          ? this.nodeService.network()
          : (this.btcxWallet.config()?.network ?? 'mainnet');
      this.remoteNetwork.set(network);
      this.remoteServers.set(this.btcxWallet.serversFor(network));
    });

    // Populate managed temp config: always localhost, cookie auth, persisted/default port
    const rustConfig = this.nodeService.config();
    const managedNetwork = rustConfig.network || 'testnet';
    const defaultDataDir = getDefaultDataDirectory('bitcoin-pocx', this.platform.platform);
    this.managedTempConfig = {
      ...defaultNodeConfig,
      network: managedNetwork,
      rpcPort: rustConfig.rpcPort || getDefaultRpcPort(managedNetwork),
      dataDirectory: defaultDataDir,
    };

    // Seed aggregator listen port from persisted config (parsed off "host:port"),
    // falling back to rpcPort + 7 — same auto-derive rule the mining wizard uses.
    const aggCfg = this.aggregatorService.config();
    const parsedAggPort = parseListenAddressPort(aggCfg.listenAddress);
    this.aggregatorListenPort = parsedAggPort ?? this.managedTempConfig.rpcPort + 7;

    this.customArgRows.set(parseCustomArgsString(rustConfig.customArgs ?? ''));

    // Load external config from NgRx store (persisted external settings)
    this.store
      .select(selectNodeConfig)
      .pipe(takeUntil(this.destroy$))
      .subscribe(config => {
        this.externalTempConfig = { ...config };
        // Set default data directory if empty
        if (!this.externalTempConfig.dataDirectory) {
          this.externalTempConfig.dataDirectory = getDefaultDataDirectory(
            this.externalTempConfig.coinType,
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
    this.wifRescanKind.set('now');
    this.wifRescanDateInput = '';
  }

  goBack(): void {
    // Navigate back (could be to dashboard or wallet select)
    window.history.back();
  }

  // ============================================================
  // Node Configuration
  // ============================================================

  onNetworkChange(): void {
    // Update port based on network
    this.activeConfig.rpcPort = getDefaultRpcPort(this.activeConfig.network);

    // Clear test result
    this.testResult.set(null);
  }

  async onManagedNetworkChange(): Promise<void> {
    const network = this.activeConfig.network;

    // Update port and persist config (node must already be stopped via guard)
    this.activeConfig.rpcPort = getDefaultRpcPort(network);
    const rustConfig = this.nodeService.config();
    await this.nodeService.saveConfig({
      ...rustConfig,
      network,
      rpcPort: this.activeConfig.rpcPort,
    });
    this.store.dispatch(SettingsActions.setNodeConfig({ config: { ...this.activeConfig } }));

    this.notification.success(this.i18n.get('node_network_switched') + network);
  }

  async browseDataDirectory(): Promise<void> {
    if (!this.platform.isDesktop) {
      this.notification.info(this.i18n.get('folder_browser_desktop_only'));
      return;
    }

    const selectedPath = await this.electron.showFolderDialog({
      title: this.i18n.get('select_data_directory'),
      defaultPath: this.activeConfig.dataDirectory,
    });

    if (selectedPath) {
      this.activeConfig.dataDirectory = selectedPath;
      this.testResult.set(null);
    }
  }

  async testConnection(): Promise<void> {
    this.isTesting.set(true);
    this.testResult.set(null);

    try {
      // Get credentials based on auth method from form values
      let credentials: { username: string; password: string } | null = null;

      if (this.activeConfig.authMethod === 'cookie') {
        // Read cookie with form's dataDirectory and network (not from store)
        credentials = await this.cookieAuth.readCookieWithConfig(
          this.activeConfig.dataDirectory,
          this.activeConfig.network
        );
      } else {
        // Use credentials from form
        credentials = {
          username: this.activeConfig.username,
          password: this.activeConfig.password,
        };
      }

      // Test connection with form values
      const result = await this.rpcClient.testWithConfig({
        host: this.activeConfig.rpcHost,
        port: this.activeConfig.rpcPort,
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

  async saveAndApply(): Promise<void> {
    this.isSaving.set(true);

    try {
      const mode = this.nodeMode();

      // If switching away from managed while its node is running, confirm first
      const previousMode = this.nodeService.mode();
      if (previousMode === 'managed' && mode !== 'managed' && this.nodeService.isRunning()) {
        const action = await this.promptManagedNodeAction();
        if (action === null) {
          this.isSaving.set(false);
          return;
        }
        if (action === 'stop') {
          await this.stopManagedNode();
        }
        // 'keep' — leave the node running, just switch mode
      }

      if (mode === 'remote') {
        // Remote: one save path for BOTH configs (node mode/network +
        // Electrum endpoints), no cookie/RPC plumbing, then back to the
        // wallet selector, which lists the LOCAL wallet store.
        const network = this.remoteNetwork();
        const saved = await this.nodeService.saveRemoteConfig(network, this.remoteServers());
        if (!saved) {
          this.notification.error(this.nodeService.error() ?? 'Failed to save configuration');
          return;
        }
        this.store.dispatch(SettingsActions.setNetwork({ network }));
        this.notification.success(this.i18n.get('settings_saved'));
        this.store.dispatch(WalletActions.resetState());
        this.walletManager.setActiveWallet(null);
        this.router.navigate(['/auth']);
        return;
      }

      const config = this.activeConfig;

      // 1. Persist mode to Rust
      await this.nodeService.setMode(mode);

      // 2. Persist NgRx store config
      this.store.dispatch(SettingsActions.setNodeConfig({ config: { ...config } }));

      // 3. Sync to Rust-side NodeConfig (used by miner/aggregator)
      const rustConfig = this.nodeService.config();
      // Reserved keys are dropped at serialize time too — keep wallet-managed
      // values authoritative even if the user leaves a row visible.
      const filteredArgRows = this.customArgRows().filter(r => !this.isReservedArgKey(r.key));
      await this.nodeService.saveConfig({
        ...rustConfig,
        mode,
        network: config.network,
        rpcHost: config.rpcHost,
        rpcPort: config.rpcPort,
        dataDirectory: config.dataDirectory,
        authMethod: config.authMethod === 'credentials' ? 'userpass' : 'cookie',
        rpcUser: config.username,
        rpcPassword: config.password,
        customArgs: serializeCustomArgRows(filteredArgRows),
      });

      // 4. Apply credentials
      if (config.authMethod === 'cookie') {
        await this.cookieAuth.refreshCredentials();
      } else {
        this.cookieAuth.setManualCredentials(config.username, config.password);
      }

      // 4b. Sync aggregator config in managed mode: keep upstream pointed at the
      // local node's RPC port and persist any custom listen-port the user set.
      if (mode === 'managed') {
        await this.syncAggregatorPorts(config.rpcPort);
        // 4c. Re-point the solo chain at the (possibly changed) aggregator listen
        // port or node RPC port, so the miner connects to the right one.
        await this.syncSoloChainPort();
      }

      // 5. Handle managed node lifecycle
      if (mode === 'managed') {
        if (!this.nodeService.isRunning() && this.nodeService.isInstalled()) {
          await this.startManagedNode();
        }
      }

      // 6. Restart miner/aggregator if running with solo chains
      await this.restartMiningServicesIfNeeded();

      // 7. Notify and redirect to wallet selection
      this.notification.success(this.i18n.get('settings_saved'));
      this.store.dispatch(WalletActions.resetState());
      this.walletManager.setActiveWallet(null);
      this.router.navigate(['/auth']);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save configuration';
      this.notification.error(message);
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

    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe(async confirmed => {
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

    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe(confirmed => {
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

  canImportWif(): boolean {
    if (this.wifRescanKind() === 'date' && !this.wifRescanDateInput) return false;
    return true;
  }

  private buildWifRescan(): WatchOnlyRescan | null {
    const kind = this.wifRescanKind();
    if (kind === 'now') return { kind: 'now' };
    if (kind === 'genesis') return { kind: 'genesis' };
    const date = new Date(this.wifRescanDateInput);
    const timestamp = Math.floor(date.getTime() / 1000);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return { kind: 'date', timestamp };
  }

  async importWif(): Promise<void> {
    const preview = this.wifPreview();
    const walletName = this.walletManager.activeWallet;

    if (!preview || !walletName) return;

    const rescan = this.buildWifRescan();
    if (!rescan) return;
    const timestamp = rescanToTimestamp(rescan);

    this.isImportingWif.set(true);

    try {
      const label = this.wifLabel().trim() || undefined;

      // For 'now', use a short timeout (5s) — import is near-instant. For an actual rescan,
      // let it run with the default timeout; treat it as fire-and-forget on the UI side.
      const timeoutMs = rescan.kind === 'now' ? 5000 : undefined;
      const result = await this.walletRpc.importDescriptors(
        walletName,
        [
          {
            desc: preview.descriptor,
            timestamp,
            label,
          },
        ],
        timeoutMs
      );

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

  // ============================================================
  // Managed Node Controls
  // ============================================================

  /**
   * UI-only mode toggle — no backend calls, no store dispatches.
   * Just switches which temp config the form shows.
   * Mode is persisted only on Save & Apply.
   */
  onNodeModeToggle(mode: NodeMode): void {
    this.nodeMode.set(mode);
    this.testResult.set(null);
  }

  /** Remote block: switch the edited network (per-network server lists). */
  onRemoteNetworkChange(network: 'mainnet' | 'testnet' | 'regtest'): void {
    this.remoteNetwork.set(network);
    this.remoteServers.set(this.btcxWallet.serversFor(network));
  }

  /**
   * Remote-mode "check for older (v30) funds": re-probe the legacy branch for
   * the open BDK wallet and restore a counterpart if history turns up.
   */
  async rescanLegacy(): Promise<void> {
    if (this.rescanningLegacy()) return;
    this.rescanningLegacy.set(true);
    try {
      const result = await this.btcxWallet.rescanLegacy();
      this.notification.success(
        this.i18n.get(
          result.outcome === 'created-v30' ? 'wallet_rescan_found' : 'wallet_rescan_none'
        )
      );
    } catch (err) {
      console.error('Failed to rescan legacy funds:', err);
      this.notification.error(`${err}`);
    } finally {
      this.rescanningLegacy.set(false);
    }
  }

  /**
   * Upgrade a v30 (coin-0') wallet to v31: creates its `<name>-v31` sibling
   * over the same seed and switches to it. The old wallet is left untouched;
   * a passphrase-locked seed defers (unlock first).
   */
  async upgradeToV31(w: BtcxWalletSummary): Promise<void> {
    if (this.upgradingV31() !== null) return;
    this.upgradingV31.set(w.name);
    try {
      const result = await this.btcxWallet.upgradeV30(w.name);
      if (result.outcome === 'deferred') {
        this.notification.info(this.i18n.get('mwallet_upgrade_v31_deferred'));
      }
    } catch (err) {
      console.error('Failed to upgrade wallet:', err);
      this.notification.error(`${err}`);
    } finally {
      this.upgradingV31.set(null);
    }
  }

  async startManagedNode(): Promise<void> {
    this.isStartingNode.set(true);
    try {
      await this.nodeService.startNode();

      // Wait for RPC to be ready (max 30 seconds)
      const ready = await this.waitForNodeReady();

      if (ready) {
        // Refresh credentials after node is ready
        await this.cookieAuth.refreshCredentials();
        // Notify toolbar and other components to reload wallet list
        this.walletManager.notifyWalletsChanged();
        this.notification.success('Node started');
      } else {
        this.notification.info('Node started, but RPC not yet ready');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start node';
      this.notification.error(message);
    } finally {
      this.isStartingNode.set(false);
    }
  }

  async stopManagedNode(): Promise<void> {
    this.isStoppingNode.set(true);
    try {
      // Stop miner/aggregator first — they depend on the node
      if (this.miningService.minerRunning()) {
        await this.miningService.stopMiner();
      }
      if (this.aggregatorService.isRunning()) {
        await this.aggregatorService.stop();
      }

      await this.nodeService.stopNodeAndWait();
      this.notification.success('Node stopped');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop node';
      this.notification.error(message);
    } finally {
      this.isStoppingNode.set(false);
    }
  }

  async restartManagedNode(): Promise<void> {
    this.isStoppingNode.set(true);
    try {
      await this.nodeService.restartNode();

      // Wait for RPC to be ready (max 30 seconds)
      const ready = await this.waitForNodeReady();

      if (ready) {
        // Refresh credentials after node is ready
        await this.cookieAuth.refreshCredentials();
        // Notify toolbar and other components to reload wallet list
        this.walletManager.notifyWalletsChanged();
        this.notification.success('Node restarted');
      } else {
        this.notification.info('Node restarted, but RPC not yet ready');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart node';
      this.notification.error(message);
    } finally {
      this.isStoppingNode.set(false);
    }
  }

  async checkForNodeUpdate(): Promise<void> {
    try {
      const updateInfo = await this.nodeService.checkForUpdate();
      if (updateInfo?.available) {
        this.notification.info(`Update available: ${updateInfo.latestVersion}`);
      } else {
        this.notification.info('No updates available');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check for updates';
      this.notification.error(message);
    }
  }

  /**
   * Navigate to node setup to install update.
   * Requires miner, aggregator, and node to be stopped first.
   */
  updateNode(): void {
    const running: string[] = [];
    if (this.miningService.minerRunning()) running.push(this.i18n.get('miner'));
    if (this.aggregatorService.isRunning()) running.push(this.i18n.get('aggregator'));
    if (this.nodeService.isRunning()) running.push(this.i18n.get('node'));

    if (running.length > 0) {
      this.notification.warning(this.i18n.get('node_update_stop_services') + running.join(', '));
      return;
    }

    // Navigate to node setup page with update flag to skip mode selection
    this.router.navigate(['/node/setup'], { queryParams: { update: 'true' } });
  }

  navigateToNodeSetup(): void {
    this.router.navigate(['/node/setup']);
  }

  // ============================================================
  // Debug & Logs
  // ============================================================

  onTabChange(event: MatTabChangeEvent): void {
    // Tab index 3 is the Debug & Logs tab
    if (event.index === 3 && !this.debugPaths()) {
      this.loadDebugPaths();
    }
  }

  async loadDebugPaths(): Promise<void> {
    const paths = await this.electron.getDebugPaths();
    this.debugPaths.set(paths);

    const [version, platform] = await Promise.all([
      this.electron.isTauri
        ? import('@tauri-apps/api/core').then(m => m.invoke<string>('get_app_version'))
        : Promise.resolve('N/A'),
      this.electron.getPlatform(),
    ]);
    this.debugAppVersion.set(version);
    this.debugPlatform.set(platform);
  }

  async openConfigFile(path: string): Promise<void> {
    await this.electron.revealInExplorer(path);
  }

  async revealFolder(path: string): Promise<void> {
    await this.electron.openFolder(path);
  }

  async copySystemInfo(): Promise<void> {
    const lines = [
      `App Version: ${this.debugAppVersion()}`,
      `Platform: ${this.debugPlatform()}`,
      `Node Version: ${this.nodeService.currentVersion() || 'N/A'}`,
      `App Data Dir: ${this.debugPaths()?.appDataDir || 'N/A'}`,
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    this.notification.success(this.i18n.get('debug_copied'));
  }

  /**
   * Wait for the node RPC to be ready.
   * Returns true if ready, false if timeout.
   */
  private async waitForNodeReady(): Promise<boolean> {
    const maxAttempts = 60; // 30 seconds max (60 * 500ms)
    let attempts = 0;

    while (attempts < maxAttempts) {
      const isReady = await this.nodeService.isNodeReady();
      if (isReady) {
        console.log('Node RPC ready after', attempts * 0.5, 'seconds');
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    console.warn('Node RPC did not become ready within timeout');
    return false;
  }

  /**
   * Show confirmation dialog when switching from managed to external
   * while the managed node is running.
   * Returns 'stop' to stop node and switch, 'keep' to keep running and switch, or null to cancel.
   */
  private promptManagedNodeAction(): Promise<'stop' | 'keep' | null> {
    return new Promise(resolve => {
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '440px',
        data: {
          title: this.i18n.get('node_managed_running_title'),
          message: this.i18n.get('node_managed_running_message'),
          confirmText: this.i18n.get('node_stop'),
          secondaryText: this.i18n.get('keep_running'),
          cancelText: this.i18n.get('cancel'),
          type: 'warning',
        },
      });
      dialogRef.afterClosed().subscribe(result => {
        if (result === true) resolve('stop');
        else if (result === 'secondary') resolve('keep');
        else resolve(null);
      });
    });
  }

  /**
   * Reconcile aggregator config with the (possibly updated) node RPC port and
   * the user's chosen aggregator listen port. No-op if nothing changed.
   */
  private async syncAggregatorPorts(nodeRpcPort: number): Promise<void> {
    const current = this.aggregatorService.config();
    const desiredListenPort = this.aggregatorListenPort ?? nodeRpcPort + 7;
    const desiredListenAddress = withListenPort(current.listenAddress, desiredListenPort);

    if (current.upstreamRpcPort === nodeRpcPort && current.listenAddress === desiredListenAddress) {
      return;
    }

    const next: AggregatorConfig = {
      ...current,
      upstreamRpcPort: nodeRpcPort,
      listenAddress: desiredListenAddress,
    };
    await this.aggregatorService.saveConfig(next);
  }

  /**
   * Keep the solo chain's connection target in sync with the current node RPC
   * port and aggregator listen port.
   *
   * The miner reads the persisted chain config: when the aggregator is enabled
   * it must point at 127.0.0.1:<aggregator listen port>, otherwise directly at
   * the node's RPC host/port. Changing either port in settings only updated the
   * aggregator/node config, leaving the stored solo chain pointing at the old
   * port — so the miner kept connecting to the wrong one until the chain was
   * manually re-saved. Recompute it here (mirroring the setup wizard's saveChain)
   * before restarting mining services.
   */
  private async syncSoloChainPort(): Promise<void> {
    const soloChain = this.miningService.config()?.chains?.find(c => c.chainType === 'solo');
    if (!soloChain) return;

    const nodeConfig = this.nodeService.config();
    const nodeRpcHost = nodeConfig.rpcHost || '127.0.0.1';
    const nodeRpcPort = nodeConfig.rpcPort || (nodeConfig.network === 'mainnet' ? 8332 : 18332);
    const aggregatorEnabled = this.aggregatorService.config().enabled;

    let rpcHost: string;
    let rpcPort: number;
    let rpcAuth: ChainConfig['rpcAuth'];

    if (aggregatorEnabled) {
      // Miner connects to the local aggregator (no auth) on its listen port.
      rpcHost = '127.0.0.1';
      rpcPort =
        parseListenAddressPort(this.aggregatorService.config().listenAddress) ?? nodeRpcPort + 7;
      rpcAuth = { type: 'none' };
    } else {
      // Direct solo: miner connects straight to the node with its auth.
      rpcHost = nodeRpcHost;
      rpcPort = nodeRpcPort;
      rpcAuth =
        nodeConfig.authMethod === 'userpass' && nodeConfig.rpcUser
          ? { type: 'user_pass', username: nodeConfig.rpcUser, password: nodeConfig.rpcPassword }
          : { type: 'cookie' };
    }

    if (
      soloChain.rpcHost === rpcHost &&
      soloChain.rpcPort === rpcPort &&
      soloChain.rpcAuth.type === rpcAuth.type
    ) {
      return; // Already correct — avoid a redundant config write/refresh.
    }

    await this.miningService.updateChain({ ...soloChain, rpcHost, rpcPort, rpcAuth });
  }

  /**
   * Restart miner and aggregator if they're running with solo chains.
   * Solo chains connect directly to the local node, so they need
   * to be restarted when node config changes.
   */
  private async restartMiningServicesIfNeeded(): Promise<void> {
    const minerWasRunning = this.miningService.minerRunning();
    const aggregatorWasRunning = this.aggregatorService.isRunning();

    if (!minerWasRunning && !aggregatorWasRunning) return;

    // Check if any solo chains are configured
    const config = this.miningService.config();
    const hasSoloChains = config?.chains?.some(c => c.chainType === 'solo') ?? false;
    if (!hasSoloChains) return;

    // Stop miner first, then aggregator
    if (minerWasRunning) {
      await this.miningService.stopMiner();
    }
    if (aggregatorWasRunning) {
      await this.aggregatorService.stop();
    }

    // Small delay for clean shutdown
    await new Promise(r => setTimeout(r, 500));

    // Restart in reverse order: aggregator first, then miner
    if (aggregatorWasRunning) {
      await this.aggregatorService.start();
    }
    if (minerWasRunning) {
      await this.miningService.startMiner();
    }
  }

  /**
   * Reset external mode settings to defaults.
   */
  resetExternalToDefaults(): void {
    this.externalTempConfig = {
      ...defaultNodeConfig,
      coinType: this.externalTempConfig.coinType,
      dataDirectory: getDefaultDataDirectory(
        this.externalTempConfig.coinType,
        this.platform.platform
      ),
    };
    this.testResult.set(null);
  }
}
