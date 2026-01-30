import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AggregatorService } from '../../services/aggregator.service';
import { SummaryStatsComponent } from '../../components/summary-stats/summary-stats.component';
import { MachinesSectionComponent } from '../../components/machines-section/machines-section.component';
import { AccountsSectionComponent } from '../../components/accounts-section/accounts-section.component';
import { ActivityLogComponent } from '../../components/activity-log/activity-log.component';
import { I18nPipe } from '../../../core/i18n';

@Component({
  selector: 'app-aggregator-dashboard',
  standalone: true,
  imports: [
    MatIconModule,
    SummaryStatsComponent,
    MachinesSectionComponent,
    AccountsSectionComponent,
    ActivityLogComponent,
    I18nPipe,
  ],
  template: `
    <div class="dashboard">
      <div class="main-content">
        <!-- Summary Cards Row -->
        <app-aggregator-summary-stats
          [stats]="aggregatorService.stats()"
          [status]="aggregatorService.status()"
          [isLoading]="aggregatorService.isLoading()"
          [isRunning]="aggregatorService.isRunning()"
          [bestAccountBech32]="aggregatorService.bestAccountBech32()"
          (startClicked)="start()"
          (stopClicked)="stop()"
        ></app-aggregator-summary-stats>

        @if (aggregatorService.isRunning()) {
          <!-- Split Row: Machines | Accounts -->
          <div class="detail-row">
            <app-aggregator-machines-section
              [machines]="aggregatorService.stats()?.machines ?? []"
            ></app-aggregator-machines-section>

            <app-aggregator-accounts-section
              [accounts]="aggregatorService.stats()?.accounts ?? []"
            ></app-aggregator-accounts-section>
          </div>
        } @else if (!aggregatorService.isLoading()) {
          <!-- Offline placeholder -->
          <div class="offline-placeholder">
            <mat-icon>hub</mat-icon>
            <p>{{ 'aggregator_offline_message' | i18n }}</p>
          </div>
        }

        <!-- Activity Log (always visible, full width at bottom) -->
        <app-aggregator-activity-log
          [logs]="aggregatorService.activityLogs()"
        ></app-aggregator-activity-log>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .dashboard {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    .main-content {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      min-height: 0;
    }

    .detail-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      min-height: 200px;
    }

    @media (max-width: 900px) {
      .detail-row {
        grid-template-columns: 1fr;
        gap: 12px;
      }
    }

    .offline-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: rgba(0,0,0,0.38);
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .offline-placeholder mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
    }

    .offline-placeholder p {
      font-size: 14px;
      text-align: center;
    }

    :host-context(.dark-theme) {
      .offline-placeholder {
        color: rgba(255,255,255,0.38);
        background: #1e1e1e;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
    }
  `],
})
export class AggregatorDashboardComponent implements OnInit, OnDestroy {
  readonly aggregatorService = inject(AggregatorService);
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    await this.aggregatorService.initListeners();
    await this.aggregatorService.loadConfig();
    await this.aggregatorService.refreshStatus();
    await this.aggregatorService.refreshStats();

    // Poll stats every 5s as fallback
    this.statsInterval = setInterval(() => {
      if (this.aggregatorService.isRunning()) {
        this.aggregatorService.refreshStats();
      }
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  async start(): Promise<void> {
    await this.aggregatorService.start();
  }

  async stop(): Promise<void> {
    await this.aggregatorService.stop();
  }
}
