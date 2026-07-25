import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { RestoreWalletFlowComponent } from '../../../wallet-setup/restore-wallet-flow.component';

/**
 * ImportWalletComponent — the desktop /auth host for the shared
 * RestoreWalletFlowComponent (the page itself lives in
 * features/wallet-setup and is also mounted by the mobile shell).
 * This host only provides the auth-page chrome and post-restore
 * navigation.
 */
@Component({
  selector: 'app-import-wallet',
  standalone: true,
  imports: [RestoreWalletFlowComponent],
  template: `
    <div class="import-wallet-container">
      <app-restore-wallet-flow
        [showCancel]="true"
        settingsLink="/settings"
        doneLabelKey="dashboard"
        (cancelled)="router.navigate(['/auth'])"
        (done)="router.navigate(['/dashboard'])"
      />
    </div>
  `,
  styles: [
    `
      .import-wallet-container {
        min-height: 100vh;
        padding: 24px;
        background: #eceff1;
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }

      app-restore-wallet-flow {
        flex: 1;
      }
    `,
  ],
})
export class ImportWalletComponent {
  protected readonly router = inject(Router);
}
