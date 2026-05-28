import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe } from '../../../core/i18n';
import {
  ClockDriftService,
  CLOCK_DRIFT_CRITICAL_MS,
  CLOCK_DRIFT_WARNING_MS,
} from '../../../core/services/clock-drift.service';

@Component({
  selector: 'app-clock-drift-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    I18nPipe,
    DatePipe,
    DecimalPipe,
  ],
  template: `
    <div class="clock-dialog" [attr.data-status]="status()">
      <h2 mat-dialog-title>
        <mat-icon class="status-icon">{{ statusIcon() }}</mat-icon>
        {{ 'clock_drift_title' | i18n }}
      </h2>

      <mat-dialog-content>
        @if (offsetMs() === null) {
          <p class="muted">{{ 'clock_drift_no_data' | i18n }}</p>
        } @else {
          <div class="summary">
            <div class="drift-value" [class]="'status-' + status()">
              {{ formattedOffset() }}
            </div>
            <div class="drift-label">{{ statusLabel() | i18n }}</div>
            <div class="threshold-note">
              {{
                'clock_drift_threshold_note'
                  | i18n: { warning: warningSeconds(), critical: criticalSeconds() }
              }}
            </div>
          </div>

          <div class="rows">
            <div class="row">
              <span class="label">{{ 'clock_drift_local_time' | i18n }}</span>
              <span class="value">{{ now() | date: 'medium' }}</span>
            </div>
            <div class="row">
              <span class="label">{{ 'clock_drift_ntp_time' | i18n }}</span>
              <span class="value">{{ ntpTime() | date: 'medium' }}</span>
            </div>
            <div class="row">
              <span class="label">{{ 'clock_drift_last_checked' | i18n }}</span>
              <span class="value">{{
                lastCheckedAt() ? (lastCheckedAt()! | date: 'medium') : '—'
              }}</span>
            </div>
          </div>

          @if (samples().length > 0) {
            <h4 class="samples-title">{{ 'clock_drift_sources' | i18n }}</h4>
            <table class="samples">
              <thead>
                <tr>
                  <th>{{ 'clock_drift_server' | i18n }}</th>
                  <th>{{ 'clock_drift_offset' | i18n }}</th>
                  <th>{{ 'clock_drift_rtt' | i18n }}</th>
                </tr>
              </thead>
              <tbody>
                @for (sample of samples(); track sample.server) {
                  <tr>
                    <td>{{ sample.server }}</td>
                    <td>{{ formatOffset(sample.offsetMs) }}</td>
                    <td>{{ sample.rttMs | number: '1.0-0' }} ms</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="onCheckNow()" [disabled]="service.checking()">
          @if (service.checking()) {
            <mat-spinner diameter="18"></mat-spinner>
          } @else {
            <mat-icon>refresh</mat-icon>
          }
          {{ 'clock_drift_check_now' | i18n }}
        </button>
        <button mat-raised-button color="primary" mat-dialog-close>
          {{ 'close' | i18n }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .clock-dialog {
        min-width: 420px;
        max-width: 560px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
        padding: 16px 24px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;

        .status-icon {
          font-size: 26px;
          width: 26px;
          height: 26px;
        }
      }

      .muted {
        color: rgba(0, 0, 0, 0.6);
        font-style: italic;
      }

      .summary {
        text-align: center;
        padding: 16px 0 8px 0;

        .drift-value {
          font-size: 2.5rem;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        .drift-value.status-ok {
          color: #2e7d32;
        }
        .drift-value.status-warning {
          color: #ef6c00;
        }
        .drift-value.status-critical {
          color: #c62828;
        }

        .drift-label {
          margin-top: 4px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.7);
        }

        .threshold-note {
          margin-top: 8px;
          font-size: 0.85rem;
          color: rgba(0, 0, 0, 0.55);
        }
      }

      .rows {
        margin-top: 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        font-size: 0.9rem;

        .label {
          color: rgba(0, 0, 0, 0.6);
        }

        .value {
          font-variant-numeric: tabular-nums;
        }
      }

      .samples-title {
        margin: 20px 0 8px 0;
        font-size: 0.9rem;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.7);
      }

      .samples {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;

        th,
        td {
          text-align: left;
          padding: 6px 8px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }

        th {
          color: rgba(0, 0, 0, 0.6);
          font-weight: 500;
        }

        td {
          font-variant-numeric: tabular-nums;
        }

        td:nth-child(2),
        td:nth-child(3) {
          text-align: right;
        }
        th:nth-child(2),
        th:nth-child(3) {
          text-align: right;
        }
      }

      mat-dialog-actions button mat-spinner {
        margin-right: 6px;
      }
    `,
  ],
})
export class ClockDriftDialogComponent implements OnInit {
  readonly service = inject(ClockDriftService);
  private readonly dialogRef = inject(MatDialogRef<ClockDriftDialogComponent>);

  readonly offsetMs = this.service.offsetMs;
  readonly samples = this.service.samples;
  readonly lastCheckedAt = this.service.lastCheckedAt;
  readonly status = this.service.status;

  readonly now = signal(Date.now());
  readonly ntpTime = computed(() => {
    const offset = this.offsetMs();
    if (offset === null) return null;
    return this.now() - offset;
  });

  readonly statusIcon = computed(() => {
    switch (this.status()) {
      case 'ok':
        return 'check_circle';
      case 'warning':
        return 'warning';
      case 'critical':
        return 'error';
      default:
        return 'schedule';
    }
  });

  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'ok':
        return 'clock_drift_status_ok';
      case 'warning':
        return 'clock_drift_status_warning';
      case 'critical':
        return 'clock_drift_status_critical';
      default:
        return 'clock_drift_status_unknown';
    }
  });

  readonly formattedOffset = computed(() => {
    const offset = this.offsetMs();
    if (offset === null) return '—';
    return this.formatOffset(offset);
  });

  readonly warningSeconds = computed(() => Math.round(CLOCK_DRIFT_WARNING_MS / 1000));
  readonly criticalSeconds = computed(() => Math.round(CLOCK_DRIFT_CRITICAL_MS / 1000));

  private tickInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Refresh "local time" display every second while dialog is open.
    this.tickInterval = setInterval(() => {
      this.now.set(Date.now());
    }, 1000);
    this.dialogRef.afterClosed().subscribe(() => {
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
    });
    // Trigger a fresh check on open (background); existing data stays visible.
    this.service.checkNow();
  }

  formatOffset(ms: number): string {
    const sign = ms >= 0 ? '+' : '−';
    const abs = Math.abs(ms);
    if (abs < 1000) {
      return `${sign}${abs} ms`;
    }
    const secs = abs / 1000;
    return `${sign}${secs.toFixed(secs < 10 ? 2 : 1)} s`;
  }

  onCheckNow(): void {
    this.service.checkNow();
  }
}
