import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import { BtcxWalletService, BtcxNetwork } from '../../../../core/services/btcx-wallet.service';
import { ElectrumServersEditorComponent } from '../../../../shared/components/electrum-servers-editor/electrum-servers-editor.component';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';
import { ElectronService } from '../../../../core/services/electron.service';

/**
 * WalletSettingsComponent - mobile wallet settings.
 *
 * Deliberately SLIM: wallet management lives in the toolbar (wallet chip =
 * groups + create/restore/import, pocket chip = the active wallet's
 * compartments). This page keeps the environment: network selection,
 * Electrum server list (per active network), lock control (passphrase-
 * encrypted seeds only), the manual legacy (v30) fund check, and About.
 */
@Component({
  selector: 'app-wallet-settings',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    I18nPipe,
    ElectrumServersEditorComponent,
    PageHeaderComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="mwallet_settings_title" />

    <div class="page">
      <!-- Network -->
      <div class="card">
        <h3>{{ 'network' | i18n }}</h3>
        <p class="hint-text">{{ 'mwallet_network_hint' | i18n }}</p>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>{{ 'network' | i18n }}</mat-label>
          <mat-select
            [ngModel]="wallet.network()"
            (ngModelChange)="setNetwork($event)"
            [disabled]="busy()"
          >
            @for (net of networks; track net) {
              <mat-option [value]="net">{{ net | i18n }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <!-- Electrum servers -->
      <div class="card">
        <h3>{{ 'mwallet_electrum_servers' | i18n }}</h3>
        <p class="hint-text">{{ 'mwallet_electrum_hint' | i18n }}</p>

        <app-electrum-servers-editor
          [servers]="wallet.electrumServers()"
          [network]="wallet.network()"
          [disabled]="busy()"
          [showTest]="true"
          (serversChange)="saveServers($event)"
        />
      </div>

      <!-- Lock (passphrase-encrypted seeds only) -->
      @if (wallet.seedEncrypted() && wallet.seedState() === 'unlocked') {
        <div class="card">
          <h3>{{ 'mwallet_lock_wallet' | i18n }}</h3>
          <button mat-stroked-button class="full-width" [disabled]="busy()" (click)="lock()">
            <mat-icon>lock</mat-icon>
            {{ 'mwallet_lock_wallet' | i18n }}
          </button>
        </div>
      }

      <!-- Older (v30) funds — re-probe the legacy branches for the open
           wallet; a hit materializes a spend-only v30 pocket. -->
      @if (wallet.walletActive()) {
        <div class="card">
          <h3>{{ 'wallet_rescan_legacy' | i18n }}</h3>
          <p class="hint-text">{{ 'wallet_rescan_legacy_description' | i18n }}</p>
          <button
            mat-stroked-button
            class="full-width"
            [disabled]="busy() || rescanning()"
            (click)="rescanLegacy()"
          >
            @if (rescanning()) {
              <mat-spinner diameter="18"></mat-spinner>
            } @else {
              <mat-icon>manage_search</mat-icon>
            }
            {{ 'scan' | i18n }}
          </button>
        </div>
      }

      <!-- About (app version) -->
      <div class="card about-card">
        <h3>{{ 'mwallet_about_title' | i18n }}</h3>
        <div class="about-row">
          <span class="about-app">Phoenix</span>
          <span class="about-version">{{ appVersion() ?? '…' }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .page {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 480px;
        width: 100%;
        margin: 0 auto;
        box-sizing: border-box;
      }

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;

        h3 {
          margin: 0 0 8px;
          font-size: 15px;
          font-weight: 500;
        }
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 16px;
      }

      .about-card h3 {
        margin-bottom: 0;
      }

      .about-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-top: 8px;
      }

      .about-app {
        font-size: 14px;
        color: rgba(0, 0, 0, 0.75);
      }

      .about-version {
        font-size: 14px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: rgba(0, 0, 0, 0.6);
      }

      .full-width {
        width: 100%;
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .about-app {
          color: rgba(255, 255, 255, 0.75);
        }

        .about-version {
          color: rgba(255, 255, 255, 0.6);
        }
      }
    `,
  ],
})
export class WalletSettingsComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly electron = inject(ElectronService);

  readonly networks: BtcxNetwork[] = ['mainnet', 'testnet', 'regtest'];
  readonly busy = signal(false);

  /** True while a legacy (v30) re-probe is in flight. */
  readonly rescanning = signal(false);

  /** App version (e.g. "2.1.1") from the Tauri shell; null until loaded. */
  readonly appVersion = signal<string | null>(null);

  ngOnInit(): void {
    void this.wallet.initialize();
    void this.loadAppVersion();
  }

  /** Read the app version from the Tauri shell (`get_app_version`). */
  private async loadAppVersion(): Promise<void> {
    if (!this.electron.isTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      this.appVersion.set(await invoke<string>('get_app_version'));
    } catch (err) {
      console.error('Failed to read app version:', err);
    }
  }

  async setNetwork(network: BtcxNetwork): Promise<void> {
    if (network === this.wallet.network() || this.busy()) return;
    this.busy.set(true);
    try {
      await this.wallet.setConfig({ network });
    } catch (err) {
      console.error('Failed to set network:', err);
      this.notification.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }

  async saveServers(electrumServers: string[]): Promise<void> {
    this.busy.set(true);
    try {
      await this.wallet.setConfig({ electrumServers });
    } catch (err) {
      console.error('Failed to update Electrum servers:', err);
      this.notification.error(`${err}`);
    } finally {
      this.busy.set(false);
    }
  }

  async lock(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.wallet.lock();
      this.notification.success(this.i18n.get('mwallet_locked_title'));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Re-probe the legacy (v30) branches for the open wallet and materialize
   * a spend-only pocket if older funds turn up — the manual "check for
   * older funds" lever.
   */
  async rescanLegacy(): Promise<void> {
    if (this.busy() || this.rescanning()) return;
    this.rescanning.set(true);
    try {
      const result = await this.wallet.rescanLegacy();
      this.notification.success(
        this.i18n.get(
          result.outcome === 'created-v30' ? 'wallet_rescan_found' : 'wallet_rescan_none'
        )
      );
    } catch (err) {
      console.error('Failed to rescan legacy funds:', err);
      this.notification.error(`${err}`);
    } finally {
      this.rescanning.set(false);
    }
  }
}
