import { Component, inject, signal, computed, OnInit } from '@angular/core';

import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { StepHeaderComponent } from '../../../../shared/components';
import {
  WalletManagerService,
  type WatchOnlyRescan,
} from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { DescriptorService } from '../../../../bitcoin/services/wallet/descriptor.service';
import { selectNetwork } from '../../../../store/settings/settings.selectors';
import type { Network } from '../../../../store/settings/settings.state';
import {
  validatePocxAddress,
  POCX_NETWORKS,
} from '../../../../bitcoin/utils/address-validation';
import {
  detectEntryKind,
  validateDescriptorChecksum,
  detectDescriptorNetwork,
} from '../../../../bitcoin/utils/descriptor-validation';

type EntryError =
  | { key: 'watch_only_entry_error_unknown' }
  | { key: 'watch_only_entry_error_bare_xpub' }
  | { key: 'watch_only_entry_error_checksum_address' }
  | { key: 'watch_only_entry_error_checksum_descriptor' }
  | {
      key: 'address_wrong_network';
      params: { addressNetwork: string; appNetwork: string };
    }
  | { key: 'watch_only_entry_error_duplicate' };

interface PendingEntry {
  id: string;
  kind: 'address' | 'descriptor';
  raw: string; // what the user typed, for display
  canonicalDescriptor: string; // what we send to importdescriptors
  typeLabel: string; // "P2PKH", "wpkh", etc.
  commitError?: string; // populated if commit fails for this entry
}

@Component({
  selector: 'app-watch-only',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatProgressBarModule,
    MatRadioModule,
    I18nPipe,
    StepHeaderComponent,
  ],
  template: `
    <div class="watch-only-container">
      <mat-card class="watch-only-card">
        <app-step-header
          [title]="getCurrentStepTitle()"
          [currentStep]="currentStep()"
          [totalSteps]="3"
        ></app-step-header>

        @if (creating()) {
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        }

        <mat-card-content>
          <!-- Step 1: Wallet Name -->
          @if (currentStep() === 1) {
            <div class="step-content">
              <p class="info-text">{{ 'watch_only_description' | i18n }}</p>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'wallet_name' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="walletName"
                  (ngModelChange)="onWalletNameChange()"
                  placeholder="My Watch Wallet"
                  [disabled]="creating()"
                />
                @if (walletNameConflict()) {
                  <mat-error>{{ 'wallet_name_conflict' | i18n }}</mat-error>
                } @else {
                  <mat-hint>{{ 'wallet_name_hint' | i18n }}</mat-hint>
                }
              </mat-form-field>
              <div class="step-actions">
                <button mat-button routerLink="/auth">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="!walletName || walletNameConflict() || creating()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 2: Add entries -->
          @if (currentStep() === 2) {
            <div class="step-content">
              <p class="info-text">{{ 'watch_only_entries_description' | i18n }}</p>

              @let err = entryError();

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ 'watch_only_entry_label' | i18n }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="entryInput"
                  [placeholder]="entryPlaceholder()"
                  [disabled]="creating()"
                  (keyup.enter)="addEntry()"
                />
                @if (err) {
                  <mat-error>
                    @if (err.key === 'address_wrong_network') {
                      {{ err.key | i18n: err.params }}
                    } @else {
                      {{ err.key | i18n }}
                    }
                  </mat-error>
                }
                <mat-hint>{{ 'watch_only_entry_hint' | i18n }}</mat-hint>
              </mat-form-field>

              <div class="entry-add-row">
                <button
                  mat-stroked-button
                  color="primary"
                  [disabled]="!entryInput.trim() || creating()"
                  (click)="addEntry()"
                >
                  <mat-icon>add</mat-icon>
                  {{ 'watch_only_entry_add' | i18n }}
                </button>
              </div>

              @if (pendingEntries().length === 0) {
                <p class="entry-empty">{{ 'watch_only_entries_empty' | i18n }}</p>
              } @else {
                <ul class="entry-list">
                  @for (entry of pendingEntries(); track entry.id) {
                    <li class="entry-item">
                      <div class="entry-meta">
                        <span class="entry-kind">{{ entry.kind }} · {{ entry.typeLabel }}</span>
                        <span class="entry-raw">{{ entry.raw }}</span>
                        @if (entry.commitError) {
                          <span class="entry-commit-error">
                            <mat-icon>error</mat-icon>
                            {{ entry.commitError }}
                          </span>
                        }
                      </div>
                      <button
                        mat-icon-button
                        type="button"
                        [attr.aria-label]="'watch_only_entry_remove' | i18n"
                        [disabled]="creating()"
                        (click)="removeEntry(entry.id)"
                      >
                        <mat-icon>delete</mat-icon>
                      </button>
                    </li>
                  }
                </ul>
              }

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="pendingEntries().length === 0 || creating()"
                  (click)="nextStep()"
                >
                  {{ 'next' | i18n }}
                </button>
              </div>
            </div>
          }

          <!-- Step 3: Review + rescan + commit -->
          @if (currentStep() === 3) {
            <div class="step-content">
              <p class="info-text">
                {{
                  'watch_only_review_summary'
                    | i18n
                      : {
                          addresses: addressCount(),
                          descriptors: descriptorCount(),
                          network: translateNetwork(network()),
                        }
                }}
              </p>

              <div class="rescan-section">
                <p class="rescan-label">{{ 'watch_only_rescan_label' | i18n }}</p>
                <mat-radio-group
                  class="rescan-group"
                  [value]="rescanKind()"
                  (change)="setRescanKind($event.value)"
                  [disabled]="creating()"
                >
                  <mat-radio-button value="now">
                    {{ 'watch_only_rescan_now' | i18n }}
                  </mat-radio-button>
                  <mat-radio-button value="date">
                    {{ 'watch_only_rescan_date' | i18n }}
                  </mat-radio-button>
                  <mat-radio-button value="genesis">
                    {{ 'watch_only_rescan_genesis' | i18n }}
                  </mat-radio-button>
                </mat-radio-group>

                @if (rescanKind() === 'date') {
                  <mat-form-field appearance="outline" class="date-field">
                    <mat-label>{{ 'watch_only_rescan_date_label' | i18n }}</mat-label>
                    <input
                      matInput
                      type="date"
                      [(ngModel)]="rescanDateInput"
                      [disabled]="creating()"
                    />
                  </mat-form-field>
                }

                @if (rescanKind() === 'now') {
                  <p class="warning-text small">
                    <mat-icon>warning</mat-icon>
                    {{ 'watch_only_rescan_warning_now' | i18n }}
                  </p>
                }
              </div>

              <div class="step-actions">
                <button mat-button (click)="prevStep()" [disabled]="creating()">
                  {{ 'back' | i18n }}
                </button>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="creating() || !canCommit()"
                  (click)="commit()"
                >
                  @if (creating()) {
                    {{ 'creating' | i18n }}...
                  } @else {
                    {{ 'create_wallet' | i18n }}
                  }
                </button>
              </div>
            </div>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .watch-only-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #eceff1;
      }

      .watch-only-card {
        width: 100%;
        max-width: 640px;
      }

      .step-content {
        padding: 24px;
      }

      .full-width {
        width: 100%;
      }

      .info-text {
        color: rgba(0, 0, 0, 0.6);
        margin-bottom: 16px;
      }

      .warning-text {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #f57c00;
        font-size: 13px;
        margin-top: 8px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .entry-add-row {
        display: flex;
        justify-content: flex-end;
        margin-top: -8px;
        margin-bottom: 16px;
      }

      .entry-empty {
        color: rgba(0, 0, 0, 0.5);
        font-style: italic;
        text-align: center;
        padding: 24px 0;
        border: 1px dashed rgba(0, 0, 0, 0.15);
        border-radius: 4px;
      }

      .entry-list {
        list-style: none;
        padding: 0;
        margin: 0 0 8px 0;
      }

      .entry-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 4px;
        margin-bottom: 6px;
      }

      .entry-meta {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .entry-kind {
        font-size: 12px;
        text-transform: uppercase;
        color: #4caf50;
        font-weight: 500;
        letter-spacing: 0.04em;
      }

      .entry-raw {
        font-family: monospace;
        font-size: 13px;
        word-break: break-all;
      }

      .entry-commit-error {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: #d32f2f;
        font-size: 12px;
        margin-top: 2px;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }

      .rescan-section {
        margin: 16px 0;
      }

      .rescan-label {
        font-weight: 500;
        margin-bottom: 8px;
      }

      .rescan-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .date-field {
        margin-top: 12px;
        width: 240px;
      }

      .step-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
      }

    `,
  ],
})
export class WatchOnlyComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly walletManager = inject(WalletManagerService);
  private readonly descriptorService = inject(DescriptorService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  private readonly store = inject(Store);

  currentStep = signal(1);
  private readonly stepTitles = [
    'wallet_name',
    'watch_only_step_entries',
    'watch_only_step_review',
  ];

  walletName = '';
  creating = signal(false);

  // Existing wallet names (for conflict check on step 1)
  private readonly existingWalletNames = signal<string[]>([]);
  readonly walletNameConflict = signal(false);

  // Current entry being typed
  entryInput = '';
  readonly entryError = signal<EntryError | null>(null);

  // Pending list and rescan state
  readonly pendingEntries = signal<PendingEntry[]>([]);
  readonly rescanKind = signal<WatchOnlyRescan['kind']>('now');
  rescanDateInput = '';

  // App network — for mismatch checks and placeholder
  readonly network = toSignal(this.store.select(selectNetwork), { initialValue: 'mainnet' });

  readonly entryPlaceholder = computed(() => {
    const hrp = POCX_NETWORKS[this.network()].hrp;
    return `${hrp}1q... / wpkh(xpub.../<0;1>/*)#checksum`;
  });

  readonly addressCount = computed(
    () => this.pendingEntries().filter(e => e.kind === 'address').length
  );
  readonly descriptorCount = computed(
    () => this.pendingEntries().filter(e => e.kind === 'descriptor').length
  );

  async ngOnInit(): Promise<void> {
    try {
      const names = await this.walletManager.listAllWallets();
      this.existingWalletNames.set(names);
    } catch {
      // RPC unreachable — skip the check; commit-time RPC will surface the real error.
    }
  }

  onWalletNameChange(): void {
    const target = this.walletName.trim().toLowerCase();
    this.walletNameConflict.set(
      target.length > 0 && this.existingWalletNames().some(n => n.toLowerCase() === target)
    );
  }

  getCurrentStepTitle(): string {
    return this.i18n.get(this.stepTitles[this.currentStep() - 1]);
  }

  nextStep(): void {
    if (this.currentStep() < 3) {
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  translateNetwork(network: Network): string {
    return this.i18n.get(network);
  }

  setRescanKind(kind: WatchOnlyRescan['kind']): void {
    this.rescanKind.set(kind);
  }

  addEntry(): void {
    const raw = this.entryInput.trim();
    if (!raw) return;

    const kind = detectEntryKind(raw);
    if (kind === 'unknown') {
      this.entryError.set({ key: 'watch_only_entry_error_unknown' });
      return;
    }
    if (kind === 'bare_xpub') {
      this.entryError.set({ key: 'watch_only_entry_error_bare_xpub' });
      return;
    }

    let canonical: string;
    let typeLabel: string;
    const appNet = this.network();

    if (kind === 'address') {
      const result = validatePocxAddress(raw);
      if (result.kind !== 'valid') {
        this.entryError.set({ key: 'watch_only_entry_error_checksum_address' });
        return;
      }
      if (result.network !== appNet) {
        this.entryError.set({
          key: 'address_wrong_network',
          params: {
            addressNetwork: this.translateNetwork(result.network),
            appNetwork: this.translateNetwork(appNet),
          },
        });
        return;
      }
      canonical = this.descriptorService.addChecksum(`addr(${raw})`);
      typeLabel = result.type;
    } else {
      // descriptor
      if (!validateDescriptorChecksum(raw)) {
        this.entryError.set({ key: 'watch_only_entry_error_checksum_descriptor' });
        return;
      }
      const detected = detectDescriptorNetwork(raw);
      if (detected !== null && detected !== appNet) {
        this.entryError.set({
          key: 'address_wrong_network',
          params: {
            addressNetwork: this.translateNetwork(detected),
            appNetwork: this.translateNetwork(appNet),
          },
        });
        return;
      }
      canonical = raw;
      typeLabel = this.descriptorFunctionName(raw);
    }

    if (this.pendingEntries().some(e => e.canonicalDescriptor === canonical)) {
      this.entryError.set({ key: 'watch_only_entry_error_duplicate' });
      return;
    }

    const entry: PendingEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      raw,
      canonicalDescriptor: canonical,
      typeLabel,
    };
    this.pendingEntries.update(list => [...list, entry]);
    this.entryInput = '';
    this.entryError.set(null);
  }

  removeEntry(id: string): void {
    this.pendingEntries.update(list => list.filter(e => e.id !== id));
  }

  canCommit(): boolean {
    if (this.pendingEntries().length === 0) return false;
    if (this.rescanKind() === 'date' && !this.rescanDateInput) return false;
    return true;
  }

  async commit(): Promise<void> {
    if (this.creating() || !this.canCommit()) return;

    const rescan = this.buildRescan();
    if (!rescan) return;

    this.creating.set(true);
    // Reset any previous per-entry commit errors
    this.pendingEntries.update(list => list.map(e => ({ ...e, commitError: undefined })));

    try {
      await this.walletManager.createWatchOnlyWallet({
        walletName: this.walletName,
        descriptors: this.pendingEntries().map(e => e.canonicalDescriptor),
        rescan,
      });

      this.snackBar.open(
        this.i18n.get('wallet_created_success', { name: this.walletName }),
        undefined,
        { duration: 3000 }
      );
      this.router.navigate(['/dashboard']);
    } catch (error) {
      console.error('Failed to create watch-only wallet:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create wallet';
      // Send user back to step 2 so they can edit entries
      this.currentStep.set(2);
      this.snackBar.open(
        this.i18n.get('watch_only_commit_failed', { error: errorMessage }),
        this.i18n.get('dismiss'),
        { duration: 8000 }
      );
      this.creating.set(false);
    }
  }

  private buildRescan(): WatchOnlyRescan | null {
    const kind = this.rescanKind();
    if (kind === 'now') return { kind: 'now' };
    if (kind === 'genesis') return { kind: 'genesis' };
    // date
    const date = new Date(this.rescanDateInput);
    const timestamp = Math.floor(date.getTime() / 1000);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return { kind: 'date', timestamp };
  }

  private descriptorFunctionName(desc: string): string {
    const body = desc.includes('#') ? desc.slice(0, desc.lastIndexOf('#')) : desc;
    const match = body.match(/^([a-z]+)\(/);
    return match ? match[1] : 'descriptor';
  }
}
