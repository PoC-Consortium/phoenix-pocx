import { Component, Input, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { I18nPipe } from '../../../core/i18n';

export interface BreadcrumbItem {
  path: string;
  label: string;
}

/**
 * PageLayoutComponent provides a consistent page layout with:
 * - Page title and optional subtitle
 * - Breadcrumb navigation
 * - Back/forward navigation buttons
 * - Content projection for page content
 *
 * Usage:
 * <app-page-layout title="Dashboard" subtitle="Welcome back">
 *   <div>Page content here</div>
 * </app-page-layout>
 */
@Component({
  selector: 'app-page-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatButtonModule, I18nPipe],
  template: `
    <div class="page-layout">
      <!-- Header -->
      <div class="page-header-section">
        <div class="page-header-content">
          <!-- Navigation Row -->
          <div class="nav-row">
            <button
              mat-icon-button
              class="nav-button"
              (click)="goBack()"
              [attr.aria-label]="'back' | i18n"
            >
              <mat-icon>arrow_back</mat-icon>
            </button>

            <!-- Breadcrumbs -->
            <div class="breadcrumbs">
              <a routerLink="/dashboard" class="breadcrumb-link">
                <mat-icon class="home-icon">home</mat-icon>
              </a>
              @for (crumb of breadcrumbs; track crumb.path) {
                <mat-icon class="separator">chevron_right</mat-icon>
                <a [routerLink]="crumb.path" class="breadcrumb-link">{{ crumb.label }}</a>
              }
              @if (title) {
                <mat-icon class="separator">chevron_right</mat-icon>
                <span class="current-page">{{ title }}</span>
              }
            </div>

            <button
              mat-icon-button
              class="nav-button"
              (click)="goForward()"
              [attr.aria-label]="'forward' | i18n"
            >
              <mat-icon>arrow_forward</mat-icon>
            </button>
          </div>

          <!-- Title -->
          @if (title) {
            <h1 class="page-title">{{ title }}</h1>
          }
          @if (subtitle) {
            <p class="page-subtitle">{{ subtitle }}</p>
          }
        </div>
      </div>

      <!-- Content -->
      <div class="page-content-wrapper" [class.wide]="wide" [class.full]="full">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      .page-layout {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      .page-header-section {
        background: linear-gradient(135deg, var(--mdc-theme-primary, #0075d4) 0%, #0062b3 100%);
        color: white;
        padding: 24px;
        min-height: 140px;
      }

      .page-header-content {
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
      }

      .nav-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .nav-button {
        color: rgba(255, 255, 255, 0.8);

        &:hover {
          color: white;
          background: rgba(255, 255, 255, 0.1);
        }
      }

      .breadcrumbs {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        padding: 0 16px;
      }

      .breadcrumb-link {
        color: rgba(255, 255, 255, 0.8);
        text-decoration: none;
        font-size: 14px;

        &:hover {
          color: white;
          text-decoration: underline;
        }
      }

      .home-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .separator {
        color: rgba(255, 255, 255, 0.5);
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      .current-page {
        color: white;
        font-weight: 600;
        font-size: 14px;
      }

      .page-title {
        font-size: 28px;
        font-weight: 600;
        margin: 0 0 8px 0;
      }

      .page-subtitle {
        font-size: 16px;
        margin: 0;
        opacity: 0.9;
      }

      .page-content-wrapper {
        flex: 1;
        padding: 24px;
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;

        &.wide {
          max-width: 1400px;
        }

        &.full {
          max-width: 100%;
        }
      }

      @media (max-width: 599px) {
        .page-header-section {
          padding: 16px;
          min-height: 120px;
        }

        .page-title {
          font-size: 22px;
        }

        .breadcrumbs {
          display: none;
        }

        .page-content-wrapper {
          padding: 16px;
        }
      }
    `,
  ],
})
export class PageLayoutComponent {
  private readonly location = inject(Location);

  @Input() title: string = '';
  @Input() subtitle: string = '';
  @Input() breadcrumbs: BreadcrumbItem[] = [];
  @Input() wide: boolean = false;
  @Input() full: boolean = false;

  goBack(): void {
    this.location.back();
  }

  goForward(): void {
    this.location.forward();
  }
}
