import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { sanitizeReturnTo } from '../../return-to';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';
import { CreateWalletFlowComponent } from '../../../wallet-setup/create-wallet-flow.component';

/**
 * WalletCreateComponent — the mobile-shell host for the shared
 * CreateWalletFlowComponent (the wizard itself lives in
 * features/wallet-setup and is also mounted by the desktop /auth flow).
 *
 * Accepts a `returnTo` query param (app-internal path, e.g. the mining
 * setup wizard's address step) and navigates there instead of /wallet
 * after a successful create.
 */
@Component({
  selector: 'app-wallet-create',
  standalone: true,
  imports: [PageHeaderComponent, CreateWalletFlowComponent],
  template: `
    <app-mwallet-page-header titleKey="mwallet_create_wallet" />

    <div class="page">
      <app-create-wallet-flow (created)="onCreated()" />
    </div>
  `,
  styles: [
    `
      .page {
        padding: 16px;
      }
    `,
  ],
})
export class WalletCreateComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  async onCreated(): Promise<void> {
    const returnTo = sanitizeReturnTo(this.route.snapshot.queryParamMap.get('returnTo'));
    if (returnTo) {
      await this.router.navigateByUrl(returnTo);
    } else {
      await this.router.navigate(['/wallet']);
    }
  }
}
