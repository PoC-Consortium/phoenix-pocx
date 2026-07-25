import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { sanitizeReturnTo } from '../../return-to';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';
import { RestoreWalletFlowComponent } from '../../../wallet-setup/restore-wallet-flow.component';

/**
 * WalletRestoreComponent — the mobile-shell host for the shared
 * RestoreWalletFlowComponent (the page itself lives in
 * features/wallet-setup and is also mounted by the desktop /auth flow).
 *
 * Accepts a `returnTo` query param (app-internal path, e.g. the mining
 * setup wizard's address step): the success screen's button then continues
 * there instead of going to /wallet.
 */
@Component({
  selector: 'app-wallet-restore',
  standalone: true,
  imports: [PageHeaderComponent, RestoreWalletFlowComponent],
  template: `
    <app-mwallet-page-header titleKey="mwallet_restore_wallet" />

    <div class="page">
      <app-restore-wallet-flow
        titleKey=""
        [doneLabelKey]="returnTo() ? 'mwallet_continue_setup' : 'mwallet_title'"
        (done)="onDone()"
      />
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
export class WalletRestoreComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly returnTo = computed(() =>
    sanitizeReturnTo(this.route.snapshot.queryParamMap.get('returnTo'))
  );

  async onDone(): Promise<void> {
    const target = this.returnTo();
    if (target) {
      await this.router.navigateByUrl(target);
    } else {
      await this.router.navigate(['/wallet']);
    }
  }
}
