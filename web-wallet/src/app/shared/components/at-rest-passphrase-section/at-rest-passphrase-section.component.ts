import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { I18nPipe } from '../../../core/i18n';

/**
 * AtRestPassphraseSectionComponent — the standard optional at-rest secret
 * block (lean pattern: no enable-checkbox; the confirm field and the
 * forget-warning appear once something is typed). Shared by the create and
 * restore flows, the multisig wizard and the descriptor import page.
 *
 * What the secret protects differs per flow (BDK seed at rest, Core
 * encryptwallet, imported descriptors) — parents pass the fitting
 * explanation via `hintKey`.
 *
 * Parents gate their commit button on `valid()` via a template ref.
 */
@Component({
  selector: 'app-at-rest-passphrase-section',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatIconModule, MatInputModule, I18nPipe],
  template: `
    <p class="hint-text">{{ hintKey() | i18n }}</p>

    <mat-form-field appearance="outline" class="full-width">
      <mat-label>{{ 'mwallet_passphrase_optional' | i18n }}</mat-label>
      <input
        matInput
        type="password"
        [(ngModel)]="passphrase"
        [disabled]="disabled()"
        autocomplete="off"
      />
    </mat-form-field>

    @if (passphrase()) {
      <p class="warning-text">
        <mat-icon class="warning-icon">warning</mat-icon>
        {{ 'wallet_encryption_warning' | i18n }}
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ 'mwallet_passphrase_confirm' | i18n }}</mat-label>
        <input
          matInput
          type="password"
          [(ngModel)]="passphraseConfirm"
          [disabled]="disabled()"
          autocomplete="off"
        />
      </mat-form-field>

      @if (passphraseConfirm() && passphrase() !== passphraseConfirm()) {
        <p class="error-text">{{ 'passphrase_mismatch' | i18n }}</p>
      }
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

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      .full-width {
        width: 100%;
      }

      :host-context(.dark-theme) {
        .hint-text {
          color: rgba(255, 255, 255, 0.6);
        }

        .warning-text {
          color: rgba(255, 255, 255, 0.8);
          background: rgba(255, 183, 77, 0.12);
        }
      }
    `,
  ],
})
export class AtRestPassphraseSectionComponent {
  /** i18n key explaining what this secret protects in the hosting flow. */
  readonly hintKey = input.required<string>();
  readonly disabled = input(false);
  readonly passphrase = model('');
  readonly passphraseConfirm = model('');

  /** Empty (= no secret) or both fields matching. */
  valid(): boolean {
    return !this.passphrase() || this.passphrase() === this.passphraseConfirm();
  }
}
