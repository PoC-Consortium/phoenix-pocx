import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { I18nPipe } from '../../../core/i18n';

/**
 * MnemonicDisplayComponent renders a generated seed phrase as the standard
 * numbered word-chip grid, with an optional "Generate new" action.
 * Shared by the create-wallet and multisig wizards.
 */
@Component({
  selector: 'app-mnemonic-display',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, I18nPipe],
  template: `
    <div class="mnemonic-display">
      @for (word of words(); track $index) {
        <div class="word-chip">
          <span class="word-index">{{ $index + 1 }}</span>
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
      .mnemonic-display {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 16px;
      }

      .word-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #ffffff;
        border-radius: 4px;
        font-family: 'Roboto Mono', monospace;
      }

      .word-index {
        color: rgba(0, 0, 0, 0.4);
        font-size: 12px;
        min-width: 20px;
      }

      .word-text {
        font-weight: 500;
      }

      .mnemonic-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      @media (max-width: 599px) {
        .mnemonic-display {
          grid-template-columns: repeat(3, 1fr);
        }
      }

      @media (max-width: 400px) {
        .mnemonic-display {
          grid-template-columns: repeat(2, 1fr);
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
