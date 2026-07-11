import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { I18nPipe } from '../../../../core/i18n';
import { isInvalidWalletName, isWalletNameTaken } from '../../wallet-name';

/**
 * WalletNameSectionComponent - the "name your wallet" section shared by the
 * three acquisition flows (create / restore / import-descriptor).
 *
 * Owner rule (feedback round 8): naming comes FIRST — a separate first step
 * on the stepped create flow, the first thing on the all-in-one restore and
 * import pages — so one component keeps the three visually identical.
 *
 * Renders the badge heading, the pre-fill explanation, and the outlined
 * name field with the desktop naming rules mirrored live
 * (`isWalletNameTaken` / `isInvalidWalletName` against `existingNames`).
 * The field's subscript is `subscriptSizing="dynamic"`: hints and errors
 * that wrap in longer locales grow the field instead of overflowing the
 * fixed one-line subscript box onto whatever follows (the import page's
 * overlay bug).
 *
 * API:
 * - `name`          - two-way bound wallet name (`[(name)]`); parents keep
 *                     pre-filling it with `suggestWalletName(...)`
 * - `existingNames` - registry names for the case-insensitive conflict check
 * - `disabled`      - freeze the field while the flow commits
 * - `conflict` / `invalid` / `hasError` - live verdicts for the parents'
 *   button gating (template ref: `#nameSection`) and submit guards
 */
@Component({
  selector: 'app-mwallet-name-section',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatIconModule, MatInputModule, I18nPipe],
  template: `
    <h3 class="name-heading">
      <mat-icon class="name-icon">badge</mat-icon>
      {{ 'wallet_name' | i18n }}
    </h3>
    <p class="hint-text">{{ 'mwallet_name_hint' | i18n }}</p>
    <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
      <mat-label>{{ 'wallet_name' | i18n }}</mat-label>
      <input
        matInput
        [ngModel]="name()"
        (ngModelChange)="name.set($event)"
        [disabled]="disabled()"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
      />
      @if (conflict()) {
        <mat-error>{{ 'wallet_name_conflict' | i18n }}</mat-error>
      } @else if (invalid()) {
        <mat-error>{{ 'wallet_name_invalid_local' | i18n }}</mat-error>
      } @else {
        <mat-hint>{{ 'wallet_name_hint_local' | i18n }}</mat-hint>
      }
    </mat-form-field>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .name-heading {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 4px;
        font-size: 15px;
        font-weight: 500;

        .name-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #1976d2;
        }
      }

      .hint-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 12px;
        margin: 0 0 12px;
      }

      .full-width {
        width: 100%;
      }

      :host-context(.dark-theme) .hint-text {
        color: rgba(255, 255, 255, 0.6);
      }
    `,
  ],
})
export class WalletNameSectionComponent {
  /** The wallet name, two-way bound; parents pre-fill the suggestion. */
  readonly name = model('');
  /** Registry names for suggestion + case-insensitive conflict checks. */
  readonly existingNames = input<string[]>([]);
  readonly disabled = input(false);

  /** Mirror the Rust-side naming rules before the commit (desktop parity). */
  readonly conflict = computed(() => isWalletNameTaken(this.name(), this.existingNames()));
  readonly invalid = computed(() => isInvalidWalletName(this.name()));
  readonly hasError = computed(() => this.conflict() || this.invalid());
}
