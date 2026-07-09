import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppModeService } from '../services/app-mode.service';

/**
 * MiningOnlyGuard allows access only when the app is in mining-only mode
 * or in mobile mode (which includes mining).
 * Used to protect the /miner routes.
 */
export const miningOnlyGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (appMode.isMiningOnly() || appMode.isMobileMode()) {
    return true;
  }

  // Redirect to normal auth flow if not in mining-only/mobile mode
  return router.createUrlTree(['/auth']);
};

/**
 * NotMiningOnlyGuard allows access only when the app is NOT in mining-only
 * or mobile mode. Used to protect the Core-RPC-backed desktop wallet routes
 * from being accessed in those modes.
 */
export const notMiningOnlyGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (!appMode.isMiningOnly() && !appMode.isMobileMode()) {
    return true;
  }

  // Redirect to miner route in mining-only/mobile mode
  return router.createUrlTree(['/miner']);
};
