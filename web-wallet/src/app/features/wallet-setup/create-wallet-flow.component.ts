import {
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { I18nPipe } from '../../core/i18n';
import { NodeService } from '../../node/services/node.service';
import { BtcxWalletService } from '../../core/services/btcx-wallet.service';
import { WalletManagerService } from '../../bitcoin/services/wallet/wallet-manager.service';
import { DescriptorService } from '../../bitcoin/services/wallet/descriptor.service';
import { selectIsTestnet } from '../../store/settings/settings.selectors';
import {
  StepHeaderComponent,
  MnemonicDisplayComponent,
  Bip39PassphraseSectionComponent,
} from '../../shared/components';
import { WalletNameSectionComponent } from '../mobile-wallet/components/wallet-name-section/wallet-name-section.component';
import {
  isInvalidWalletName,
  isWalletNameTaken,
  suggestWalletName,
} from '../mobile-wallet/wallet-name';

type FlowStep = 1 | 2 | 3 | 4;

/**
 * CreateWalletFlowComponent — THE create-wallet wizard, shared by the
 * desktop auth flow and the mobile shell (best-of-both unification):
 *
 * 1. name    — shared WalletNameSectionComponent, pre-filled with the next
 *              free default, live conflict/invalid messages
 * 2. phrase  — MnemonicDisplay (Generate New) + BIP39 25th-word section +
 *              write-it-down acknowledgement. Backing out of this step
 *              abandons the draft; re-entry generates a fresh phrase, and
 *              Generate New also resets the BIP39 fields (desktop hygiene).
 * 3. verify  — 3 random words, BIP39 autocomplete, Enter-to-advance,
 *              per-field inline errors, Next enabled only when all correct
 * 4. protect — optional at-rest secret. Remote/BDK: encrypts the stored
 *              seed. Core RPC: encryptwallet after create. Both modes use
 *              the lean optional-field pattern (confirm appears once typed)
 *              with the forget-warning box.
 *
 * The Core-vs-BDK commit branch follows NodeService.isRemote — the mobile
 * shell is always nodeless/remote, so it collapses naturally there. Hosts
 * handle post-create navigation via the `created` output.
 */
@Component({
  selector: 'app-create-wallet-flow',
  standalone: true,
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    I18nPipe,
    StepHeaderComponent,
    MnemonicDisplayComponent,
    Bip39PassphraseSectionComponent,
    WalletNameSectionComponent,
  ],
  template: `
    <div class="flow">
      <app-step-header [title]="stepTitle() | i18n" [currentStep]="step()" [totalSteps]="4" />

      <div class="card">
        <!-- Step 1: name -->
        @if (step() === 1) {
          <app-mwallet-name-section
            #nameSection
            [(name)]="walletName"
            [existingNames]="existingNames()"
            [disabled]="creating()"
          />

          <div class="button-row">
            @if (showCancel()) {
              <button mat-stroked-button (click)="cancelled.emit()">{{ 'back' | i18n }}</button>
            } @else {
              <span></span>
            }
            <button
              mat-raised-button
              color="primary"
              [disabled]="nameSection.hasError()"
              (click)="nextFromName()"
            >
              {{ 'next' | i18n }}
            </button>
          </div>
        }

        <!-- Step 2: phrase + BIP39 -->
        @if (step() === 2) {
          <p class="warning-text">
            <mat-icon class="warning-icon">warning</mat-icon>
            {{ 'backup_warning' | i18n }}
          </p>

          @if (words().length > 0) {
            <app-mnemonic-display
              [words]="words()"
              [disabled]="creating()"
              (regenerate)="regenerate()"
            />
          } @else {
            <div class="loading-inline">
              <mat-spinner diameter="24"></mat-spinner>
            </div>
          }

          <!-- BIP39 25th word — part of the phrase, asked here; the at-rest
               secret is a SEPARATE choice on the protect step. -->
          <app-bip39-passphrase-section
            [disabled]="creating()"
            [(enabled)]="useBip39"
            [(passphrase)]="bip39Word"
            [(passphraseConfirm)]="bip39WordConfirm"
          />

          <mat-checkbox [(ngModel)]="acknowledged">
            {{ 'confirm_backup_written' | i18n }}
          </mat-checkbox>

          <div class="button-row">
            <button mat-stroked-button (click)="backToName()">{{ 'back' | i18n }}</button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="
                !acknowledged ||
                words().length === 0 ||
                (useBip39 && bip39Word !== bip39WordConfirm)
              "
              (click)="startVerify()"
            >
              {{ 'next' | i18n }}
            </button>
          </div>
        }

        <!-- Step 3: verify -->
        @if (step() === 3) {
          <p class="hint-text">{{ 'verify_backup_instruction' | i18n }}</p>

          @for (idx of verifyIndices; track idx; let i = $index) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'word_number' | i18n: { number: idx + 1 } }}</mat-label>
              <input
                #wordInput
                matInput
                [(ngModel)]="verifyWords[i]"
                [disabled]="creating()"
                [matAutocomplete]="auto"
                #trigger="matAutocompleteTrigger"
                (input)="updateSuggestions(i, verifyWords[i])"
                (keydown.enter)="onWordEnter(i, $event, trigger)"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
              />
              <mat-autocomplete
                #auto="matAutocomplete"
                [autoActiveFirstOption]="true"
                (optionSelected)="onWordSelected(i, $event.option.value)"
              >
                @for (word of wordSuggestions[i]; track word) {
                  <mat-option [value]="word">{{ word }}</mat-option>
                }
              </mat-autocomplete>
              @if (verifyWords[i] && !wordCorrect(i)) {
                <mat-hint class="error-hint">{{ 'incorrect_word' | i18n }}</mat-hint>
              }
            </mat-form-field>
          }

          <div class="button-row">
            <button mat-stroked-button (click)="step.set(2)">{{ 'back' | i18n }}</button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="!verificationPassed()"
              (click)="step.set(4)"
            >
              {{ 'next' | i18n }}
            </button>
          </div>
        }

        <!-- Step 4: protect (at-rest secret) + create -->
        @if (step() === 4) {
          <p class="hint-text">
            {{ (isRemote() ? 'mwallet_passphrase_hint' : 'wallet_encryption_info') | i18n }}
          </p>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>{{ 'mwallet_passphrase_optional' | i18n }}</mat-label>
            <input
              matInput
              type="password"
              [(ngModel)]="protectPassphrase"
              [disabled]="creating()"
              autocomplete="off"
            />
          </mat-form-field>

          @if (protectPassphrase) {
            <p class="warning-text">
              <mat-icon class="warning-icon">warning</mat-icon>
              {{ 'wallet_encryption_warning' | i18n }}
            </p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>{{ 'mwallet_passphrase_confirm' | i18n }}</mat-label>
              <input
                matInput
                type="password"
                [(ngModel)]="protectPassphraseConfirm"
                [disabled]="creating()"
                autocomplete="off"
              />
            </mat-form-field>

            @if (protectPassphraseConfirm && protectPassphrase !== protectPassphraseConfirm) {
              <p class="error-text">{{ 'passphrase_mismatch' | i18n }}</p>
            }
          }

          @if (createError()) {
            <p class="error-text">{{ 'mwallet_create_failed' | i18n }}: {{ createError() }}</p>
          }

          <div class="button-row">
            <button mat-stroked-button [disabled]="creating()" (click)="step.set(3)">
              {{ 'back' | i18n }}
            </button>
            <button
              mat-raised-button
              color="primary"
              [disabled]="creating() || !canCreate()"
              (click)="create()"
            >
              @if (creating()) {
                <mat-spinner diameter="20"></mat-spinner>
              }
              {{ 'create_wallet' | i18n }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .flow {
        max-width: 600px;
        width: 100%;
        margin: 0 auto;
      }

      .card {
        background: white;
        border-radius: 0 0 8px 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 20px;
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 12px;
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

      .error-hint {
        color: #c62828;
      }

      .full-width {
        width: 100%;
      }

      .button-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 16px;
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

        .error-hint {
          color: #ef9a9a;
        }
      }
    `,
  ],
})
export class CreateWalletFlowComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly nodeService = inject(NodeService);
  private readonly btcxWallet = inject(BtcxWalletService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly descriptorService = inject(DescriptorService);

  /** Emits the wallet name after a successful create; host navigates. */
  readonly created = output<string>();
  /** Step-1 back button (auth host: return to the wallet-select page). The
      mobile host relies on its page-header back arrow instead. */
  readonly showCancel = input(false);
  readonly cancelled = output<void>();

  readonly isRemote = this.nodeService.isRemote;
  private readonly isTestnet = toSignal(this.store.select(selectIsTestnet), { initialValue: true });

  readonly step = signal<FlowStep>(1);
  private readonly stepTitles = [
    'wallet_name',
    'backup_phrase',
    'verify_backup',
    'wallet_encryption_title',
  ];
  readonly stepTitle = computed(() => this.stepTitles[this.step() - 1]);

  // Step 1: name
  walletName = '';
  readonly existingNames = signal<string[]>([]);
  private readonly nameSection = viewChild(WalletNameSectionComponent);

  // Step 2: phrase + BIP39
  private mnemonic = '';
  readonly words = signal<string[]>([]);
  acknowledged = false;
  useBip39 = false;
  bip39Word = '';
  bip39WordConfirm = '';

  // Step 3: verify (desktop-style: live per-field check)
  verifyIndices: number[] = [];
  verifyWords: string[] = ['', '', ''];
  wordSuggestions: string[][] = [[], [], []];
  readonly wordInputs = viewChildren<ElementRef<HTMLInputElement>>('wordInput');

  // Step 4: protect + commit
  protectPassphrase = '';
  protectPassphraseConfirm = '';
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      if (this.isRemote()) {
        await this.btcxWallet.initialize();
        this.existingNames.set((await this.btcxWallet.refreshWallets()).map(w => w.name));
      } else {
        this.existingNames.set(await this.walletManager.listAllWallets());
      }
    } catch {
      // Registry unreachable — commit-time errors will surface the real cause.
    }
    if (!this.walletName) {
      this.walletName = suggestWalletName(this.existingNames());
    }
  }

  nextFromName(): void {
    if (this.nameSection()?.hasError()) return;
    if (!this.mnemonic) {
      void this.generateMnemonic();
    }
    this.step.set(2);
  }

  /** 2 → 1 abandons the draft; a fresh phrase is generated on re-entry. */
  backToName(): void {
    this.clearMnemonicDraft();
    this.step.set(1);
  }

  async regenerate(): Promise<void> {
    await this.generateMnemonic();
  }

  private async generateMnemonic(): Promise<void> {
    // A new phrase invalidates everything derived from the old draft.
    this.acknowledged = false;
    this.useBip39 = false;
    this.bip39Word = '';
    this.bip39WordConfirm = '';
    this.verifyWords = ['', '', ''];
    try {
      this.mnemonic = this.isRemote()
        ? await this.btcxWallet.generateMnemonic()
        : this.walletManager.generateMnemonic(256);
      this.words.set(this.mnemonic.split(' '));
    } catch (err) {
      console.error('Failed to generate mnemonic:', err);
      this.createError.set(`${err}`);
    }
  }

  private clearMnemonicDraft(): void {
    this.mnemonic = '';
    this.words.set([]);
    this.acknowledged = false;
    this.useBip39 = false;
    this.bip39Word = '';
    this.bip39WordConfirm = '';
  }

  startVerify(): void {
    const indices: number[] = [];
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * this.words().length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    this.verifyIndices = indices.sort((a, b) => a - b);
    this.verifyWords = ['', '', ''];
    this.wordSuggestions = [[], [], []];
    this.step.set(3);
  }

  wordCorrect(i: number): boolean {
    return (
      this.verifyWords[i]?.toLowerCase().trim() === this.words()[this.verifyIndices[i]]
    );
  }

  verificationPassed(): boolean {
    return this.verifyIndices.every((_, i) => this.wordCorrect(i));
  }

  updateSuggestions(index: number, value: string): void {
    this.wordSuggestions[index] = value?.length
      ? this.descriptorService.getWordSuggestions(value, 8)
      : [];
  }

  onWordSelected(index: number, word: string): void {
    this.verifyWords[index] = word;
    this.wordSuggestions[index] = [];
    this.focusNext(index);
  }

  /**
   * Enter-to-accept, mirroring the import flow's mnemonic entry: with an
   * open autocomplete panel Material selects the highlighted option;
   * otherwise an exact BIP39 word commits and advances.
   */
  onWordEnter(index: number, event: Event, trigger: MatAutocompleteTrigger): void {
    if (event.defaultPrevented) return;
    if (trigger.panelOpen && trigger.activeOption) return;
    const typed = (this.verifyWords[index] ?? '').toLowerCase().trim();
    if (this.descriptorService.getWordlist().includes(typed)) {
      event.preventDefault();
      this.verifyWords[index] = typed;
      this.wordSuggestions[index] = [];
      this.focusNext(index);
    }
  }

  private focusNext(index: number): void {
    const next = this.wordInputs()[index + 1];
    if (next) {
      setTimeout(() => {
        next.nativeElement.focus();
        next.nativeElement.select();
      });
    }
  }

  canCreate(): boolean {
    // Re-check the name against the live registry (the section is off-screen
    // by now, so don't rely on its viewChild).
    if (
      isWalletNameTaken(this.walletName, this.existingNames()) ||
      isInvalidWalletName(this.walletName)
    ) {
      return false;
    }
    if (this.protectPassphrase && this.protectPassphrase !== this.protectPassphraseConfirm) {
      return false;
    }
    if (this.useBip39 && this.bip39Word !== this.bip39WordConfirm) return false;
    return true;
  }

  async create(): Promise<void> {
    if (this.creating() || !this.canCreate()) return;
    this.creating.set(true);
    this.createError.set(null);
    try {
      // An emptied name field falls back to the suggested default.
      const name = this.walletName.trim() || suggestWalletName(this.existingNames());
      const bip39Passphrase = this.useBip39 ? this.bip39Word || undefined : undefined;

      if (this.isRemote()) {
        // Local BDK wallet: the backend materializes the SegWit + Taproot
        // compartments together as one group; the at-rest passphrase locks
        // the stored seed, the 25th word changes the derivation.
        await this.btcxWallet.create(
          this.mnemonic,
          this.protectPassphrase || undefined,
          name,
          undefined,
          bip39Passphrase
        );
        try {
          const loaded = await this.walletManager.refreshLoadedWallets();
          if (loaded.includes(name)) {
            this.walletManager.setActiveWallet(name);
          }
        } catch {
          // Mobile shell tracks the active wallet in BtcxWalletService itself.
        }
      } else {
        const result = await this.walletManager.createWalletFromMnemonic({
          walletName: name,
          mnemonic: this.mnemonic,
          mnemonicPassphrase: bip39Passphrase,
          isTestnet: this.isTestnet(),
          rescan: false,
        });
        if (!result.success) {
          throw new Error(result.errors?.join(', ') || 'Create failed');
        }
        if (this.protectPassphrase) {
          await this.walletManager.encryptWallet(name, this.protectPassphrase);
        }
      }

      this.clearSecrets();
      this.created.emit(name);
    } catch (err) {
      console.error('Failed to create wallet:', err);
      this.createError.set(`${err}`);
    } finally {
      this.creating.set(false);
    }
  }

  private clearSecrets(): void {
    this.mnemonic = '';
    this.words.set([]);
    this.bip39Word = '';
    this.bip39WordConfirm = '';
    this.protectPassphrase = '';
    this.protectPassphraseConfirm = '';
  }
}
