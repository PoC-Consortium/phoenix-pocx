import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppModeService } from '../services/app-mode.service';

/**
 * MobileWalletGuard protects the /wallet routes, which are backed by the
 * nodeless BTCX wallet rather than a Bitcoin Core node. Admitted:
 * - mobile mode (Android: wallet + mining),
 * - wallet-only mode (the wallet-only flavor / desktop --wallet-only).
 *
 * Desktop remote (Electrum) mode does NOT use these routes — it runs the
 * full desktop pages over the same btcx wallet backend.
 */
export const mobileWalletGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (appMode.isMobileMode() || appMode.isWalletOnly()) {
    return true;
  }

  // Mining-only launches go back to the miner — the nodeless wallet is a
  // wallet feature, not a miner one.
  if (appMode.isMiningOnly()) {
    return router.createUrlTree(['/miner']);
  }

  return router.createUrlTree(['/auth']);
};
