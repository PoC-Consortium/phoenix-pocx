import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppModeService } from '../services/app-mode.service';

/**
 * MobileWalletGuard allows access only in mobile mode (wallet + mining).
 * Used to protect the /wallet routes, which are backed by the nodeless
 * BTCX wallet rather than a Bitcoin Core node.
 */
export const mobileWalletGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (appMode.isMobileMode()) {
    return true;
  }

  // Mining-only launches go back to the miner, desktop to the auth flow
  if (appMode.isMiningOnly()) {
    return router.createUrlTree(['/miner']);
  }
  return router.createUrlTree(['/auth']);
};
