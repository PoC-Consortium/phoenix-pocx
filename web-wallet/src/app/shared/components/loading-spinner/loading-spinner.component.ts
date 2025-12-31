import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * LoadingSpinnerComponent displays a centered loading spinner with optional message.
 *
 * Usage:
 * <app-loading-spinner />
 * <app-loading-spinner message="Loading wallet..." />
 * <app-loading-spinner [inline]="true" [diameter]="24" />
 */
@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  template: `
    <div class="loading-container" [class.inline]="inline">
      <mat-spinner [diameter]="diameter" [strokeWidth]="strokeWidth"></mat-spinner>
      @if (message) {
        <p class="loading-message">{{ message }}</p>
      }
    </div>
  `,
  styles: [
    `
      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        gap: 16px;

        &.inline {
          flex-direction: row;
          padding: 8px;
          gap: 12px;
        }
      }

      .loading-message {
        color: rgba(0, 0, 0, 0.6);
        font-size: 14px;
        margin: 0;
      }

      :host-context(.dark-theme) {
        .loading-message {
          color: rgba(255, 255, 255, 0.7);
        }
      }
    `,
  ],
})
export class LoadingSpinnerComponent {
  @Input() message?: string;
  @Input() inline: boolean = false;
  @Input() diameter: number = 40;
  @Input() strokeWidth: number = 4;
}
