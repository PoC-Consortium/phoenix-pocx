import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../core/i18n';
import {
  BtcxWalletService,
  BtcxNetwork,
} from '../../../core/services/btcx-wallet.service';

/**
 * ElectrumServersEditorComponent — the ordered Electrum endpoint list
 * editor shared by the setup wizard, the desktop settings page's remote
 * block, and the mobile wallet settings.
 *
 * Dumb component: the parent owns the list (`servers` in, `serversChange`
 * out) and persists it. Order matters — the FIRST entry is the wallet's
 * primary (home) server, the rest are failovers — so rows can be moved up
 * and down. The optional per-server "Test" button probes with a fresh
 * connection via `btcx_electrum_probe` (needs `network` to pick the chain
 * to genesis-check against).
 */
@Component({
  selector: 'app-electrum-servers-editor',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    I18nPipe,
  ],
  template: `
    <div class="servers-editor">
      @if (servers.length > 0) {
        <p class="primary-hint">{{ 'electrum_primary_server_hint' | i18n }}</p>
      }

      @for (server of servers; track $index) {
        <div class="server-row" [class.primary]="$index === 0">
          @if ($index === 0) {
            <mat-icon
              class="primary-icon"
              [matTooltip]="'electrum_primary_server' | i18n"
              >star</mat-icon
            >
          } @else {
            <span class="order-index">{{ $index + 1 }}</span>
          }
          <span class="server-url">{{ server }}</span>

          @if (testResults()[server]; as result) {
            <span
              class="test-result"
              [class.ok]="result.ok"
              [class.fail]="!result.ok"
              [matTooltip]="result.detail"
            >
              {{ result.label }}
            </span>
          }

          <span class="row-actions">
            @if (showTest) {
              <button
                mat-icon-button
                [disabled]="disabled || testing() === server"
                (click)="testServer(server)"
                [matTooltip]="'electrum_test_connection' | i18n"
              >
                <mat-icon [class.spin]="testing() === server">network_check</mat-icon>
              </button>
            }
            <button
              mat-icon-button
              [disabled]="disabled || $index === 0"
              (click)="move($index, -1)"
              [matTooltip]="'move_up' | i18n"
            >
              <mat-icon>arrow_upward</mat-icon>
            </button>
            <button
              mat-icon-button
              [disabled]="disabled || $index === servers.length - 1"
              (click)="move($index, 1)"
              [matTooltip]="'move_down' | i18n"
            >
              <mat-icon>arrow_downward</mat-icon>
            </button>
            <button
              mat-icon-button
              [disabled]="disabled"
              (click)="remove($index)"
              [matTooltip]="'electrum_remove_server' | i18n"
            >
              <mat-icon>delete_outline</mat-icon>
            </button>
          </span>
        </div>
      } @empty {
        <p class="empty-hint">{{ 'electrum_no_servers_hint' | i18n }}</p>
      }

      <div class="add-row">
        <mat-form-field appearance="outline" class="server-field" subscriptSizing="dynamic">
          <mat-label>{{ 'electrum_server_url' | i18n }}</mat-label>
          <input
            matInput
            [(ngModel)]="newServer"
            placeholder="ssl://host:port"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            [disabled]="disabled"
            (keyup.enter)="add()"
          />
        </mat-form-field>
        <button
          mat-stroked-button
          class="add-button"
          [disabled]="!newServerValid() || disabled"
          (click)="add()"
        >
          <mat-icon>add</mat-icon>
          {{ 'add' | i18n }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .servers-editor {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .primary-hint,
      .empty-hint {
        margin: 0;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.5);
      }

      .server-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 4px 2px 10px;
        background: rgba(0, 0, 0, 0.04);
        border-radius: 6px;

        &.primary {
          background: rgba(33, 150, 243, 0.08);
        }

        .primary-icon {
          color: #1976d2;
          font-size: 16px;
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        .order-index {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.4);
          width: 16px;
          text-align: center;
          flex-shrink: 0;
        }

        .server-url {
          font-family: monospace;
          font-size: 12px;
          word-break: break-all;
          flex: 1;
        }

        .test-result {
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;

          &.ok {
            background: rgba(76, 175, 80, 0.15);
            color: #2e7d32;
          }

          &.fail {
            background: rgba(244, 67, 54, 0.12);
            color: #c62828;
          }
        }

        .row-actions {
          display: flex;
          align-items: center;
          flex-shrink: 0;

          button {
            width: 32px;
            height: 32px;
            padding: 4px;

            mat-icon {
              font-size: 18px;
              width: 18px;
              height: 18px;
            }
          }
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

      .spin {
        animation: electrum-editor-spin 1s linear infinite;
      }

      @keyframes electrum-editor-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      :host-context(.dark-theme) {
        .primary-hint,
        .empty-hint {
          color: rgba(255, 255, 255, 0.5);
        }

        .server-row {
          background: rgba(255, 255, 255, 0.06);

          &.primary {
            background: rgba(33, 150, 243, 0.16);
          }

          .order-index {
            color: rgba(255, 255, 255, 0.4);
          }
        }
      }
    `,
  ],
})
export class ElectrumServersEditorComponent {
  private readonly btcxWallet = inject(BtcxWalletService);

  /** The ordered server list (first = primary/home). */
  @Input({ required: true }) servers: string[] = [];
  /** Disable all interactions (parent is busy). */
  @Input() disabled = false;
  /** Network the Test button genesis-checks against. */
  @Input() network: BtcxNetwork = 'mainnet';
  /** Show the per-server Test button. */
  @Input() showTest = false;

  @Output() serversChange = new EventEmitter<string[]>();

  newServer = '';
  readonly testing = signal<string | null>(null);
  readonly testResults = signal<Record<string, { ok: boolean; label: string; detail: string }>>(
    {}
  );

  newServerValid(): boolean {
    const url = this.newServer.trim();
    return /^(tcp|ssl):\/\/[^\s/]+:\d+$/.test(url) && !this.servers.includes(url);
  }

  add(): void {
    if (!this.newServerValid()) return;
    this.serversChange.emit([...this.servers, this.newServer.trim()]);
    this.newServer = '';
  }

  remove(index: number): void {
    this.serversChange.emit(this.servers.filter((_, i) => i !== index));
  }

  move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.servers.length) return;
    const next = [...this.servers];
    [next[index], next[target]] = [next[target], next[index]];
    this.serversChange.emit(next);
  }

  async testServer(server: string): Promise<void> {
    this.testing.set(server);
    try {
      const result = await this.btcxWallet.electrumProbe(server, this.network);
      this.testResults.update(r => ({
        ...r,
        [server]: {
          ok: true,
          label: `#${result.height} · ${Math.round(result.latencyMs)}ms`,
          detail: '',
        },
      }));
    } catch (err) {
      this.testResults.update(r => ({
        ...r,
        [server]: { ok: false, label: '✕', detail: `${err}` },
      }));
    } finally {
      this.testing.set(null);
    }
  }
}
