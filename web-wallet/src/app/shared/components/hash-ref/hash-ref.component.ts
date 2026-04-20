import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe } from '../../../core/i18n';
import { ClipboardService } from '../../services';
import { BlockExplorerService } from '../../services';

export type HashRefKind = 'address' | 'txid' | 'blockhash' | 'plain';

/**
 * Unified renderer for a hash-like value (address, txid, block hash, other).
 *
 * Rule the app follows consistently:
 *  - If a kind has an internal details route, the text is a router link.
 *  - Copy-to-clipboard and open-in-explorer are always explicit icon buttons,
 *    never hidden behind a text click.
 *
 * `kind` drives both whether the text is a link and whether the explorer
 * button is shown. `plain` renders copy-only text (merkle root, chainwork,
 * raw hex, etc.).
 */
@Component({
  selector: 'app-hash-ref',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, MatButtonModule, MatIconModule, MatTooltipModule, I18nPipe],
  template: `
    <span class="hash-ref" [class.hash-ref-full]="!truncate()">
      @if (effectiveLink()) {
        <a class="hash-text hash-link" [routerLink]="effectiveLink()" [matTooltip]="value()">
          {{ displayValue() }}
        </a>
      } @else {
        <span class="hash-text" [matTooltip]="value()">{{ displayValue() }}</span>
      }
      <button
        mat-icon-button
        class="hash-btn"
        (click)="copy()"
        [matTooltip]="'click_to_copy' | i18n"
        [attr.aria-label]="'click_to_copy' | i18n"
      >
        <mat-icon>content_copy</mat-icon>
      </button>
      @if (hasExplorer()) {
        <button
          mat-icon-button
          class="hash-btn"
          (click)="openExplorer()"
          [matTooltip]="'view_in_explorer' | i18n"
          [attr.aria-label]="'view_in_explorer' | i18n"
        >
          <mat-icon>open_in_new</mat-icon>
        </button>
      }
    </span>
  `,
  styles: [
    `
      .hash-ref {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-family: monospace;
        font-size: 12px;
        max-width: 100%;
        min-width: 0;
      }

      .hash-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(0, 0, 0, 0.75);
      }

      .hash-ref-full .hash-text {
        overflow: visible;
        white-space: normal;
        word-break: break-all;
      }

      .hash-link {
        color: #1565c0;
        text-decoration: none;
        cursor: pointer;

        &:hover {
          text-decoration: underline;
        }
      }

      .hash-btn {
        width: 24px;
        height: 24px;
        line-height: 24px;
        padding: 0;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }

      :host-context(.dark-theme) .hash-text {
        color: rgba(255, 255, 255, 0.85);
      }
    `,
  ],
})
export class HashRefComponent {
  private readonly clipboard = inject(ClipboardService);
  private readonly blockExplorer = inject(BlockExplorerService);

  readonly value = input.required<string>();
  readonly kind = input<HashRefKind>('plain');
  /** Appended verbatim after the truncated text (e.g. ":3" for vout). */
  readonly suffix = input<string>('');
  readonly startChars = input<number>(16);
  readonly endChars = input<number>(12);
  /** Show the full value instead of truncating. */
  readonly truncate = input<boolean>(true);
  /**
   * Suppress the internal router link even for kinds that have one. Useful when
   * the target detail page cannot meaningfully populate for this value (e.g.
   * referencing a prev-tx whose body we don't have).
   */
  readonly link = input<boolean>(true);

  readonly displayValue = computed<string>(() => {
    const v = this.value() ?? '';
    const suffix = this.suffix();
    if (!this.truncate()) return `${v}${suffix}`;
    const start = this.startChars();
    const end = this.endChars();
    const truncated = v.length <= start + end + 3 ? v : `${v.slice(0, start)}...${v.slice(-end)}`;
    return `${truncated}${suffix}`;
  });

  /** Router link target, or null if the kind has no internal page or linking is disabled. */
  readonly effectiveLink = computed<string[] | null>(() => {
    if (!this.link()) return null;
    const v = this.value();
    if (!v) return null;
    switch (this.kind()) {
      case 'txid':
        return ['/blocks', 'tx', v];
      case 'blockhash':
        return ['/blocks', v];
      case 'address':
      case 'plain':
      default:
        return null;
    }
  });

  readonly hasExplorer = computed(() => {
    const k = this.kind();
    return k === 'address' || k === 'txid' || k === 'blockhash';
  });

  copy(): void {
    const v = this.value();
    if (v) this.clipboard.copy(v);
  }

  openExplorer(): void {
    const v = this.value();
    if (!v) return;
    switch (this.kind()) {
      case 'address':
        this.blockExplorer.openAddress(v);
        break;
      case 'txid':
        this.blockExplorer.openTransaction(v);
        break;
      case 'blockhash':
        this.blockExplorer.openBlock(v);
        break;
    }
  }
}
