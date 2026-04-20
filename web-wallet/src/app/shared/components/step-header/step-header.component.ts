import { Component, Input } from '@angular/core';

/**
 * StepHeaderComponent renders the title + numbered-dot progress indicator
 * that appears at the top of the wallet onboarding wizards (create-wallet,
 * import-wallet, watch-only).
 *
 * Styled to sit on the dark gradient header of the surrounding mat-card.
 *
 * Usage:
 *   <app-step-header
 *     [title]="getCurrentStepTitle()"
 *     [currentStep]="currentStep()"
 *     [totalSteps]="4"
 *   ></app-step-header>
 */
@Component({
  selector: 'app-step-header',
  standalone: true,
  template: `
    <div class="step-header">
      <span class="step-title">{{ title }}</span>
      <div class="step-indicators">
        @for (step of steps; track step) {
          <span
            class="step-dot"
            [class.active]="currentStep === step"
            [class.completed]="currentStep > step"
          >
            {{ step }}
          </span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .step-header {
        padding: 16px 24px;
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-radius: 4px 4px 0 0;
      }

      @media (max-width: 599px) {
        .step-header {
          flex-direction: column;
          gap: 12px;
          text-align: center;
        }
      }

      .step-title {
        font-size: 18px;
        font-weight: 500;
      }

      .step-indicators {
        display: flex;
        gap: 8px;
      }

      .step-dot {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 500;
        background: rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.7);

        &.active {
          background: white;
          color: #1e3a5f;
        }

        &.completed {
          background: rgba(255, 255, 255, 0.4);
          color: white;
        }
      }
    `,
  ],
})
export class StepHeaderComponent {
  @Input() title = '';
  @Input() currentStep = 1;
  @Input() totalSteps = 1;

  get steps(): number[] {
    return Array.from({ length: this.totalSteps }, (_, i) => i + 1);
  }
}
