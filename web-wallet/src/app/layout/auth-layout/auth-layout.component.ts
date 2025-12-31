import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToolbarComponent } from '../toolbar/toolbar.component';

/**
 * Auth layout component for public routes (login, wallet selection, etc.)
 * Shows toolbar at top with content below (no sidenav).
 */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterOutlet, ToolbarComponent],
  template: `
    <div class="auth-layout">
      <app-toolbar [showSidenavToggle]="false"></app-toolbar>
      <div class="auth-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [
    `
      .auth-layout {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
      }

      .auth-content {
        flex: 1;
        overflow: auto;
      }
    `,
  ],
})
export class AuthLayoutComponent {}
