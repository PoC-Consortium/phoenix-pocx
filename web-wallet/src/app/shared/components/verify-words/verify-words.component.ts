import { Component, ElementRef, effect, inject, input, viewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { I18nPipe } from '../../../core/i18n';
import { DescriptorService } from '../../../bitcoin/services/wallet/descriptor.service';

/**
 * VerifyWordsComponent — the standard "prove you wrote it down" step:
 * 3 random words from the phrase, BIP39 autocomplete, Enter-to-advance,
 * per-field inline errors. Shared by the create-wallet flow and the
 * multisig wizard.
 *
 * The parent gates its Next button on `passed()` via a template ref:
 *   <app-verify-words #verifyStep [words]="words()" />
 *   <button [disabled]="!verifyStep.passed()">...
 *
 * Indices are rolled when the component is (re)created — mount it inside
 * the step's @if so each visit to the step gets a fresh selection.
 */
@Component({
  selector: 'app-verify-words',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule, I18nPipe],
  template: `
    <p class="hint-text">{{ 'verify_backup_instruction' | i18n }}</p>

    @for (idx of verifyIndices; track idx; let i = $index) {
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ 'word_number' | i18n: { number: idx + 1 } }}</mat-label>
        <input
          #wordInput
          matInput
          [(ngModel)]="verifyWords[i]"
          [disabled]="disabled()"
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
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        margin: 0 0 12px;
      }

      .full-width {
        width: 100%;
      }

      .error-hint {
        color: #c62828;
      }

      :host-context(.dark-theme) {
        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .error-hint {
          color: #ef9a9a;
        }
      }
    `,
  ],
})
export class VerifyWordsComponent {
  private readonly descriptorService = inject(DescriptorService);

  /** The full phrase being verified. */
  readonly words = input.required<string[]>();
  readonly disabled = input(false);
  /** How many random positions to confirm. */
  readonly count = input(3);

  verifyIndices: number[] = [];
  verifyWords: string[] = [];
  wordSuggestions: string[][] = [];
  readonly wordInputs = viewChildren<ElementRef<HTMLInputElement>>('wordInput');

  constructor() {
    // Roll fresh indices whenever the phrase (re)arrives or changes.
    effect(() => {
      const words = this.words();
      if (words.length > 0) this.reset(words.length);
    });
  }

  reset(wordCount: number = this.words().length): void {
    const n = Math.min(this.count(), wordCount);
    const indices: number[] = [];
    while (indices.length < n) {
      const idx = Math.floor(Math.random() * wordCount);
      if (!indices.includes(idx)) indices.push(idx);
    }
    this.verifyIndices = indices.sort((a, b) => a - b);
    this.verifyWords = indices.map(() => '');
    this.wordSuggestions = indices.map(() => []);
  }

  wordCorrect(i: number): boolean {
    return (
      this.verifyWords[i]?.toLowerCase().trim() ===
      this.words()[this.verifyIndices[i]]?.toLowerCase()
    );
  }

  /** True once every requested word is typed correctly. */
  passed(): boolean {
    return this.verifyIndices.length > 0 && this.verifyIndices.every((_, i) => this.wordCorrect(i));
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
   * Enter-to-accept: with an open autocomplete panel Material selects the
   * highlighted option; otherwise an exact BIP39 word commits and advances.
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
}
