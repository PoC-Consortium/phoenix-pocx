import { Injectable, inject, signal, computed, NgZone } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subject, Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { ElectronService } from './electron.service';
import { selectClockDriftWarning } from '../../store/settings/settings.selectors';

export interface NtpSample {
  server: string;
  offsetMs: number;
  rttMs: number;
}

export interface ClockDriftReport {
  offsetMs: number;
  samples: NtpSample[];
}

export type ClockDriftStatus = 'unknown' | 'ok' | 'warning' | 'critical';

// Thresholds (absolute milliseconds)
export const CLOCK_DRIFT_WARNING_MS = 10_000;
export const CLOCK_DRIFT_CRITICAL_MS = 15_000;

const FIRST_CHECK_DELAY_MS = 30_000;
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Polls public NTP servers to detect system clock drift.
 *
 * Drift > 15s breaks PoCX forging, so this service surfaces drift via the
 * toolbar indicator. NTP failures are silent (no spurious warnings on
 * flaky networks). User can disable polling via the settings flag.
 */
@Injectable({ providedIn: 'root' })
export class ClockDriftService {
  private readonly electronService = inject(ElectronService);
  private readonly ngZone = inject(NgZone);
  private readonly store = inject(Store);

  private firstCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private settingsSubscription: Subscription | null = null;
  private initialized = false;

  readonly offsetMs = signal<number | null>(null);
  readonly samples = signal<NtpSample[]>([]);
  readonly lastCheckedAt = signal<number | null>(null);
  readonly checking = signal<boolean>(false);
  readonly enabled = signal<boolean>(true);

  readonly status = computed<ClockDriftStatus>(() => {
    const offset = this.offsetMs();
    if (offset === null) return 'unknown';
    const abs = Math.abs(offset);
    if (abs >= CLOCK_DRIFT_CRITICAL_MS) return 'critical';
    if (abs >= CLOCK_DRIFT_WARNING_MS) return 'warning';
    return 'ok';
  });

  /** Emits when a manual recheck completes (success or failure). */
  readonly checkCompleted$ = new Subject<void>();

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.electronService.isDesktop) {
      // No NTP query path on web; service stays inert.
      return;
    }

    this.settingsSubscription = this.store
      .select(selectClockDriftWarning)
      .pipe(distinctUntilChanged())
      .subscribe(enabled => {
        this.enabled.set(enabled);
        if (enabled) {
          this.startSchedule();
        } else {
          this.stopSchedule();
          // Clear any stale reading so the toolbar indicator hides.
          this.offsetMs.set(null);
          this.samples.set([]);
        }
      });
  }

  destroy(): void {
    this.stopSchedule();
    if (this.settingsSubscription) {
      this.settingsSubscription.unsubscribe();
      this.settingsSubscription = null;
    }
  }

  /** Manual recheck — used by the dialog's "Check now" button. */
  async checkNow(): Promise<void> {
    if (!this.electronService.isDesktop) return;
    await this.runCheck();
    this.checkCompleted$.next();
  }

  private startSchedule(): void {
    this.stopSchedule();
    this.firstCheckTimer = setTimeout(() => {
      this.runCheck();
    }, FIRST_CHECK_DELAY_MS);
    this.intervalTimer = setInterval(() => {
      this.runCheck();
    }, INTERVAL_MS);
  }

  private stopSchedule(): void {
    if (this.firstCheckTimer) {
      clearTimeout(this.firstCheckTimer);
      this.firstCheckTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private async runCheck(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const report = await invoke<ClockDriftReport>('check_clock_drift');
      this.ngZone.run(() => {
        this.offsetMs.set(report.offsetMs);
        this.samples.set(report.samples);
        this.lastCheckedAt.set(Date.now());
      });
    } catch (err) {
      // NTP unreachable — stay silent. Don't overwrite last good reading;
      // a transient failure shouldn't clear the indicator.
      console.debug('[ClockDrift] check failed:', err);
    } finally {
      this.ngZone.run(() => this.checking.set(false));
    }
  }
}
