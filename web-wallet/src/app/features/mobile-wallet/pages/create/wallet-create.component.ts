import {
  Component,
  inject,
  signal,
  computed,
  viewChild,
  viewChildren,
  ElementRef,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nPipe } from '../../../../core/i18n';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import { DescriptorService } from '../../../../bitcoin/services/wallet/descriptor.service';
import { sanitizeReturnTo } from '../../return-to';
import { isInvalidWalletName, isWalletNameTaken, suggestWalletName } from '../../wallet-name';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';
import { WalletNameSectionComponent } from '../../components/wallet-name-section/wallet-name-section.component';

type CreateStep = 'name' | 'phrase' | 'verify' | 'protect';

/**
 * WalletCreateComponent - create-wallet onboarding flow.
 *
 * 1. name:    wallet name as its own FIRST step (owner rule, round 8) —
 *             pre-filled with the next free default, desktop naming rules
 *             (the shared WalletNameSectionComponent)
 * 2. phrase:  generate + display the 24 words with a write-it-down gate
 * 3. verify:  confirm a few words from the written backup
 * 4. protect: optional at-rest passphrase and a collapsed ADVANCED
 *             address-type choice (BIP-84 segwit default / BIP-86
 *             taproot), then create
 *
 * No skippable-backup shortcuts: the acknowledge checkbox and the word
 * check are both required before the seed is committed.
 *
 * Accepts a `returnTo` query param (app-internal path, e.g. the mining
 * setup wizard's address step) and navigates there instead of /wallet
 * after a successful create.
 */
@Component({
  selector: 'app-wallet-create',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
    I18nPipe,
    PageHeaderComponent,
    WalletNameSectionComponent,
  ],
  template: `
    <app-mwallet-page-header titleKey="mwallet_create_wallet" />

    <div class="page">
      @if (step() === 'name') {
        <div class="card">
          <!-- Wallet name — its own FIRST step so the pre-filled default is
               a conscious choice, not something to overlook. -->
          <app-mwallet-name-section
            #nameSection
            [(name)]="walletName"
            [existingNames]="existingNames()"
          />

          <button
            mat-raised-button
            color="primary"
            class="full-width step-button"
            [disabled]="nameSection.hasError()"
            (click)="step.set('phrase')"
          >
            {{ 'next' | i18n }}
          </button>
        </div>
      } @else if (step() === 'phrase') {
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

          <!-- BIP39 25th word — belongs right after the recovery phrase.
               SEPARATE from the at-rest encryption passphrase (asked later on
               the protect step). Folded into the derivation: with it set, the
               recovery phrase alone will NOT restore the funds. -->
          <mat-checkbox [(ngModel)]="useBip39" class="bip39-toggle">
            {{ 'mwallet_bip39_toggle' | i18n }}
          </mat-checkbox>

          @if (useBip39) {
            <p class="warning-text">
              <mat-icon class="warning-icon">warning</mat-icon>
              {{ 'mwallet_bip39_warning' | i18n }}
            </p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'mwallet_bip39_label' | i18n }}</mat-label>
              <input matInput type="password" [(ngModel)]="bip39Passphrase" autocomplete="off" />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'mwallet_bip39_confirm' | i18n }}</mat-label>
              <input
                matInput
                type="password"
                [(ngModel)]="bip39PassphraseConfirm"
                autocomplete="off"
              />
            </mat-form-field>

            @if (bip39PassphraseConfirm && bip39Passphrase !== bip39PassphraseConfirm) {
              <p class="error-text">{{ 'mwallet_passphrase_mismatch' | i18n }}</p>
            }
          }

          <mat-checkbox [(ngModel)]="acknowledged">
            {{ 'mwallet_backup_ack' | i18n }}
          </mat-checkbox>

          <div class="button-row step-button">
            <button mat-stroked-button (click)="step.set('name')">
              {{ 'back' | i18n }}
            </button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="
                !acknowledged ||
                words().length === 0 ||
                (useBip39 && bip39Passphrase !== bip39PassphraseConfirm)
              "
              (click)="startVerify()"
            >
              {{ 'next' | i18n }}
            </button>
          </div>
        </div>
      } @else if (step() === 'verify') {
        <div class="card">
          <h3>{{ 'mwallet_verify_title' | i18n }}</h3>
          <p class="hint-text">{{ 'mwallet_verify_hint' | i18n }}</p>

          @for (check of checks(); track check.index; let pos = $index) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'word_number' | i18n: { number: check.index + 1 } }}</mat-label>
              <input
                #wordInput
                matInput
                [ngModel]="check.entered"
                (ngModelChange)="onCheckInput(check.index, $event)"
                [matAutocomplete]="auto"
                #trigger="matAutocompleteTrigger"
                (keydown.enter)="onWordEnter(check.index, pos, $event, trigger)"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
              />
              <mat-autocomplete
                #auto="matAutocomplete"
                [autoActiveFirstOption]="true"
                (optionSelected)="onWordSelected(check.index, pos, $event.option.value)"
              >
                @for (word of suggestionsFor(check.index); track word) {
                  <mat-option [value]="word">{{ word }}</mat-option>
                }
              </mat-autocomplete>
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

          <!-- No address-type choice: a new wallet is a GROUP holding both
               a SegWit and a Taproot compartment (the backend materializes
               them together); the selector picks the pocket later. -->
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

        &.small {
          font-size: 12px;
          margin: 0 0 8px;
        }
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

      .bip39-toggle {
        display: block;
        margin: 4px 0 12px;
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
  private readonly route = inject(ActivatedRoute);
  private readonly descriptorService = inject(DescriptorService);

  readonly step = signal<CreateStep>('name');
  readonly words = signal<string[]>([]);
  readonly checks = signal<{ index: number; entered: string }[]>([]);
  /** BIP39 suggestions per verify-word position (keyed by word index). */
  readonly wordSuggestions = signal<Record<number, string[]>>({});
  /** The verify-step inputs, for Enter-to-advance. */
  readonly wordInputs = viewChildren<ElementRef<HTMLInputElement>>('wordInput');
  readonly verifyError = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  acknowledged = false;
  passphrase = '';
  passphraseConfirm = '';

  /**
   * Optional BIP39 25th word — SEPARATE from the at-rest `passphrase`. When
   * set it is folded into the seed derivation, so the recovery phrase alone
   * will NOT restore the funds (the word is required too).
   */
  useBip39 = false;
  bip39Passphrase = '';
  bip39PassphraseConfirm = '';

  /** Wallet name — pre-filled with the next free default; desktop rules. */
  walletName = '';
  /** The shared name section (rendered on the 'name' step only). */
  private readonly nameSection = viewChild(WalletNameSectionComponent);

  private mnemonic = '';
  /** Registry names for suggestion + case-insensitive conflict checks. */
  readonly existingNames = signal<string[]>([]);

  readonly allChecksFilled = computed(() => this.checks().every(c => c.entered.trim().length > 0));

  ngOnInit(): void {
    void this.generate();
  }

  private async generate(): Promise<void> {
    try {
      await this.wallet.initialize();
      this.existingNames.set((await this.wallet.refreshWallets()).map(w => w.name));
      if (!this.walletName) {
        this.walletName = suggestWalletName(this.existingNames());
      }
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

  /**
   * Record a typed verify-word by replacing the checks array with a fresh
   * copy (new array + new object). Mutating `check.entered` in place would
   * leave the signal's reference unchanged, so the `allChecksFilled`
   * computed would never recompute and the Next button would stay disabled
   * forever — the 2.1.0 create-wallet showstopper.
   */
  setCheckEntered(index: number, value: string): void {
    this.checks.update(arr => arr.map(c => (c.index === index ? { ...c, entered: value } : c)));
  }

  /** BIP39 suggestions for one verify-word position. */
  suggestionsFor(index: number): string[] {
    return this.wordSuggestions()[index] ?? [];
  }

  /** Record the typed word and refresh its BIP39 suggestions. */
  onCheckInput(index: number, value: string): void {
    this.setCheckEntered(index, value);
    const suggestions = value?.length ? this.descriptorService.getWordSuggestions(value, 8) : [];
    this.wordSuggestions.update(m => ({ ...m, [index]: suggestions }));
  }

  onWordSelected(index: number, pos: number, word: string): void {
    this.setCheckEntered(index, word);
    this.wordSuggestions.update(m => ({ ...m, [index]: [] }));
    this.focusNext(pos);
  }

  /**
   * Enter-to-accept, mirroring the import flow. If the autocomplete panel is
   * open with a highlighted option, Material selects it (→ onWordSelected);
   * otherwise, if the typed value is an exact BIP39 word, commit it and advance.
   */
  onWordEnter(index: number, pos: number, event: Event, trigger: MatAutocompleteTrigger): void {
    if (event.defaultPrevented) return;
    if (trigger.panelOpen && trigger.activeOption) return;
    const typed = (this.checks().find(c => c.index === index)?.entered ?? '').toLowerCase().trim();
    if (this.descriptorService.getWordlist().includes(typed)) {
      event.preventDefault();
      this.setCheckEntered(index, typed);
      this.wordSuggestions.update(m => ({ ...m, [index]: [] }));
      this.focusNext(pos);
    }
  }

  private focusNext(pos: number): void {
    const next = this.wordInputs()[pos + 1];
    if (next) {
      setTimeout(() => {
        next.nativeElement.focus();
        next.nativeElement.select();
      });
    }
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
    // The name step gated conflicts/invalid names already; re-check with
    // the same rules in case the registry moved (the section may be
    // off-screen by now, so don't rely on its viewChild).
    if (
      this.nameSection()?.hasError() ||
      isWalletNameTaken(this.walletName, this.existingNames()) ||
      isInvalidWalletName(this.walletName)
    ) {
      return false;
    }
    // The at-rest passphrase and the BIP39 25th word each must match their
    // confirm field when in use.
    if (this.passphrase && this.passphrase !== this.passphraseConfirm) return false;
    if (this.useBip39 && this.bip39Passphrase !== this.bip39PassphraseConfirm) return false;
    return true;
  }

  async create(): Promise<void> {
    if (this.creating() || !this.canCreate()) return;
    this.creating.set(true);
    this.createError.set(null);
    try {
      // An emptied name field falls back to the suggested default.
      const name = this.walletName.trim() || suggestWalletName(this.existingNames());
      // No kind: the backend materializes the SegWit + Taproot compartments
      // together as one group. The BIP39 25th word (when set) is folded into
      // the derivation — the at-rest passphrase is passed separately.
      const bip39Passphrase = this.useBip39 ? this.bip39Passphrase || undefined : undefined;
      await this.wallet.create(
        this.mnemonic,
        this.passphrase || undefined,
        name,
        undefined,
        bip39Passphrase
      );
      this.mnemonic = '';
      this.words.set([]);
      // Chain back into the flow that launched us (e.g. mining setup)
      const returnTo = sanitizeReturnTo(this.route.snapshot.queryParamMap.get('returnTo'));
      if (returnTo) {
        await this.router.navigateByUrl(returnTo);
      } else {
        await this.router.navigate(['/wallet']);
      }
    } catch (err) {
      console.error('Failed to create wallet:', err);
      this.createError.set(`${err}`);
    } finally {
      this.creating.set(false);
    }
  }
}
