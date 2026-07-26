import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { I18nPipe } from '../../../core/i18n';

/**
 * MnemonicDisplayComponent renders a generated seed phrase as the standard
 * numbered word-chip grid, with an optional "Generate new" action.
 * Shared by the create-wallet (desktop + mobile) and multisig wizards.
 */
@Component({
  selector: 'app-mnemonic-display',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, I18nPipe],
  template: `
    <div class="mnemonic-display">
      @for (word of words(); track $index) {
        <div class="word-chip">
          <span class="word-text">{{ word }}</span>
        </div>
      }
    </div>

    @if (showRegenerate()) {
      <div class="mnemonic-actions">
        <button mat-stroked-button [disabled]="disabled()" (click)="regenerate.emit()">
          <mat-icon>refresh</mat-icon>
          {{ 'generate_new' | i18n }}
        </button>
      </div>
    }
  `,
  styles: [
    `
      /* The host is the size container: column count derives from the
         actual space the parent card gives us, never from the viewport,
         so the grid behaves the same in every wizard. */
      :host {
        display: block;
        container-type: inline-size;
      }

      .mnemonic-display {
        display: grid;
        /* 3 columns always (Johnny: 3 work even at 320px) — 4 only when
           they genuinely fit (>=504px: 4 worst-case chips + gaps). */
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 16px;
        counter-reset: seed-word;
      }

      @container (min-width: 504px) {
        .mnemonic-display {
          grid-template-columns: repeat(4, 1fr);
        }
      }

      .word-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #ffffff;
        border-radius: 4px;
        font-family: 'Roboto Mono', monospace;

        /* Index as a pseudo-element: not in the DOM, so selecting the grid
           copies only the words — one per line, no numbers. */
        &::before {
          counter-increment: seed-word;
          content: counter(seed-word);
          color: rgba(0, 0, 0, 0.4);
          font-size: 12px;
          min-width: 20px;
        }
      }

      .word-text {
        font-weight: 500;
      }

      .mnemonic-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      /* Narrow container (sub-phone cards): tighten chips so the 8-letter
         worst case (e.g. "category") still fits 3 columns at a 276px
         container (= 320px viewport in the mobile create page). Regular
         chips need ~375px for 3 columns — below that, shrink. */
      @container (max-width: 380px) {
        .mnemonic-display {
          gap: 6px 4px;
        }

        .word-chip {
          padding: 5px;
          gap: 4px;

          &::before {
            min-width: 12px;
            font-size: 11px;
          }

          .word-text {
            /* 12px: an 8-letter word (widest possible, e.g. "category")
               must fit the 3-column chip at 320px viewport with zero clip. */
            font-size: 12px;
          }
        }
      }

      :host-context(.dark-theme) {
        .word-chip {
          background: #333;

          &::before {
            color: rgba(255, 255, 255, 0.45);
          }
        }
      }
    `,
  ],
})
export class MnemonicDisplayComponent {
  readonly words = input.required<string[]>();
  readonly showRegenerate = input(true);
  readonly disabled = input(false);
  readonly regenerate = output<void>();
}
