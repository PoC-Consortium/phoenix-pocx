import { Component, input, output, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { StatsSnapshot, AggregatorStatus } from '../../models/aggregator.models';
import { I18nPipe, I18nService } from '../../../core/i18n';

@Component({
  selector: 'app-aggregator-summary-stats',
  standalone: true,
  imports: [MatIconModule, I18nPipe],
  template: `
    <div class="summary-cards">
      <!-- Aggregator Status Card (with start/stop) -->
      <div class="summary-card status-card">
        <div class="card-header">
          <span class="card-title"><mat-icon>hub</mat-icon>{{ 'aggregator_status' | i18n }}</span>
        </div>
        <div class="status-row">
          <span class="status-indicator" [class]="getStatusIndicatorClass()"></span>
          <span class="status-label">{{ getStatusText() }}</span>
          <button
            class="btn btn-icon"
            [class.btn-stop]="isRunning()"
            [class.btn-start]="!isRunning()"
            [disabled]="isLoading()"
            (click)="isRunning() ? stopClicked.emit() : startClicked.emit()"
          >
            <span class="btn-label">{{ isRunning() ? ('stop' | i18n) : ('start' | i18n) }}</span>
            <span class="btn-icon-glyph">{{ isRunning() ? '■' : '▶' }}</span>
          </button>
        </div>
        <div class="card-sub">{{ getSubText() }}</div>
      </div>

      <!-- Network Info Card -->
      <div class="summary-card">
        <div class="card-header">
          <span class="card-title"
            ><mat-icon>language</mat-icon>{{ 'aggregator_network_info' | i18n }}</span
          >
        </div>
        <div class="stat-row">
          <div class="stat-item">
            <span class="stat-label">{{ 'aggregator_block_height' | i18n }}</span>
            <span class="stat-value">#{{ stats()?.currentHeight ?? 0 }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ 'aggregator_network_capacity' | i18n }}</span>
            <span class="stat-value">{{ stats()?.networkCapacity ?? '—' }}</span>
          </div>
        </div>
      </div>

      <!-- Current Block Best Card -->
      <div class="summary-card">
        <div class="card-header">
          <span class="card-title"
            ><mat-icon>emoji_events</mat-icon>{{ 'aggregator_block_best' | i18n }}</span
          >
        </div>
        @if (hasBest()) {
          <div class="stat-row">
            <div class="stat-item">
              <span class="stat-label">{{ 'aggregator_poc_time' | i18n }}</span>
              <span class="stat-value">{{ stats()!.currentBlockBest.bestPocTime }}s</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">{{ 'aggregator_quality' | i18n }}</span>
              <span class="stat-value">{{ stats()!.currentBlockBest.bestQuality }}</span>
            </div>
          </div>
          <div class="stat-item">
            <span class="stat-label">{{ 'account' | i18n }}</span>
            <span class="stat-value mono">{{ displayAccount() }}</span>
          </div>
        } @else {
          <div class="best-value">—</div>
          <div class="card-sub">{{ 'aggregator_no_submissions' | i18n }}</div>
        }
      </div>

      <!-- Total Capacity Estimate Card -->
      <div class="summary-card">
        <div class="card-header">
          <span class="card-title"
            ><mat-icon>storage</mat-icon>{{ 'aggregator_capacity_estimate' | i18n }}</span
          >
        </div>
        <div class="capacity-value">{{ stats()?.totalCapacity ?? '0 B' }}</div>
        <div class="card-sub">
          {{ 'aggregator_stats_machines' | i18n: { machines: stats()?.activeMachines ?? 0 } }} ·
          {{ 'aggregator_stats_accounts' | i18n: { accounts: stats()?.uniqueMiners ?? 0 } }}
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .summary-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        flex-shrink: 0;
        min-height: fit-content;
      }

      @media (max-width: 1100px) {
        .summary-cards {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 600px) {
        .summary-cards {
          grid-template-columns: 1fr;
        }
      }

      .summary-card {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        position: relative;
        min-height: 120px;
        min-width: 0;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 10px;
      }

      .card-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.7);
      }

      .card-title mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: rgba(255, 255, 255, 0.7);
      }

      .card-sub {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        margin-top: 4px;
      }

      /* Status Card */
      .status-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      .status-indicator {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-indicator.active {
        background: #4caf50;
        box-shadow: 0 0 8px #4caf50;
        animation: pulse 2s infinite;
      }
      .status-indicator.starting {
        background: #ff9800;
        box-shadow: 0 0 8px #ff9800;
      }
      .status-indicator.stopped {
        background: #9e9e9e;
      }
      .status-indicator.error {
        background: #f44336;
        box-shadow: 0 0 8px #f44336;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.6;
        }
      }

      .status-label {
        font-size: 14px;
        font-weight: 500;
        color: #ffffff;
      }

      .btn {
        padding: 8px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-start {
        background: #4caf50;
        color: white;
      }
      .btn-start:hover:not(:disabled) {
        background: #43a047;
      }
      .btn-stop {
        background: #d32f2f;
        color: white;
      }
      .btn-stop:hover:not(:disabled) {
        background: #c62828;
      }

      .btn-icon {
        padding: 4px 10px;
        margin-left: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        gap: 2px;
      }

      .btn-label {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .btn-icon-glyph {
        font-size: 14px;
        line-height: 1;
      }

      /* Network Info Card */
      .stat-row {
        display: flex;
        gap: 16px;
      }

      .stat-item {
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      .stat-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 2px;
      }

      .stat-value {
        font-size: 18px;
        font-weight: 600;
        color: #81c784;
      }

      /* Capacity Card */
      .capacity-value {
        font-size: 24px;
        font-weight: 700;
        color: #81c784;
      }

      /* Best Card */
      .best-value {
        font-size: 24px;
        font-weight: 700;
        color: #81c784;
      }

      .mono {
        font-family: 'Consolas', monospace;
        font-size: clamp(9px, 1.8vw, 14px);
        word-break: break-all;
      }
    `,
  ],
})
export class SummaryStatsComponent {
  private readonly i18n = inject(I18nService);

  stats = input<StatsSnapshot | null>(null);
  status = input<AggregatorStatus>({ type: 'stopped' });
  isLoading = input(false);
  isRunning = input(false);
  bestAccountBech32 = input<string | null>(null);

  startClicked = output<void>();
  stopClicked = output<void>();

  hasBest = computed(() => {
    const s = this.stats();
    return s?.currentBlockBest?.bestPocTime != null;
  });

  displayAccount = computed(() => {
    const bech32 = this.bestAccountBech32();
    if (bech32) return bech32;
    return this.stats()?.currentBlockBest?.bestAccountId ?? '—';
  });

  truncateId(id: string | null | undefined): string {
    if (!id) return '—';
    if (id.length <= 16) return id;
    return id.slice(0, 8) + '…' + id.slice(-8);
  }

  getStatusIndicatorClass(): string {
    const s = this.status();
    switch (s.type) {
      case 'running':
        return 'active';
      case 'starting':
        return 'starting';
      case 'error':
        return 'error';
      default:
        return 'stopped';
    }
  }

  getStatusText(): string {
    const s = this.status();
    switch (s.type) {
      case 'running':
        return this.i18n.get('aggregator_running');
      case 'starting':
        return this.i18n.get('aggregator_starting');
      case 'error':
        return this.i18n.get('aggregator_error');
      default:
        return this.i18n.get('aggregator_offline');
    }
  }

  getSubText(): string {
    const s = this.status();
    switch (s.type) {
      case 'running':
        return this.i18n.get('aggregator_listening_on', { address: s.listenAddress || '...' });
      case 'error':
        return s.message || this.i18n.get('aggregator_unknown_error');
      default:
        return this.i18n.get('aggregator_press_start');
    }
  }
}
