import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AppModeService } from '../services/app-mode.service';

/**
 * MiningOnlyGuard allows access only when the app is in mining-only mode.
 * Used to protect routes that should only be accessible in mining-only mode.
 */
export const miningOnlyGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (appMode.isMiningOnly()) {
    return true;
  }

  // Redirect to normal auth flow if not in mining-only mode
  return router.createUrlTree(['/auth']);
};

/**
 * NotMiningOnlyGuard allows access only when the app is NOT in mining-only mode.
 * Used to protect wallet routes from being accessed in mining-only mode.
 */
export const notMiningOnlyGuard: CanActivateFn = () => {
  const appMode = inject(AppModeService);
  const router = inject(Router);

  if (!appMode.isMiningOnly()) {
    return true;
  }

  // Redirect to miner route if in mining-only mode
  return router.createUrlTree(['/miner']);
};
