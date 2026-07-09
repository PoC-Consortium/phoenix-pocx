import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { Store } from '@ngrx/store';
import { AppModeService } from '../services/app-mode.service';
import { ElectronService } from '../services/electron.service';
import { selectNodelessWallet } from '../../store/settings/settings.selectors';

/**
 * MobileWalletGuard protects the /wallet routes, which are backed by the
 * nodeless BTCX wallet rather than a Bitcoin Core node. Admitted:
 * - mobile mode (Android: wallet + mining),
 * - wallet-only mode (the wallet-only flavor / desktop --wallet-only),
 * - desktop wallet mode with the "Nodeless wallet (experimental)" setting
 *   enabled.
 */
export const mobileWalletGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);
  const store = inject(Store);
  const electron = inject(ElectronService);

  if (appMode.isMobileMode() || appMode.isWalletOnly()) {
    return true;
  }

  // Mining-only launches go back to the miner — the nodeless wallet is a
  // wallet feature, not a miner one.
  if (appMode.isMiningOnly()) {
    return router.createUrlTree(['/miner']);
  }

  // Desktop: admitted behind the experimental nodeless-wallet toggle
  // (settings are loaded in an APP_INITIALIZER, so the selector is ready).
  if (electron.isDesktop && store.selectSignal(selectNodelessWallet)()) {
    return true;
  }

  return router.createUrlTree(['/auth']);
};
