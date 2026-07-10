import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import { BtcxWalletService, BtcxNetwork } from '../../../../core/services/btcx-wallet.service';
import { ElectrumServersEditorComponent } from '../../../../shared/components/electrum-servers-editor/electrum-servers-editor.component';

/**
 * WalletSettingsComponent - mobile wallet settings.
 *
 * Network selection, Electrum server list editor (per active network),
 * and lock control (only shown for passphrase-encrypted seeds).
 */
@Component({
  selector: 'app-wallet-settings',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    I18nPipe,
    ElectrumServersEditorComponent,
  ],
  template: `
    <div class="page">
      <div class="header-row">
        <button mat-icon-button routerLink="/wallet">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h2>{{ 'mwallet_settings_title' | i18n }}</h2>
      </div>

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

      .header-row {
        display: flex;
        align-items: center;
        gap: 8px;

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 500;
        }
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

      .full-width {
        width: 100%;
      }

      .server-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 4px 0 4px 12px;
        background: #f5f7fa;
        border-radius: 6px;
        margin-bottom: 8px;

        .server-url {
          font-family: monospace;
          font-size: 12px;
          word-break: break-all;
          flex: 1;
        }
      }

      .add-row {
        display: flex;
        align-items: center;
        gap: 8px;

        .server-field {
          flex: 1;
        }

        .add-button {
          height: 40px;
          flex-shrink: 0;
        }
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .server-row {
          background: #333;
        }
      }
    `,
  ],
})
export class WalletSettingsComponent implements OnInit {
  readonly wallet = inject(BtcxWalletService);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  readonly networks: BtcxNetwork[] = ['mainnet', 'testnet', 'regtest'];
  readonly busy = signal(false);

  ngOnInit(): void {
    void this.wallet.initialize();
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
}
