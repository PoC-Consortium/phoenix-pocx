import { Component, input, signal, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AccountSummary } from '../../models/aggregator.models';
import { I18nPipe, I18nService } from '../../../core/i18n';

@Component({
  selector: 'app-aggregator-accounts-section',
  standalone: true,
  imports: [MatIconModule, I18nPipe],
  template: `
    <div class="section">
      <div class="section-header">
        <span class="section-title">{{ 'aggregator_accounts' | i18n }}</span>
      </div>
      <div class="section-content">
        @if (accounts().length === 0) {
          <div class="no-data">{{ 'aggregator_no_accounts' | i18n }}</div>
        } @else {
          <table>
            <thead>
              <tr>
                <th>{{ 'account_id' | i18n }}</th>
                <th>{{ 'aggregator_machines' | i18n }}</th>
                <th>{{ 'aggregator_capacity' | i18n }}</th>
                <th>{{ 'aggregator_subs_24h' | i18n }}</th>
                <th>{{ 'status' | i18n }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (row of accounts(); track row.accountId) {
                <tr (click)="toggleExpand(row.accountId)">
                  <td class="mono">{{ truncate(row.accountId) }}</td>
                  <td>{{ row.machineCount }}</td>
                  <td>{{ row.totalCapacityTib.toFixed(2) }} TiB</td>
                  <td>{{ row.submissions24h }}</td>
                  <td>
                    <span
                      class="status-dot"
                      [class.active]="row.isActive"
                      [class.inactive]="!row.isActive"
                    ></span>
                    {{ row.isActive ? ('active' | i18n) : ('aggregator_offline' | i18n) }}
                  </td>
                  <td>
                    @if (row.machines.length > 0) {
                      <mat-icon class="expand-icon">{{
                        expandedId() === row.accountId ? 'expand_less' : 'expand_more'
                      }}</mat-icon>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
          @if (expandedAccount(); as account) {
            <div class="expanded-detail">
              <div class="detail-title">{{ getMachinesForLabel(account.accountId) }}</div>
              @for (machine of account.machines; track machine.machineId) {
                <div class="detail-row">
                  <span class="mono">{{ truncate(machine.machineId) }}</span>
                  <span>{{ machine.capacityTib.toFixed(2) }} TiB</span>
                  <span>{{ machine.submissions24h }} {{ 'aggregator_subs_suffix' | i18n }}</span>
                  <span
                    class="status-dot"
                    [class.active]="machine.isActive"
                    [class.inactive]="!machine.isActive"
                  ></span>
                </div>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .section {
        background: #ffffff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        flex-shrink: 0;
      }

      .section-title {
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #ffffff;
      }

      .section-content {
        padding: 10px 14px;
        overflow-x: auto;
        overflow-y: auto;
        flex: 1;
      }

      table {
        width: 100%;
        min-width: 350px;
        border-collapse: collapse;
      }

      th {
        text-align: left;
        padding: 5px 6px;
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgb(0, 35, 65);
        border-bottom: 1px solid #e0e0e0;
      }

      td {
        padding: 5px 6px;
        font-size: 11px;
        border-bottom: 1px solid #f0f0f0;
        color: rgb(0, 35, 65);
      }

      tr:last-child td {
        border-bottom: none;
      }
      tr {
        cursor: pointer;
      }
      tr:hover {
        background: rgba(0, 0, 0, 0.02);
      }

      .mono {
        font-family: 'Consolas', monospace;
        font-size: 11px;
      }
      .no-data {
        padding: 24px;
        text-align: center;
        color: rgba(0, 0, 0, 0.38);
        font-size: 13px;
      }

      .status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-right: 5px;
      }
      .status-dot.active {
        background: #4caf50;
        box-shadow: 0 0 4px #4caf50;
      }
      .status-dot.inactive {
        background: #9e9e9e;
      }

      .expand-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: rgba(0, 35, 65, 0.5);
      }

      .expanded-detail {
        padding: 12px 16px;
        background: rgba(0, 0, 0, 0.03);
        border-radius: 4px;
        margin-top: 4px;
      }

      .detail-title {
        font-weight: 500;
        margin-bottom: 8px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(0, 35, 65, 0.6);
      }

      .detail-row {
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 4px 0;
        font-size: 11px;
        color: rgb(0, 35, 65);
      }

      :host-context(.dark-theme) {
        .section {
          background: #1e1e1e;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        .no-data {
          color: rgba(255, 255, 255, 0.38);
        }
        th {
          color: rgba(255, 255, 255, 0.7);
          border-bottom-color: rgba(255, 255, 255, 0.1);
        }
        td {
          color: #e0e0e0;
          border-bottom-color: rgba(255, 255, 255, 0.05);
        }
        tr:hover {
          background: rgba(255, 255, 255, 0.03);
        }
        .expand-icon {
          color: rgba(255, 255, 255, 0.5);
        }
        .expanded-detail {
          background: rgba(255, 255, 255, 0.05);
        }
        .detail-title {
          color: rgba(255, 255, 255, 0.5);
        }
        .detail-row {
          color: #e0e0e0;
        }
      }
    `,
  ],
})
export class AccountsSectionComponent {
  private readonly i18n = inject(I18nService);

  accounts = input<AccountSummary[]>([]);

  private readonly _expandedId = signal<string | null>(null);
  expandedId = this._expandedId.asReadonly();

  expandedAccount = () => {
    const id = this._expandedId();
    if (!id) return null;
    return this.accounts().find(a => a.accountId === id) ?? null;
  };

  toggleExpand(id: string): void {
    this._expandedId.set(this._expandedId() === id ? null : id);
  }

  truncate(id: string): string {
    if (!id) return '—';
    if (id.length <= 16) return id;
    return id.slice(0, 8) + '…' + id.slice(-8);
  }

  getMachinesForLabel(accountId: string): string {
    return this.i18n.get('aggregator_machines_for', { id: this.truncate(accountId) });
  }
}
