import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nPipe, I18nService, LANGUAGES, Language } from '../../core/i18n';
import { MiningService } from '../../mining/services';

/**
 * MiningLayoutComponent provides a simplified layout for mining-only mode.
 *
 * Features:
 * - Minimal header with app name and status indicators
 * - No sidenav (no wallet navigation)
 * - Full-width content area for mining dashboard
 * - Language selector and exit button
 */
@Component({
  selector: 'app-mining-layout',
  standalone: true,
  imports: [
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    I18nPipe,
  ],
  template: `
    <div class="mining-layout">
      <!-- Simplified Header -->
      <mat-toolbar class="mining-toolbar">
        <div class="toolbar-content">
          <!-- Left: Logo and App Name -->
          <div class="toolbar-left">
            <img src="assets/images/logos/phoenix_v.svg" alt="Phoenix PoCX" class="logo" />
            <span class="app-name">Phoenix PoCX Miner</span>

            <div class="toolbar-separator"></div>

            <!-- Status Indicators -->
            <div class="status-indicators">
              <!-- Miner Indicator -->
              @if (miningService.isConfigured()) {
                <div
                  class="status-indicator"
                  [matTooltip]="
                    miningService.minerRunning()
                      ? ('miner_running' | i18n)
                      : ('miner_stopped' | i18n)
                  "
                >
                  <mat-icon [class.active]="miningService.minerRunning()">hardware</mat-icon>
                </div>
              }

              <!-- Plotter Indicator -->
              @if (miningService.plotterUIState() !== 'complete') {
                <div
                  class="status-indicator"
                  [matTooltip]="
                    miningService.plotterUIState() === 'plotting' ||
                    miningService.plotterUIState() === 'stopping'
                      ? ('plotting_active' | i18n)
                      : ('plotting_pending' | i18n)
                  "
                >
                  <mat-icon
                    [class.active]="
                      miningService.plotterUIState() === 'plotting' ||
                      miningService.plotterUIState() === 'stopping'
                    "
                    >storage</mat-icon
                  >
                </div>
              }
            </div>
          </div>

          <!-- Right: Language and Exit -->
          <div class="toolbar-right">
            <!-- Mining Setup Button -->
            <button
              mat-button
              class="action-button icon-button"
              [routerLink]="['/miner/setup']"
              [matTooltip]="'mining_setup' | i18n"
            >
              <mat-icon class="secondary-text">settings</mat-icon>
            </button>

            <div class="toolbar-separator"></div>

            <!-- Language Selector -->
            <button mat-button [matMenuTriggerFor]="langMenu" class="action-button lang-button">
              <span class="lang-name-text">{{ i18n.currentLanguageName() }}</span>
              <mat-icon class="lang-icon secondary-text">language</mat-icon>
            </button>

            <mat-menu #langMenu="matMenu">
              @for (lang of languages; track lang.code) {
                <button mat-menu-item (click)="setLanguage(lang)">
                  {{ lang.nativeName }}
                </button>
              }
            </mat-menu>
          </div>
        </div>
      </mat-toolbar>

      <!-- Content Area -->
      <div class="mining-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [
    `
      .mining-layout {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: #eaf0f6;
      }

      .mining-toolbar {
        position: relative;
        background-color: white !important;
        color: rgba(0, 0, 0, 0.87) !important;
        padding: 0;
        height: 64px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        flex-shrink: 0;
      }

      .toolbar-content {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: space-between;
      }

      .toolbar-left {
        display: flex;
        align-items: center;
        height: 100%;
        padding-left: 16px;
        gap: 12px;
      }

      .logo {
        width: 32px;
        height: 32px;
      }

      .app-name {
        font-size: 16px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.87);
      }

      .toolbar-right {
        display: flex;
        align-items: center;
        height: 100%;
      }

      .toolbar-separator {
        height: 64px;
        width: 1px;
        background: rgba(0, 0, 0, 0.12);
      }

      .action-button {
        min-width: 64px;
        height: 64px;
        border-radius: 0;
      }

      .icon-button {
        min-width: 56px;
        width: 56px;
        padding: 0 !important;
        justify-content: center !important;

        mat-icon {
          font-size: 24px;
          width: 24px;
          height: 24px;
          margin: 0 !important;
        }
      }

      .secondary-text {
        color: rgba(0, 0, 0, 0.54);
      }

      .status-indicators {
        display: flex;
        align-items: center;
        height: 64px;
        padding: 0 12px;
        gap: 8px;
      }

      .status-indicator {
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 22px;
          width: 22px;
          height: 22px;
          color: rgba(0, 0, 0, 0.25);
          transition: color 0.2s ease;

          &.active {
            color: #4caf50;
          }
        }
      }

      .lang-button {
        .lang-name-text {
          color: rgba(0, 0, 0, 0.87);
          display: inline;
        }

        .lang-icon {
          display: none;
          font-size: 24px;
          width: 24px;
          height: 24px;
        }

        @media (max-width: 600px) {
          .lang-name-text {
            display: none;
          }

          .lang-icon {
            display: inline;
          }
        }
      }

      .mining-content {
        flex: 1;
        overflow: auto;
        display: flex;
        flex-direction: column;
      }

      :host-context(.dark-theme) {
        .mining-layout {
          background: #303030;
        }

        .mining-toolbar {
          background-color: #424242 !important;
          color: white !important;
        }

        .app-name {
          color: white;
        }

        .secondary-text {
          color: rgba(255, 255, 255, 0.7);
        }

        .toolbar-separator {
          background: rgba(255, 255, 255, 0.12);
        }
      }

      @media (max-width: 600px) {
        .mining-toolbar {
          height: 56px;
        }

        .action-button {
          min-width: 48px;
          height: 56px;
        }

        .icon-button {
          min-width: 48px;
          width: 48px;

          mat-icon {
            font-size: 22px;
            width: 22px;
            height: 22px;
          }
        }

        .toolbar-separator {
          height: 56px;
        }

        .app-name {
          display: none;
        }

        .status-indicators {
          height: 56px;
        }
      }
    `,
  ],
})
export class MiningLayoutComponent {
  readonly i18n = inject(I18nService);
  readonly miningService = inject(MiningService);

  languages: Language[] = LANGUAGES;

  setLanguage(lang: Language): void {
    this.i18n.setLanguageByCode(lang.code);
  }
}
