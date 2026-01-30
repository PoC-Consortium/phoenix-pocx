import { Component, input, signal, computed } from '@angular/core';
import { ActivityLogEntry } from '../../models/aggregator.models';
import { I18nPipe } from '../../../core/i18n';

type FilterType = 'all' | 'info' | 'warn' | 'error';

@Component({
  selector: 'app-aggregator-activity-log',
  standalone: true,
  imports: [I18nPipe],
  template: `
    <div class="section">
      <div class="section-header">
        <span class="section-title">{{ 'aggregator_recent_activity' | i18n }}</span>
        <div class="log-filters">
          <button
            class="log-filter"
            [class.active]="logFilter() === 'all'"
            (click)="logFilter.set('all')"
          >
            {{ 'all' | i18n }}
          </button>
          <button
            class="log-filter"
            [class.active]="logFilter() === 'info'"
            data-filter="info"
            (click)="logFilter.set('info')"
          >
            {{ 'info' | i18n }}
          </button>
          <button
            class="log-filter"
            [class.active]="logFilter() === 'warn'"
            data-filter="warn"
            (click)="logFilter.set('warn')"
          >
            {{ 'warn' | i18n }}
          </button>
          <button
            class="log-filter"
            [class.active]="logFilter() === 'error'"
            data-filter="error"
            (click)="logFilter.set('error')"
          >
            {{ 'error' | i18n }}
          </button>
        </div>
      </div>
      <div class="section-content">
        <div class="activity-log">
          @for (log of filteredLogs(); track log.id) {
            <div class="log-entry">
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <span class="log-message" [class]="log.type">{{ log.message }}</span>
            </div>
          }
          @if (filteredLogs().length === 0) {
            <div class="log-entry">
              <span class="log-time">--:--:--</span>
              <span class="log-message">{{ 'aggregator_no_activity' | i18n }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 120px;
      }

      .section {
        background: #ffffff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        flex: 1;
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

      .log-filters {
        display: flex;
        gap: 4px;
      }

      .log-filter {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: rgba(255, 255, 255, 0.5);
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .log-filter:hover {
        background: rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.8);
      }

      .log-filter.active {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }

      .log-filter[data-filter='info'].active {
        background: rgba(100, 181, 246, 0.3);
        color: #64b5f6;
      }

      .log-filter[data-filter='warn'].active {
        background: rgba(255, 183, 77, 0.3);
        color: #ffb74d;
      }

      .log-filter[data-filter='error'].active {
        background: rgba(229, 115, 115, 0.3);
        color: #e57373;
      }

      .section-content {
        padding: 10px 14px;
        flex: 1;
        overflow-y: auto;
      }

      .activity-log {
        display: flex;
        flex-direction: column;
      }

      .log-entry {
        display: flex;
        gap: 10px;
        padding: 4px 0;
        font-size: 11px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      }

      .log-entry:last-child {
        border-bottom: none;
      }

      .log-time {
        color: #888888;
        font-family: 'Consolas', monospace;
        min-width: 55px;
        font-size: 11px;
        flex-shrink: 0;
      }

      .log-message {
        color: #666666;
        font-family: 'Consolas', monospace;
        word-break: break-word;
      }

      .log-message.info {
        color: #666666;
      }
      .log-message.success {
        color: #4caf50;
      }
      .log-message.warn,
      .log-message.warning {
        color: #ff9800;
      }
      .log-message.error {
        color: #f44336;
      }

      :host-context(.dark-theme) {
        .section {
          background: #1e1e1e;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        .log-entry {
          border-bottom-color: rgba(255, 255, 255, 0.05);
        }
        .log-time {
          color: #888888;
        }
        .log-message {
          color: #999999;
        }
        .log-message.info {
          color: #999999;
        }
      }
    `,
  ],
})
export class ActivityLogComponent {
  logs = input<ActivityLogEntry[]>([]);
  logFilter = signal<FilterType>('all');

  filteredLogs = computed(() => {
    const filter = this.logFilter();
    const allLogs = this.logs();

    if (filter === 'all') return allLogs;

    return allLogs.filter(log => {
      if (filter === 'warn') return log.type === 'warn' || log.type === 'error';
      if (filter === 'error') return log.type === 'error';
      return log.type === filter || log.type === 'success';
    });
  });

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
