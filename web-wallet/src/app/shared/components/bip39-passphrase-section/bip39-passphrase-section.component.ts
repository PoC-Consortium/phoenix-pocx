import { Component, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../core/i18n';

/**
 * Bip39PassphraseSectionComponent — the standard optional BIP39 25th-word
 * block: toggle checkbox, boxed warning, passphrase field with a single
 * reveal toggle and (create mode) a confirm field with inline mismatch
 * error. Shared by the desktop create/import wizards and the mobile
 * create/restore pages.
 *
 * mode 'create': set-it-and-remember warning + confirm field.
 * mode 'restore': exact-word warning, NO confirm — a wrong word simply
 * derives a different (empty) wallet; the restore probe is the real check.
 *
 * The 25th word is folded into the seed derivation and is SEPARATE from
 * any at-rest encryption passphrase a parent page may ask for.
 */
@Component({
  selector: 'app-bip39-passphrase-section',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    I18nPipe,
  ],
  template: `
    <mat-checkbox [(ngModel)]="enabled" [disabled]="disabled()" class="bip39-toggle">
      {{ 'use_bip39_passphrase' | i18n }}
    </mat-checkbox>

    @if (enabled()) {
      <p class="warning-text">
        <mat-icon class="warning-icon">warning</mat-icon>
        {{ (mode() === 'create' ? 'bip39_passphrase_warning' : 'bip39_restore_warning') | i18n }}
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>{{ 'bip39_passphrase' | i18n }}</mat-label>
        <!-- The 25th word is byte-significant: keep the platform from
             auto-capitalizing/autocorrecting it when revealed. -->
        <input
          matInput
          [type]="visible() ? 'text' : 'password'"
          [(ngModel)]="passphrase"
          [disabled]="disabled()"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
        />
        <button
          mat-icon-button
          matSuffix
          type="button"
          (click)="visible.set(!visible())"
          [attr.aria-label]="(visible() ? 'hide_passphrase' : 'show_passphrase') | i18n"
          [matTooltip]="(visible() ? 'hide_passphrase' : 'show_passphrase') | i18n"
        >
          <mat-icon>{{ visible() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
      </mat-form-field>

      @if (mode() === 'create') {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>{{ 'confirm_bip39_passphrase' | i18n }}</mat-label>
          <input
            matInput
            [type]="visible() ? 'text' : 'password'"
            [(ngModel)]="passphraseConfirm"
            [disabled]="disabled()"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
          />
        </mat-form-field>

        @if (passphraseConfirm() && passphrase() !== passphraseConfirm()) {
          <p class="error-text">{{ 'passphrase_mismatch' | i18n }}</p>
        }
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .bip39-toggle {
        display: block;
        margin: 4px 0 12px;
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

      .full-width {
        width: 100%;
      }

      .error-text {
        color: #c62828;
        font-size: 13px;
        margin: 0 0 12px;
      }

      :host-context(.dark-theme) {
        .warning-text {
          color: rgba(255, 255, 255, 0.8);
          background: rgba(255, 183, 77, 0.12);
        }
      }
    `,
  ],
})
export class Bip39PassphraseSectionComponent {
  readonly mode = input<'create' | 'restore'>('create');
  readonly disabled = input(false);
  /** Whether the 25th word is enabled (two-way). */
  readonly enabled = model(false);
  readonly passphrase = model('');
  /** Only collected in 'create' mode. */
  readonly passphraseConfirm = model('');
  /** Reveal toggle (verify what was typed) — one eye for both fields. */
  readonly visible = signal(false);
}
