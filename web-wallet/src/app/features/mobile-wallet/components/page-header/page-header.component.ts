import { Component, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { I18nPipe } from '../../../../core/i18n';

/**
 * PageHeaderComponent - the mobile subpage header band.
 *
 * The desktop pages' gradient page header (features/send `.header`,
 * transaction-list, receive: `linear-gradient(135deg, #1e3a5f, #2d5a87)`
 * with white, weight-300 title and a translucent back button), sized for
 * mobile. Full-bleed band; the inner row aligns with the 480px page column
 * the mobile pages use.
 *
 * API:
 * - `titleKey`  - i18n key of the page title (required)
 * - `backLink`  - back target (default '/wallet'); null hands control to
 *                 the `back` output only (e.g. send's stage-aware back)
 * - `back`      - emitted on every back tap, before any navigation
 * - projected content - right-aligned extras (icon buttons, the send
 *   page's available-balance chip); projected icon buttons are tinted
 *   white for the gradient surface
 */
@Component({
  selector: 'app-mwallet-page-header',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, I18nPipe],
  template: `
    <div class="header-band">
      <div class="header-inner">
        <button mat-icon-button class="back-button" (click)="onBack()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h1 class="page-title">{{ titleKey() | i18n }}</h1>
        <span class="spacer"></span>
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        flex-shrink: 0;
      }

      /* Gradient band on the shared balance-band token — the same height
         every unified page header uses (in tandem with the menu balance
         block; responsive via the token, not a local breakpoint). */
      .header-band {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        height: var(--menu-balance-h);
        box-sizing: border-box;
        padding: 0 16px;
        display: flex;
        align-items: stretch;
      }

      /* Spans the full page width (the app-wide header rule): back arrow at
         the page's left edge, actions at the right — not the card column. */
      .header-inner {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 100%;
      }

      .back-button {
        color: rgba(255, 255, 255, 0.9);
        flex-shrink: 0;
        margin-left: -8px;

        &:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      }

      /* Desktop header h1: weight 300, white — mobile-sized. */
      .page-title {
        margin: 0;
        font-size: 20px;
        font-weight: 300;
        color: white;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .spacer {
        flex: 1;
      }

      /* Projected right-side icon buttons (refresh, add contact, ...):
         the desktop header's translucent-white button treatment. */
      :host ::ng-deep .header-inner .mat-mdc-icon-button {
        color: rgba(255, 255, 255, 0.9);

        &:disabled {
          color: rgba(255, 255, 255, 0.4);
        }
      }

      /* Desktop keeps the same gradient in dark theme (send/receive/
         transaction-list :host-context(.dark-theme) .header). */
      :host-context(.dark-theme) .header-band {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      }
    `,
  ],
})
export class PageHeaderComponent {
  private readonly router = inject(Router);

  /** i18n key of the page title. */
  readonly titleKey = input.required<string>();

  /** Back navigation target; null = emit `back` only (custom handling). */
  readonly backLink = input<string | null>('/wallet');

  /** Emitted on every back tap (before any backLink navigation). */
  readonly back = output<void>();

  onBack(): void {
    this.back.emit();
    const link = this.backLink();
    if (link !== null) {
      void this.router.navigate([link]);
    }
  }
}
