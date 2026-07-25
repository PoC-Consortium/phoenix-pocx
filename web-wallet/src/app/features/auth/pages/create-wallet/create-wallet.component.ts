import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { I18nService } from '../../../../core/i18n';
import { CreateWalletFlowComponent } from '../../../wallet-setup/create-wallet-flow.component';

/**
 * CreateWalletComponent — the desktop /auth host for the shared
 * CreateWalletFlowComponent (the wizard itself lives in
 * features/wallet-setup and is also mounted by the mobile shell).
 * This host only provides the auth-page chrome and post-create navigation.
 */
@Component({
  selector: 'app-create-wallet',
  standalone: true,
  imports: [MatSnackBarModule, CreateWalletFlowComponent],
  template: `
    <div class="create-wallet-container">
      <app-create-wallet-flow
        [showCancel]="true"
        (cancelled)="router.navigate(['/auth'])"
        (created)="onCreated($event)"
      />
    </div>
  `,
  styles: [
    `
      .create-wallet-container {
        min-height: 100vh;
        padding: 24px;
        background: #eceff1;
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }

      app-create-wallet-flow {
        flex: 1;
      }
    `,
  ],
})
export class CreateWalletComponent {
  protected readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);

  onCreated(name: string): void {
    this.snackBar.open(this.i18n.get('wallet_created_success', { name }), undefined, {
      duration: 3000,
    });
    void this.router.navigate(['/dashboard']);
  }
}
