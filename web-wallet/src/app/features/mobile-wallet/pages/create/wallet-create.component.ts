import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe } from '../../../../core/i18n';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';

type CreateStep = 'phrase' | 'verify' | 'protect';

/**
 * WalletCreateComponent - create-wallet onboarding flow.
 *
 * 1. phrase:  generate + display the 12 words with a write-it-down gate
 * 2. verify:  confirm a few words from the written backup
 * 3. protect: optional at-rest passphrase, then create
 *
 * No skippable-backup shortcuts: the acknowledge checkbox and the word
 * check are both required before the seed is committed.
 */
@Component({
  selector: 'app-wallet-create',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    I18nPipe,
  ],
  template: `
    <div class="page">
      <div class="header-row">
        <button mat-icon-button routerLink="/wallet">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h2>{{ 'mwallet_create_wallet' | i18n }}</h2>
      </div>

      @if (step() === 'phrase') {
        <div class="card">
          <h3>{{ 'mwallet_backup_title' | i18n }}</h3>
          <p class="warning-text">
            <mat-icon class="warning-icon">warning</mat-icon>
            {{ 'mwallet_backup_warning' | i18n }}
          </p>

          @if (words().length > 0) {
            <div class="word-grid">
              @for (word of words(); track $index) {
                <div class="word-chip">
                  <span class="word-index">{{ $index + 1 }}</span>
                  <span class="word-text">{{ word }}</span>
                </div>
              }
            </div>
          } @else {
            <div class="loading-inline">
              <mat-spinner diameter="24"></mat-spinner>
            </div>
          }

          <mat-checkbox [(ngModel)]="acknowledged">
            {{ 'mwallet_backup_ack' | i18n }}
          </mat-checkbox>

          <button
            mat-raised-button
            color="primary"
            class="full-width step-button"
            [disabled]="!acknowledged || words().length === 0"
            (click)="startVerify()"
          >
            {{ 'next' | i18n }}
          </button>
        </div>
      } @else if (step() === 'verify') {
        <div class="card">
          <h3>{{ 'mwallet_verify_title' | i18n }}</h3>
          <p class="hint-text">{{ 'mwallet_verify_hint' | i18n }}</p>

          @for (check of checks(); track check.index) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'word_number' | i18n: { number: check.index + 1 } }}</mat-label>
              <input
                matInput
                [(ngModel)]="check.entered"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
              />
            </mat-form-field>
          }

          @if (verifyError()) {
            <p class="error-text">{{ 'mwallet_verify_mismatch' | i18n }}</p>
          }

          <div class="button-row">
            <button mat-stroked-button (click)="step.set('phrase')">
              {{ 'back' | i18n }}
            </button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="!allChecksFilled()"
              (click)="verify()"
            >
              {{ 'next' | i18n }}
            </button>
          </div>
        </div>
      } @else {
        <div class="card">
          <h3>{{ 'mwallet_passphrase_title' | i18n }}</h3>
          <p class="hint-text">{{ 'mwallet_passphrase_hint' | i18n }}</p>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'mwallet_passphrase_label' | i18n }}</mat-label>
            <input matInput type="password" [(ngModel)]="passphrase" autocomplete="off" />
          </mat-form-field>

          @if (passphrase) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'mwallet_passphrase_confirm' | i18n }}</mat-label>
              <input matInput type="password" [(ngModel)]="passphraseConfirm" autocomplete="off" />
            </mat-form-field>

            @if (passphraseConfirm && passphrase !== passphraseConfirm) {
              <p class="error-text">{{ 'mwallet_passphrase_mismatch' | i18n }}</p>
            }
          }

          @if (createError()) {
            <p class="error-text">{{ 'mwallet_create_failed' | i18n }}: {{ createError() }}</p>
          }

          <div class="button-row">
            <button mat-stroked-button [disabled]="creating()" (click)="step.set('verify')">
              {{ 'back' | i18n }}
            </button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="!canCreate() || creating()"
              (click)="create()"
            >
              @if (creating()) {
                <mat-spinner diameter="20"></mat-spinner>
              }
              {{ 'mwallet_create_wallet' | i18n }}
            </button>
          </div>
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

      .warning-text {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        background: rgba(230, 81, 0, 0.08);
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 13px;
        color: rgba(0, 0, 0, 0.75);
        margin: 0 0 16px;

        .warning-icon {
          color: #e65100;
          font-size: 18px;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }
      }

      .word-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 16px;
      }

      .word-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #f5f7fa;
        border-radius: 6px;
        padding: 6px 8px;

        .word-index {
          font-size: 11px;
          color: rgba(0, 0, 0, 0.45);
          min-width: 14px;
          text-align: right;
        }

        .word-text {
          font-family: monospace;
          font-size: 13px;
        }
      }

      .loading-inline {
        display: flex;
        justify-content: center;
        padding: 24px 0;
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      .full-width {
        width: 100%;
      }

      .step-button {
        margin-top: 16px;
      }

      .button-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
      }

      :host-context(.dark-theme) {
        .card {
          background: #424242;
        }

        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .warning-text {
          color: rgba(255, 255, 255, 0.8);
          background: rgba(255, 183, 77, 0.12);
        }

        .word-chip {
          background: #333;

          .word-index {
            color: rgba(255, 255, 255, 0.45);
          }
        }
      }
    `,
  ],
})
export class WalletCreateComponent implements OnInit {
  private readonly wallet = inject(BtcxWalletService);
  private readonly router = inject(Router);

  readonly step = signal<CreateStep>('phrase');
  readonly words = signal<string[]>([]);
  readonly checks = signal<{ index: number; entered: string }[]>([]);
  readonly verifyError = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  acknowledged = false;
  passphrase = '';
  passphraseConfirm = '';

  private mnemonic = '';

  readonly allChecksFilled = computed(() => this.checks().every(c => c.entered.trim().length > 0));

  ngOnInit(): void {
    void this.generate();
  }

  private async generate(): Promise<void> {
    try {
      await this.wallet.initialize();
      this.mnemonic = await this.wallet.generateMnemonic();
      this.words.set(this.mnemonic.split(' '));
    } catch (err) {
      console.error('Failed to generate mnemonic:', err);
      this.createError.set(`${err}`);
    }
  }

  startVerify(): void {
    // Pick 3 distinct random word positions to confirm
    const count = this.words().length;
    const indices = new Set<number>();
    while (indices.size < 3 && indices.size < count) {
      indices.add(Math.floor(Math.random() * count));
    }
    this.checks.set([...indices].sort((a, b) => a - b).map(index => ({ index, entered: '' })));
    this.verifyError.set(false);
    this.step.set('verify');
  }

  verify(): void {
    const words = this.words();
    const ok = this.checks().every(c => c.entered.trim().toLowerCase() === words[c.index]);
    if (!ok) {
      this.verifyError.set(true);
      return;
    }
    this.step.set('protect');
  }

  canCreate(): boolean {
    if (!this.passphrase) return true;
    return this.passphrase === this.passphraseConfirm;
  }

  async create(): Promise<void> {
    if (this.creating() || !this.canCreate()) return;
    this.creating.set(true);
    this.createError.set(null);
    try {
      await this.wallet.create(this.mnemonic, this.passphrase || undefined);
      this.mnemonic = '';
      this.words.set([]);
      await this.router.navigate(['/wallet']);
    } catch (err) {
      console.error('Failed to create wallet:', err);
      this.createError.set(`${err}`);
    } finally {
      this.creating.set(false);
    }
  }
}
