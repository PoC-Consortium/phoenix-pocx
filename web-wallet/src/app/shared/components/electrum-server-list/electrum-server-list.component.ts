import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../core/i18n';
import { BtcxServerHealth } from '../../../core/services/btcx-wallet.service';

/**
 * ElectrumServerListComponent — the per-server rows of the Electrum status
 * popover: health dot, server URL, primary-server star (`role === 'wallet'`),
 * smoothed latency, and the last error while a server is down.
 *
 * Extracted (feedback round 6) from the desktop toolbar's inline popover so
 * the mobile wallet header shows the exact same rows; both toolbars wrap it
 * in their own mat-menu with their own title/summary rows.
 */
@Component({
  selector: 'app-electrum-server-list',
  standalone: true,
  imports: [DecimalPipe, MatIconModule, MatTooltipModule, I18nPipe],
  template: `
    @for (server of servers(); track server.url) {
      <div class="electrum-server-row">
        <span
          class="dot"
          [class.ok]="server.state === 'healthy'"
          [class.down]="server.state === 'down'"
          [class.untested]="server.state === 'untested'"
        ></span>
        <span class="url">{{ server.url }}</span>
        <span class="meta">
          @if (server.role === 'wallet') {
            <mat-icon class="home-icon" [matTooltip]="'electrum_primary_server' | i18n"
              >star</mat-icon
            >
          }
          @if (server.latency_ms !== undefined) {
            {{ server.latency_ms | number: '1.0-0' }}ms
          }
        </span>
      </div>
      @if (server.last_error && server.state === 'down') {
        <div class="electrum-server-error">{{ server.last_error }}</div>
      }
    } @empty {
      <div class="electrum-server-row">
        <span class="url">{{ 'electrum_no_servers_hint' | i18n }}</span>
      </div>
    }
  `,
  styles: [
    `
      .electrum-server-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          background: rgba(0, 0, 0, 0.25);

          &.ok {
            background: #4caf50;
          }

          &.down {
            background: #e53935;
          }

          &.untested {
            background: rgba(0, 0, 0, 0.25);
          }
        }

        .url {
          font-family: monospace;
          font-size: 12px;
          word-break: break-all;
          flex: 1;
        }

        .meta {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: rgba(0, 0, 0, 0.5);
          white-space: nowrap;

          .home-icon {
            font-size: 14px;
            width: 14px;
            height: 14px;
            color: #1976d2;
          }
        }
      }

      .electrum-server-error {
        font-size: 11px;
        color: #c62828;
        margin: 0 0 4px 16px;
        word-break: break-word;
      }

      /* body.dark-theme is an ancestor of the CDK overlay hosting the
         popovers, so :host-context reaches it here. */
      :host-context(.dark-theme) {
        .electrum-server-row {
          .dot,
          .dot.untested {
            background: rgba(255, 255, 255, 0.3);
          }

          .dot.ok {
            background: #4caf50;
          }

          .dot.down {
            background: #e53935;
          }

          .meta {
            color: rgba(255, 255, 255, 0.5);
          }
        }

        .electrum-server-error {
          color: #ef9a9a;
        }
      }
    `,
  ],
})
export class ElectrumServerListComponent {
  readonly servers = input.required<BtcxServerHealth[]>();
}
