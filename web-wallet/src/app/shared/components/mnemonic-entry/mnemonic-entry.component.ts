import { Component, ElementRef, inject, input, output, viewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../core/i18n';
import { DescriptorService } from '../../../bitcoin/services/wallet/descriptor.service';

export interface MnemonicEntryState {
  /** Lower-cased, space-joined phrase (may be incomplete) */
  mnemonic: string;
  /** All words filled, in the wordlist, and BIP39 checksum valid */
  valid: boolean;
}

/**
 * MnemonicEntryComponent — the standard seed-phrase entry grid:
 * 12/24-word selector, per-word inputs with BIP39 autocomplete and
 * validation, and a checksum warning once all words are filled.
 * Shared by the import-wallet and multisig wizards.
 */
@Component({
  selector: 'app-mnemonic-entry',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatAutocompleteModule,
    MatTooltipModule,
    I18nPipe,
  ],
  template: `
    <div class="word-length-selector">
      <button
        mat-stroked-button
        [class.active]="wordCount === 12"
        (click)="setWordCount(12)"
        [disabled]="disabled()"
      >
        12 {{ 'words' | i18n }}
      </button>
      <button
        mat-stroked-button
        [class.active]="wordCount === 24"
        (click)="setWordCount(24)"
        [disabled]="disabled()"
      >
        24 {{ 'words' | i18n }}
      </button>
    </div>

    <div class="mnemonic-input-grid" [class.words-12]="wordCount === 12">
      @for (word of mnemonicWords; track $index; let i = $index) {
        <div class="word-input-chip">
          <span class="word-index">{{ i + 1 }}</span>
          <input
            #wordInput
            #trigger="matAutocompleteTrigger"
            class="word-input"
            [(ngModel)]="mnemonicWords[i]"
            [disabled]="disabled()"
            [matAutocomplete]="auto"
            (input)="updateSuggestions(i, mnemonicWords[i])"
            (keydown.enter)="onWordEnter(i, $event, trigger)"
            (blur)="validateWord(i)"
            autocomplete="off"
            spellcheck="false"
          />
          <mat-autocomplete
            #auto="matAutocomplete"
            [autoActiveFirstOption]="true"
            (optionSelected)="onWordSelected(i, $event.option.value)"
          >
            @for (suggestion of wordSuggestions[i]; track suggestion) {
              <mat-option [value]="suggestion">{{ suggestion }}</mat-option>
            }
          </mat-autocomplete>
          @if (wordErrors[i]) {
            <mat-icon class="word-error-icon" matTooltip="{{ 'invalid_word' | i18n }}"
              >error</mat-icon
            >
          }
        </div>
      }
    </div>

    @if (isChecksumInvalid()) {
      <p class="warning-text small">
        <mat-icon>error</mat-icon>
        {{ 'mnemonic_checksum_invalid' | i18n }}
      </p>
    }
  `,
  styles: [
    `
      .word-length-selector {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;

        button {
          flex: 1;

          &.active {
            background: #1e3a5f;
            color: white;
          }
        }
      }

      .mnemonic-input-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 16px;

        &.words-12 {
          grid-template-columns: repeat(3, 1fr);
        }
      }

      .word-input-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        background: #ffffff;
        border-radius: 4px;
        border: 1px solid transparent;
        position: relative;
        min-width: 0;
        overflow: hidden;

        &:focus-within {
          border-color: #1e3a5f;
          background: white;
        }
      }

      .word-index {
        color: rgba(0, 0, 0, 0.4);
        font-size: 11px;
        min-width: 16px;
        flex-shrink: 0;
        font-family: 'Roboto Mono', monospace;
      }

      .word-input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-family: 'Roboto Mono', monospace;
        font-weight: 500;
        font-size: 13px;
        min-width: 0;
        width: 0;
      }

      .word-error-icon {
        color: #f44336;
        font-size: 16px;
        width: 16px;
        height: 16px;
        position: absolute;
        right: 8px;
      }

      .warning-text.small {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        color: #e65100;
        background: rgba(255, 152, 0, 0.1);
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 12px;
        font-size: 12px;

        mat-icon {
          flex-shrink: 0;
          color: #ff9800;
        }
      }

      @media (max-width: 599px) {
        .mnemonic-input-grid {
          grid-template-columns: repeat(3, 1fr);

          &.words-12 {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      }

      @media (max-width: 400px) {
        .mnemonic-input-grid {
          grid-template-columns: repeat(2, 1fr);

          &.words-12 {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      }
    `,
  ],
})
export class MnemonicEntryComponent {
  private readonly descriptorService = inject(DescriptorService);

  readonly disabled = input(false);
  readonly changed = output<MnemonicEntryState>();

  /** The per-word `<input>` elements, in grid order, for focus advancing. */
  private readonly wordInputs = viewChildren<ElementRef<HTMLInputElement>>('wordInput');

  wordCount: 12 | 24 = 24;
  mnemonicWords: string[] = new Array(24).fill('');
  wordSuggestions: string[][] = new Array(24).fill(null).map(() => []);
  wordErrors: boolean[] = new Array(24).fill(false);

  setWordCount(count: 12 | 24): void {
    if (this.wordCount === count) return;
    this.wordCount = count;
    this.mnemonicWords = new Array(count).fill('');
    this.wordSuggestions = new Array(count).fill(null).map(() => []);
    this.wordErrors = new Array(count).fill(false);
    this.emitState();
  }

  /** Clear all inputs (e.g. when the host resets the form) */
  reset(): void {
    this.mnemonicWords = new Array(this.wordCount).fill('');
    this.wordSuggestions = new Array(this.wordCount).fill(null).map(() => []);
    this.wordErrors = new Array(this.wordCount).fill(false);
    this.emitState();
  }

  updateSuggestions(index: number, value: string): void {
    this.wordSuggestions[index] =
      value && value.length >= 1 ? this.descriptorService.getWordSuggestions(value, 8) : [];
    this.wordErrors[index] = false;
    this.emitState();
  }

  onWordSelected(index: number, word: string): void {
    this.mnemonicWords[index] = word;
    this.wordSuggestions[index] = [];
    this.wordErrors[index] = false;
    this.emitState();
    // Satchel-style: committing a word jumps focus to the next field, so
    // the whole phrase can be entered without reaching for the mouse.
    this.focusNext(index);
  }

  /**
   * Enter-to-accept (Satchel's SeedForm behaviour). With
   * `autoActiveFirstOption` the first suggestion is always highlighted, so
   * Angular Material selects it on Enter and fires `optionSelected`
   * (→ `onWordSelected`, which advances). This raw handler covers the two
   * cases Material's selection does NOT: when the autocomplete panel is
   * closed but the typed value is already an exact BIP39 word, commit it and
   * advance; otherwise keep Enter from submitting an enclosing form or doing
   * nothing. It never double-advances — if Material already selected the
   * highlighted option for this keypress (`defaultPrevented`), or the panel
   * is open with a highlighted option (Material will select it), we bail.
   */
  onWordEnter(index: number, event: Event, trigger: MatAutocompleteTrigger): void {
    if (event.defaultPrevented) return;
    if (trigger.panelOpen && trigger.activeOption) return;
    const typed = this.mnemonicWords[index]?.trim().toLowerCase();
    if (typed && this.descriptorService.getWordlist().includes(typed)) {
      event.preventDefault();
      this.mnemonicWords[index] = typed;
      this.wordSuggestions[index] = [];
      this.wordErrors[index] = false;
      this.emitState();
      this.focusNext(index);
    }
  }

  /** Move focus to the next word input; a no-op on the last field. */
  private focusNext(index: number): void {
    const next = this.wordInputs()[index + 1];
    if (!next) return;
    // Defer past Material's own post-selection focus handling so our move
    // to the next field wins instead of snapping back to the current one.
    setTimeout(() => {
      next.nativeElement.focus();
      next.nativeElement.select();
    });
  }

  validateWord(index: number): void {
    const word = this.mnemonicWords[index]?.trim().toLowerCase();
    this.wordErrors[index] = word ? !this.descriptorService.getWordlist().includes(word) : false;
  }

  isComplete(): boolean {
    const wordlist = this.descriptorService.getWordlist();
    return (
      this.mnemonicWords.filter(w => w.trim().length > 0).length === this.wordCount &&
      this.mnemonicWords.every(word => wordlist.includes(word.trim().toLowerCase()))
    );
  }

  isValid(): boolean {
    return this.isComplete() && this.descriptorService.validateMnemonic(this.phrase());
  }

  isChecksumInvalid(): boolean {
    return this.isComplete() && !this.isValid();
  }

  private phrase(): string {
    return this.mnemonicWords.map(w => w.trim().toLowerCase()).join(' ');
  }

  private emitState(): void {
    this.changed.emit({ mnemonic: this.phrase(), valid: this.isValid() });
  }
}
